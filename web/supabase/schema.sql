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

-- CNPJá pública: cache mínimo e limite global
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

-- Descoberta cadastral e decisões de acompanhamento MEI
begin;

-- A decisão do escritório existe mesmo sem datas suficientes para um cadastro fiscal.
create table if not exists public.xml_mei_acompanhamento (
  org_id uuid not null references public.organizacoes(id) on delete cascade,
  cnpj text not null check (cnpj ~ '^[0-9]{14}$'),
  estado text not null check (estado in ('ativo','pausado','ignorado')),
  origem text not null default 'manual', motivo text not null default '',
  versao bigint not null default 1,
  atualizado_por uuid references auth.users(id) on delete set null,
  atualizado_em timestamptz not null default now(),
  primary key(org_id,cnpj)
);
alter table public.xml_mei_cadastros add column if not exists origem text not null default 'manual';
create table if not exists public.xml_mei_historico (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizacoes(id) on delete cascade, cnpj text not null,
  antes jsonb, depois jsonb not null, cadastro jsonb,
  usuario_id uuid references auth.users(id) on delete set null, criado_em timestamptz not null default now()
);
create table if not exists public.xml_mei_sincronizacoes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizacoes(id) on delete cascade,
  origem text not null check (origem in ('manual','automatico','indicacao','periodico')),
  estado text not null default 'aberto' check (estado in ('aberto','concluido')),
  solicitado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now()
);
create unique index if not exists xml_mei_lote_aberto on public.xml_mei_sincronizacoes(org_id,origem) where estado='aberto';
create index if not exists xml_mei_lote_org on public.xml_mei_sincronizacoes(org_id,criado_em desc);
create table if not exists public.xml_mei_sincronizacao_itens (
  id uuid primary key default gen_random_uuid(),
  lote_id uuid not null references public.xml_mei_sincronizacoes(id) on delete cascade,
  org_id uuid not null references public.organizacoes(id) on delete cascade,
  cnpj text not null check (cnpj ~ '^[0-9]{14}$'), nome text not null,
  resultado text not null default 'pendente' check (resultado in ('pendente','processando','elegivel','incluido','acompanhado','nao_mei','revisar','dispensado','erro')),
  mensagem text not null default '', dados jsonb, consultado_em timestamptz,
  decisao_versao bigint not null default 0,
  reserva uuid, reserva_ate timestamptz, tentativas integer not null default 0,
  proxima_tentativa timestamptz not null default now(), criado_em timestamptz not null default now(),
  concluido_em timestamptz, unique(lote_id,cnpj)
);
create index if not exists xml_mei_item_fila on public.xml_mei_sincronizacao_itens(proxima_tentativa,criado_em) where resultado in ('pendente','processando');
create index if not exists xml_mei_item_org on public.xml_mei_sincronizacao_itens(org_id,cnpj,criado_em desc);
create table if not exists public.xml_mei_worker (
  id boolean primary key default true check(id), ultimo_sinal timestamptz not null default now()
);

-- Somente leitura por sessão; alterações passam pelas operações autorizadas do servidor.
alter table public.xml_mei_acompanhamento enable row level security;
alter table public.xml_mei_historico enable row level security;
alter table public.xml_mei_sincronizacoes enable row level security;
alter table public.xml_mei_sincronizacao_itens enable row level security;
alter table public.xml_mei_worker enable row level security;
revoke all on public.xml_mei_acompanhamento,public.xml_mei_historico,public.xml_mei_sincronizacoes,public.xml_mei_sincronizacao_itens,public.xml_mei_worker from public,anon,authenticated;
grant select on public.xml_mei_acompanhamento,public.xml_mei_historico,public.xml_mei_sincronizacoes,public.xml_mei_sincronizacao_itens,public.xml_mei_worker to authenticated;
grant all on public.xml_mei_acompanhamento,public.xml_mei_historico,public.xml_mei_sincronizacoes,public.xml_mei_sincronizacao_itens,public.xml_mei_worker to service_role;
grant usage,select on sequence public.xml_mei_historico_id_seq to service_role;
-- Dependências das RPCs invoker: não depender de grants padrão da instalação.
grant select on public.organizacoes,public.perfis,public.xml_empresas,public.xml_nfse_empresas to service_role;
grant select,insert,update on public.xml_mei_cadastros to service_role;
drop policy if exists mei_acomp_ler on public.xml_mei_acompanhamento;
create policy mei_acomp_ler on public.xml_mei_acompanhamento for select to authenticated using ((select public.sou_admin()) or org_id=(select public.minha_org()));
drop policy if exists mei_hist_ler on public.xml_mei_historico;
create policy mei_hist_ler on public.xml_mei_historico for select to authenticated using ((select public.sou_admin()) or org_id=(select public.minha_org()));
drop policy if exists mei_lote_ler on public.xml_mei_sincronizacoes;
create policy mei_lote_ler on public.xml_mei_sincronizacoes for select to authenticated using ((select public.sou_admin()) or org_id=(select public.minha_org()));
drop policy if exists mei_item_ler on public.xml_mei_sincronizacao_itens;
create policy mei_item_ler on public.xml_mei_sincronizacao_itens for select to authenticated using ((select public.sou_admin()) or org_id=(select public.minha_org()));
drop policy if exists mei_worker_ler on public.xml_mei_worker;
create policy mei_worker_ler on public.xml_mei_worker for select to authenticated using (true);

-- Migração conservadora: não consulta API nem inclui toda a carteira antiga.
insert into public.xml_mei_acompanhamento(org_id,cnpj,estado,origem,atualizado_por)
  select org_id,cnpj,case when ativo then 'ativo' else 'pausado' end,'legado',atualizado_por from public.xml_mei_cadastros
  on conflict do nothing;

create or replace function public.xml_mei_nome(p_org uuid,p_cnpj text) returns text
language sql stable security invoker set search_path=public as $$
  select nome from (select nome,0 ordem from public.xml_nfse_empresas where org_id=p_org and cnpj=p_cnpj
    union all select nome,1 from public.xml_empresas where org_id=p_org and cnpj=p_cnpj) e order by ordem limit 1
$$;
create or replace function public.xml_mei_autorizar(p_org uuid,p_usuario uuid) returns void
language plpgsql security invoker set search_path=public as $$
begin
  if not exists (select 1 from public.perfis p where p.id=p_usuario and p.ativo and
    (p.papel='admin' or (p.org_id=p_org and p.papel='gestor')))
    or not exists(select 1 from public.organizacoes where id=p_org and ativo) then
    raise exception 'Somente gestor ou administrador do escritório pode alterar o acompanhamento MEI';
  end if;
end $$;
create or replace function public.xml_mei_pode_consultar(p_org uuid,p_documento text,p_competencia date default null) returns boolean
language sql stable security invoker set search_path=public as $$
  with doc as (select case when length(p_documento)=14 then p_documento else
    (select cnpj from public.xml_empresas where org_id=p_org and ie=p_documento limit 1) end cnpj)
  select not exists(select 1 from public.xml_mei_acompanhamento a,doc d where a.org_id=p_org and a.cnpj=d.cnpj and a.estado<>'ativo')
    and not exists(select 1 from public.xml_mei_cadastros c,doc d where c.org_id=p_org and c.cnpj=d.cnpj
      and (not c.ativo or (p_competencia is not null and (p_competencia<c.inicio_mei or (c.fim_mei is not null and p_competencia>c.fim_mei)))))
$$;

create or replace function public.xml_mei_decidir(p_org uuid,p_cnpj text,p_usuario uuid,p_acao text,
  p_abertura date default null,p_inicio date default null,p_fim date default null,p_motivo text default '',p_versao bigint default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_nome text; v_antes public.xml_mei_acompanhamento; v_estado text; v_cadastro public.xml_mei_cadastros;
begin
  perform public.xml_mei_autorizar(p_org,p_usuario);
  v_nome:=public.xml_mei_nome(p_org,p_cnpj);
  if v_nome is null or p_cnpj !~ '^[0-9]{14}$' then raise exception 'Empresa não encontrada neste escritório'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mei:'||p_org::text||':'||p_cnpj,0));
  select * into v_antes from public.xml_mei_acompanhamento where org_id=p_org and cnpj=p_cnpj;
  if p_versao is not null and p_versao<>coalesce(v_antes.versao,0) then raise exception 'O acompanhamento mudou. Atualize a página antes de confirmar'; end if;
  if p_acao not in ('salvar','salvar_pausado','pausar','ignorar','reativar','encerrar') then raise exception 'Ação inválida'; end if;
  select * into v_cadastro from public.xml_mei_cadastros where org_id=p_org and cnpj=p_cnpj;
  if p_acao in ('salvar','salvar_pausado') then
    if p_abertura is null or p_inicio is null or p_abertura>(now() at time zone 'America/Sao_Paulo')::date
      or p_inicio<date_trunc('month',p_abertura)::date or p_inicio>date_trunc('month',now() at time zone 'America/Sao_Paulo')::date
      or extract(day from p_inicio)<>1 or (p_fim is not null and (p_fim<p_inicio or extract(day from p_fim)<>1)) then raise exception 'Confira a abertura e o período MEI'; end if;
    insert into public.xml_mei_cadastros(org_id,cnpj,nome,ativo,inicio_atividade,inicio_mei,fim_mei,atualizado_por,origem)
      values(p_org,p_cnpj,v_nome,p_acao='salvar',p_abertura,p_inicio,p_fim,p_usuario,'manual')
      on conflict(org_id,cnpj) do update set nome=excluded.nome,ativo=excluded.ativo,inicio_atividade=excluded.inicio_atividade,
        inicio_mei=excluded.inicio_mei,fim_mei=excluded.fim_mei,atualizado_por=p_usuario,atualizado_em=now(),origem='manual';
  elsif p_acao='reativar' then
    if v_cadastro.cnpj is null then raise exception 'Confira as datas no cadastro antes de reativar'; end if;
    update public.xml_mei_cadastros set ativo=true,atualizado_por=p_usuario,atualizado_em=now() where org_id=p_org and cnpj=p_cnpj;
  elsif p_acao='encerrar' then
    if v_cadastro.cnpj is null or p_fim is null or p_fim<v_cadastro.inicio_mei or extract(day from p_fim)<>1 then raise exception 'Informe o último mês MEI válido'; end if;
    update public.xml_mei_cadastros set ativo=true,fim_mei=p_fim,atualizado_por=p_usuario,atualizado_em=now(),origem='manual' where org_id=p_org and cnpj=p_cnpj;
  else
    update public.xml_mei_cadastros set ativo=false,atualizado_por=p_usuario,atualizado_em=now() where org_id=p_org and cnpj=p_cnpj;
  end if;
  v_estado:=case p_acao when 'pausar' then 'pausado' when 'salvar_pausado' then 'pausado' when 'ignorar' then 'ignorado' else 'ativo' end;
  insert into public.xml_mei_acompanhamento(org_id,cnpj,estado,origem,motivo,versao,atualizado_por)
    values(p_org,p_cnpj,v_estado,'manual',left(coalesce(p_motivo,''),240),coalesce(v_antes.versao,0)+1,p_usuario)
    on conflict(org_id,cnpj) do update set estado=excluded.estado,origem=excluded.origem,motivo=excluded.motivo,
      versao=excluded.versao,atualizado_por=p_usuario,atualizado_em=now();
  insert into public.xml_mei_historico(org_id,cnpj,antes,depois,cadastro,usuario_id)
    select p_org,p_cnpj,to_jsonb(v_antes),to_jsonb(a),to_jsonb(c),p_usuario from public.xml_mei_acompanhamento a
      left join public.xml_mei_cadastros c using(org_id,cnpj) where a.org_id=p_org and a.cnpj=p_cnpj;
  return jsonb_build_object('estado',v_estado);
end $$;

create or replace function public.xml_mei_enfileirar(p_org uuid,p_cnpj text,p_origem text,p_usuario uuid default null) returns uuid
language plpgsql security invoker set search_path=public as $$
declare v_lote uuid; v_nome text; v_doc text;
begin
  if p_origem not in ('manual','automatico','indicacao','periodico') then raise exception 'Origem inválida'; end if;
  if p_origem='manual' then perform public.xml_mei_autorizar(p_org,p_usuario); end if;
  if not exists(select 1 from public.organizacoes where id=p_org and ativo) then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended('mei-fila:'||p_org::text||':'||p_origem,0));
  select id into v_lote from public.xml_mei_sincronizacoes where org_id=p_org and origem=p_origem and estado='aberto';
  if v_lote is null then
    insert into public.xml_mei_sincronizacoes(org_id,origem,solicitado_por) values(p_org,p_origem,p_usuario) returning id into v_lote;
  end if;
  for v_doc,v_nome in select distinct on(cnpj) cnpj,nome from (
      select cnpj,nome from public.xml_nfse_empresas where org_id=p_org
      union all select cnpj,nome from public.xml_empresas where org_id=p_org) e
    where cnpj ~ '^[0-9]{14}$' and (xml_mei_enfileirar.p_cnpj is null or cnpj=xml_mei_enfileirar.p_cnpj) order by cnpj,nome
  loop
    insert into public.xml_mei_sincronizacao_itens(lote_id,org_id,cnpj,nome,decisao_versao,resultado,mensagem)
      select v_lote,p_org,v_doc,v_nome,coalesce(a.versao,0),
        case when coalesce(a.estado,'ativo')<>'ativo' or coalesce(c.ativo,true)=false then 'dispensado' else 'pendente' end,
        case when coalesce(a.estado,'ativo')<>'ativo' or coalesce(c.ativo,true)=false then 'Pausa ou exclusão do escritório respeitada' else '' end
      from (select 1) x left join public.xml_mei_acompanhamento a on a.org_id=p_org and a.cnpj=v_doc
        left join public.xml_mei_cadastros c on c.org_id=p_org and c.cnpj=v_doc
      on conflict(lote_id,cnpj) do nothing;
  end loop;
  update public.xml_mei_sincronizacoes s set estado='concluido' where id=v_lote and not exists(
    select 1 from public.xml_mei_sincronizacao_itens i where i.lote_id=s.id and i.resultado in ('pendente','processando'));
  return v_lote;
end $$;

create or replace function public.xml_mei_pegar_verificacao() returns jsonb
language plpgsql security invoker set search_path=public as $$
declare v public.xml_mei_sincronizacao_itens; v_token uuid:=gen_random_uuid();
begin
  insert into public.xml_mei_worker(id) values(true) on conflict(id) do update set ultimo_sinal=now();
  select i.* into v from public.xml_mei_sincronizacao_itens i join public.organizacoes o on o.id=i.org_id and o.ativo
    where (i.resultado='pendente' and i.proxima_tentativa<=now()) or (i.resultado='processando' and i.reserva_ate<now())
    order by i.proxima_tentativa,i.criado_em,i.id for update of i skip locked limit 1;
  if v.id is null then return null; end if;
  update public.xml_mei_sincronizacao_itens set resultado='processando',reserva=v_token,reserva_ate=now()+interval '45 seconds',
    tentativas=tentativas+1 where id=v.id;
  return jsonb_build_object('id',v.id,'cnpj',v.cnpj,'token',v_token,'tentativas',v.tentativas+1);
end $$;

-- Aplica somente evidência já verificada pelo backend, sob a mesma trava das decisões manuais.
create or replace function public.xml_mei_aplicar_item(p_item uuid,p_usuario uuid default null) returns text
language plpgsql security invoker set search_path=public as $$
declare v public.xml_mei_sincronizacao_itens; a public.xml_mei_acompanhamento; c public.xml_mei_cadastros; v_nome text;
begin
  select * into v from public.xml_mei_sincronizacao_itens where id=p_item for update;
  if v.id is null then raise exception 'Verificação não encontrada'; end if;
  if p_usuario is not null then perform public.xml_mei_autorizar(v.org_id,p_usuario); end if;
  if v.resultado<>'elegivel' then return v.resultado; end if;
  perform pg_advisory_xact_lock(hashtextextended('mei:'||v.org_id::text||':'||v.cnpj,0));
  select * into a from public.xml_mei_acompanhamento where org_id=v.org_id and cnpj=v.cnpj;
  select * into c from public.xml_mei_cadastros where org_id=v.org_id and cnpj=v.cnpj;
  v_nome:=public.xml_mei_nome(v.org_id,v.cnpj);
  if v_nome is null or coalesce(a.estado,'ativo')<>'ativo' or coalesce(c.ativo,true)=false then
    update public.xml_mei_sincronizacao_itens set resultado='dispensado',mensagem='Empresa retirada, pausada ou ignorada' where id=v.id; return 'dispensado';
  end if;
  if coalesce(a.versao,0)<>v.decisao_versao or v.consultado_em is null or v.consultado_em<now()-interval '7 days' then
    update public.xml_mei_sincronizacao_itens set resultado='revisar',mensagem='A decisão ou a validade da consulta mudou. Confira novamente' where id=v.id; return 'revisar';
  end if;
  if c.cnpj is not null then
    update public.xml_mei_sincronizacao_itens set resultado='acompanhado' where id=v.id; return 'acompanhado';
  end if;
  insert into public.xml_mei_cadastros(org_id,cnpj,nome,ativo,inicio_atividade,inicio_mei,origem,atualizado_por)
    values(v.org_id,v.cnpj,v_nome,true,(v.dados->>'abertura')::date,date_trunc('month',(v.dados->>'inicioMei')::date)::date,
      case when p_usuario is null then 'automatico' else 'lote' end,p_usuario);
  insert into public.xml_mei_acompanhamento(org_id,cnpj,estado,origem,versao,atualizado_por)
    values(v.org_id,v.cnpj,'ativo',case when p_usuario is null then 'automatico' else 'lote' end,coalesce(a.versao,0)+1,p_usuario)
    on conflict(org_id,cnpj) do update set versao=excluded.versao,estado='ativo',origem=excluded.origem,atualizado_em=now(),atualizado_por=p_usuario;
  insert into public.xml_mei_historico(org_id,cnpj,antes,depois,cadastro,usuario_id)
    select v.org_id,v.cnpj,to_jsonb(a),to_jsonb(n),to_jsonb(ca),p_usuario from public.xml_mei_acompanhamento n
      join public.xml_mei_cadastros ca using(org_id,cnpj) where n.org_id=v.org_id and n.cnpj=v.cnpj;
  update public.xml_mei_sincronizacao_itens set resultado='incluido',mensagem='Incluída no monitoramento; dados fiscais ainda dependem das consultas' where id=v.id;
  return 'incluido';
end $$;

create or replace function public.xml_mei_finalizar_verificacao(p_item uuid,p_token uuid,p_resultado text,
  p_dados jsonb default null,p_consultado_em timestamptz default null,p_mensagem text default '',p_espera integer default 0)
returns text language plpgsql security invoker set search_path=public as $$
declare v public.xml_mei_sincronizacao_itens; a public.xml_mei_acompanhamento; c public.xml_mei_cadastros; v_origem text; v_r text; v_msg text:=left(p_mensagem,500);
begin
  select * into v from public.xml_mei_sincronizacao_itens where id=p_item for update;
  if v.id is null or v.reserva is distinct from p_token or v.reserva_ate<now() or v.resultado<>'processando' then return 'expirado'; end if;
  if p_dados is not null and (p_dados->>'cnpj') is distinct from v.cnpj then raise exception 'CNPJ da resposta não corresponde ao item'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mei:'||v.org_id::text||':'||v.cnpj,0));
  select * into a from public.xml_mei_acompanhamento where org_id=v.org_id and cnpj=v.cnpj;
  select * into c from public.xml_mei_cadastros where org_id=v.org_id and cnpj=v.cnpj;
  v_r:=p_resultado;
  if coalesce(a.estado,'ativo')<>'ativo' or coalesce(c.ativo,true)=false or public.xml_mei_nome(v.org_id,v.cnpj) is null then v_r:='dispensado'; v_msg:='Empresa retirada, pausada ou ignorada. Decisão do escritório preservada';
  elsif coalesce(a.versao,0)<>v.decisao_versao then v_r:='revisar'; v_msg:='O acompanhamento mudou durante a consulta. Confira a decisão mais recente';
  elsif p_resultado in ('aguardar','erro') then
    if p_resultado='aguardar' or v.tentativas<5 then
      update public.xml_mei_sincronizacao_itens set resultado='pendente',reserva=null,reserva_ate=null,
        tentativas=case when p_resultado='aguardar' then greatest(0,tentativas-1) else tentativas end,
        proxima_tentativa=now()+make_interval(secs=>greatest(13,least(3600,case when p_espera>0 then p_espera else 30*(2^least(v.tentativas,6))::integer end))),
        mensagem=left(p_mensagem,500),dados=coalesce(p_dados,dados),consultado_em=coalesce(p_consultado_em,consultado_em) where id=v.id;
      return 'pendente';
    end if;
  elsif p_resultado='elegivel' then
    if p_dados->>'mei' is distinct from 'true' or p_dados->>'abertura' is null or p_dados->>'inicioMei' is null
      or (p_dados->>'abertura')::date>(now() at time zone 'America/Sao_Paulo')::date
      or (p_dados->>'inicioMei')::date>(now() at time zone 'America/Sao_Paulo')::date
      or date_trunc('month',(p_dados->>'inicioMei')::date)<date_trunc('month',(p_dados->>'abertura')::date)
      or p_consultado_em is null or p_consultado_em<now()-interval '7 days' then v_r:='revisar';
    elsif c.cnpj is not null then
      v_r:=case when c.inicio_atividade=(p_dados->>'abertura')::date and c.inicio_mei=date_trunc('month',(p_dados->>'inicioMei')::date)::date and c.fim_mei is null then 'acompanhado' else 'revisar' end;
    end if;
  elsif p_resultado='nao_mei' and c.cnpj is not null then v_r:='revisar';
  end if;
  if v_r='revisar' and v_msg=left(p_mensagem,500) then
    v_msg:='Confira enquadramento e datas: a informação recebida está incompleta, vencida ou diverge do cadastro confirmado. O cadastro foi preservado';
  elsif v_r='elegivel' and a.cnpj is null and exists(select 1 from public.xml_mei_meses m where m.org_id=v.org_id and
      (m.ie=v.cnpj or m.ie in(select e.ie from public.xml_empresas e where e.org_id=v.org_id and e.cnpj=v.cnpj))) then
    v_msg:=v_msg||' Há histórico MEI anterior sem decisão explícita. Confirme se o cliente quer acompanhamento; a ausência de marcação antiga não informa o motivo.';
  end if;
  update public.xml_mei_sincronizacao_itens set resultado=v_r,dados=p_dados,consultado_em=p_consultado_em,
    mensagem=left(v_msg,500),concluido_em=now(),reserva=null,reserva_ate=null where id=v.id;
  select origem into v_origem from public.xml_mei_sincronizacoes where id=v.lote_id;
  if v_r='elegivel' and v_origem='automatico' then v_r:=public.xml_mei_aplicar_item(v.id); end if;
  update public.xml_mei_sincronizacoes s set estado='concluido' where id=v.lote_id and not exists(
    select 1 from public.xml_mei_sincronizacao_itens i where i.lote_id=s.id and i.resultado in ('pendente','processando'));
  return v_r;
end $$;

create or replace function public.xml_mei_confirmar_lote(p_lote uuid,p_cnpjs text[],p_usuario uuid) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare v_org uuid; v record; v_r text; v_res jsonb:='{}';
begin
  select org_id into v_org from public.xml_mei_sincronizacoes where id=p_lote;
  perform public.xml_mei_autorizar(v_org,p_usuario);
  for v in select id from public.xml_mei_sincronizacao_itens where lote_id=p_lote and cnpj=any(p_cnpjs) and resultado='elegivel' order by cnpj loop
    v_r:=public.xml_mei_aplicar_item(v.id,p_usuario);
    v_res:=jsonb_set(v_res,array[v_r],to_jsonb(coalesce((v_res->>v_r)::integer,0)+1));
  end loop;
  return v_res;
end $$;

-- Novos CNPJs, não toda reimportação: a decisão persistente tem precedência.
create or replace function public.xml_mei_empresa_nova() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
  if new.cnpj !~ '^[0-9]{14}$' or (tg_op='UPDATE' and old.cnpj is not distinct from new.cnpj) then return new; end if;
  if (select count(*) from (select cnpj from public.xml_empresas where org_id=new.org_id and cnpj=new.cnpj
    union all select cnpj from public.xml_nfse_empresas where org_id=new.org_id and cnpj=new.cnpj) e)>1 then return new; end if;
  if not exists(select 1 from public.xml_mei_acompanhamento where org_id=new.org_id and cnpj=new.cnpj) then
    perform public.xml_mei_enfileirar(new.org_id,new.cnpj,'automatico');
  end if;
  return new;
end $$;
drop trigger if exists xml_mei_empresa_nova on public.xml_empresas;
create trigger xml_mei_empresa_nova after insert or update of cnpj on public.xml_empresas for each row execute function public.xml_mei_empresa_nova();
drop trigger if exists xml_mei_empresa_nova on public.xml_nfse_empresas;
create trigger xml_mei_empresa_nova after insert or update of cnpj on public.xml_nfse_empresas for each row execute function public.xml_mei_empresa_nova();

create or replace function public.xml_mei_indicacao_xml() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
  if new.status in ('concluido','sem_notas') and new.detalhes @> '{"mei_nfse":{"detectado_no_xml":true}}'::jsonb
    and not coalesce(old.detalhes @> '{"mei_nfse":{"detectado_no_xml":true}}'::jsonb,false)
    and new.ie ~ '^[0-9]{14}$' then perform public.xml_mei_enfileirar(new.org_id,new.ie,'indicacao'); end if;
  return new;
end $$;
drop trigger if exists xml_mei_indicacao_xml on public.xml_tarefas;
create trigger xml_mei_indicacao_xml after update of detalhes,status on public.xml_tarefas for each row execute function public.xml_mei_indicacao_xml();

-- Bloqueia apenas o serviço MEI em novas tarefas; outros documentos continuam funcionando.
create or replace function public.xml_mei_respeitar_decisao() returns trigger
language plpgsql security invoker set search_path=public as $$
declare v_comp date;
begin
  select competencia into v_comp from public.xml_agendamentos where id=new.agendamento_id and org_id=new.org_id;
  if 'mei'=any(new.tipos) and not public.xml_mei_pode_consultar(new.org_id,new.ie,v_comp) then
    new.tipos:=array_remove(new.tipos,'mei');
    if cardinality(new.tipos)=0 then new.status:='cancelado'; new.mensagem:='Acompanhamento MEI pausado, ignorado ou fora do período'; end if;
  end if;
  return new;
end $$;
drop trigger if exists xml_mei_respeitar_decisao on public.xml_tarefas;
create trigger xml_mei_respeitar_decisao before insert on public.xml_tarefas for each row execute function public.xml_mei_respeitar_decisao();

create or replace function public.xml_mei_revisar_ativos() returns integer
language plpgsql security invoker set search_path=public as $$
declare a record; n integer:=0;
begin
  for a in select x.org_id,x.cnpj from public.xml_mei_acompanhamento x join public.organizacoes o on o.id=x.org_id and o.ativo
    where x.estado='ativo' and not exists(select 1 from public.xml_mei_sincronizacao_itens i where i.org_id=x.org_id and i.cnpj=x.cnpj and i.criado_em>now()-interval '7 days')
    order by x.atualizado_em limit 20 loop
    perform public.xml_mei_enfileirar(a.org_id,a.cnpj,'periodico'); n:=n+1;
  end loop;
  return n;
end $$;
revoke all on function public.xml_mei_revisar_ativos() from public,anon,authenticated;
grant execute on function public.xml_mei_revisar_ativos() to service_role;

create or replace function public.xml_mei_faturamento_lote(p_org uuid,p_cnpjs text[],p_inicio date,p_fim date) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare c text; r jsonb; resultados jsonb:='[]';
begin
  if not coalesce(public.sou_admin() or (p_org=public.minha_org() and public.meu_papel()='gestor'),false) then raise exception 'Sem permissão para este escritório'; end if;
  if cardinality(p_cnpjs)>2000 then raise exception 'Selecione até 2000 empresas por atualização'; end if;
  for c in select distinct unnest(p_cnpjs) loop
    begin
      if public.xml_mei_nome(p_org,c) is null then raise exception 'Empresa não encontrada'; end if;
      r:=public.xml_mei_reprocessar_periodo(p_org,c,p_inicio,p_fim);
      resultados:=resultados||jsonb_build_array(jsonb_build_object('cnpj',c,'consultas',r->'consultas','existente',r->'existente'));
    exception when others then
      resultados:=resultados||jsonb_build_array(jsonb_build_object('cnpj',c,'erro',sqlerrm));
    end;
  end loop;
  return resultados;
end $$;
revoke all on function public.xml_mei_faturamento_lote(uuid,text[],date,date) from public,anon;
grant execute on function public.xml_mei_faturamento_lote(uuid,text[],date,date) to authenticated;
-- A função usa apenas dados visíveis à sessão e não grava diretamente nas tabelas.
grant execute on function public.xml_mei_nome(uuid,text) to authenticated;

revoke all on function public.xml_mei_nome(uuid,text) from public,anon;

-- Nenhuma RPC administrativa nova fica disponível ao navegador.
revoke all on function public.xml_mei_autorizar(uuid,uuid),public.xml_mei_decidir(uuid,text,uuid,text,date,date,date,text,bigint),
 public.xml_mei_enfileirar(uuid,text,text,uuid),public.xml_mei_pegar_verificacao(),public.xml_mei_aplicar_item(uuid,uuid),
 public.xml_mei_finalizar_verificacao(uuid,uuid,text,jsonb,timestamptz,text,integer),public.xml_mei_confirmar_lote(uuid,text[],uuid),
 public.xml_mei_empresa_nova(),public.xml_mei_indicacao_xml(),public.xml_mei_respeitar_decisao() from public,anon,authenticated;
grant execute on function public.xml_mei_nome(uuid,text),public.xml_mei_autorizar(uuid,uuid),public.xml_mei_decidir(uuid,text,uuid,text,date,date,date,text,bigint),
 public.xml_mei_enfileirar(uuid,text,text,uuid),public.xml_mei_pegar_verificacao(),public.xml_mei_aplicar_item(uuid,uuid),
 public.xml_mei_finalizar_verificacao(uuid,uuid,text,jsonb,timestamptz,text,integer),public.xml_mei_confirmar_lote(uuid,text[],uuid),
 public.xml_mei_empresa_nova(),public.xml_mei_indicacao_xml(),public.xml_mei_respeitar_decisao() to service_role;
revoke all on function public.xml_mei_pode_consultar(uuid,text,date) from public,anon;
grant execute on function public.xml_mei_pode_consultar(uuid,text,date) to authenticated,service_role;

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

-- A decisão também vale para tarefas que já estavam aguardando na fila.
create or replace function public.xml_mei_limpar_fila() returns void
language sql security invoker set search_path=public as $$
  update public.xml_tarefas t set tipos=array_remove(t.tipos,'mei'),
    status=case when cardinality(t.tipos)=1 then 'cancelado' else t.status end,
    mensagem=case when cardinality(t.tipos)=1 then 'Acompanhamento MEI pausado, ignorado ou fora do período' else t.mensagem end
  from public.xml_agendamentos a where t.agendamento_id=a.id and t.org_id=a.org_id and t.status='pendente'
    and 'mei'=any(t.tipos) and not public.xml_mei_pode_consultar(t.org_id,t.ie,a.competencia)
$$;
revoke all on function public.xml_mei_limpar_fila() from public,anon,authenticated;
grant execute on function public.xml_mei_limpar_fila() to service_role;

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

  perform public.xml_mei_limpar_fila();

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

drop function if exists public.xml_nfse_pegar_lote(text,integer);
create or replace function public.xml_nfse_pegar_lote(p_robo text, p_max integer default 10)
returns table (id uuid, cnpj text, nome text, codigo text, tipos text[], data_inicio date, data_fim date,
               certificado_cnpj text, pfx_cifrado text, senha_cifrada text, org_nome text, procurador boolean, mei boolean, mei_bloqueado boolean)
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
revoke all on function public.xml_nfse_pegar_lote(text,integer) from public,anon,authenticated;
grant execute on function public.xml_nfse_pegar_lote(text,integer) to service_role;

commit;
