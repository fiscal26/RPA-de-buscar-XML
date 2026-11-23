-- Retirada e renovação das tarefas ATF por tentativa. Mantém os contratos anteriores.
begin;

create or replace function public.xml_atf_reservar_lote(p_robo text, p_login text default '', p_max integer default 15)
returns table (id uuid, ie text, cnpj text, nome text, codigo text, tipos text[], data_inicio date, data_fim date,
               login_atf text, senha_cifrada text, org_id uuid, org_nome text, tentativa_id uuid)
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
#variable_conflict use_column
begin
  update public.xml_tarefas t set status = 'pendente', iniciado_em = null, robo = null, tentativa_id = null, reserva_ate = null
    from public.xml_agendamentos a, public.organizacoes o
   where t.agendamento_id = a.id and a.origem = 'sefaz' and o.id = t.org_id and o.ativo
     and t.status = 'processando' and coalesce(t.reserva_ate, t.iniciado_em + interval '90 minutes') <= statement_timestamp();

  update public.xml_tarefas t set status = 'erro', concluido_em = now(),
         mensagem = 'Empresa, agendamento ou acesso do ATF incompatível com a organização da tarefa.'
    from public.xml_agendamentos a, public.organizacoes o
   where t.agendamento_id = a.id and a.origem = 'sefaz' and o.id = t.org_id and o.ativo
     and t.status = 'pendente' and a.executar_em <= now()
     and (t.tentar_novamente_em is null or t.tentar_novamente_em <= statement_timestamp())
     and (a.org_id <> t.org_id or t.nfse_empresa_id is not null or not exists (
       select 1 from public.xml_empresas e
       join public.xml_acessos c on c.id = e.acesso_id and c.org_id = e.org_id
       where e.id = t.empresa_id and e.org_id = t.org_id and e.ie = t.ie
     ));

  perform public.xml_mei_limpar_fila();

  -- Escolhe um acesso e um período exato. SKIP LOCKED pula tarefas já travadas por outra sessão.
  return query
  with grupo as (
    select c.id as acesso_id, a.data_inicio, a.data_fim
      from public.xml_tarefas t
      join public.xml_agendamentos a on a.id = t.agendamento_id and a.org_id = t.org_id
      join public.organizacoes o on o.id = t.org_id and o.ativo
      join public.xml_empresas e on e.id = t.empresa_id and e.org_id = t.org_id and e.ie = t.ie
      join public.xml_acessos c on c.id = e.acesso_id and c.org_id = t.org_id
     where t.status = 'pendente' and a.origem = 'sefaz' and a.executar_em <= now()
     and (t.tentar_novamente_em is null or t.tentar_novamente_em <= statement_timestamp())
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
     and (t.tentar_novamente_em is null or t.tentar_novamente_em <= statement_timestamp())
       and t.nfse_empresa_id is null and a.data_inicio = g.data_inicio and a.data_fim = g.data_fim
     order by a.executar_em, t.criado_em, t.id
     limit greatest(1, least(p_max, 50))
     for update of t skip locked for share of a, o, e, c
  ), retiradas as (
    update public.xml_tarefas t set status = 'processando', iniciado_em = statement_timestamp(), robo = p_robo,
           tentativa_id = gen_random_uuid(), reserva_ate = statement_timestamp() + interval '90 minutes',
           tentar_novamente_em = null
      from lote l where t.id = l.id returning t.id, t.tentativa_id
  )
  select l.id, l.ie, l.cnpj, l.nome, l.codigo, l.tipos, l.data_inicio, l.data_fim,
         l.login, l.senha_cifrada, l.org_id, l.org_nome, r.tentativa_id
    from lote l join retiradas r on r.id = l.id
   order by l.executar_em, l.criado_em, l.id;
end $$;

-- Mantém vivas apenas as reservas ATF ainda válidas, inclusive durante a leitura da caixa.
create or replace function public.xml_renovar_reservas_atf(p_tentativas uuid[])
returns void language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  update public.xml_tarefas t set reserva_ate = clock_timestamp() + interval '90 minutes'
    from public.xml_agendamentos a
   where a.id = t.agendamento_id and a.org_id = t.org_id and a.origem = 'sefaz'
     and t.status = 'processando' and t.tentativa_id = any(p_tentativas)
     and t.reserva_ate > clock_timestamp();
end $$;

-- A verificação e a gravação do histórico acontecem na mesma transação.
-- NULL indica uma tentativa vencida; zero indica um envio válido sem meses mais recentes.
create or replace function public.xml_mei_registrar_tarefa_reservada(
  p_tarefa uuid, p_tentativa uuid, p_org uuid, p_ie text, p_meses jsonb, p_inicio_atividade date default null
) returns integer language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  perform 1 from public.xml_tarefas t
   where t.id = p_tarefa and t.status = 'processando' and t.tentativa_id = p_tentativa
     and t.reserva_ate > clock_timestamp()
   for update of t;
  if not found then
    return null;
  end if;
  return public.xml_mei_registrar_v2(p_tarefa, p_org, p_ie, p_meses, p_inicio_atividade);
end $$;

revoke all on function public.xml_atf_reservar_lote(text, text, integer) from public, anon, authenticated;
grant execute on function public.xml_atf_reservar_lote(text, text, integer) to service_role;
revoke all on function public.xml_renovar_reservas_atf(uuid[]) from public, anon, authenticated;
grant execute on function public.xml_renovar_reservas_atf(uuid[]) to service_role;
revoke all on function public.xml_mei_registrar_tarefa_reservada(uuid, uuid, uuid, text, jsonb, date) from public, anon, authenticated;
grant execute on function public.xml_mei_registrar_tarefa_reservada(uuid, uuid, uuid, text, jsonb, date) to service_role;

notify pgrst, 'reload schema';
commit;
