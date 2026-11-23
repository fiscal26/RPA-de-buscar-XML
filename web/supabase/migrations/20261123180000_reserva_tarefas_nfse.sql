-- Reserva por tentativa. Os contratos de retirada anteriores mantêm a assinatura e o comportamento.
begin;

alter table public.xml_tarefas add column if not exists tentativa_id uuid;
alter table public.xml_tarefas add column if not exists reserva_ate timestamptz;

create or replace function public.xml_nfse_reservar_lote(p_robo text, p_max integer default 10)
returns table (id uuid, cnpj text, nome text, codigo text, tipos text[], data_inicio date, data_fim date,
               certificado_cnpj text, pfx_cifrado text, senha_cifrada text, org_id uuid, org_nome text, procurador boolean, mei boolean, mei_bloqueado boolean,
               tentativa_id uuid)
-- Executa com as permissões do proprietário. A concessão ao serviço limita quem pode chamar.
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
#variable_conflict use_column
begin
  update public.xml_tarefas t set status = 'pendente', iniciado_em = null, robo = null, tentativa_id = null, reserva_ate = null
    from public.xml_agendamentos a, public.organizacoes o
   where t.agendamento_id = a.id and a.origem = 'nfse' and o.id = t.org_id and o.ativo
     and t.status = 'processando' and coalesce(t.reserva_ate, t.iniciado_em + interval '90 minutes') <= statement_timestamp();

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
         mensagem = 'Sem certificado A1 autorizado da empresa, matriz ou procurador nesta organização.'
    from public.xml_agendamentos a, public.organizacoes o, public.xml_nfse_empresas e
   where t.agendamento_id = a.id and a.org_id = t.org_id and a.origem = 'nfse' and a.executar_em <= now()
     and o.id = t.org_id and o.ativo and t.empresa_id is null and t.status = 'pendente'
     and e.id = t.nfse_empresa_id and e.org_id = t.org_id and e.cnpj = t.ie
     and not exists (select 1 from public.xml_nfse_certificados c
                      where c.org_id = t.org_id and (a.certificado_id is null or c.id = a.certificado_id)
                        and ((length(c.cnpj) = 14 and left(c.cnpj, 8) = left(e.cnpj, 8)) or c.procurador));

  -- Reserva e credenciais saem das mesmas linhas. Os bloqueios mantêm os vínculos durante a operação.
  return query
  with lote as (
    select t.id, e.cnpj, t.nome, t.codigo, t.tipos, a.data_inicio, a.data_fim, c.cnpj as certificado_cnpj,
           c.pfx_cifrado, c.senha_cifrada, t.org_id, o.nome as org_nome, c.procurador,
           a.competencia, a.executar_em, t.criado_em
      from public.xml_tarefas t
      join public.xml_agendamentos a on a.id = t.agendamento_id and a.org_id = t.org_id
      join public.organizacoes o on o.id = t.org_id and o.ativo
      join public.xml_nfse_empresas e on e.id = t.nfse_empresa_id and e.org_id = t.org_id and e.cnpj = t.ie
      cross join lateral (
        select c.cnpj, c.pfx_cifrado, c.senha_cifrada,
               (c.cnpj <> e.cnpj and not (length(c.cnpj) = 14 and left(c.cnpj, 8) = left(e.cnpj, 8))) as procurador
          from public.xml_nfse_certificados c
         where c.org_id = t.org_id and (a.certificado_id is null or c.id = a.certificado_id)
                        and ((length(c.cnpj) = 14 and left(c.cnpj, 8) = left(e.cnpj, 8)) or c.procurador)
         order by (c.cnpj = e.cnpj) desc, (length(c.cnpj) = 14 and left(c.cnpj, 8) = left(e.cnpj, 8)) desc, (substr(c.cnpj, 9, 4) = '0001') desc, c.atualizado_em desc, c.id
         limit 1 for share of c
      ) c
     where t.status = 'pendente' and a.origem = 'nfse' and a.executar_em <= now() and t.empresa_id is null
     order by a.executar_em, t.criado_em, t.id
     limit greatest(1, least(p_max, 50))
     for update of t skip locked for share of a, o, e
  ), retiradas as (
    update public.xml_tarefas t set status = 'processando', iniciado_em = statement_timestamp(), robo = p_robo,
           tentativa_id = gen_random_uuid(), reserva_ate = statement_timestamp() + interval '90 minutes'
      from lote l where t.id = l.id returning t.id, t.tentativa_id
  )
  select l.id, l.cnpj, l.nome, l.codigo, l.tipos, l.data_inicio, l.data_fim,
         l.certificado_cnpj, l.pfx_cifrado, l.senha_cifrada, l.org_id, l.org_nome, l.procurador,
         (exists (select 1 from public.xml_mei_cadastros m
                   where m.org_id = l.org_id and m.cnpj = l.cnpj and m.ativo
                     and l.competencia >= m.inicio_mei and (m.fim_mei is null or l.competencia <= m.fim_mei))
          or (not exists (select 1 from public.xml_mei_cadastros m where m.org_id = l.org_id and m.cnpj = l.cnpj)
              and exists (select 1 from public.xml_empresas s where s.org_id = l.org_id and s.cnpj = l.cnpj and 'mei' = any(s.tipos)))),
         not public.xml_mei_pode_consultar(l.org_id, l.cnpj, l.competencia), r.tentativa_id
    from lote l join retiradas r on r.id = l.id
   order by l.executar_em, l.criado_em, l.id;
end $$;

-- O identificador muda a cada retirada. A atualização só vale durante a reserva correspondente.
create or replace function public.xml_atualizar_tarefa_reservada(
  p_tarefa uuid, p_tentativa uuid, p_campos jsonb default '{}'::jsonb
) returns boolean
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if jsonb_typeof(p_campos) is distinct from 'object' then
    raise exception 'A atualização da tarefa precisa ser um objeto JSON.' using errcode = '22023';
  end if;
  if (p_campos - array['status','mensagem','detalhes','pasta','qtd_xml']) <> '{}'::jsonb
     or (p_campos ? 'status' and coalesce(p_campos->>'status', '') not in (
         'concluido', 'sem_notas', 'erro', 'fora_do_ar', 'certificado', 'senha_invalida')) then
    raise exception 'Campos ou estado inválidos na atualização da reserva.' using errcode = '22023';
  end if;

  update public.xml_tarefas t
     set status = coalesce(dados.status, t.status),
         mensagem = coalesce(dados.mensagem, t.mensagem),
         detalhes = coalesce(dados.detalhes, t.detalhes),
         pasta = coalesce(dados.pasta, t.pasta),
         qtd_xml = coalesce(dados.qtd_xml, t.qtd_xml),
         concluido_em = case when dados.status is null then t.concluido_em else clock_timestamp() end,
         tentativa_id = case when dados.status is null then t.tentativa_id end,
         reserva_ate = case when dados.status is null then clock_timestamp() + interval '90 minutes' end
    from jsonb_to_record(p_campos) as dados(status text, mensagem text, detalhes jsonb, pasta text, qtd_xml integer)
   where t.id = p_tarefa and t.status = 'processando' and t.tentativa_id = p_tentativa
     and t.reserva_ate > clock_timestamp();
  return found;
end $$;

revoke all on function public.xml_nfse_reservar_lote(text, integer) from public, anon, authenticated;
grant execute on function public.xml_nfse_reservar_lote(text, integer) to service_role;
revoke all on function public.xml_atualizar_tarefa_reservada(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.xml_atualizar_tarefa_reservada(uuid, uuid, jsonb) to service_role;

notify pgrst, 'reload schema';
commit;
