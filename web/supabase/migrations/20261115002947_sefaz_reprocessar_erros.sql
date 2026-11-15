begin;
alter table public.xml_agendamentos add column if not exists reprocessamento_de uuid references public.xml_agendamentos(id) on delete set null;
alter table public.xml_agendamentos add column if not exists reprocessamento_automatico boolean not null default false;
create unique index if not exists xml_agendamentos_reprocessamento_unico on public.xml_agendamentos(reprocessamento_de) where reprocessamento_de is not null;

-- Mesma classificação de situacaoTarefa: preserva os serviços já concluídos ou sem movimento.
create or replace function public.xml_tipos_com_erro(p_status text, p_tipos text[], p_detalhes jsonb)
returns text[] language sql immutable security invoker set search_path = public as $$
  select coalesce(array_agg(subtipo order by pos,subpos), '{}') from unnest(p_tipos) with ordinality u(tipo,pos)
  cross join lateral unnest(case when tipo='cte' then array['cte_rem','cte_dest'] else array[tipo] end) with ordinality s(subtipo,subpos)
  where p_status not in ('pendente','processando','cancelado') and case
      when coalesce(p_detalhes->subtipo->>'situacao','') not in ('','fila','andamento','aguardando')
        then p_detalhes->subtipo->>'situacao' = 'erro'
      when coalesce((p_detalhes->subtipo->>'arquivos')::int,0)>0 or coalesce((p_detalhes->subtipo->>'repetidos')::int,0)>0 then false
      when coalesce((p_detalhes->subtipo->>'sem_notas')::boolean,false) or p_status='sem_notas' then false
      else true end;
$$;
revoke all on function public.xml_tipos_com_erro(text,text[],jsonb) from public, anon, authenticated;
grant execute on function public.xml_tipos_com_erro(text,text[],jsonb) to service_role;

create or replace function public.xml_proxima_22h(p_agora timestamptz) returns timestamptz
language sql immutable security invoker set search_path = public as $$
  select (date_trunc('day', local) + interval '22 hours'
    + case when local::time >= time '22:00' then interval '1 day' else interval '0 days' end)
    at time zone 'America/Sao_Paulo' from (select p_agora at time zone 'America/Sao_Paulo' as local) h;
$$;
revoke all on function public.xml_proxima_22h(timestamptz) from public, anon, authenticated;
grant execute on function public.xml_proxima_22h(timestamptz) to service_role;

-- Interna: nunca exposta ao navegador. A transação preserva o histórico original.
create or replace function public.xml_criar_reprocessamento_sefaz(p_id uuid, p_automatico boolean)
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_ag record; v_id uuid; v_total int; v_executar timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended('reprocessar-sefaz:' || p_id::text,0));
  select * into v_ag from public.xml_agendamentos where id=p_id and origem='sefaz';
  if not found then return null; end if;
  select id into v_id from public.xml_agendamentos where reprocessamento_de=p_id;
  if found then return v_id; end if;
  if p_automatico and (v_ag.reprocessamento_de is not null or v_ag.reprocessamento_automatico) then return null; end if;
  if exists(select 1 from public.xml_tarefas where agendamento_id=p_id and status in ('pendente','processando')) then return null; end if;
  select count(*) into v_total from public.xml_tarefas t
    where t.agendamento_id=p_id and t.org_id=v_ag.org_id and t.empresa_id is not null
      and cardinality(public.xml_tipos_com_erro(t.status,t.tipos,t.detalhes))>0;
  if v_total=0 or (p_automatico and v_total<15) then return null; end if;
  if p_automatico then
    v_executar := public.xml_proxima_22h(now());
  else v_executar:=now(); end if;
  insert into public.xml_agendamentos(org_id,criado_por,competencia,executar_em,total,origem,nome_arquivo,reprocessamento_de,reprocessamento_automatico)
    values(v_ag.org_id,v_ag.criado_por,v_ag.competencia,v_executar,v_total,'sefaz',
      case when p_automatico then 'Reprocessamento automático de erros' else 'Reprocessamento de erros' end,p_id,p_automatico) returning id into v_id;
  insert into public.xml_tarefas(org_id,agendamento_id,empresa_id,ie,nome,codigo,tipos)
    select t.org_id,v_id,t.empresa_id,t.ie,t.nome,t.codigo,public.xml_tipos_com_erro(t.status,t.tipos,t.detalhes)
      from public.xml_tarefas t where t.agendamento_id=p_id and t.org_id=v_ag.org_id and t.empresa_id is not null
        and cardinality(public.xml_tipos_com_erro(t.status,t.tipos,t.detalhes))>0;
  return v_id;
end $$;
revoke all on function public.xml_criar_reprocessamento_sefaz(uuid,boolean) from public, anon, authenticated;
grant execute on function public.xml_criar_reprocessamento_sefaz(uuid,boolean) to service_role;

create or replace function public.xml_reprocessar_erros_sefaz(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_id uuid;
begin
  select org_id into v_org from public.xml_agendamentos where id=p_id and origem='sefaz';
  if v_org is null or not exists(select 1 from public.perfis p where p.id=auth.uid() and p.ativo
    and (p.papel='admin' or (p.papel in ('gestor','usuario') and p.org_id=v_org and exists(select 1 from public.organizacoes o where o.id=v_org and o.ativo)))) then
    raise exception 'Sem permissão para reprocessar este agendamento';
  end if;
  v_id:=public.xml_criar_reprocessamento_sefaz(p_id,false);
  if v_id is null then raise exception 'Aguarde o término do agendamento; é necessário haver empresas cadastradas com erro'; end if;
  return v_id;
end $$;
revoke all on function public.xml_reprocessar_erros_sefaz(uuid) from public, anon;
grant execute on function public.xml_reprocessar_erros_sefaz(uuid) to authenticated;

create or replace function public.xml_reprocessar_sefaz_automatico() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if new.status not in ('pendente','processando') then
    perform public.xml_criar_reprocessamento_sefaz(new.agendamento_id,true);
  end if;
  return new;
end $$;
revoke all on function public.xml_reprocessar_sefaz_automatico() from public, anon, authenticated;
drop trigger if exists xml_sefaz_reprocessar_automatico on public.xml_tarefas;
create trigger xml_sefaz_reprocessar_automatico after update of status,detalhes on public.xml_tarefas
  for each row execute function public.xml_reprocessar_sefaz_automatico();
commit;
