begin;

-- Identifica a NFS-e já pendente que cobre a competência do Dossiê MEI.
create or replace function public.xml_mei_nfse_pendente(p_org uuid, p_nfse uuid, p_competencia date, p_executar_em timestamptz)
returns uuid language sql stable security invoker set search_path = '' as $$
  select a.id from public.xml_tarefas t join public.xml_agendamentos a on a.id = t.agendamento_id and a.org_id = t.org_id
    where t.org_id = p_org and t.nfse_empresa_id = p_nfse and a.origem = 'nfse'
      and 'nfse_emitidas' = any(t.tipos) and t.status in ('pendente', 'processando')
      and a.competencia >= p_competencia and a.competencia < (date_trunc('year', p_competencia::timestamp) + interval '1 year')::date
      and a.executar_em <= p_executar_em
    order by a.competencia, a.executar_em, a.id limit 1
$$;
revoke all on function public.xml_mei_nfse_pendente(uuid, uuid, date, timestamptz) from public, anon, authenticated;
grant execute on function public.xml_mei_nfse_pendente(uuid, uuid, date, timestamptz) to service_role;

create or replace function public.xml_mei_reprocessar(p_org uuid, p_documento text, p_competencia date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cnpj text; v_empresa record; v_nfse record; v_ag uuid; v_ids uuid[] := '{}'; v_ativo uuid; v_criados integer := 0;
  v_complemento uuid;
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
  if v_nfse.id is null then
    -- A inserção da tarefa SEFAZ pode ter criado o cadastro e agendado NFS-e pelo trigger.
    select public.xml_mei_nfse_pendente(p_org, n.id, p_competencia, a.executar_em) into v_complemento
      from public.xml_nfse_empresas n
      join public.xml_agendamentos a on a.org_id = n.org_id and a.id = any(v_ids) and a.origem = 'sefaz'
      where n.org_id = p_org and n.cnpj = v_cnpj
      order by a.executar_em desc, a.id limit 1;
    if v_complemento is not null then v_ids := array_append(v_ids, v_complemento); end if;
  end if;
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
  if public.xml_mei_nfse_pendente(new.org_id, v_nfse, v_ag.competencia, v_ag.executar_em) is not null then return new; end if;

  insert into public.xml_agendamentos(org_id, criado_por, competencia, executar_em, total, origem, nome_arquivo)
    values (new.org_id, v_ag.criado_por, v_ag.competencia, v_ag.executar_em, 1, 'nfse', 'Complemento NFS-e do MEI (ATF)') returning id into v_novo;
  insert into public.xml_tarefas(org_id, agendamento_id, nfse_empresa_id, ie, nome, codigo, tipos)
    values (new.org_id, v_novo, v_nfse, v_empresa.cnpj, v_empresa.nome, v_empresa.codigo, array['nfse_emitidas']);
  return new;
end $$;

notify pgrst, 'reload schema';
commit;
