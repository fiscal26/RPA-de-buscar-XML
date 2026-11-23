begin;

alter table public.xml_nfe_notas
  add column if not exists xml_consultado_em timestamptz,
  add column if not exists xml_fora_prazo boolean not null default false;

-- Fila do robô: empresas cuja consulta venceu, com o certificado A1 dela (ou o da matriz, mesma raiz do CNPJ:
-- o Ambiente Nacional só entrega ao próprio interessado) e as notas que ainda esperam o XML completo
create or replace function public.xml_nfe_pegar_monitor(p_robo text, p_max integer default 5)
returns table (id uuid, cnpj text, nome text, codigo text, ciencia boolean, ultimo_nsu bigint, org_nome text,
               certificado_cnpj text, pfx_cifrado text, senha_cifrada text, pendentes jsonb)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_ids uuid[];
begin
  update public.xml_nfe_monitor set status = 'fila', iniciado_em = null, robo = null
   where status = 'processando' and iniciado_em < now() - interval '90 minutes';

  update public.xml_nfe_monitor m set status = 'certificado', proxima_consulta = public.xml_nfe_proxima(m.org_id, m.ultima_consulta),
         mensagem = 'Sem certificado A1 desta empresa (nem da matriz). Envie em Certificados.'
   where m.ativo and m.status <> 'processando' and m.proxima_consulta <= now()
     and not exists (select 1 from public.xml_nfse_certificados c
                      where c.org_id = m.org_id and length(c.cnpj) = 14 and left(c.cnpj, 8) = left(m.cnpj, 8));

  select array_agg(x.id) into v_ids from (
    select m.id from public.xml_nfe_monitor m
     where m.ativo and m.status <> 'processando' and m.proxima_consulta <= now()
     order by m.proxima_consulta
     limit greatest(1, least(p_max, 20))
     for update of m skip locked) x;
  if v_ids is null then return; end if;

  update public.xml_nfe_monitor set status = 'processando', iniciado_em = now(), robo = p_robo where xml_nfe_monitor.id = any(v_ids);

  return query
  select m.id, m.cnpj, m.nome, m.codigo, m.ciencia, m.ultimo_nsu, o.nome, c.cnpj, c.pfx_cifrado, c.senha_cifrada,
         coalesce((select jsonb_agg(jsonb_build_object('chave', n.chave, 'manifestada', f.manifestada)
                                    order by n.xml_consultado_em nulls first, n.encontrada_em desc, n.chave)
                     from (values (true), (false)) f(manifestada)
                     cross join lateral (
                       select n.chave, n.xml_consultado_em, n.encontrada_em from public.xml_nfe_notas n
                        where n.org_id = m.org_id and n.cnpj = m.cnpj and not n.completa and n.situacao = 'autorizada'
                          and not n.xml_fora_prazo and (n.manifestada_em is not null) = f.manifestada
                          and n.encontrada_em > now() - interval '90 days'
                        order by n.xml_consultado_em nulls first, n.encontrada_em desc, n.chave limit 100
                     ) n), '[]'::jsonb)
    from public.xml_nfe_monitor m
    join public.organizacoes o on o.id = m.org_id
    cross join lateral (
      select c.cnpj, c.pfx_cifrado, c.senha_cifrada from public.xml_nfse_certificados c
       where c.org_id = m.org_id and length(c.cnpj) = 14 and left(c.cnpj, 8) = left(m.cnpj, 8)
       order by (c.cnpj = m.cnpj) desc, (substr(c.cnpj, 9, 4) = '0001') desc, c.atualizado_em desc
       limit 1) c
   where m.id = any(v_ids);
end $$;

-- O robô devolve a consulta: grava as notas (sem perder o que já se sabia) e marca a próxima consulta
-- (o horário do escritório no dia seguinte, ou daqui a p_espera_minutos quando o Ambiente Nacional pediu para esperar)
create or replace function public.xml_nfe_concluir(p_id uuid, p_ultimo_nsu bigint, p_max_nsu bigint, p_notas jsonb,
                                                  p_status text, p_mensagem text, p_espera_minutos integer default 0)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  m public.xml_nfe_monitor;
  v_novas integer := 0;
begin
  select * into m from public.xml_nfe_monitor where id = p_id;
  if not found then return 0; end if;

  with dados as (
    select n.* from jsonb_to_recordset(coalesce(p_notas, '[]'::jsonb)) as n(
      chave text, numero text, serie text, emitente_cnpj text, emitente_nome text, emitente_uf text,
      valor numeric, emissao timestamptz, situacao text, completa boolean, manifestada boolean, pdf boolean,
      xml_consultado boolean, xml_fora_prazo boolean)
     where n.chave ~ '^[0-9]{44}$'
  ), gravadas as (
    insert into public.xml_nfe_notas as t (org_id, chave, cnpj, numero, serie, emitente_cnpj, emitente_nome, emitente_uf,
                                           valor, emissao, situacao, completa, manifestada_em, pdf, xml_consultado_em, xml_fora_prazo)
    select m.org_id, d.chave, m.cnpj, coalesce(d.numero, ''), coalesce(d.serie, ''), coalesce(d.emitente_cnpj, ''),
           coalesce(d.emitente_nome, ''), coalesce(d.emitente_uf, ''), d.valor, d.emissao,
           case when d.situacao in ('autorizada', 'cancelada', 'denegada') then d.situacao else 'autorizada' end,
           coalesce(d.completa, false), case when d.manifestada then now() end, coalesce(d.pdf, false),
           case when d.xml_consultado then now() end, coalesce(d.xml_fora_prazo, false)
      from dados d
    on conflict (org_id, chave) do update set
      numero        = coalesce(nullif(excluded.numero, ''), t.numero),
      serie         = coalesce(nullif(excluded.serie, ''), t.serie),
      emitente_cnpj = coalesce(nullif(excluded.emitente_cnpj, ''), t.emitente_cnpj),
      emitente_nome = coalesce(nullif(excluded.emitente_nome, ''), t.emitente_nome),
      emitente_uf   = coalesce(nullif(excluded.emitente_uf, ''), t.emitente_uf),
      valor         = coalesce(excluded.valor, t.valor),
      emissao       = coalesce(excluded.emissao, t.emissao),
      -- cancelada vale mais que autorizada (o evento pode chegar antes ou depois da nota)
      situacao      = case when t.situacao = 'cancelada' or excluded.situacao = 'cancelada' then 'cancelada'
                           when excluded.situacao = 'denegada' then 'denegada' else t.situacao end,
      completa      = t.completa or excluded.completa,
      manifestada_em = coalesce(t.manifestada_em, excluded.manifestada_em),
      pdf           = t.pdf or excluded.pdf,
      xml_consultado_em = greatest(t.xml_consultado_em, excluded.xml_consultado_em),
      xml_fora_prazo = t.xml_fora_prazo or excluded.xml_fora_prazo
    returning (xmax = 0) as nova
  )
  select count(*) filter (where nova) into v_novas from gravadas;

  update public.xml_nfe_monitor set
    ultimo_nsu = greatest(ultimo_nsu, coalesce(p_ultimo_nsu, 0)),
    max_nsu = greatest(max_nsu, coalesce(p_max_nsu, 0)),
    status = case when p_status in ('ok', 'erro', 'certificado') then p_status else 'ok' end,
    mensagem = left(coalesce(p_mensagem, ''), 500),
    ultima_consulta = now(),
    ultima_nota_em = case when v_novas > 0 then now() else ultima_nota_em end,
    proxima_consulta = case when coalesce(p_espera_minutos, 0) > 0 then now() + make_interval(mins => p_espera_minutos)
                            else public.xml_nfe_proxima(org_id, now()) end,
    iniciado_em = null, robo = null
  where id = p_id;
  return v_novas;
end $$;

notify pgrst, 'reload schema';
commit;
