-- Filas anteriores da NFS-e preservam a reserva ativa e a espera da próxima tentativa.
begin;

-- Um PATCH legado pode devolver várias tarefas pelo nome do robô. Pule só as reservadas.
create or replace function public.xml_proteger_atualizacao_reservada() returns trigger
language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
begin
  if current_user = 'service_role' then
    return null;
  end if;
  -- As funções de fila validam a tentativa e executam com as permissões do proprietário.
  return new;
end $$;
revoke all on function public.xml_proteger_atualizacao_reservada() from public, anon, authenticated, service_role;

drop trigger if exists xml_proteger_atualizacao_reservada on public.xml_tarefas;
create trigger xml_proteger_atualizacao_reservada
before update of status, iniciado_em, robo, concluido_em, mensagem, detalhes, pasta, qtd_xml,
                 tentativa_id, reserva_ate, tentar_novamente_em on public.xml_tarefas
for each row when (old.tentativa_id is not null)
execute function public.xml_proteger_atualizacao_reservada();

-- Retomar uma reserva vencida limpa o identificador. A tentativa anterior perde o direito de concluir.
create or replace function public.xml_nfse_pegar_lote(p_robo text, p_max integer default 10)
returns table (id uuid, cnpj text, nome text, codigo text, tipos text[], data_inicio date, data_fim date,
               certificado_cnpj text, pfx_cifrado text, senha_cifrada text, org_nome text, procurador boolean, mei boolean, mei_bloqueado boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_ids uuid[];
begin
  update public.xml_tarefas t
     set status = 'pendente', iniciado_em = null, robo = null, tentativa_id = null, reserva_ate = null
    from public.xml_agendamentos a
   where a.id = t.agendamento_id and a.origem = 'nfse'
     and t.status = 'processando' and t.nfse_empresa_id is not null
     and coalesce(t.reserva_ate, t.iniciado_em + interval '90 minutes') <= statement_timestamp();

  -- empresa apagada depois do agendamento
  update public.xml_tarefas t set status = 'erro', concluido_em = now(),
         mensagem = 'Empresa removida do cadastro da NFS-e; envie a planilha de novo.'
   where t.status = 'pendente' and t.nfse_empresa_id is null
     and t.tentativa_id is null and t.reserva_ate is null
     and (t.tentar_novamente_em is null or t.tentar_novamente_em <= statement_timestamp())
     and exists (select 1 from public.xml_agendamentos a where a.id = t.agendamento_id and a.origem = 'nfse');

  -- sem certificado para o CNPJ, nem para a matriz, nem do escritório (procuração)
  update public.xml_tarefas t set status = 'certificado', concluido_em = now(),
         mensagem = 'Sem certificado A1 que sirva para este CNPJ (nem o escolhido no agendamento, nem o da matriz, nem o do escritório com procuração). Cadastre em Certificados e agende de novo.'
   where t.status = 'pendente'
     and t.tentativa_id is null and t.reserva_ate is null
     and (t.tentar_novamente_em is null or t.tentar_novamente_em <= statement_timestamp())
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
       and t.tentativa_id is null and t.reserva_ate is null
       and (t.tentar_novamente_em is null or t.tentar_novamente_em <= statement_timestamp())
     order by a.executar_em, t.criado_em
     limit greatest(1, least(p_max, 50))
     for update of t skip locked) x;
  if v_ids is null then return; end if;

  update public.xml_tarefas set status = 'processando', iniciado_em = now(), robo = p_robo,
         tentar_novamente_em = null
   where xml_tarefas.id = any(v_ids);

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

revoke all on function public.xml_nfse_pegar_lote(text, integer) from public, anon, authenticated;
grant execute on function public.xml_nfse_pegar_lote(text, integer) to service_role;

create or replace function public.xml_nfse_pegar_lote_v2(p_robo text, p_max integer default 10)
returns table (id uuid, cnpj text, nome text, codigo text, tipos text[], data_inicio date, data_fim date,
               certificado_cnpj text, pfx_cifrado text, senha_cifrada text, org_id uuid, org_nome text, procurador boolean, mei boolean, mei_bloqueado boolean)
-- Executa com as permissões do proprietário. A concessão ao serviço limita quem pode chamar.
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
#variable_conflict use_column
begin
  update public.xml_tarefas t
     set status = 'pendente', iniciado_em = null, robo = null, tentativa_id = null, reserva_ate = null
    from public.xml_agendamentos a, public.organizacoes o
   where t.agendamento_id = a.id and a.origem = 'nfse' and o.id = t.org_id and o.ativo
     and t.status = 'processando'
     and coalesce(t.reserva_ate, t.iniciado_em + interval '90 minutes') <= statement_timestamp();

  update public.xml_tarefas t set status = 'erro', concluido_em = now(),
         mensagem = 'Empresa ou agendamento da NFS-e incompatível com a organização da tarefa.'
    from public.xml_agendamentos a, public.organizacoes o
   where t.agendamento_id = a.id and a.origem = 'nfse' and o.id = t.org_id and o.ativo
     and t.status = 'pendente' and a.executar_em <= now()
       and t.tentativa_id is null and t.reserva_ate is null
       and (t.tentar_novamente_em is null or t.tentar_novamente_em <= statement_timestamp())
     and (a.org_id <> t.org_id or t.empresa_id is not null or not exists (
       select 1 from public.xml_nfse_empresas e
       where e.id = t.nfse_empresa_id and e.org_id = t.org_id and e.cnpj = t.ie
     ));

  update public.xml_tarefas t set status = 'certificado', concluido_em = now(),
         mensagem = 'Sem certificado A1 autorizado da empresa, matriz ou procurador nesta organização.'
    from public.xml_agendamentos a, public.organizacoes o, public.xml_nfse_empresas e
   where t.agendamento_id = a.id and a.org_id = t.org_id and a.origem = 'nfse' and a.executar_em <= now()
     and o.id = t.org_id and o.ativo and t.empresa_id is null and t.status = 'pendente'
       and t.tentativa_id is null and t.reserva_ate is null
       and (t.tentar_novamente_em is null or t.tentar_novamente_em <= statement_timestamp())
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
       and t.tentativa_id is null and t.reserva_ate is null
       and (t.tentar_novamente_em is null or t.tentar_novamente_em <= statement_timestamp())
     order by a.executar_em, t.criado_em, t.id
     limit greatest(1, least(p_max, 50))
     for update of t skip locked for share of a, o, e
  ), retiradas as (
    update public.xml_tarefas t set status = 'processando', iniciado_em = now(), robo = p_robo,
           tentar_novamente_em = null
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
