begin;

-- Totais do Monitor Fiscal agrupados por escritório e empresa, sob a RLS das notas.
create or replace function public.xml_nfe_resumo_monitor(p_inicio timestamptz, p_fim timestamptz)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(resumo)), '[]'::jsonb)
  from (
    select org_id, cnpj, count(*) as "notasEncontradas",
      count(*) filter (where no_mes) as "notasMes",
      coalesce(sum(valor) filter (where no_mes), 0) as "comprasMes"
    from (
      select org_id, cnpj, valor, situacao = 'autorizada' and emissao >= p_inicio and emissao < p_fim as no_mes
      from public.xml_nfe_notas
    ) notas
    group by org_id, cnpj
  ) resumo
$$;
revoke execute on function public.xml_nfe_resumo_monitor(timestamptz, timestamptz) from public, anon;
grant execute on function public.xml_nfe_resumo_monitor(timestamptz, timestamptz) to authenticated;

notify pgrst, 'reload schema';
commit;
