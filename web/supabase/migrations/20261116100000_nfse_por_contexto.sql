-- Integração NFS-e por escritório. Preserva os contratos usados por instalações anteriores.
begin;

-- A versão de ensaio tinha outro retorno. RESTRICT impede retirar dependências existentes.
drop function if exists public.xml_nfse_pegar_lote_v2(text, integer) restrict;
create or replace function public.xml_nfse_pegar_lote_v2(p_robo text, p_max integer default 10)
returns table (id uuid, cnpj text, nome text, codigo text, tipos text[], data_inicio date, data_fim date,
               certificado_cnpj text, pfx_cifrado text, senha_cifrada text, org_id uuid, org_nome text, procurador boolean, mei boolean, mei_bloqueado boolean)
-- Executa com as permissões do proprietário. A concessão ao serviço limita quem pode chamar.
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
    update public.xml_tarefas t set status = 'processando', iniciado_em = now(), robo = p_robo
      from lote l where t.id = l.id returning t.id
  )
  select l.id, l.cnpj, l.nome, l.codigo, l.tipos, l.data_inicio, l.data_fim,
         l.certificado_cnpj, l.pfx_cifrado, l.senha_cifrada, l.org_id, l.org_nome, l.procurador,
         (exists (select 1 from public.xml_mei_cadastros m
                   where m.org_id = l.org_id and m.cnpj = l.cnpj and m.ativo
                     and l.competencia >= m.inicio_mei and (m.fim_mei is null or l.competencia <= m.fim_mei))
          or (not exists (select 1 from public.xml_mei_cadastros m where m.org_id = l.org_id and m.cnpj = l.cnpj)
              and exists (select 1 from public.xml_empresas s where s.org_id = l.org_id and s.cnpj = l.cnpj and 'mei' = any(s.tipos)))),
         not public.xml_mei_pode_consultar(l.org_id, l.cnpj, l.competencia)
    from lote l join retiradas r on r.id = l.id
   order by l.executar_em, l.criado_em, l.id;
end $$;

revoke all on function public.xml_nfse_pegar_lote_v2(text, integer) from public, anon, authenticated;
grant execute on function public.xml_nfse_pegar_lote_v2(text, integer) to service_role;

notify pgrst, 'reload schema';
commit;
