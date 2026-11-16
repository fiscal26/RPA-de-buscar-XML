begin;

-- A decisão do escritório existe mesmo sem datas suficientes para um cadastro fiscal.
create table if not exists public.xml_mei_acompanhamento (
  org_id uuid not null references public.organizacoes(id) on delete cascade,
  cnpj text not null check (cnpj ~ '^[0-9]{14}$'),
  estado text not null check (estado in ('ativo','pausado','ignorado')),
  origem text not null default 'manual', motivo text not null default '',
  versao bigint not null default 1,
  atualizado_por uuid references auth.users(id) on delete set null,
  atualizado_em timestamptz not null default now(),
  primary key(org_id,cnpj)
);
alter table public.xml_mei_cadastros add column if not exists origem text not null default 'manual';
create table if not exists public.xml_mei_historico (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizacoes(id) on delete cascade, cnpj text not null,
  antes jsonb, depois jsonb not null, cadastro jsonb,
  usuario_id uuid references auth.users(id) on delete set null, criado_em timestamptz not null default now()
);
create table if not exists public.xml_mei_sincronizacoes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizacoes(id) on delete cascade,
  origem text not null check (origem in ('manual','automatico','indicacao','periodico')),
  estado text not null default 'aberto' check (estado in ('aberto','concluido')),
  solicitado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now()
);
create unique index if not exists xml_mei_lote_aberto on public.xml_mei_sincronizacoes(org_id,origem) where estado='aberto';
create index if not exists xml_mei_lote_org on public.xml_mei_sincronizacoes(org_id,criado_em desc);
create table if not exists public.xml_mei_sincronizacao_itens (
  id uuid primary key default gen_random_uuid(),
  lote_id uuid not null references public.xml_mei_sincronizacoes(id) on delete cascade,
  org_id uuid not null references public.organizacoes(id) on delete cascade,
  cnpj text not null check (cnpj ~ '^[0-9]{14}$'), nome text not null,
  resultado text not null default 'pendente' check (resultado in ('pendente','processando','elegivel','incluido','acompanhado','nao_mei','revisar','dispensado','erro')),
  mensagem text not null default '', dados jsonb, consultado_em timestamptz,
  decisao_versao bigint not null default 0,
  reserva uuid, reserva_ate timestamptz, tentativas integer not null default 0,
  proxima_tentativa timestamptz not null default now(), criado_em timestamptz not null default now(),
  concluido_em timestamptz, unique(lote_id,cnpj)
);
create index if not exists xml_mei_item_fila on public.xml_mei_sincronizacao_itens(proxima_tentativa,criado_em) where resultado in ('pendente','processando');
create index if not exists xml_mei_item_org on public.xml_mei_sincronizacao_itens(org_id,cnpj,criado_em desc);
create table if not exists public.xml_mei_worker (
  id boolean primary key default true check(id), ultimo_sinal timestamptz not null default now()
);

-- Somente leitura por sessão; alterações passam pelas operações autorizadas do servidor.
alter table public.xml_mei_acompanhamento enable row level security;
alter table public.xml_mei_historico enable row level security;
alter table public.xml_mei_sincronizacoes enable row level security;
alter table public.xml_mei_sincronizacao_itens enable row level security;
alter table public.xml_mei_worker enable row level security;
revoke all on public.xml_mei_acompanhamento,public.xml_mei_historico,public.xml_mei_sincronizacoes,public.xml_mei_sincronizacao_itens,public.xml_mei_worker from public,anon,authenticated;
grant select on public.xml_mei_acompanhamento,public.xml_mei_historico,public.xml_mei_sincronizacoes,public.xml_mei_sincronizacao_itens,public.xml_mei_worker to authenticated;
grant all on public.xml_mei_acompanhamento,public.xml_mei_historico,public.xml_mei_sincronizacoes,public.xml_mei_sincronizacao_itens,public.xml_mei_worker to service_role;
grant usage,select on sequence public.xml_mei_historico_id_seq to service_role;
-- Dependências das RPCs invoker: não depender de grants padrão da instalação.
grant select on public.organizacoes,public.perfis,public.xml_empresas,public.xml_nfse_empresas to service_role;
grant select,insert,update on public.xml_mei_cadastros to service_role;
drop policy if exists mei_acomp_ler on public.xml_mei_acompanhamento;
create policy mei_acomp_ler on public.xml_mei_acompanhamento for select to authenticated using ((select public.sou_admin()) or org_id=(select public.minha_org()));
drop policy if exists mei_hist_ler on public.xml_mei_historico;
create policy mei_hist_ler on public.xml_mei_historico for select to authenticated using ((select public.sou_admin()) or org_id=(select public.minha_org()));
drop policy if exists mei_lote_ler on public.xml_mei_sincronizacoes;
create policy mei_lote_ler on public.xml_mei_sincronizacoes for select to authenticated using ((select public.sou_admin()) or org_id=(select public.minha_org()));
drop policy if exists mei_item_ler on public.xml_mei_sincronizacao_itens;
create policy mei_item_ler on public.xml_mei_sincronizacao_itens for select to authenticated using ((select public.sou_admin()) or org_id=(select public.minha_org()));
drop policy if exists mei_worker_ler on public.xml_mei_worker;
create policy mei_worker_ler on public.xml_mei_worker for select to authenticated using (true);

-- Migração conservadora: não consulta API nem inclui toda a carteira antiga.
insert into public.xml_mei_acompanhamento(org_id,cnpj,estado,origem,atualizado_por)
  select org_id,cnpj,case when ativo then 'ativo' else 'pausado' end,'legado',atualizado_por from public.xml_mei_cadastros
  on conflict do nothing;

create or replace function public.xml_mei_nome(p_org uuid,p_cnpj text) returns text
language sql stable security invoker set search_path=public as $$
  select nome from (select nome,0 ordem from public.xml_nfse_empresas where org_id=p_org and cnpj=p_cnpj
    union all select nome,1 from public.xml_empresas where org_id=p_org and cnpj=p_cnpj) e order by ordem limit 1
$$;
create or replace function public.xml_mei_autorizar(p_org uuid,p_usuario uuid) returns void
language plpgsql security invoker set search_path=public as $$
begin
  if not exists (select 1 from public.perfis p where p.id=p_usuario and p.ativo and
    (p.papel='admin' or (p.org_id=p_org and p.papel='gestor')))
    or not exists(select 1 from public.organizacoes where id=p_org and ativo) then
    raise exception 'Somente gestor ou administrador do escritório pode alterar o acompanhamento MEI';
  end if;
end $$;
create or replace function public.xml_mei_pode_consultar(p_org uuid,p_documento text,p_competencia date default null) returns boolean
language sql stable security invoker set search_path=public as $$
  with doc as (select case when length(p_documento)=14 then p_documento else
    (select cnpj from public.xml_empresas where org_id=p_org and ie=p_documento limit 1) end cnpj)
  select not exists(select 1 from public.xml_mei_acompanhamento a,doc d where a.org_id=p_org and a.cnpj=d.cnpj and a.estado<>'ativo')
    and not exists(select 1 from public.xml_mei_cadastros c,doc d where c.org_id=p_org and c.cnpj=d.cnpj
      and (not c.ativo or (p_competencia is not null and (p_competencia<c.inicio_mei or (c.fim_mei is not null and p_competencia>c.fim_mei)))))
$$;

create or replace function public.xml_mei_decidir(p_org uuid,p_cnpj text,p_usuario uuid,p_acao text,
  p_abertura date default null,p_inicio date default null,p_fim date default null,p_motivo text default '',p_versao bigint default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_nome text; v_antes public.xml_mei_acompanhamento; v_estado text; v_cadastro public.xml_mei_cadastros;
begin
  perform public.xml_mei_autorizar(p_org,p_usuario);
  v_nome:=public.xml_mei_nome(p_org,p_cnpj);
  if v_nome is null or p_cnpj !~ '^[0-9]{14}$' then raise exception 'Empresa não encontrada neste escritório'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mei:'||p_org::text||':'||p_cnpj,0));
  select * into v_antes from public.xml_mei_acompanhamento where org_id=p_org and cnpj=p_cnpj;
  if p_versao is not null and p_versao<>coalesce(v_antes.versao,0) then raise exception 'O acompanhamento mudou. Atualize a página antes de confirmar'; end if;
  if p_acao not in ('salvar','salvar_pausado','pausar','ignorar','reativar','encerrar') then raise exception 'Ação inválida'; end if;
  select * into v_cadastro from public.xml_mei_cadastros where org_id=p_org and cnpj=p_cnpj;
  if p_acao in ('salvar','salvar_pausado') then
    if p_abertura is null or p_inicio is null or p_abertura>(now() at time zone 'America/Sao_Paulo')::date
      or p_inicio<date_trunc('month',p_abertura)::date or p_inicio>date_trunc('month',now() at time zone 'America/Sao_Paulo')::date
      or extract(day from p_inicio)<>1 or (p_fim is not null and (p_fim<p_inicio or extract(day from p_fim)<>1)) then raise exception 'Confira a abertura e o período MEI'; end if;
    insert into public.xml_mei_cadastros(org_id,cnpj,nome,ativo,inicio_atividade,inicio_mei,fim_mei,atualizado_por,origem)
      values(p_org,p_cnpj,v_nome,p_acao='salvar',p_abertura,p_inicio,p_fim,p_usuario,'manual')
      on conflict(org_id,cnpj) do update set nome=excluded.nome,ativo=excluded.ativo,inicio_atividade=excluded.inicio_atividade,
        inicio_mei=excluded.inicio_mei,fim_mei=excluded.fim_mei,atualizado_por=p_usuario,atualizado_em=now(),origem='manual';
  elsif p_acao='reativar' then
    if v_cadastro.cnpj is null then raise exception 'Confira as datas no cadastro antes de reativar'; end if;
    update public.xml_mei_cadastros set ativo=true,atualizado_por=p_usuario,atualizado_em=now() where org_id=p_org and cnpj=p_cnpj;
  elsif p_acao='encerrar' then
    if v_cadastro.cnpj is null or p_fim is null or p_fim<v_cadastro.inicio_mei or extract(day from p_fim)<>1 then raise exception 'Informe o último mês MEI válido'; end if;
    update public.xml_mei_cadastros set ativo=true,fim_mei=p_fim,atualizado_por=p_usuario,atualizado_em=now(),origem='manual' where org_id=p_org and cnpj=p_cnpj;
  else
    update public.xml_mei_cadastros set ativo=false,atualizado_por=p_usuario,atualizado_em=now() where org_id=p_org and cnpj=p_cnpj;
  end if;
  v_estado:=case p_acao when 'pausar' then 'pausado' when 'salvar_pausado' then 'pausado' when 'ignorar' then 'ignorado' else 'ativo' end;
  insert into public.xml_mei_acompanhamento(org_id,cnpj,estado,origem,motivo,versao,atualizado_por)
    values(p_org,p_cnpj,v_estado,'manual',left(coalesce(p_motivo,''),240),coalesce(v_antes.versao,0)+1,p_usuario)
    on conflict(org_id,cnpj) do update set estado=excluded.estado,origem=excluded.origem,motivo=excluded.motivo,
      versao=excluded.versao,atualizado_por=p_usuario,atualizado_em=now();
  insert into public.xml_mei_historico(org_id,cnpj,antes,depois,cadastro,usuario_id)
    select p_org,p_cnpj,to_jsonb(v_antes),to_jsonb(a),to_jsonb(c),p_usuario from public.xml_mei_acompanhamento a
      left join public.xml_mei_cadastros c using(org_id,cnpj) where a.org_id=p_org and a.cnpj=p_cnpj;
  return jsonb_build_object('estado',v_estado);
end $$;

create or replace function public.xml_mei_enfileirar(p_org uuid,p_cnpj text,p_origem text,p_usuario uuid default null) returns uuid
language plpgsql security invoker set search_path=public as $$
declare v_lote uuid; v_nome text; v_doc text;
begin
  if p_origem not in ('manual','automatico','indicacao','periodico') then raise exception 'Origem inválida'; end if;
  if p_origem='manual' then perform public.xml_mei_autorizar(p_org,p_usuario); end if;
  if not exists(select 1 from public.organizacoes where id=p_org and ativo) then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended('mei-fila:'||p_org::text||':'||p_origem,0));
  select id into v_lote from public.xml_mei_sincronizacoes where org_id=p_org and origem=p_origem and estado='aberto';
  if v_lote is null then
    insert into public.xml_mei_sincronizacoes(org_id,origem,solicitado_por) values(p_org,p_origem,p_usuario) returning id into v_lote;
  end if;
  for v_doc,v_nome in select distinct on(cnpj) cnpj,nome from (
      select cnpj,nome from public.xml_nfse_empresas where org_id=p_org
      union all select cnpj,nome from public.xml_empresas where org_id=p_org) e
    where cnpj ~ '^[0-9]{14}$' and (xml_mei_enfileirar.p_cnpj is null or cnpj=xml_mei_enfileirar.p_cnpj) order by cnpj,nome
  loop
    insert into public.xml_mei_sincronizacao_itens(lote_id,org_id,cnpj,nome,decisao_versao,resultado,mensagem)
      select v_lote,p_org,v_doc,v_nome,coalesce(a.versao,0),
        case when coalesce(a.estado,'ativo')<>'ativo' or coalesce(c.ativo,true)=false then 'dispensado' else 'pendente' end,
        case when coalesce(a.estado,'ativo')<>'ativo' or coalesce(c.ativo,true)=false then 'Pausa ou exclusão do escritório respeitada' else '' end
      from (select 1) x left join public.xml_mei_acompanhamento a on a.org_id=p_org and a.cnpj=v_doc
        left join public.xml_mei_cadastros c on c.org_id=p_org and c.cnpj=v_doc
      on conflict(lote_id,cnpj) do nothing;
  end loop;
  update public.xml_mei_sincronizacoes s set estado='concluido' where id=v_lote and not exists(
    select 1 from public.xml_mei_sincronizacao_itens i where i.lote_id=s.id and i.resultado in ('pendente','processando'));
  return v_lote;
end $$;

create or replace function public.xml_mei_pegar_verificacao() returns jsonb
language plpgsql security invoker set search_path=public as $$
declare v public.xml_mei_sincronizacao_itens; v_token uuid:=gen_random_uuid();
begin
  insert into public.xml_mei_worker(id) values(true) on conflict(id) do update set ultimo_sinal=now();
  select i.* into v from public.xml_mei_sincronizacao_itens i join public.organizacoes o on o.id=i.org_id and o.ativo
    where (i.resultado='pendente' and i.proxima_tentativa<=now()) or (i.resultado='processando' and i.reserva_ate<now())
    order by i.proxima_tentativa,i.criado_em,i.id for update of i skip locked limit 1;
  if v.id is null then return null; end if;
  update public.xml_mei_sincronizacao_itens set resultado='processando',reserva=v_token,reserva_ate=now()+interval '45 seconds',
    tentativas=tentativas+1 where id=v.id;
  return jsonb_build_object('id',v.id,'cnpj',v.cnpj,'token',v_token,'tentativas',v.tentativas+1);
end $$;

-- Aplica somente evidência já verificada pelo backend, sob a mesma trava das decisões manuais.
create or replace function public.xml_mei_aplicar_item(p_item uuid,p_usuario uuid default null) returns text
language plpgsql security invoker set search_path=public as $$
declare v public.xml_mei_sincronizacao_itens; a public.xml_mei_acompanhamento; c public.xml_mei_cadastros; v_nome text;
begin
  select * into v from public.xml_mei_sincronizacao_itens where id=p_item for update;
  if v.id is null then raise exception 'Verificação não encontrada'; end if;
  if p_usuario is not null then perform public.xml_mei_autorizar(v.org_id,p_usuario); end if;
  if v.resultado<>'elegivel' then return v.resultado; end if;
  perform pg_advisory_xact_lock(hashtextextended('mei:'||v.org_id::text||':'||v.cnpj,0));
  select * into a from public.xml_mei_acompanhamento where org_id=v.org_id and cnpj=v.cnpj;
  select * into c from public.xml_mei_cadastros where org_id=v.org_id and cnpj=v.cnpj;
  v_nome:=public.xml_mei_nome(v.org_id,v.cnpj);
  if v_nome is null or coalesce(a.estado,'ativo')<>'ativo' or coalesce(c.ativo,true)=false then
    update public.xml_mei_sincronizacao_itens set resultado='dispensado',mensagem='Empresa retirada, pausada ou ignorada' where id=v.id; return 'dispensado';
  end if;
  if coalesce(a.versao,0)<>v.decisao_versao or v.consultado_em is null or v.consultado_em<now()-interval '7 days' then
    update public.xml_mei_sincronizacao_itens set resultado='revisar',mensagem='A decisão ou a validade da consulta mudou. Confira novamente' where id=v.id; return 'revisar';
  end if;
  if c.cnpj is not null then
    update public.xml_mei_sincronizacao_itens set resultado='acompanhado' where id=v.id; return 'acompanhado';
  end if;
  insert into public.xml_mei_cadastros(org_id,cnpj,nome,ativo,inicio_atividade,inicio_mei,origem,atualizado_por)
    values(v.org_id,v.cnpj,v_nome,true,(v.dados->>'abertura')::date,date_trunc('month',(v.dados->>'inicioMei')::date)::date,
      case when p_usuario is null then 'automatico' else 'lote' end,p_usuario);
  insert into public.xml_mei_acompanhamento(org_id,cnpj,estado,origem,versao,atualizado_por)
    values(v.org_id,v.cnpj,'ativo',case when p_usuario is null then 'automatico' else 'lote' end,coalesce(a.versao,0)+1,p_usuario)
    on conflict(org_id,cnpj) do update set versao=excluded.versao,estado='ativo',origem=excluded.origem,atualizado_em=now(),atualizado_por=p_usuario;
  insert into public.xml_mei_historico(org_id,cnpj,antes,depois,cadastro,usuario_id)
    select v.org_id,v.cnpj,to_jsonb(a),to_jsonb(n),to_jsonb(ca),p_usuario from public.xml_mei_acompanhamento n
      join public.xml_mei_cadastros ca using(org_id,cnpj) where n.org_id=v.org_id and n.cnpj=v.cnpj;
  update public.xml_mei_sincronizacao_itens set resultado='incluido',mensagem='Incluída no monitoramento; dados fiscais ainda dependem das consultas' where id=v.id;
  return 'incluido';
end $$;

create or replace function public.xml_mei_finalizar_verificacao(p_item uuid,p_token uuid,p_resultado text,
  p_dados jsonb default null,p_consultado_em timestamptz default null,p_mensagem text default '',p_espera integer default 0)
returns text language plpgsql security invoker set search_path=public as $$
declare v public.xml_mei_sincronizacao_itens; a public.xml_mei_acompanhamento; c public.xml_mei_cadastros; v_origem text; v_r text; v_msg text:=left(p_mensagem,500);
begin
  select * into v from public.xml_mei_sincronizacao_itens where id=p_item for update;
  if v.id is null or v.reserva is distinct from p_token or v.reserva_ate<now() or v.resultado<>'processando' then return 'expirado'; end if;
  if p_dados is not null and (p_dados->>'cnpj') is distinct from v.cnpj then raise exception 'CNPJ da resposta não corresponde ao item'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mei:'||v.org_id::text||':'||v.cnpj,0));
  select * into a from public.xml_mei_acompanhamento where org_id=v.org_id and cnpj=v.cnpj;
  select * into c from public.xml_mei_cadastros where org_id=v.org_id and cnpj=v.cnpj;
  v_r:=p_resultado;
  if coalesce(a.estado,'ativo')<>'ativo' or coalesce(c.ativo,true)=false or public.xml_mei_nome(v.org_id,v.cnpj) is null then v_r:='dispensado'; v_msg:='Empresa retirada, pausada ou ignorada. Decisão do escritório preservada';
  elsif coalesce(a.versao,0)<>v.decisao_versao then v_r:='revisar'; v_msg:='O acompanhamento mudou durante a consulta. Confira a decisão mais recente';
  elsif p_resultado in ('aguardar','erro') then
    if p_resultado='aguardar' or v.tentativas<5 then
      update public.xml_mei_sincronizacao_itens set resultado='pendente',reserva=null,reserva_ate=null,
        tentativas=case when p_resultado='aguardar' then greatest(0,tentativas-1) else tentativas end,
        proxima_tentativa=now()+make_interval(secs=>greatest(13,least(3600,case when p_espera>0 then p_espera else 30*(2^least(v.tentativas,6))::integer end))),
        mensagem=left(p_mensagem,500),dados=coalesce(p_dados,dados),consultado_em=coalesce(p_consultado_em,consultado_em) where id=v.id;
      return 'pendente';
    end if;
  elsif p_resultado='elegivel' then
    if p_dados->>'mei' is distinct from 'true' or p_dados->>'abertura' is null or p_dados->>'inicioMei' is null
      or (p_dados->>'abertura')::date>(now() at time zone 'America/Sao_Paulo')::date
      or (p_dados->>'inicioMei')::date>(now() at time zone 'America/Sao_Paulo')::date
      or date_trunc('month',(p_dados->>'inicioMei')::date)<date_trunc('month',(p_dados->>'abertura')::date)
      or p_consultado_em is null or p_consultado_em<now()-interval '7 days' then v_r:='revisar';
    elsif c.cnpj is not null then
      v_r:=case when c.inicio_atividade=(p_dados->>'abertura')::date and c.inicio_mei=date_trunc('month',(p_dados->>'inicioMei')::date)::date and c.fim_mei is null then 'acompanhado' else 'revisar' end;
    end if;
  elsif p_resultado='nao_mei' and c.cnpj is not null then v_r:='revisar';
  end if;
  if v_r='revisar' and v_msg=left(p_mensagem,500) then
    v_msg:='Confira enquadramento e datas: a informação recebida está incompleta, vencida ou diverge do cadastro confirmado. O cadastro foi preservado';
  elsif v_r='elegivel' and a.cnpj is null and exists(select 1 from public.xml_mei_meses m where m.org_id=v.org_id and
      (m.ie=v.cnpj or m.ie in(select e.ie from public.xml_empresas e where e.org_id=v.org_id and e.cnpj=v.cnpj))) then
    v_msg:=v_msg||' Há histórico MEI anterior sem decisão explícita. Confirme se o cliente quer acompanhamento; a ausência de marcação antiga não informa o motivo.';
  end if;
  update public.xml_mei_sincronizacao_itens set resultado=v_r,dados=p_dados,consultado_em=p_consultado_em,
    mensagem=left(v_msg,500),concluido_em=now(),reserva=null,reserva_ate=null where id=v.id;
  select origem into v_origem from public.xml_mei_sincronizacoes where id=v.lote_id;
  if v_r='elegivel' and v_origem='automatico' then v_r:=public.xml_mei_aplicar_item(v.id); end if;
  update public.xml_mei_sincronizacoes s set estado='concluido' where id=v.lote_id and not exists(
    select 1 from public.xml_mei_sincronizacao_itens i where i.lote_id=s.id and i.resultado in ('pendente','processando'));
  return v_r;
end $$;

create or replace function public.xml_mei_confirmar_lote(p_lote uuid,p_cnpjs text[],p_usuario uuid) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare v_org uuid; v record; v_r text; v_res jsonb:='{}';
begin
  select org_id into v_org from public.xml_mei_sincronizacoes where id=p_lote;
  perform public.xml_mei_autorizar(v_org,p_usuario);
  for v in select id from public.xml_mei_sincronizacao_itens where lote_id=p_lote and cnpj=any(p_cnpjs) and resultado='elegivel' order by cnpj loop
    v_r:=public.xml_mei_aplicar_item(v.id,p_usuario);
    v_res:=jsonb_set(v_res,array[v_r],to_jsonb(coalesce((v_res->>v_r)::integer,0)+1));
  end loop;
  return v_res;
end $$;

-- Novos CNPJs, não toda reimportação: a decisão persistente tem precedência.
create or replace function public.xml_mei_empresa_nova() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
  if new.cnpj !~ '^[0-9]{14}$' or (tg_op='UPDATE' and old.cnpj is not distinct from new.cnpj) then return new; end if;
  if (select count(*) from (select cnpj from public.xml_empresas where org_id=new.org_id and cnpj=new.cnpj
    union all select cnpj from public.xml_nfse_empresas where org_id=new.org_id and cnpj=new.cnpj) e)>1 then return new; end if;
  if not exists(select 1 from public.xml_mei_acompanhamento where org_id=new.org_id and cnpj=new.cnpj) then
    perform public.xml_mei_enfileirar(new.org_id,new.cnpj,'automatico');
  end if;
  return new;
end $$;
drop trigger if exists xml_mei_empresa_nova on public.xml_empresas;
create trigger xml_mei_empresa_nova after insert or update of cnpj on public.xml_empresas for each row execute function public.xml_mei_empresa_nova();
drop trigger if exists xml_mei_empresa_nova on public.xml_nfse_empresas;
create trigger xml_mei_empresa_nova after insert or update of cnpj on public.xml_nfse_empresas for each row execute function public.xml_mei_empresa_nova();

create or replace function public.xml_mei_indicacao_xml() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
  if new.status in ('concluido','sem_notas') and new.detalhes @> '{"mei_nfse":{"detectado_no_xml":true}}'::jsonb
    and not coalesce(old.detalhes @> '{"mei_nfse":{"detectado_no_xml":true}}'::jsonb,false)
    and new.ie ~ '^[0-9]{14}$' then perform public.xml_mei_enfileirar(new.org_id,new.ie,'indicacao'); end if;
  return new;
end $$;
drop trigger if exists xml_mei_indicacao_xml on public.xml_tarefas;
create trigger xml_mei_indicacao_xml after update of detalhes,status on public.xml_tarefas for each row execute function public.xml_mei_indicacao_xml();

-- Bloqueia apenas o serviço MEI em novas tarefas; outros documentos continuam funcionando.
create or replace function public.xml_mei_respeitar_decisao() returns trigger
language plpgsql security invoker set search_path=public as $$
declare v_comp date;
begin
  select competencia into v_comp from public.xml_agendamentos where id=new.agendamento_id and org_id=new.org_id;
  if 'mei'=any(new.tipos) and not public.xml_mei_pode_consultar(new.org_id,new.ie,v_comp) then
    new.tipos:=array_remove(new.tipos,'mei');
    if cardinality(new.tipos)=0 then new.status:='cancelado'; new.mensagem:='Acompanhamento MEI pausado, ignorado ou fora do período'; end if;
  end if;
  return new;
end $$;
drop trigger if exists xml_mei_respeitar_decisao on public.xml_tarefas;
create trigger xml_mei_respeitar_decisao before insert on public.xml_tarefas for each row execute function public.xml_mei_respeitar_decisao();

create or replace function public.xml_mei_revisar_ativos() returns integer
language plpgsql security invoker set search_path=public as $$
declare a record; n integer:=0;
begin
  for a in select x.org_id,x.cnpj from public.xml_mei_acompanhamento x join public.organizacoes o on o.id=x.org_id and o.ativo
    where x.estado='ativo' and not exists(select 1 from public.xml_mei_sincronizacao_itens i where i.org_id=x.org_id and i.cnpj=x.cnpj and i.criado_em>now()-interval '7 days')
    order by x.atualizado_em limit 20 loop
    perform public.xml_mei_enfileirar(a.org_id,a.cnpj,'periodico'); n:=n+1;
  end loop;
  return n;
end $$;
revoke all on function public.xml_mei_revisar_ativos() from public,anon,authenticated;
grant execute on function public.xml_mei_revisar_ativos() to service_role;

create or replace function public.xml_mei_faturamento_lote(p_org uuid,p_cnpjs text[],p_inicio date,p_fim date) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare c text; r jsonb; resultados jsonb:='[]';
begin
  if not coalesce(public.sou_admin() or (p_org=public.minha_org() and public.meu_papel()='gestor'),false) then raise exception 'Sem permissão para este escritório'; end if;
  if cardinality(p_cnpjs)>2000 then raise exception 'Selecione até 2000 empresas por atualização'; end if;
  for c in select distinct unnest(p_cnpjs) loop
    begin
      if public.xml_mei_nome(p_org,c) is null then raise exception 'Empresa não encontrada'; end if;
      r:=public.xml_mei_reprocessar_periodo(p_org,c,p_inicio,p_fim);
      resultados:=resultados||jsonb_build_array(jsonb_build_object('cnpj',c,'consultas',r->'consultas','existente',r->'existente'));
    exception when others then
      resultados:=resultados||jsonb_build_array(jsonb_build_object('cnpj',c,'erro',sqlerrm));
    end;
  end loop;
  return resultados;
end $$;
revoke all on function public.xml_mei_faturamento_lote(uuid,text[],date,date) from public,anon;
grant execute on function public.xml_mei_faturamento_lote(uuid,text[],date,date) to authenticated;
-- A função usa apenas dados visíveis à sessão e não grava diretamente nas tabelas.
grant execute on function public.xml_mei_nome(uuid,text) to authenticated;

revoke all on function public.xml_mei_nome(uuid,text) from public,anon;

-- Nenhuma RPC administrativa nova fica disponível ao navegador.
revoke all on function public.xml_mei_autorizar(uuid,uuid),public.xml_mei_decidir(uuid,text,uuid,text,date,date,date,text,bigint),
 public.xml_mei_enfileirar(uuid,text,text,uuid),public.xml_mei_pegar_verificacao(),public.xml_mei_aplicar_item(uuid,uuid),
 public.xml_mei_finalizar_verificacao(uuid,uuid,text,jsonb,timestamptz,text,integer),public.xml_mei_confirmar_lote(uuid,text[],uuid),
 public.xml_mei_empresa_nova(),public.xml_mei_indicacao_xml(),public.xml_mei_respeitar_decisao() from public,anon,authenticated;
grant execute on function public.xml_mei_nome(uuid,text),public.xml_mei_autorizar(uuid,uuid),public.xml_mei_decidir(uuid,text,uuid,text,date,date,date,text,bigint),
 public.xml_mei_enfileirar(uuid,text,text,uuid),public.xml_mei_pegar_verificacao(),public.xml_mei_aplicar_item(uuid,uuid),
 public.xml_mei_finalizar_verificacao(uuid,uuid,text,jsonb,timestamptz,text,integer),public.xml_mei_confirmar_lote(uuid,text[],uuid),
 public.xml_mei_empresa_nova(),public.xml_mei_indicacao_xml(),public.xml_mei_respeitar_decisao() to service_role;
revoke all on function public.xml_mei_pode_consultar(uuid,text,date) from public,anon;
grant execute on function public.xml_mei_pode_consultar(uuid,text,date) to authenticated,service_role;

create or replace function public.xml_mei_reprocessar(p_org uuid, p_documento text, p_competencia date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cnpj text; v_empresa record; v_nfse record; v_ag uuid; v_ids uuid[] := '{}'; v_ativo uuid; v_criados integer := 0;
begin
  if not coalesce(public.sou_admin() or (p_org = public.minha_org() and public.meu_papel() = 'gestor'), false) then
    raise exception 'Somente gestor ou administrador pode reprocessar';
  end if;
  if p_documento is null or p_documento !~ '^([0-9]{9}|[0-9]{14})$' or p_competencia is null
     or p_competencia < '2018-01-01'::date or extract(day from p_competencia) <> 1
     or p_competencia > date_trunc('month', now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'Escolha uma competência válida, já iniciada';
  end if;
  select e.cnpj into v_cnpj from public.xml_empresas e where e.org_id = p_org and e.ie = p_documento limit 1;
  if length(p_documento) = 14 then v_cnpj := p_documento; end if;
  if not exists (select 1 from public.organizacoes where id = p_org and ativo) then raise exception 'Escritório inativo'; end if;
  if not (exists (select 1 from public.xml_mei_cadastros c where c.org_id = p_org and c.cnpj = v_cnpj and c.ativo
                   and p_competencia >= c.inicio_mei and (c.fim_mei is null or p_competencia <= c.fim_mei))
      or (not exists (select 1 from public.xml_mei_cadastros c where c.org_id = p_org and c.cnpj = v_cnpj)
          and exists (select 1 from public.xml_empresas e where e.org_id = p_org
                       and (e.ie = p_documento or e.cnpj = v_cnpj) and 'mei' = any(e.tipos)))) then
    raise exception 'Empresa não acompanhada como MEI nessa competência';
  end if;
  if not public.xml_mei_pode_consultar(p_org,p_documento,p_competencia) then raise exception 'Acompanhamento pausado, ignorado ou fora do período'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org::text || '|' || coalesce(v_cnpj, p_documento) || '|' || p_competencia::text, 0));
  select * into v_nfse from public.xml_nfse_empresas where org_id = p_org and cnpj = v_cnpj;
  if v_nfse.id is not null then
    select t.agendamento_id into v_ativo from public.xml_tarefas t join public.xml_agendamentos a on a.id=t.agendamento_id
      where t.org_id=p_org and t.nfse_empresa_id=v_nfse.id and a.competencia=p_competencia
        and t.status in ('pendente','processando') order by t.criado_em desc limit 1;
    if v_ativo is not null then
      v_ids := array_append(v_ids, v_ativo);
    else
    if not exists (select 1 from public.xml_nfse_certificados c where c.org_id = p_org
        and (c.procurador or (length(c.cnpj) = 14 and left(c.cnpj,8) = left(v_cnpj,8)))
        and (c.validade is null or c.validade > now())) then
      raise exception 'Cadastre um certificado A1 válido para reprocessar as NFS-e';
    end if;
    insert into public.xml_agendamentos (org_id, criado_por, competencia, total, origem, nome_arquivo)
      values (p_org, auth.uid(), p_competencia, 1, 'nfse', 'Reprocessamento MEI') returning id into v_ag;
    insert into public.xml_tarefas (org_id, agendamento_id, nfse_empresa_id, ie, nome, codigo, tipos)
      values (p_org, v_ag, v_nfse.id, v_cnpj, v_nfse.nome, v_nfse.codigo, array['nfse_emitidas']);
    v_ids := array_append(v_ids, v_ag); v_criados := v_criados + 1;
    end if;
  end if;
  for v_empresa in select e.* from public.xml_empresas e where e.org_id = p_org
    and (e.ie = p_documento or (e.cnpj = v_cnpj and ('mei' = any(e.tipos) or exists (select 1 from public.xml_mei_cadastros c where c.org_id = p_org and c.cnpj = v_cnpj and c.ativo)))) loop
    select t.agendamento_id into v_ativo from public.xml_tarefas t join public.xml_agendamentos a on a.id=t.agendamento_id
      where t.org_id=p_org and t.empresa_id=v_empresa.id and 'mei'=any(t.tipos) and a.competencia=p_competencia
        and t.status in ('pendente','processando') order by t.criado_em desc limit 1;
    if v_ativo is not null then
      v_ids := array_append(v_ids, v_ativo);
      continue;
    end if;
    if not exists (select 1 from public.xml_acessos c where c.id = v_empresa.acesso_id and c.org_id = p_org) then
      raise exception 'Cadastre o login ATF para reprocessar o Dossiê MEI';
    end if;
    insert into public.xml_agendamentos (org_id, criado_por, competencia, total, nome_arquivo)
      values (p_org, auth.uid(), p_competencia, 1, 'Reprocessamento MEI') returning id into v_ag;
    insert into public.xml_tarefas (org_id, agendamento_id, empresa_id, ie, nome, codigo, tipos)
      values (p_org, v_ag, v_empresa.id, v_empresa.ie, v_empresa.nome, v_empresa.codigo, array['mei']);
    v_ids := array_append(v_ids, v_ag); v_criados := v_criados + 1;
  end loop;
  if cardinality(v_ids) = 0 then raise exception 'Cadastre a empresa na NFS-e ou na SEFAZ antes de reprocessar'; end if;
  return jsonb_build_object('agendamentos', v_ids, 'existente', v_criados = 0);
end $$;

create or replace function public.xml_mei_agendar_nfse_atf() returns trigger
language plpgsql security invoker set search_path = public as $$
declare
  v_empresa record; v_ag record; v_nfse uuid; v_novo uuid;
begin
  if new.empresa_id is null or new.status <> 'pendente' then return new; end if;
  select * into v_ag from public.xml_agendamentos where id = new.agendamento_id and org_id = new.org_id and origem = 'sefaz';
  if not found then return new; end if;
  select * into v_empresa from public.xml_empresas where id = new.empresa_id and org_id = new.org_id;
  if not found or v_empresa.cnpj !~ '^[0-9]{14}$' then return new; end if;
  if not public.xml_mei_pode_consultar(new.org_id,v_empresa.cnpj,v_ag.competencia) then return new; end if;
  if not ('mei' = any(new.tipos) or exists (
    select 1 from public.xml_mei_cadastros m where m.org_id = new.org_id and m.cnpj = v_empresa.cnpj
      and m.ativo and v_ag.competencia >= m.inicio_mei and (m.fim_mei is null or v_ag.competencia <= m.fim_mei)
  )) then return new; end if;

  -- Serializa pedidos concorrentes do mesmo CNPJ dentro da organização.
  perform pg_advisory_xact_lock(hashtextextended(new.org_id::text || ':' || v_empresa.cnpj, 0));
  if not exists (
    select 1 from generate_series(date_trunc('year', v_ag.competencia), v_ag.competencia, interval '1 month') d
    where not exists (select 1 from public.xml_mei_nfse_meses m
      where m.org_id = new.org_id and m.cnpj = v_empresa.cnpj and m.competencia = d::date)
  ) then return new; end if;

  insert into public.xml_nfse_empresas(org_id, cnpj, nome, codigo, tipos)
    values (new.org_id, v_empresa.cnpj, v_empresa.nome, v_empresa.codigo, array['nfse_emitidas'])
    on conflict (org_id, cnpj) do nothing;
  select id into v_nfse from public.xml_nfse_empresas where org_id = new.org_id and cnpj = v_empresa.cnpj;
  if exists (
    select 1 from public.xml_tarefas t join public.xml_agendamentos a on a.id = t.agendamento_id
      where t.org_id = new.org_id and t.nfse_empresa_id = v_nfse and a.origem = 'nfse'
        and 'nfse_emitidas' = any(t.tipos) and t.status in ('pendente', 'processando')
        and a.competencia >= v_ag.competencia and date_trunc('year', a.competencia) = date_trunc('year', v_ag.competencia)
        and a.executar_em <= v_ag.executar_em
  ) then return new; end if;

  insert into public.xml_agendamentos(org_id, criado_por, competencia, executar_em, total, origem, nome_arquivo)
    values (new.org_id, v_ag.criado_por, v_ag.competencia, v_ag.executar_em, 1, 'nfse', 'Complemento NFS-e do MEI (ATF)') returning id into v_novo;
  insert into public.xml_tarefas(org_id, agendamento_id, nfse_empresa_id, ie, nome, codigo, tipos)
    values (new.org_id, v_novo, v_nfse, v_empresa.cnpj, v_empresa.nome, v_empresa.codigo, array['nfse_emitidas']);
  return new;
end $$;

-- A decisão também vale para tarefas que já estavam aguardando na fila.
create or replace function public.xml_mei_limpar_fila() returns void
language sql security invoker set search_path=public as $$
  update public.xml_tarefas t set tipos=array_remove(t.tipos,'mei'),
    status=case when cardinality(t.tipos)=1 then 'cancelado' else t.status end,
    mensagem=case when cardinality(t.tipos)=1 then 'Acompanhamento MEI pausado, ignorado ou fora do período' else t.mensagem end
  from public.xml_agendamentos a where t.agendamento_id=a.id and t.org_id=a.org_id and t.status='pendente'
    and 'mei'=any(t.tipos) and not public.xml_mei_pode_consultar(t.org_id,t.ie,a.competencia)
$$;
revoke all on function public.xml_mei_limpar_fila() from public,anon,authenticated;
grant execute on function public.xml_mei_limpar_fila() to service_role;

create or replace function public.xml_pegar_lote(p_robo text, p_login text default '', p_max integer default 15)
returns table (id uuid, ie text, cnpj text, nome text, codigo text, tipos text[], data_inicio date, data_fim date,
               login_atf text, senha_cifrada text, org_nome text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_acesso uuid;
  v_competencia date;
  v_ids uuid[];
begin
  -- tarefa "presa" (o robô caiu no meio) volta para a fila depois de 90 min
  update public.xml_tarefas set status = 'pendente', iniciado_em = null, robo = null
   where xml_tarefas.status = 'processando' and xml_tarefas.iniciado_em < now() - interval '90 minutes';

  perform public.xml_mei_limpar_fila();

  -- empresa ou login apagado depois do agendamento: encerra com aviso
  update public.xml_tarefas t set status = 'erro', concluido_em = now(),
         mensagem = 'Empresa ou login do ATF removido do cadastro; envie a planilha de novo.'
   where t.status = 'pendente'
     and exists (select 1 from public.xml_agendamentos a where a.id = t.agendamento_id and a.origem = 'sefaz')
     and not exists (select 1 from public.xml_empresas e join public.xml_acessos c on c.id = e.acesso_id
                      where e.id = t.empresa_id);

  -- qual login e competência atender agora
  select e.acesso_id, a.competencia into v_acesso, v_competencia
    from public.xml_tarefas t
    join public.xml_agendamentos a on a.id = t.agendamento_id
    join public.xml_empresas e on e.id = t.empresa_id
    join public.xml_acessos c on c.id = e.acesso_id
   where t.status = 'pendente' and a.executar_em <= now()
   order by (c.login is not distinct from nullif(p_login, '')) desc, a.executar_em, t.criado_em
   limit 1;
  if v_acesso is null then return; end if;

  select array_agg(x.id) into v_ids from (
    select t.id
      from public.xml_tarefas t
      join public.xml_agendamentos a on a.id = t.agendamento_id
      join public.xml_empresas e on e.id = t.empresa_id
     where t.status = 'pendente' and a.executar_em <= now()
       and e.acesso_id = v_acesso and a.competencia = v_competencia
     order by a.executar_em, t.criado_em
     limit greatest(1, least(p_max, 50))
     for update of t skip locked) x;
  if v_ids is null then return; end if;

  update public.xml_tarefas set status = 'processando', iniciado_em = now(), robo = p_robo where xml_tarefas.id = any(v_ids);

  return query
  select t.id, t.ie, e.cnpj, t.nome, t.codigo, t.tipos, a.data_inicio, a.data_fim, c.login, c.senha_cifrada, o.nome
    from public.xml_tarefas t
    join public.organizacoes o on o.id = t.org_id
    join public.xml_agendamentos a on a.id = t.agendamento_id
    join public.xml_empresas e on e.id = t.empresa_id
    join public.xml_acessos c on c.id = e.acesso_id
   where t.id = any(v_ids)
   order by t.criado_em;
end $$;

drop function if exists public.xml_nfse_pegar_lote(text,integer);
create or replace function public.xml_nfse_pegar_lote(p_robo text, p_max integer default 10)
returns table (id uuid, cnpj text, nome text, codigo text, tipos text[], data_inicio date, data_fim date,
               certificado_cnpj text, pfx_cifrado text, senha_cifrada text, org_nome text, procurador boolean, mei boolean, mei_bloqueado boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_ids uuid[];
begin
  update public.xml_tarefas set status = 'pendente', iniciado_em = null, robo = null
   where xml_tarefas.status = 'processando' and xml_tarefas.nfse_empresa_id is not null
     and xml_tarefas.iniciado_em < now() - interval '90 minutes';

  -- empresa apagada depois do agendamento
  update public.xml_tarefas t set status = 'erro', concluido_em = now(),
         mensagem = 'Empresa removida do cadastro da NFS-e; envie a planilha de novo.'
   where t.status = 'pendente' and t.nfse_empresa_id is null
     and exists (select 1 from public.xml_agendamentos a where a.id = t.agendamento_id and a.origem = 'nfse');

  -- sem certificado para o CNPJ, nem para a matriz, nem do escritório (procuração)
  update public.xml_tarefas t set status = 'certificado', concluido_em = now(),
         mensagem = 'Sem certificado A1 que sirva para este CNPJ (nem o escolhido no agendamento, nem o da matriz, nem o do escritório com procuração). Cadastre em Certificados e agende de novo.'
   where t.status = 'pendente'
     and exists (select 1 from public.xml_agendamentos a where a.id = t.agendamento_id and a.origem = 'nfse'
                  and a.executar_em <= now())
     and exists (select 1 from public.xml_nfse_empresas e
                   join public.xml_agendamentos a on a.id = t.agendamento_id
                  where e.id = t.nfse_empresa_id
                    and not exists (select 1 from public.xml_nfse_certificados c
                                     where c.org_id = e.org_id
                                       and (a.certificado_id is null or c.id = a.certificado_id)
                                       and ((length(c.cnpj) = 14 and left(c.cnpj, 8) = left(e.cnpj, 8)) or c.procurador)));

  select array_agg(x.id) into v_ids from (
    select t.id
      from public.xml_tarefas t
      join public.xml_agendamentos a on a.id = t.agendamento_id
     where t.status = 'pendente' and a.origem = 'nfse' and a.executar_em <= now() and t.nfse_empresa_id is not null
     order by a.executar_em, t.criado_em
     limit greatest(1, least(p_max, 50))
     for update of t skip locked) x;
  if v_ids is null then return; end if;

  update public.xml_tarefas set status = 'processando', iniciado_em = now(), robo = p_robo where xml_tarefas.id = any(v_ids);

  return query
  select t.id, e.cnpj, t.nome, t.codigo, t.tipos, a.data_inicio, a.data_fim, c.cnpj, c.pfx_cifrado, c.senha_cifrada, o.nome,
         c.procurador,
         -- MEI na planilha da SEFAZ (mesmo CNPJ, mesmo escritório): a NFS-e sai com o ano todo na primeira vez
         (exists (select 1 from public.xml_mei_cadastros m where m.org_id = e.org_id and m.cnpj = e.cnpj and m.ativo and a.competencia >= m.inicio_mei and (m.fim_mei is null or a.competencia <= m.fim_mei)) or (not exists (select 1 from public.xml_mei_cadastros m where m.org_id = e.org_id and m.cnpj = e.cnpj) and exists (select 1 from public.xml_empresas s where s.org_id = e.org_id and s.cnpj = e.cnpj and 'mei' = any(s.tipos)))),
         not public.xml_mei_pode_consultar(e.org_id,e.cnpj,a.competencia)
    from public.xml_tarefas t
    join public.organizacoes o on o.id = t.org_id
    join public.xml_agendamentos a on a.id = t.agendamento_id
    join public.xml_nfse_empresas e on e.id = t.nfse_empresa_id
    cross join lateral (
      -- o da própria empresa, senão o da matriz (mesma raiz), senão o do escritório (procuração)
      select c.cnpj, c.pfx_cifrado, c.senha_cifrada, (c.cnpj <> e.cnpj and not (length(c.cnpj) = 14 and left(c.cnpj, 8) = left(e.cnpj, 8))) as procurador
        from public.xml_nfse_certificados c
       where c.org_id = e.org_id and (a.certificado_id is null or c.id = a.certificado_id)  -- o escolhido no agendamento
         and ((length(c.cnpj) = 14 and left(c.cnpj, 8) = left(e.cnpj, 8)) or c.procurador)
       order by (c.cnpj = e.cnpj) desc, (length(c.cnpj) = 14 and left(c.cnpj, 8) = left(e.cnpj, 8)) desc,
                (substr(c.cnpj, 9, 4) = '0001') desc, c.atualizado_em desc
       limit 1) c
   where t.id = any(v_ids)
   order by t.criado_em;
end $$;
revoke all on function public.xml_nfse_pegar_lote(text,integer) from public,anon,authenticated;
grant execute on function public.xml_nfse_pegar_lote(text,integer) to service_role;

commit;
