-- Executar antes de publicar o portal e reiniciar o robô atualizado. Reaplicável, sem apagar histórico.
begin;

create table if not exists public.xml_mei_cadastros (
  org_id uuid not null references public.organizacoes(id) on delete cascade,
  cnpj text not null check (cnpj ~ '^[0-9]{14}$'),
  nome text not null,
  ativo boolean not null default true,
  inicio_atividade date not null,
  inicio_mei date not null,
  fim_mei date,
  atualizado_por uuid references auth.users(id) on delete set null,
  atualizado_em timestamptz not null default now(),
  primary key (org_id, cnpj),
  check (inicio_mei >= date_trunc('month', inicio_atividade)::date),
  check (fim_mei is null or fim_mei >= inicio_mei)
);
create table if not exists public.xml_mei_nfse_meses (
  org_id uuid not null references public.organizacoes(id) on delete cascade,
  cnpj text not null check (cnpj ~ '^[0-9]{14}$'),
  competencia date not null check (extract(day from competencia) = 1),
  valor numeric(14,2) not null check (valor >= 0),
  quantidade integer not null check (quantidade >= 0),
  tarefa_id uuid references public.xml_tarefas(id) on delete set null,
  iniciado_em timestamptz not null,
  consultado_em timestamptz not null default now(),
  primary key (org_id, cnpj, competencia)
);
alter table public.xml_mei_cadastros enable row level security;
alter table public.xml_mei_nfse_meses enable row level security;
revoke all on public.xml_mei_cadastros, public.xml_mei_nfse_meses from anon, authenticated;
grant select on public.xml_mei_cadastros, public.xml_mei_nfse_meses to authenticated;
grant all on public.xml_mei_cadastros, public.xml_mei_nfse_meses to service_role;
drop policy if exists xml_mei_cadastros_ler on public.xml_mei_cadastros;
create policy xml_mei_cadastros_ler on public.xml_mei_cadastros for select to authenticated
  using ((select public.sou_admin()) or org_id = (select public.minha_org()));
drop policy if exists xml_mei_nfse_meses_ler on public.xml_mei_nfse_meses;
create policy xml_mei_nfse_meses_ler on public.xml_mei_nfse_meses for select to authenticated
  using ((select public.sou_admin()) or org_id = (select public.minha_org()));

-- Mantém os ajustes antigos por IE e aceita CNPJ para prestadoras e carteiras unificadas.
alter table public.xml_mei_ajustes drop constraint if exists xml_mei_ajustes_ie_check;
alter table public.xml_mei_ajustes add constraint xml_mei_ajustes_ie_check check (ie ~ '^([0-9]{9}|[0-9]{14})$');

-- O vínculo empresa/escritório vem da tarefa. Um PATCH final grava tarefa e faturamento atomicamente.
create or replace function public.xml_mei_nfse_da_tarefa() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_cnpj text; v_comp date; v_mes jsonb; v_data date; v_inicio timestamptz;
begin
  if new.nfse_empresa_id is null or new.status not in ('concluido', 'sem_notas')
     or not (new.detalhes ? 'mei_nfse') then return new; end if;
  select e.cnpj, a.competencia into v_cnpj, v_comp
    from public.xml_nfse_empresas e join public.xml_agendamentos a on a.id = new.agendamento_id
    where e.id = new.nfse_empresa_id and e.org_id = new.org_id and a.org_id = new.org_id and a.origem = 'nfse';
  if v_cnpj is null then raise exception 'Vínculo NFS-e inválido'; end if;
  -- Dados são guardados mesmo antes da marcação manual; só entram na carteira quando o CNPJ é acompanhado.
  v_inicio := coalesce(new.iniciado_em, new.criado_em);
  for v_mes in select value from jsonb_array_elements(new.detalhes->'mei_nfse'->'meses') loop
    v_data := (v_mes->>'competencia')::date;
    if extract(day from v_data) <> 1 or extract(year from v_data) <> extract(year from v_comp) or v_data > v_comp then
      raise exception 'Competência NFS-e fora do agendamento';
    end if;
    insert into public.xml_mei_nfse_meses as m (org_id, cnpj, competencia, valor, quantidade, tarefa_id, iniciado_em, consultado_em)
    values (new.org_id, v_cnpj, v_data, (v_mes->>'valor')::numeric, (v_mes->>'quantidade')::integer,
            new.id, v_inicio, coalesce(new.concluido_em, now()))
    on conflict (org_id, cnpj, competencia) do update set
      valor = excluded.valor, quantidade = excluded.quantidade, tarefa_id = excluded.tarefa_id,
      iniciado_em = excluded.iniciado_em, consultado_em = excluded.consultado_em
    where excluded.iniciado_em >= m.iniciado_em; -- retorno atrasado não sobrescreve uma consulta mais nova
  end loop;
  return new;
end $$;
revoke all on function public.xml_mei_nfse_da_tarefa() from public, anon, authenticated;
drop trigger if exists xml_mei_nfse_finalizada on public.xml_tarefas;
create trigger xml_mei_nfse_finalizada after update of status, detalhes on public.xml_tarefas
  for each row execute function public.xml_mei_nfse_da_tarefa();

-- Cria agendamentos normais na fila existente. A transação evita cliques concorrentes duplicados.
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
revoke all on function public.xml_mei_reprocessar(uuid, text, date) from public, anon;
grant execute on function public.xml_mei_reprocessar(uuid, text, date) to authenticated;

-- A definição atualizada da fila NFS-e é acrescentada abaixo.

create or replace function public.xml_nfse_pegar_lote(p_robo text, p_max integer default 10)
returns table (id uuid, cnpj text, nome text, codigo text, tipos text[], data_inicio date, data_fim date,
               certificado_cnpj text, pfx_cifrado text, senha_cifrada text, org_nome text, procurador boolean, mei boolean)
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
         (exists (select 1 from public.xml_mei_cadastros m where m.org_id = e.org_id and m.cnpj = e.cnpj and m.ativo and a.competencia >= m.inicio_mei and (m.fim_mei is null or a.competencia <= m.fim_mei)) or (not exists (select 1 from public.xml_mei_cadastros m where m.org_id = e.org_id and m.cnpj = e.cnpj) and exists (select 1 from public.xml_empresas s where s.org_id = e.org_id and s.cnpj = e.cnpj and 'mei' = any(s.tipos))))
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
commit;
