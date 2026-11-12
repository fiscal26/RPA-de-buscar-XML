-- Isolamento v2: manter este bloco idêntico ao de schema.sql.
-- SECURITY DEFINER permite à função usar os privilégios do dono para operar nas tabelas protegidas.
-- As permissões no fim limitam quem pode executá-la, e o search_path exclui esquemas de usuários.
begin;

create or replace function public.xml_pegar_lote_v2(p_robo text, p_login text default '', p_max integer default 15)
returns table (id uuid, ie text, cnpj text, nome text, codigo text, tipos text[], data_inicio date, data_fim date,
               login_atf text, senha_cifrada text, org_id uuid, org_nome text)
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
#variable_conflict use_column
begin
  update public.xml_tarefas t set status = 'pendente', iniciado_em = null, robo = null
    from public.xml_agendamentos a, public.organizacoes o
   where t.agendamento_id = a.id and a.origem = 'sefaz' and o.id = t.org_id and o.ativo
     and t.status = 'processando' and t.iniciado_em < now() - interval '90 minutes';

  update public.xml_tarefas t set status = 'erro', concluido_em = now(),
         mensagem = 'Empresa, agendamento ou acesso do ATF incompatível com a organização da tarefa.'
    from public.xml_agendamentos a, public.organizacoes o
   where t.agendamento_id = a.id and a.origem = 'sefaz' and o.id = t.org_id and o.ativo
     and t.status = 'pendente' and a.executar_em <= now()
     and (a.org_id <> t.org_id or t.nfse_empresa_id is not null or not exists (
       select 1 from public.xml_empresas e
       join public.xml_acessos c on c.id = e.acesso_id and c.org_id = e.org_id
       where e.id = t.empresa_id and e.org_id = t.org_id and e.ie = t.ie
     ));

  -- Escolhe um acesso e uma competência. SKIP LOCKED pula tarefas já travadas por outra sessão.
  return query
  with grupo as (
    select c.id as acesso_id, a.competencia
      from public.xml_tarefas t
      join public.xml_agendamentos a on a.id = t.agendamento_id and a.org_id = t.org_id
      join public.organizacoes o on o.id = t.org_id and o.ativo
      join public.xml_empresas e on e.id = t.empresa_id and e.org_id = t.org_id and e.ie = t.ie
      join public.xml_acessos c on c.id = e.acesso_id and c.org_id = t.org_id
     where t.status = 'pendente' and a.origem = 'sefaz' and a.executar_em <= now()
       and t.nfse_empresa_id is null
     order by (c.login is not distinct from nullif(p_login, '')) desc, a.executar_em, t.criado_em, t.id
     limit 1 for update of t skip locked
  ), lote as (
    select t.id, t.ie, e.cnpj, t.nome, t.codigo, t.tipos, a.data_inicio, a.data_fim,
           c.login, c.senha_cifrada, t.org_id, o.nome as org_nome, a.executar_em, t.criado_em
      from grupo g
      join public.xml_acessos c on c.id = g.acesso_id
      join public.xml_empresas e on e.acesso_id = c.id and e.org_id = c.org_id
      join public.xml_tarefas t on t.empresa_id = e.id and t.org_id = e.org_id and t.ie = e.ie
      join public.xml_agendamentos a on a.id = t.agendamento_id and a.org_id = t.org_id
      join public.organizacoes o on o.id = t.org_id and o.ativo
     where t.status = 'pendente' and a.origem = 'sefaz' and a.executar_em <= now()
       and t.nfse_empresa_id is null and a.competencia = g.competencia
     order by a.executar_em, t.criado_em, t.id
     limit greatest(1, least(p_max, 50))
     for update of t skip locked for share of a, o, e, c
  ), retiradas as (
    update public.xml_tarefas t set status = 'processando', iniciado_em = now(), robo = p_robo
      from lote l where t.id = l.id returning t.id
  )
  select l.id, l.ie, l.cnpj, l.nome, l.codigo, l.tipos, l.data_inicio, l.data_fim,
         l.login, l.senha_cifrada, l.org_id, l.org_nome
    from lote l join retiradas r on r.id = l.id
   order by l.executar_em, l.criado_em, l.id;
end $$;

create or replace function public.xml_nfse_pegar_lote_v2(p_robo text, p_max integer default 10)
returns table (id uuid, cnpj text, nome text, codigo text, tipos text[], data_inicio date, data_fim date,
               certificado_cnpj text, pfx_cifrado text, senha_cifrada text, org_id uuid, org_nome text)
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
#variable_conflict use_column
begin
  update public.xml_tarefas t set status = 'pendente', iniciado_em = null, robo = null
    from public.xml_agendamentos a, public.organizacoes o
   where t.agendamento_id = a.id and a.origem = 'nfse' and o.id = t.org_id and o.ativo
     and t.status = 'processando' and t.iniciado_em < now() - interval '90 minutes';

  update public.xml_tarefas t set status = 'erro', concluido_em = now(),
         mensagem = 'Empresa ou agendamento da NFS-e incompatível com a organização da tarefa.'
    from public.xml_agendamentos a, public.organizacoes o
   where t.agendamento_id = a.id and a.origem = 'nfse' and o.id = t.org_id and o.ativo
     and t.status = 'pendente' and a.executar_em <= now()
     and (a.org_id <> t.org_id or t.empresa_id is not null or not exists (
       select 1 from public.xml_nfse_empresas e
       where e.id = t.nfse_empresa_id and e.org_id = t.org_id and e.cnpj = t.ie
     ));

  update public.xml_tarefas t set status = 'certificado', concluido_em = now(),
         mensagem = 'Sem certificado A1 da empresa ou da matriz nesta organização.'
    from public.xml_agendamentos a, public.organizacoes o, public.xml_nfse_empresas e
   where t.agendamento_id = a.id and a.org_id = t.org_id and a.origem = 'nfse' and a.executar_em <= now()
     and o.id = t.org_id and o.ativo and t.empresa_id is null and t.status = 'pendente'
     and e.id = t.nfse_empresa_id and e.org_id = t.org_id and e.cnpj = t.ie
     and not exists (select 1 from public.xml_nfse_certificados c
                      where c.org_id = t.org_id and left(c.cnpj, 8) = left(e.cnpj, 8));

  -- Usa o certificado do mesmo escritório e mantém o CNPJ consultado, mesmo com o certificado da matriz.
  return query
  with lote as (
    select t.id, e.cnpj, t.nome, t.codigo, t.tipos, a.data_inicio, a.data_fim, c.cnpj as certificado_cnpj,
           c.pfx_cifrado, c.senha_cifrada, t.org_id, o.nome as org_nome, a.executar_em, t.criado_em
      from public.xml_tarefas t
      join public.xml_agendamentos a on a.id = t.agendamento_id and a.org_id = t.org_id
      join public.organizacoes o on o.id = t.org_id and o.ativo
      join public.xml_nfse_empresas e on e.id = t.nfse_empresa_id and e.org_id = t.org_id and e.cnpj = t.ie
      cross join lateral (
        select c.cnpj, c.pfx_cifrado, c.senha_cifrada from public.xml_nfse_certificados c
         where c.org_id = t.org_id and left(c.cnpj, 8) = left(e.cnpj, 8)
         order by (c.cnpj = e.cnpj) desc, (substr(c.cnpj, 9, 4) = '0001') desc, c.atualizado_em desc, c.id
         limit 1 for share of c
      ) c
     where t.status = 'pendente' and a.origem = 'nfse' and a.executar_em <= now() and t.empresa_id is null
     order by a.executar_em, t.criado_em, t.id
     limit greatest(1, least(p_max, 50))
     for update of t skip locked for share of a, o, e
  ), retiradas as (
    update public.xml_tarefas t set status = 'processando', iniciado_em = now(), robo = p_robo
      from lote l where t.id = l.id returning t.id
  )
  select l.id, l.cnpj, l.nome, l.codigo, l.tipos, l.data_inicio, l.data_fim,
         l.certificado_cnpj, l.pfx_cifrado, l.senha_cifrada, l.org_id, l.org_nome
    from lote l join retiradas r on r.id = l.id
   order by l.executar_em, l.criado_em, l.id;
end $$;

-- O nome vem do cadastro atual. Meses iguais ou mais antigos não alteram dados.
create or replace function public.xml_mei_registrar_contexto(
  p_org uuid, p_ie text, p_meses jsonb, p_inicio_atividade date default null
) returns integer
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare v_nome text; n integer;
begin
  select e.nome into v_nome
    from public.xml_empresas e join public.organizacoes o on o.id = e.org_id and o.ativo
   where e.org_id = p_org and e.ie = p_ie
   for share of e, o;
  if not found then
    raise exception 'Organização inativa ou empresa MEI ausente neste contexto.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_meses) is distinct from 'object' then
    raise exception 'Os meses do MEI devem ser um objeto JSON.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_each(p_meses) as mes(chave, dados)
     where chave !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or left(chave, 4) = '0000'
        or jsonb_typeof(dados) <> 'object'
        or coalesce(dados->>'consultado_em', '') !~
           '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
  ) then
    raise exception 'Mês inválido ou consultado_em sem data e fuso explícitos; é necessária nova coleta.'
      using errcode = '22023';
  end if;

  insert into public.xml_mei_meses as m (org_id, ie, nome, competencia, saidas, entradas, qtd_saidas, qtd_entradas,
                                         cartao, qtd_cartao, sem_movimento, simei, inicio_atividade, itens, consultado_em)
  select p_org, p_ie, v_nome, (chave || '-01')::date,
         nullif(dados->>'saidas', '')::numeric, nullif(dados->>'entradas', '')::numeric,
         nullif(dados->>'qtd_saidas', '')::numeric::integer, nullif(dados->>'qtd_entradas', '')::numeric::integer,
         nullif(dados->'cartao'->>'valor', '')::numeric, nullif(dados->'cartao'->>'qtd', '')::numeric::integer,
         (dados->>'sem_movimento')::boolean, (dados->>'simei')::boolean, p_inicio_atividade,
         case when jsonb_typeof(dados->'itens') = 'array' then dados->'itens' else '[]'::jsonb end,
         (dados->>'consultado_em')::timestamptz
    from jsonb_each(p_meses) as mes(chave, dados)
   order by chave
  on conflict (org_id, ie, competencia) do update set
    nome = excluded.nome, saidas = excluded.saidas, entradas = excluded.entradas,
    qtd_saidas = excluded.qtd_saidas, qtd_entradas = excluded.qtd_entradas, cartao = excluded.cartao,
    qtd_cartao = excluded.qtd_cartao, sem_movimento = excluded.sem_movimento, simei = excluded.simei,
    inicio_atividade = coalesce(excluded.inicio_atividade, m.inicio_atividade), itens = excluded.itens,
    consultado_em = excluded.consultado_em, atualizado_em = now()
  -- Compara a data na gravação para impedir que uma coleta atrasada sobrescreva outra mais recente.
  where m.consultado_em is null or excluded.consultado_em > m.consultado_em;
  get diagnostics n = row_count;
  return n;
end $$;

-- Callback da tarefa v2. O contexto recebido deve coincidir com a tarefa e seu cadastro.
create or replace function public.xml_mei_registrar_v2(
  p_tarefa uuid, p_org uuid, p_ie text, p_meses jsonb, p_inicio_atividade date default null
) returns integer
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  perform 1 from public.xml_tarefas t
    join public.xml_agendamentos a on a.id = t.agendamento_id and a.org_id = t.org_id and a.origem = 'sefaz'
    join public.xml_empresas e on e.id = t.empresa_id and e.org_id = t.org_id and e.ie = t.ie
   where t.id = p_tarefa and t.org_id = p_org and t.ie = p_ie and t.nfse_empresa_id is null and 'mei' = any(t.tipos)
   for share of t, a, e;
  if not found then
    raise exception 'Contexto MEI incompatível com a tarefa.' using errcode = '22023';
  end if;
  return public.xml_mei_registrar_contexto(p_org, p_ie, p_meses, p_inicio_atividade);
end $$;

revoke all on function public.xml_pegar_lote_v2(text, text, integer) from public, anon, authenticated;
grant execute on function public.xml_pegar_lote_v2(text, text, integer) to service_role;
revoke all on function public.xml_nfse_pegar_lote_v2(text, integer) from public, anon, authenticated;
grant execute on function public.xml_nfse_pegar_lote_v2(text, integer) to service_role;
revoke all on function public.xml_mei_registrar_contexto(uuid, text, jsonb, date) from public, anon, authenticated;
grant execute on function public.xml_mei_registrar_contexto(uuid, text, jsonb, date) to service_role;
revoke all on function public.xml_mei_registrar_v2(uuid, uuid, text, jsonb, date) from public, anon, authenticated;
grant execute on function public.xml_mei_registrar_v2(uuid, uuid, text, jsonb, date) to service_role;

notify pgrst, 'reload schema';
commit;
