begin;
-- RPC interna do backend: cria todo o intervalo na mesma transação.
create or replace function public.xml_agendar_periodo(p_org uuid, p_criado_por uuid, p_inicio date, p_fim date,
  p_executar timestamptz, p_origem text, p_nome text, p_empresas jsonb, p_certificado uuid default null)
returns uuid[] language plpgsql security invoker set search_path = public as $$
declare v_mes date; v_ag uuid; v_ids uuid[]:='{}'; v_item record; v_total int; v_inseridas int;
begin
  if p_origem is null or p_origem not in ('sefaz','nfse') or p_inicio is null or p_fim is null
    or extract(day from p_inicio)<>1 or extract(day from p_fim)<>1 or p_inicio>p_fim
    or p_inicio < (case when p_origem='nfse' then date '2023-01-01' else date '2006-01-01' end)
    or p_fim>date_trunc('month',now() at time zone 'America/Sao_Paulo')::date then raise exception 'Período inválido'; end if;
  if not exists(select 1 from public.organizacoes where id=p_org and ativo) then raise exception 'Escritório inativo'; end if;
  if p_empresas is null or jsonb_typeof(p_empresas)<>'array' or jsonb_array_length(p_empresas)=0 then raise exception 'Escolha as empresas'; end if;
  v_total:=jsonb_array_length(p_empresas);
  if (select count(distinct x.id) from jsonb_to_recordset(p_empresas) x(id uuid,tipos text[]))<>v_total then raise exception 'Empresas repetidas'; end if;
  for v_item in select * from jsonb_to_recordset(p_empresas) x(id uuid,tipos text[]) loop
    if v_item.id is null or coalesce(cardinality(v_item.tipos),0)=0 or array_position(v_item.tipos,null) is not null then raise exception 'Serviços inválidos'; end if;
    if p_origem='sefaz' then
      if not exists(select 1 from public.xml_empresas where id=v_item.id and org_id=p_org)
        or not(v_item.tipos <@ array['nfe_saida','nfe_entrada','nfce','cte','faturas','extrato','omissao','certidao','cartao','mei']) then raise exception 'Empresa ou serviço SEFAZ inválido'; end if;
    else
      if not exists(select 1 from public.xml_nfse_empresas where id=v_item.id and org_id=p_org)
        or not(v_item.tipos <@ array['nfse_emitidas','nfse_recebidas','nfse_pdf','nfse_retencoes']) then raise exception 'Empresa ou serviço NFS-e inválido'; end if;
    end if;
  end loop;
  if p_certificado is not null and (p_origem<>'nfse' or not exists(select 1 from public.xml_nfse_certificados where id=p_certificado and org_id=p_org)) then raise exception 'Certificado inválido'; end if;
  for v_mes in select d::date from generate_series(p_inicio,p_fim,interval '1 month') d loop
    insert into public.xml_agendamentos(org_id,criado_por,competencia,executar_em,total,origem,nome_arquivo,certificado_id)
      values(p_org,p_criado_por,v_mes,coalesce(p_executar,now()),v_total,p_origem,left(coalesce(p_nome,''),200),p_certificado) returning id into v_ag;
    if p_origem='sefaz' then
      insert into public.xml_tarefas(org_id,agendamento_id,empresa_id,ie,nome,codigo,tipos)
        select p_org,v_ag,e.id,e.ie,e.nome,e.codigo,x.tipos from jsonb_to_recordset(p_empresas) x(id uuid,tipos text[])
          join public.xml_empresas e on e.id=x.id and e.org_id=p_org;
    else
      insert into public.xml_tarefas(org_id,agendamento_id,nfse_empresa_id,ie,nome,codigo,tipos)
        select p_org,v_ag,e.id,e.cnpj,e.nome,e.codigo,x.tipos from jsonb_to_recordset(p_empresas) x(id uuid,tipos text[])
          join public.xml_nfse_empresas e on e.id=x.id and e.org_id=p_org;
    end if;
    get diagnostics v_inseridas = row_count;
    if v_inseridas<>v_total then raise exception 'Cadastro de empresas alterado durante o agendamento; tente novamente'; end if;
    v_ids:=array_append(v_ids,v_ag);
  end loop;
  return v_ids;
end $$;
revoke all on function public.xml_agendar_periodo(uuid,uuid,date,date,timestamptz,text,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.xml_agendar_periodo(uuid,uuid,date,date,timestamptz,text,text,jsonb,uuid) to service_role;

-- Metadados de acompanhamento; as políticas RLS existentes continuam isolando organizações.
grant select (id,competencia,origem) on public.xml_agendamentos to authenticated;

-- Usa a autorização e as regras por competência já existentes; qualquer falha desfaz todo o intervalo.
create or replace function public.xml_mei_reprocessar_periodo(p_org uuid,p_documento text,p_inicio date,p_fim date)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_mes date; v_r jsonb; v_ids uuid[]:='{}'; v_id uuid; v_existente boolean:=true;
begin
  if p_inicio is null or p_fim is null or p_inicio>p_fim or extract(day from p_inicio)<>1 or extract(day from p_fim)<>1
    or p_inicio<date '2018-01-01' or p_fim>date_trunc('month',now() at time zone 'America/Sao_Paulo')::date then raise exception 'Período inválido'; end if;
  for v_mes in select d::date from generate_series(p_inicio,p_fim,interval '1 month') d loop
    v_r:=public.xml_mei_reprocessar(p_org,p_documento,v_mes);
    v_existente:=v_existente and (v_r->>'existente')::boolean;
    for v_id in select value::uuid from jsonb_array_elements_text(v_r->'agendamentos') loop
      if not(v_id=any(v_ids)) then v_ids:=array_append(v_ids,v_id); end if;
    end loop;
  end loop;
  return jsonb_build_object('agendamentos',v_ids,'existente',v_existente,'consultas',(
    select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'competencia',a.competencia,'origem',a.origem) order by a.competencia,a.origem),'[]'::jsonb)
    from public.xml_agendamentos a where a.id=any(v_ids)));
end $$;
revoke all on function public.xml_mei_reprocessar_periodo(uuid,text,date,date) from public,anon;
grant execute on function public.xml_mei_reprocessar_periodo(uuid,text,date,date) to authenticated;
commit;
