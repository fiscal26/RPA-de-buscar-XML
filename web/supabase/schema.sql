-- =====================================================================================
-- LotiVisse XML — estrutura do banco (Supabase / PostgreSQL)
--
-- Projeto próprio do Supabase (separado do portal de CND; só o domínio e a marca são os mesmos).
-- Como usar: no painel do Supabase, abra "SQL Editor", cole TODO este arquivo e clique em "Run".
-- Pode rodar de novo sem perder dados.
--
-- Senhas do ATF: chegam aqui já cifradas pelo portal com a chave pública do robô
-- (coluna senha_cifrada, formato "v1:..."). Só o robô, no seu PC, tem a chave que abre.
-- Certificados A1 da NFS-e: o arquivo em "v2:..." e a senha em "v1:...", pela mesma chave.
--
-- Papéis:
--   admin   -> responsável pela plataforma (você): vê e gerencia todas as organizações
--   gestor  -> responsável pelo escritório cliente
--   usuario -> usa o portal do escritório
-- =====================================================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------------- clientes e login
create table if not exists public.organizacoes (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  documento  text not null default '',
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);

create table if not exists public.perfis (
  id         uuid primary key references auth.users(id) on delete cascade,
  org_id     uuid references public.organizacoes(id) on delete cascade,
  nome       text not null default '',
  email      text not null default '',
  papel      text not null default 'usuario' check (papel in ('admin', 'gestor', 'usuario')),
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now(),
  check (papel = 'admin' or org_id is not null)
);

-- e-mail de alerta do Monitoramento MEI (cada pessoa pode desligar em Meu perfil)
alter table public.perfis add column if not exists alertas_mei boolean not null default true;

create or replace function public.minha_org() returns uuid
language sql stable security definer set search_path = public as $$
  select p.org_id from public.perfis p join public.organizacoes o on o.id = p.org_id
   where p.id = auth.uid() and p.ativo and o.ativo
$$;

create or replace function public.meu_papel() returns text
language sql stable security definer set search_path = public as $$
  select papel from public.perfis where id = auth.uid() and ativo
$$;

create or replace function public.sou_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.meu_papel() = 'admin', false)
$$;

-- ------------------------------------------------------------------------- XML
-- Acessos do contador ao ATF (colunas LOGIN e SENHA da planilha). Um login serve várias empresas.
create table if not exists public.xml_acessos (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizacoes(id) on delete cascade,
  login          text not null check (length(login) between 1 and 60),
  senha_cifrada  text not null check (senha_cifrada like 'v1:%'),
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  unique (org_id, login)
);

-- Empresas (uma por inscrição estadual), com os XML marcados na planilha
create table if not exists public.xml_empresas (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizacoes(id) on delete cascade,
  ie             text not null check (ie ~ '^[0-9]{9}$'),
  cnpj           text not null default '' check (cnpj ~ '^([0-9]{11}|[0-9]{14})?$'),
  codigo         text not null default '',                  -- coluna ID da planilha
  filial         text not null default '',                  -- coluna ID_FILIAL
  nome           text not null check (length(nome) between 1 and 60),
  acesso_id      uuid references public.xml_acessos(id) on delete set null,
  tipos          text[] not null default '{}',
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  unique (org_id, ie),
  constraint xml_empresas_tipos_check
    check (tipos <@ array['nfe_saida', 'nfe_entrada', 'nfce', 'cte', 'faturas', 'extrato', 'omissao', 'certidao', 'cartao', 'mei'])
);

-- Nome renomeado no portal: a planilha seguinte não troca de volta
alter table public.xml_empresas add column if not exists nome_fixo boolean not null default false;

-- Banco criado antes dos novos serviços (faturas, extrato, omissão, certidão, CT-e, cartão): troca a regra dos tipos
alter table public.xml_empresas drop constraint if exists xml_empresas_tipos_check;
alter table public.xml_empresas add constraint xml_empresas_tipos_check
  check (tipos <@ array['nfe_saida', 'nfe_entrada', 'nfce', 'cte', 'faturas', 'extrato', 'omissao', 'certidao', 'cartao', 'mei']);

-- Cada planilha enviada na área de agendamento (uma competência: do 1º ao último dia do mês)
create table if not exists public.xml_agendamentos (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizacoes(id) on delete cascade,
  criado_por    uuid references auth.users(id) on delete set null,
  nome_arquivo  text not null default '',
  competencia   date not null check (extract(day from competencia) = 1),
  data_inicio   date generated always as (competencia) stored,
  data_fim      date generated always as ((competencia + interval '1 month' - interval '1 day')::date) stored,
  executar_em   timestamptz not null default now(),          -- quando o robô pode começar
  total         integer not null default 0,
  criado_em     timestamptz not null default now()
);

-- Uma tarefa por empresa do agendamento (o robô faz todos os XML marcados numa sessão do ATF)
create table if not exists public.xml_tarefas (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizacoes(id) on delete cascade,
  agendamento_id  uuid not null references public.xml_agendamentos(id) on delete cascade,
  empresa_id      uuid references public.xml_empresas(id) on delete set null,
  ie              text not null,
  nome            text not null default '',
  codigo          text not null default '',
  tipos           text[] not null,                            -- o que estava marcado ao agendar
  status          text not null default 'pendente' check (status in (
                    'pendente', 'processando', 'concluido', 'sem_notas', 'senha_invalida', 'certificado',
                    'erro', 'fora_do_ar', 'cancelado')),
  mensagem        text not null default '',
  qtd_xml         integer not null default 0,
  detalhes        jsonb not null default '{}'::jsonb,          -- por tipo: salvos, repetidos, conferir
  pasta           text not null default '',                    -- nome da pasta no PC do robô
  robo            text,
  criado_em       timestamptz not null default now(),
  iniciado_em     timestamptz,
  concluido_em    timestamptz
);
create index if not exists xml_tarefas_fila_idx on public.xml_tarefas (criado_em) where status = 'pendente';
create index if not exists xml_tarefas_agendamento_idx on public.xml_tarefas (agendamento_id);
create index if not exists xml_agendamentos_org_idx on public.xml_agendamentos (org_id, criado_em desc);
create index if not exists xml_tarefas_org_idx on public.xml_tarefas (org_id, criado_em desc);
create index if not exists xml_tarefas_empresa_idx on public.xml_tarefas (empresa_id);
create index if not exists xml_empresas_acesso_idx on public.xml_empresas (acesso_id);

-- Robôs (o programa que roda no PC e baixa os XML)
create table if not exists public.xml_robos (
  id           text primary key,
  ultimo_sinal timestamptz not null default now(),
  versao       text not null default '',
  info         jsonb not null default '{}'::jsonb
);

-- ------------------------------------------------------------------------- Monitoramento MEI
-- Um mês do Dossiê MEI (Docs fiscais do ATF) por empresa: o robô grava o ano inteiro a cada consulta.
create table if not exists public.xml_mei_meses (
  org_id           uuid not null references public.organizacoes(id) on delete cascade,
  ie               text not null check (ie ~ '^[0-9]{9}$'),
  nome             text not null default '',
  competencia      date not null check (extract(day from competencia) = 1),  -- 1º dia do mês
  saidas           numeric(14,2),            -- notas de saída (faturamento pelas notas)
  entradas         numeric(14,2),            -- notas de entrada (compras)
  qtd_saidas       integer,
  qtd_entradas     integer,
  cartao           numeric(14,2),            -- vendas no cartão (à parte: podem estar ou não nas notas)
  qtd_cartao       integer,
  sem_movimento    boolean,
  simei            boolean,
  inicio_atividade date,
  itens            jsonb not null default '[]'::jsonb,  -- uma linha por tipo de documento (NFEs, NFCEs...)
  consultado_em    timestamptz,
  atualizado_em    timestamptz not null default now(),
  primary key (org_id, ie, competencia)
);

-- Lançamentos manuais do escritório: receita sem nota/cartão, compra que o ATF não mostra, correções
create table if not exists public.xml_mei_ajustes (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizacoes(id) on delete cascade,
  ie           text not null check (ie ~ '^[0-9]{9}$'),
  competencia  date not null check (extract(day from competencia) = 1),
  tipo         text not null check (tipo in ('receita', 'compra')),
  descricao    text not null check (length(descricao) between 1 and 120),
  valor        numeric(14,2) not null check (valor <> 0),  -- negativo = correção para menos
  criado_por   uuid references auth.users(id) on delete set null,
  criado_em    timestamptz not null default now()
);
create index if not exists xml_mei_ajustes_idx on public.xml_mei_ajustes (org_id, ie, competencia);

-- Alertas de limite do MEI já enviados: cada nível sai uma vez por ano, por MEI e por medida
create table if not exists public.xml_mei_alertas (
  org_id       uuid not null references public.organizacoes(id) on delete cascade,
  ie           text not null,
  ano          integer not null,
  medida       text not null check (medida in ('faturamento', 'compras')),
  nivel        text not null check (nivel in ('ritmo', 'atencao', 'excedeu', 'excedeu20')),
  percentual   numeric(7,2),
  destinatarios integer not null default 0,
  enviado_em   timestamptz not null default now(),
  primary key (org_id, ie, ano, medida, nivel)
);

-- ------------------------------------------------------------------------- NFS-e (Portal Nacional)
-- Certificados A1 (e-CNPJ) das empresas, para a API oficial da NFS-e (ADN). O arquivo .pfx chega
-- cifrado pelo portal com a chave pública do robô ("v2:...": AES-256-GCM, com a chave AES em RSA-OAEP)
-- e a senha em "v1:...". Só o robô abre. Um certificado da matriz serve às filiais (mesma raiz do CNPJ).
create table if not exists public.xml_nfse_certificados (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizacoes(id) on delete cascade,
  cnpj           text not null check (cnpj ~ '^[0-9]{14}$'),
  nome           text not null default '',
  validade       timestamptz,
  pfx_cifrado    text not null check (pfx_cifrado like 'v2:%'),
  senha_cifrada  text not null check (senha_cifrada like 'v1:%'),
  criado_por     uuid references auth.users(id) on delete set null,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  unique (org_id, cnpj)
);

-- Certificado do escritório (procurador): desde 01/11/2026 a API da NFS-e aceita consulta em nome de terceiros
-- com a procuração eletrônica da Receita (e-CAC). Com ele, o robô baixa as notas das empresas que deram procuração
-- ao escritório, sem o certificado de cada uma. Pode ser e-CNPJ do escritório ou e-CPF do contador.
alter table public.xml_nfse_certificados add column if not exists procurador boolean not null default false;
alter table public.xml_nfse_certificados drop constraint if exists xml_nfse_certificados_cnpj_check;
alter table public.xml_nfse_certificados add constraint xml_nfse_certificados_cnpj_check
  check (cnpj ~ '^([0-9]{11}|[0-9]{14})$' and (length(cnpj) = 14 or procurador));

-- Empresas da NFS-e (uma por CNPJ), separadas das empresas da SEFAZ (que são por inscrição estadual)
create table if not exists public.xml_nfse_empresas (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizacoes(id) on delete cascade,
  cnpj           text not null check (cnpj ~ '^[0-9]{14}$'),
  codigo         text not null default '',
  nome           text not null check (length(nome) between 1 and 60),
  nome_fixo      boolean not null default false,
  tipos          text[] not null default '{}',
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  unique (org_id, cnpj),
  constraint xml_nfse_empresas_tipos_check
    check (tipos <@ array['nfse_emitidas', 'nfse_recebidas', 'nfse_pdf', 'nfse_retencoes'])
);

-- De onde vem o agendamento: SEFAZ do estado (ATF) ou Portal Nacional da NFS-e
alter table public.xml_agendamentos add column if not exists origem text not null default 'sefaz';
alter table public.xml_agendamentos drop constraint if exists xml_agendamentos_origem_check;
alter table public.xml_agendamentos add constraint xml_agendamentos_origem_check check (origem in ('sefaz', 'nfse'));
-- NFS-e: certificado escolhido no agendamento (vazio = automático: o da empresa, o da matriz ou o do escritório)
alter table public.xml_agendamentos add column if not exists certificado_id uuid references public.xml_nfse_certificados(id) on delete set null;
alter table public.xml_tarefas add column if not exists nfse_empresa_id uuid references public.xml_nfse_empresas(id) on delete set null;
create index if not exists xml_tarefas_nfse_empresa_idx on public.xml_tarefas (nfse_empresa_id);
-- situação nova: certificado A1 ausente, vencido ou recusado
alter table public.xml_tarefas drop constraint if exists xml_tarefas_status_check;
alter table public.xml_tarefas add constraint xml_tarefas_status_check check (status in (
  'pendente', 'processando', 'concluido', 'sem_notas', 'senha_invalida', 'certificado', 'erro', 'fora_do_ar', 'cancelado'));

-- Tentativas de login e pedidos de senha nova: só o servidor do portal lê e grava (sem regra para usuários)
create table if not exists public.xml_tentativas (
  id         bigint generated always as identity primary key,
  tipo       text not null check (tipo in ('login', 'senha')),
  chave      text not null,                -- e-mail ou "ip:<endereço>"
  criado_em  timestamptz not null default now()
);
create index if not exists xml_tentativas_idx on public.xml_tentativas (tipo, chave, criado_em desc);

-- ------------------------------------------------------------------------- fila do robô
-- Lote de tarefas liberadas (executar_em já chegou) de UM login do contador e UMA competência:
-- o robô envia todas as consultas desse login e depois recolhe os XML em "Minhas Mensagens".
-- Prefere o login que o robô já está usando (p_login): aproveita a sessão aberta no ATF.
-- Vários robôs podem rodar juntos: "for update skip locked" evita que dois peguem a mesma tarefa.
drop function if exists public.xml_pegar_tarefa(text);
drop function if exists public.xml_pegar_tarefa(text, text);
drop function if exists public.xml_pegar_lote(text, text, integer);
create or replace function public.xml_pegar_lote(p_robo text, p_login text default '', p_max integer default 15)
returns table (id uuid, ie text, cnpj text, nome text, codigo text, tipos text[], data_inicio date, data_fim date,
               login_atf text, senha_cifrada text, org_nome text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_acesso uuid;
  v_competencia date;
  v_ids uuid[];
begin
  -- tarefa "presa" (o robô caiu no meio) volta para a fila depois de 90 min
  update public.xml_tarefas set status = 'pendente', iniciado_em = null, robo = null
   where xml_tarefas.status = 'processando' and xml_tarefas.iniciado_em < now() - interval '90 minutes';

  -- empresa ou login apagado depois do agendamento: encerra com aviso
  update public.xml_tarefas t set status = 'erro', concluido_em = now(),
         mensagem = 'Empresa ou login do ATF removido do cadastro; envie a planilha de novo.'
   where t.status = 'pendente'
     and exists (select 1 from public.xml_agendamentos a where a.id = t.agendamento_id and a.origem = 'sefaz')
     and not exists (select 1 from public.xml_empresas e join public.xml_acessos c on c.id = e.acesso_id
                      where e.id = t.empresa_id);

  -- qual login e competência atender agora
  select e.acesso_id, a.competencia into v_acesso, v_competencia
    from public.xml_tarefas t
    join public.xml_agendamentos a on a.id = t.agendamento_id
    join public.xml_empresas e on e.id = t.empresa_id
    join public.xml_acessos c on c.id = e.acesso_id
   where t.status = 'pendente' and a.executar_em <= now()
   order by (c.login is not distinct from nullif(p_login, '')) desc, a.executar_em, t.criado_em
   limit 1;
  if v_acesso is null then return; end if;

  select array_agg(x.id) into v_ids from (
    select t.id
      from public.xml_tarefas t
      join public.xml_agendamentos a on a.id = t.agendamento_id
      join public.xml_empresas e on e.id = t.empresa_id
     where t.status = 'pendente' and a.executar_em <= now()
       and e.acesso_id = v_acesso and a.competencia = v_competencia
     order by a.executar_em, t.criado_em
     limit greatest(1, least(p_max, 50))
     for update of t skip locked) x;
  if v_ids is null then return; end if;

  update public.xml_tarefas set status = 'processando', iniciado_em = now(), robo = p_robo where xml_tarefas.id = any(v_ids);

  return query
  select t.id, t.ie, e.cnpj, t.nome, t.codigo, t.tipos, a.data_inicio, a.data_fim, c.login, c.senha_cifrada, o.nome
    from public.xml_tarefas t
    join public.organizacoes o on o.id = t.org_id
    join public.xml_agendamentos a on a.id = t.agendamento_id
    join public.xml_empresas e on e.id = t.empresa_id
    join public.xml_acessos c on c.id = e.acesso_id
   where t.id = any(v_ids)
   order by t.criado_em;
end $$;

-- Fila da NFS-e: tarefas liberadas do Portal Nacional, cada uma com o certificado A1 da empresa
-- (o do próprio CNPJ ou, para filial, o da matriz). Não depende de login nem de sessão aberta.
drop function if exists public.xml_nfse_pegar_lote(text, integer);
create or replace function public.xml_nfse_pegar_lote(p_robo text, p_max integer default 10)
returns table (id uuid, cnpj text, nome text, codigo text, tipos text[], data_inicio date, data_fim date,
               certificado_cnpj text, pfx_cifrado text, senha_cifrada text, org_nome text, procurador boolean, mei boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_ids uuid[];
begin
  update public.xml_tarefas set status = 'pendente', iniciado_em = null, robo = null
   where xml_tarefas.status = 'processando' and xml_tarefas.nfse_empresa_id is not null
     and xml_tarefas.iniciado_em < now() - interval '90 minutes';

  -- empresa apagada depois do agendamento
  update public.xml_tarefas t set status = 'erro', concluido_em = now(),
         mensagem = 'Empresa removida do cadastro da NFS-e; envie a planilha de novo.'
   where t.status = 'pendente' and t.nfse_empresa_id is null
     and exists (select 1 from public.xml_agendamentos a where a.id = t.agendamento_id and a.origem = 'nfse');

  -- sem certificado para o CNPJ, nem para a matriz, nem do escritório (procuração)
  update public.xml_tarefas t set status = 'certificado', concluido_em = now(),
         mensagem = 'Sem certificado A1 que sirva para este CNPJ (nem o escolhido no agendamento, nem o da matriz, nem o do escritório com procuração). Cadastre em Certificados e agende de novo.'
   where t.status = 'pendente'
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
     order by a.executar_em, t.criado_em
     limit greatest(1, least(p_max, 50))
     for update of t skip locked) x;
  if v_ids is null then return; end if;

  update public.xml_tarefas set status = 'processando', iniciado_em = now(), robo = p_robo where xml_tarefas.id = any(v_ids);

  return query
  select t.id, e.cnpj, t.nome, t.codigo, t.tipos, a.data_inicio, a.data_fim, c.cnpj, c.pfx_cifrado, c.senha_cifrada, o.nome,
         c.procurador,
         -- MEI na planilha da SEFAZ (mesmo CNPJ, mesmo escritório): a NFS-e sai com o ano todo na primeira vez
         exists (select 1 from public.xml_empresas s where s.org_id = e.org_id and s.cnpj = e.cnpj and 'mei' = any(s.tipos))
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

-- Cancelar as tarefas de um agendamento que ainda não começaram
create or replace function public.xml_cancelar_agendamento(p_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.xml_tarefas set status = 'cancelado', concluido_em = now(), mensagem = 'Cancelado pelo usuário.'
   where agendamento_id = p_id and status = 'pendente'
     and (org_id = (select public.minha_org()) or public.sou_admin());
  get diagnostics n = row_count;
  return n;
end $$;

-- Grava meses do Dossiê MEI de uma empresa num escritório (upsert por mês).
create or replace function public.xml_mei_gravar(p_org uuid, p_ie text, p_nome text, p_meses jsonb, p_inicio_atividade date)
returns integer language plpgsql security definer set search_path = public as $$
declare v_mes text; v_d jsonb; n integer := 0;
begin
  for v_mes, v_d in select * from jsonb_each(coalesce(p_meses, '{}'::jsonb)) loop
    continue when v_mes !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or jsonb_typeof(v_d) <> 'object';
    insert into public.xml_mei_meses as m (org_id, ie, nome, competencia, saidas, entradas, qtd_saidas, qtd_entradas,
                                           cartao, qtd_cartao, sem_movimento, simei, inicio_atividade, itens, consultado_em)
    values (p_org, p_ie, coalesce(p_nome, ''), (v_mes || '-01')::date,
            nullif(v_d->>'saidas', '')::numeric, nullif(v_d->>'entradas', '')::numeric,
            nullif(v_d->>'qtd_saidas', '')::numeric::integer, nullif(v_d->>'qtd_entradas', '')::numeric::integer,
            nullif(v_d->'cartao'->>'valor', '')::numeric, nullif(v_d->'cartao'->>'qtd', '')::numeric::integer,
            (v_d->>'sem_movimento')::boolean, (v_d->>'simei')::boolean, p_inicio_atividade,
            case when jsonb_typeof(v_d->'itens') = 'array' then v_d->'itens' else '[]'::jsonb end,
            nullif(v_d->>'consultado_em', '')::timestamp at time zone 'America/Fortaleza')
    on conflict (org_id, ie, competencia) do update set
      nome = coalesce(nullif(excluded.nome, ''), m.nome), saidas = excluded.saidas, entradas = excluded.entradas,
      qtd_saidas = excluded.qtd_saidas, qtd_entradas = excluded.qtd_entradas, cartao = excluded.cartao,
      qtd_cartao = excluded.qtd_cartao, sem_movimento = excluded.sem_movimento, simei = excluded.simei,
      inicio_atividade = coalesce(excluded.inicio_atividade, m.inicio_atividade), itens = excluded.itens,
      consultado_em = coalesce(excluded.consultado_em, m.consultado_em), atualizado_em = now();
    n := n + 1;
  end loop;
  return n;
end $$;

-- Robô, ao terminar um Dossiê MEI: o escritório, a IE e o nome saem da tarefa (o robô não escolhe a organização).
create or replace function public.xml_mei_registrar(p_tarefa uuid, p_meses jsonb, p_inicio_atividade date default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_ie text; v_nome text;
begin
  select org_id, ie, nome into v_org, v_ie, v_nome from public.xml_tarefas where id = p_tarefa;
  if v_org is null then raise exception 'tarefa % não encontrada', p_tarefa; end if;
  return public.xml_mei_gravar(v_org, v_ie, v_nome, p_meses, p_inicio_atividade);
end $$;

-- Robô, ao ligar: o histórico já salvo no PC vai para todos os escritórios que têm essa IE cadastrada.
-- Devolve quantos escritórios receberam (0 = IE sem cadastro no portal).
create or replace function public.xml_mei_registrar_ie(p_ie text, p_nome text, p_meses jsonb, p_inicio_atividade date default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_nome text; n integer := 0;
begin
  -- só nos escritórios que marcam a empresa como MEI (quem tirou do monitoramento não recebe o histórico de volta)
  for v_org, v_nome in select org_id, nome from public.xml_empresas where ie = p_ie and 'mei' = any(tipos) loop
    perform public.xml_mei_gravar(v_org, p_ie, coalesce(v_nome, p_nome), p_meses, p_inicio_atividade);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ------------------------------------------------------------------------- segurança (RLS)
-- Leitura pelo portal com a sessão do usuário; gravação pelo servidor do portal (chave secreta),
-- depois de conferir a organização de quem enviou, e pelo robô.
alter table public.organizacoes     enable row level security;
alter table public.perfis           enable row level security;
alter table public.xml_acessos      enable row level security;
alter table public.xml_empresas     enable row level security;
alter table public.xml_agendamentos enable row level security;
alter table public.xml_tarefas      enable row level security;
alter table public.xml_robos        enable row level security;
alter table public.xml_mei_meses    enable row level security;
alter table public.xml_mei_ajustes  enable row level security;
alter table public.xml_mei_alertas  enable row level security;
alter table public.xml_tentativas   enable row level security;
alter table public.xml_nfse_certificados enable row level security;
alter table public.xml_nfse_empresas     enable row level security;
revoke all on public.xml_tentativas from anon, authenticated;

drop policy if exists org_ler on public.organizacoes;
create policy org_ler on public.organizacoes for select to authenticated
  using ((select public.sou_admin()) or id = (select public.minha_org()));

drop policy if exists perfis_ler on public.perfis;
create policy perfis_ler on public.perfis for select to authenticated
  using ((select public.sou_admin()) or id = (select auth.uid())
         or (org_id = (select public.minha_org()) and (select public.meu_papel()) = 'gestor'));

drop policy if exists xml_acessos_ler on public.xml_acessos;
create policy xml_acessos_ler on public.xml_acessos for select to authenticated
  using ((select public.sou_admin()) or org_id = (select public.minha_org()));
-- a senha cifrada não sai para o navegador: só as colunas abaixo podem ser lidas pelo usuário
revoke select on public.xml_acessos from anon, authenticated;
grant select (id, org_id, login, criado_em, atualizado_em) on public.xml_acessos to authenticated;

drop policy if exists xml_empresas_ler on public.xml_empresas;
create policy xml_empresas_ler on public.xml_empresas for select to authenticated
  using ((select public.sou_admin()) or org_id = (select public.minha_org()));

drop policy if exists xml_agendamentos_ler on public.xml_agendamentos;
create policy xml_agendamentos_ler on public.xml_agendamentos for select to authenticated
  using ((select public.sou_admin()) or org_id = (select public.minha_org()));

drop policy if exists xml_tarefas_ler on public.xml_tarefas;
create policy xml_tarefas_ler on public.xml_tarefas for select to authenticated
  using ((select public.sou_admin()) or org_id = (select public.minha_org()));

drop policy if exists xml_robos_ler on public.xml_robos;
create policy xml_robos_ler on public.xml_robos for select to authenticated using ((select public.sou_admin()));

drop policy if exists xml_mei_meses_ler on public.xml_mei_meses;
create policy xml_mei_meses_ler on public.xml_mei_meses for select to authenticated
  using ((select public.sou_admin()) or org_id = (select public.minha_org()));

drop policy if exists xml_mei_ajustes_ler on public.xml_mei_ajustes;
create policy xml_mei_ajustes_ler on public.xml_mei_ajustes for select to authenticated
  using ((select public.sou_admin()) or org_id = (select public.minha_org()));

drop policy if exists xml_mei_alertas_ler on public.xml_mei_alertas;
create policy xml_mei_alertas_ler on public.xml_mei_alertas for select to authenticated
  using ((select public.sou_admin()) or org_id = (select public.minha_org()));

drop policy if exists xml_nfse_empresas_ler on public.xml_nfse_empresas;
create policy xml_nfse_empresas_ler on public.xml_nfse_empresas for select to authenticated
  using ((select public.sou_admin()) or org_id = (select public.minha_org()));

drop policy if exists xml_nfse_certificados_ler on public.xml_nfse_certificados;
create policy xml_nfse_certificados_ler on public.xml_nfse_certificados for select to authenticated
  using ((select public.sou_admin()) or org_id = (select public.minha_org()));
-- o certificado e a senha cifrados não saem para o navegador
revoke select on public.xml_nfse_certificados from anon, authenticated;
grant select (id, org_id, cnpj, nome, validade, procurador, criado_em, atualizado_em) on public.xml_nfse_certificados to authenticated;

-- funções: quem pode chamar
revoke all on function public.xml_pegar_lote(text, text, integer) from public, anon, authenticated;
grant execute on function public.xml_pegar_lote(text, text, integer) to service_role;
revoke all on function public.xml_nfse_pegar_lote(text, integer) from public, anon, authenticated;
grant execute on function public.xml_nfse_pegar_lote(text, integer) to service_role;
revoke all on function public.xml_mei_gravar(uuid, text, text, jsonb, date) from public, anon, authenticated;
revoke all on function public.xml_mei_registrar(uuid, jsonb, date) from public, anon, authenticated;
grant execute on function public.xml_mei_registrar(uuid, jsonb, date) to service_role;
revoke all on function public.xml_mei_registrar_ie(text, text, jsonb, date) from public, anon, authenticated;
grant execute on function public.xml_mei_registrar_ie(text, text, jsonb, date) to service_role;
revoke all on function public.xml_cancelar_agendamento(uuid) from public, anon;
grant execute on function public.xml_cancelar_agendamento(uuid) to authenticated;

-- ========================================================================= Monitor Fiscal (NF-e destinadas)
-- O robô consulta todo dia, no horário escolhido pelo escritório (padrão 11h), o Ambiente Nacional da NF-e (NFeDistribuicaoDFe) com o certificado A1 de cada
-- empresa monitorada e traz as notas em que ela é a destinatária (de qualquer estado), com o XML e o PDF.
create table if not exists public.xml_nfe_monitor (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizacoes(id) on delete cascade,
  cnpj             text not null check (cnpj ~ '^[0-9]{14}$'),
  nome             text not null default '',
  codigo           text not null default '',
  ciencia          boolean not null default true,      -- manifesta "Ciência da Operação" para baixar o XML completo
  ativo            boolean not null default true,
  ultimo_nsu       bigint not null default 0,
  max_nsu          bigint not null default 0,
  status           text not null default 'fila' check (status in ('fila', 'processando', 'ok', 'erro', 'certificado')),
  mensagem         text not null default '',
  proxima_consulta timestamptz not null default now(),
  ultima_consulta  timestamptz,
  ultima_nota_em   timestamptz,                        -- quando a última nota nova foi encontrada
  iniciado_em      timestamptz,
  robo             text,
  adicionado_por   uuid references auth.users(id) on delete set null,
  criado_em        timestamptz not null default now(),
  unique (org_id, cnpj)
);
create index if not exists xml_nfe_monitor_fila_idx on public.xml_nfe_monitor (proxima_consulta) where ativo;

create table if not exists public.xml_nfe_notas (
  org_id          uuid not null references public.organizacoes(id) on delete cascade,
  chave           text not null check (chave ~ '^[0-9]{44}$'),
  cnpj            text not null,                       -- a empresa monitorada (destinatária)
  numero          text not null default '',
  serie           text not null default '',
  emitente_cnpj   text not null default '',
  emitente_nome   text not null default '',
  emitente_uf     text not null default '',
  valor           numeric(15,2),
  emissao         timestamptz,
  situacao        text not null default 'autorizada' check (situacao in ('autorizada', 'cancelada', 'denegada')),
  completa        boolean not null default false,      -- o XML completo já veio (senão, só o resumo)
  manifestada_em  timestamptz,
  pdf             boolean not null default false,
  encontrada_em   timestamptz not null default now(),
  primary key (org_id, chave)
);
create index if not exists xml_nfe_notas_empresa_idx on public.xml_nfe_notas (org_id, cnpj, emissao desc);

-- Horário da consulta diária, escolhido pelo escritório (padrão 11h, horário de Brasília)
alter table public.organizacoes add column if not exists monitor_hora time not null default '11:00';

-- Próxima consulta: hoje no horário do escritório, se ainda der (e se já passou 1 hora da última consulta,
-- regra do Ambiente Nacional); senão, amanhã no mesmo horário
drop function if exists public.xml_nfe_proxima_11h();
create or replace function public.xml_nfe_proxima(p_org uuid, p_ultima timestamptz default null) returns timestamptz
language sql stable security definer set search_path = public as $$
  select case when hoje > greatest(now(), coalesce(p_ultima + interval '1 hour', now())) then hoje else hoje + interval '1 day' end
    from (select ((date_trunc('day', now() at time zone 'America/Fortaleza')
                   + coalesce((select o.monitor_hora from public.organizacoes o where o.id = p_org), time '11:00'))
                  at time zone 'America/Fortaleza') as hoje) h
$$;

-- O escritório trocou o horário: as próximas consultas passam para o horário novo
create or replace function public.xml_nfe_reagendar(p_org uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.xml_nfe_monitor set proxima_consulta = public.xml_nfe_proxima(org_id, ultima_consulta)
   where org_id = p_org and ativo and status <> 'processando';
  get diagnostics n = row_count;
  return n;
end $$;

-- Fila do robô: empresas cuja consulta venceu, com o certificado A1 dela (ou o da matriz, mesma raiz do CNPJ:
-- o Ambiente Nacional só entrega ao próprio interessado) e as notas que ainda esperam o XML completo
drop function if exists public.xml_nfe_pegar_monitor(text, integer);
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
         coalesce((select jsonb_agg(jsonb_build_object('chave', n.chave, 'manifestada', n.manifestada_em is not null))
                     from (select n.chave, n.manifestada_em from public.xml_nfe_notas n
                            where n.org_id = m.org_id and n.cnpj = m.cnpj and not n.completa and n.situacao = 'autorizada'
                              and n.encontrada_em > now() - interval '90 days'
                            order by n.encontrada_em desc limit 100) n), '[]'::jsonb)
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
drop function if exists public.xml_nfe_concluir(uuid, bigint, bigint, jsonb, text, text, integer);
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
      valor numeric, emissao timestamptz, situacao text, completa boolean, manifestada boolean, pdf boolean)
     where n.chave ~ '^[0-9]{44}$'
  ), gravadas as (
    insert into public.xml_nfe_notas as t (org_id, chave, cnpj, numero, serie, emitente_cnpj, emitente_nome, emitente_uf,
                                           valor, emissao, situacao, completa, manifestada_em, pdf)
    select m.org_id, d.chave, m.cnpj, coalesce(d.numero, ''), coalesce(d.serie, ''), coalesce(d.emitente_cnpj, ''),
           coalesce(d.emitente_nome, ''), coalesce(d.emitente_uf, ''), d.valor, d.emissao,
           case when d.situacao in ('autorizada', 'cancelada', 'denegada') then d.situacao else 'autorizada' end,
           coalesce(d.completa, false), case when d.manifestada then now() end, coalesce(d.pdf, false)
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
      pdf           = t.pdf or excluded.pdf
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

-- "Consultar agora" do portal: antecipa a consulta, respeitando 1 hora desde a última (regra do Ambiente Nacional)
create or replace function public.xml_nfe_consultar_agora(p_id uuid) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v timestamptz;
begin
  update public.xml_nfe_monitor
     set proxima_consulta = greatest(now(), coalesce(ultima_consulta + interval '1 hour', now())),
         status = case when status = 'processando' then status else 'fila' end
   where id = p_id and ativo and status <> 'processando'
     and (org_id = (select public.minha_org()) or public.sou_admin())
  returning proxima_consulta into v;
  return v;
end $$;

alter table public.xml_nfe_monitor enable row level security;
alter table public.xml_nfe_notas   enable row level security;
drop policy if exists xml_nfe_monitor_ler on public.xml_nfe_monitor;
create policy xml_nfe_monitor_ler on public.xml_nfe_monitor for select to authenticated
  using ((select public.sou_admin()) or org_id = (select public.minha_org()));
drop policy if exists xml_nfe_notas_ler on public.xml_nfe_notas;
create policy xml_nfe_notas_ler on public.xml_nfe_notas for select to authenticated
  using ((select public.sou_admin()) or org_id = (select public.minha_org()));

revoke all on function public.xml_nfe_pegar_monitor(text, integer) from public, anon, authenticated;
grant execute on function public.xml_nfe_pegar_monitor(text, integer) to service_role;
revoke all on function public.xml_nfe_concluir(uuid, bigint, bigint, jsonb, text, text, integer) from public, anon, authenticated;
grant execute on function public.xml_nfe_concluir(uuid, bigint, bigint, jsonb, text, text, integer) to service_role;
revoke all on function public.xml_nfe_reagendar(uuid) from public, anon, authenticated;
grant execute on function public.xml_nfe_reagendar(uuid) to service_role;
revoke all on function public.xml_nfe_proxima(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.xml_nfe_proxima(uuid, timestamptz) to service_role;
revoke all on function public.xml_nfe_consultar_agora(uuid) from public, anon;
grant execute on function public.xml_nfe_consultar_agora(uuid) to authenticated;

-- avisa a API (PostgREST) para reler as tabelas e funções novas
notify pgrst, 'reload schema';

-- Cadastro MEI por CNPJ, integração NFS-e e reprocessamento
-- Executar antes de publicar o portal e reiniciar o robô atualizado. Reaplicável, sem apagar histórico.
begin;

create table if not exists public.xml_mei_cadastros (
  org_id uuid not null references public.organizacoes(id) on delete cascade,
  cnpj text not null check (cnpj ~ '^[0-9]{14}$'),
  nome text not null,
  ativo boolean not null default true,
  inicio_atividade date not null,
  inicio_mei date not null,
  fim_mei date,
  atualizado_por uuid references auth.users(id) on delete set null,
  atualizado_em timestamptz not null default now(),
  primary key (org_id, cnpj),
  check (inicio_mei >= date_trunc('month', inicio_atividade)::date),
  check (fim_mei is null or fim_mei >= inicio_mei)
);
create table if not exists public.xml_mei_nfse_meses (
  org_id uuid not null references public.organizacoes(id) on delete cascade,
  cnpj text not null check (cnpj ~ '^[0-9]{14}$'),
  competencia date not null check (extract(day from competencia) = 1),
  valor numeric(14,2) not null check (valor >= 0),
  quantidade integer not null check (quantidade >= 0),
  tarefa_id uuid references public.xml_tarefas(id) on delete set null,
  iniciado_em timestamptz not null,
  consultado_em timestamptz not null default now(),
  primary key (org_id, cnpj, competencia)
);
alter table public.xml_mei_cadastros enable row level security;
alter table public.xml_mei_nfse_meses enable row level security;
revoke all on public.xml_mei_cadastros, public.xml_mei_nfse_meses from anon, authenticated;
grant select on public.xml_mei_cadastros, public.xml_mei_nfse_meses to authenticated;
grant all on public.xml_mei_cadastros, public.xml_mei_nfse_meses to service_role;
drop policy if exists xml_mei_cadastros_ler on public.xml_mei_cadastros;
create policy xml_mei_cadastros_ler on public.xml_mei_cadastros for select to authenticated
  using ((select public.sou_admin()) or org_id = (select public.minha_org()));
drop policy if exists xml_mei_nfse_meses_ler on public.xml_mei_nfse_meses;
create policy xml_mei_nfse_meses_ler on public.xml_mei_nfse_meses for select to authenticated
  using ((select public.sou_admin()) or org_id = (select public.minha_org()));

-- Mantém os ajustes antigos por IE e aceita CNPJ para prestadoras e carteiras unificadas.
alter table public.xml_mei_ajustes drop constraint if exists xml_mei_ajustes_ie_check;
alter table public.xml_mei_ajustes add constraint xml_mei_ajustes_ie_check check (ie ~ '^([0-9]{9}|[0-9]{14})$');

-- O vínculo empresa/escritório vem da tarefa. Um PATCH final grava tarefa e faturamento atomicamente.
create or replace function public.xml_mei_nfse_da_tarefa() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_cnpj text; v_comp date; v_mes jsonb; v_data date; v_inicio timestamptz;
begin
  if new.nfse_empresa_id is null or new.status not in ('concluido', 'sem_notas')
     or not (new.detalhes ? 'mei_nfse') then return new; end if;
  select e.cnpj, a.competencia into v_cnpj, v_comp
    from public.xml_nfse_empresas e join public.xml_agendamentos a on a.id = new.agendamento_id
    where e.id = new.nfse_empresa_id and e.org_id = new.org_id and a.org_id = new.org_id and a.origem = 'nfse';
  if v_cnpj is null then raise exception 'Vínculo NFS-e inválido'; end if;
  -- Dados são guardados mesmo antes da marcação manual; só entram na carteira quando o CNPJ é acompanhado.
  v_inicio := coalesce(new.iniciado_em, new.criado_em);
  for v_mes in select value from jsonb_array_elements(new.detalhes->'mei_nfse'->'meses') loop
    v_data := (v_mes->>'competencia')::date;
    if extract(day from v_data) <> 1 or extract(year from v_data) <> extract(year from v_comp) or v_data > v_comp then
      raise exception 'Competência NFS-e fora do agendamento';
    end if;
    insert into public.xml_mei_nfse_meses as m (org_id, cnpj, competencia, valor, quantidade, tarefa_id, iniciado_em, consultado_em)
    values (new.org_id, v_cnpj, v_data, (v_mes->>'valor')::numeric, (v_mes->>'quantidade')::integer,
            new.id, v_inicio, coalesce(new.concluido_em, now()))
    on conflict (org_id, cnpj, competencia) do update set
      valor = excluded.valor, quantidade = excluded.quantidade, tarefa_id = excluded.tarefa_id,
      iniciado_em = excluded.iniciado_em, consultado_em = excluded.consultado_em
    where excluded.iniciado_em >= m.iniciado_em; -- retorno atrasado não sobrescreve uma consulta mais nova
  end loop;
  return new;
end $$;
revoke all on function public.xml_mei_nfse_da_tarefa() from public, anon, authenticated;
drop trigger if exists xml_mei_nfse_finalizada on public.xml_tarefas;
create trigger xml_mei_nfse_finalizada after update of status, detalhes on public.xml_tarefas
  for each row execute function public.xml_mei_nfse_da_tarefa();

-- Cria agendamentos normais na fila existente. A transação evita cliques concorrentes duplicados.
create or replace function public.xml_mei_reprocessar(p_org uuid, p_documento text, p_competencia date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cnpj text; v_empresa record; v_nfse record; v_ag uuid; v_ids uuid[] := '{}'; v_ativo uuid; v_criados integer := 0;
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
  return jsonb_build_object('agendamentos', v_ids, 'existente', v_criados = 0);
end $$;
revoke all on function public.xml_mei_reprocessar(uuid, text, date) from public, anon;
grant execute on function public.xml_mei_reprocessar(uuid, text, date) to authenticated;

-- A definição atualizada da fila NFS-e é acrescentada abaixo.

create or replace function public.xml_nfse_pegar_lote(p_robo text, p_max integer default 10)
returns table (id uuid, cnpj text, nome text, codigo text, tipos text[], data_inicio date, data_fim date,
               certificado_cnpj text, pfx_cifrado text, senha_cifrada text, org_nome text, procurador boolean, mei boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_ids uuid[];
begin
  update public.xml_tarefas set status = 'pendente', iniciado_em = null, robo = null
   where xml_tarefas.status = 'processando' and xml_tarefas.nfse_empresa_id is not null
     and xml_tarefas.iniciado_em < now() - interval '90 minutes';

  -- empresa apagada depois do agendamento
  update public.xml_tarefas t set status = 'erro', concluido_em = now(),
         mensagem = 'Empresa removida do cadastro da NFS-e; envie a planilha de novo.'
   where t.status = 'pendente' and t.nfse_empresa_id is null
     and exists (select 1 from public.xml_agendamentos a where a.id = t.agendamento_id and a.origem = 'nfse');

  -- sem certificado para o CNPJ, nem para a matriz, nem do escritório (procuração)
  update public.xml_tarefas t set status = 'certificado', concluido_em = now(),
         mensagem = 'Sem certificado A1 que sirva para este CNPJ (nem o escolhido no agendamento, nem o da matriz, nem o do escritório com procuração). Cadastre em Certificados e agende de novo.'
   where t.status = 'pendente'
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
     order by a.executar_em, t.criado_em
     limit greatest(1, least(p_max, 50))
     for update of t skip locked) x;
  if v_ids is null then return; end if;

  update public.xml_tarefas set status = 'processando', iniciado_em = now(), robo = p_robo where xml_tarefas.id = any(v_ids);

  return query
  select t.id, e.cnpj, t.nome, t.codigo, t.tipos, a.data_inicio, a.data_fim, c.cnpj, c.pfx_cifrado, c.senha_cifrada, o.nome,
         c.procurador,
         -- MEI na planilha da SEFAZ (mesmo CNPJ, mesmo escritório): a NFS-e sai com o ano todo na primeira vez
         (exists (select 1 from public.xml_mei_cadastros m where m.org_id = e.org_id and m.cnpj = e.cnpj and m.ativo and a.competencia >= m.inicio_mei and (m.fim_mei is null or a.competencia <= m.fim_mei)) or (not exists (select 1 from public.xml_mei_cadastros m where m.org_id = e.org_id and m.cnpj = e.cnpj) and exists (select 1 from public.xml_empresas s where s.org_id = e.org_id and s.cnpj = e.cnpj and 'mei' = any(s.tipos))))
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
commit;
