begin;

-- Complemento nacional para MEIs agendados no ATF. A execução normal da fila
-- informa ausência de certificado/procuração; falhas nunca viram receita zero.
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
  if exists (
    select 1 from public.xml_tarefas t join public.xml_agendamentos a on a.id = t.agendamento_id
      where t.org_id = new.org_id and t.nfse_empresa_id = v_nfse and a.origem = 'nfse'
        and 'nfse_emitidas' = any(t.tipos) and t.status in ('pendente', 'processando')
        and a.competencia >= v_ag.competencia and date_trunc('year', a.competencia) = date_trunc('year', v_ag.competencia)
        and a.executar_em <= v_ag.executar_em
  ) then return new; end if;

  insert into public.xml_agendamentos(org_id, criado_por, competencia, executar_em, total, origem, nome_arquivo)
    values (new.org_id, v_ag.criado_por, v_ag.competencia, v_ag.executar_em, 1, 'nfse', 'Complemento NFS-e do MEI (ATF)') returning id into v_novo;
  insert into public.xml_tarefas(org_id, agendamento_id, nfse_empresa_id, ie, nome, codigo, tipos)
    values (new.org_id, v_novo, v_nfse, v_empresa.cnpj, v_empresa.nome, v_empresa.codigo, array['nfse_emitidas']);
  return new;
end $$;
revoke all on function public.xml_mei_agendar_nfse_atf() from public, anon, authenticated;
drop trigger if exists xml_mei_complemento_nfse_atf on public.xml_tarefas;
create trigger xml_mei_complemento_nfse_atf after insert on public.xml_tarefas
  for each row execute function public.xml_mei_agendar_nfse_atf();

commit;
