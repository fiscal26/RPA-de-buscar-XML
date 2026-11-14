-- Dados públicos mínimos, compartilhados somente no backend. Nenhuma credencial da CNPJá.
create table if not exists public.xml_cnpja_cache (
  cnpj text primary key check (cnpj ~ '^[0-9]{14}$'),
  dados jsonb,
  consultado_em timestamptz,
  reserva uuid,
  reserva_ate timestamptz,
  check ((dados is null) = (consultado_em is null))
);
create table if not exists public.xml_cnpja_controle (
  id boolean primary key default true check (id),
  ultima_consulta timestamptz,
  bloqueado_ate timestamptz
);
insert into public.xml_cnpja_controle (id) values (true) on conflict do nothing;
alter table public.xml_cnpja_cache enable row level security;
alter table public.xml_cnpja_controle enable row level security;
revoke all on public.xml_cnpja_cache, public.xml_cnpja_controle from public, anon, authenticated;
grant all on public.xml_cnpja_cache, public.xml_cnpja_controle to service_role;

-- Serializa todas as instâncias do portal: espaçamento de 13s, no máximo 5 chamadas/60s.
-- Reserva por CNPJ impede que cliques concorrentes consultem a mesma empresa duas vezes.
create or replace function public.xml_cnpja_reservar(p_cnpj text, p_forcar boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cache public.xml_cnpja_cache; v_controle public.xml_cnpja_controle;
  v_agora timestamptz := clock_timestamp(); v_ate timestamptz; v_token uuid;
begin
  if p_cnpj is null or p_cnpj !~ '^[0-9]{14}$' then raise exception 'CNPJ inválido'; end if;
  perform pg_advisory_xact_lock(hashtextextended('xml_cnpja_publica',0));
  v_agora := clock_timestamp();
  insert into public.xml_cnpja_cache (cnpj) values (p_cnpj) on conflict do nothing;
  select * into v_cache from public.xml_cnpja_cache where cnpj=p_cnpj;
  -- O botão de atualização também respeita um intervalo mínimo de 5 minutos para o mesmo CNPJ.
  if v_cache.dados is not null and v_cache.consultado_em > v_agora - (case when p_forcar then interval '5 minutes' else interval '7 days' end) then
    return jsonb_build_object('status','cache','dados',v_cache.dados,'consultado_em',v_cache.consultado_em);
  end if;
  if v_cache.reserva_ate > v_agora then
    return jsonb_build_object('status','aguardar','segundos',greatest(1,ceil(extract(epoch from v_cache.reserva_ate-v_agora))));
  end if;
  select * into v_controle from public.xml_cnpja_controle where id=true;
  v_ate := greatest(v_controle.ultima_consulta+interval '13 seconds',v_controle.bloqueado_ate);
  if v_ate > v_agora then
    return jsonb_build_object('status','aguardar','segundos',greatest(1,ceil(extract(epoch from v_ate-v_agora))));
  end if;
  v_token := gen_random_uuid();
  update public.xml_cnpja_cache set reserva=v_token,reserva_ate=v_agora+interval '25 seconds' where cnpj=p_cnpj;
  update public.xml_cnpja_controle set ultima_consulta=v_agora where id=true;
  return jsonb_build_object('status','consultar','token',v_token,'dados',v_cache.dados,'consultado_em',v_cache.consultado_em);
end $$;

create or replace function public.xml_cnpja_finalizar(p_cnpj text, p_token uuid, p_dados jsonb default null, p_bloqueio integer default 0)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if p_dados is not null and (jsonb_typeof(p_dados)<>'object' or (p_dados->>'cnpj') is distinct from p_cnpj) then
    raise exception 'Dados não correspondem ao CNPJ reservado';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('xml_cnpja_publica',0));
  update public.xml_cnpja_cache set dados=coalesce(p_dados,dados),
    consultado_em=case when p_dados is null then consultado_em else clock_timestamp() end,
    reserva=null,reserva_ate=null where cnpj=p_cnpj and reserva=p_token;
  get diagnostics v_n = row_count;
  if v_n=0 then return false; end if;
  if p_bloqueio>0 then
    update public.xml_cnpja_controle set bloqueado_ate=greatest(bloqueado_ate,clock_timestamp()+make_interval(secs=>least(p_bloqueio,3600))) where id=true;
  end if;
  return true;
end $$;
revoke all on function public.xml_cnpja_reservar(text,boolean) from public,anon,authenticated;
revoke all on function public.xml_cnpja_finalizar(text,uuid,jsonb,integer) from public,anon,authenticated;
grant execute on function public.xml_cnpja_reservar(text,boolean) to service_role;
grant execute on function public.xml_cnpja_finalizar(text,uuid,jsonb,integer) to service_role;
