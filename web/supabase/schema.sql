-- =====================================================================================
-- LotiVisse XML — estrutura do banco (Supabase / PostgreSQL)
--
-- Como usar: no painel do Supabase, abra "SQL Editor", cole TODO este arquivo e clique em "Run".
-- Pode rodar de novo sem perder dados.
--
-- Funciona em um projeto novo OU no mesmo projeto do portal de CND: as tabelas "organizacoes" e
-- "perfis" (login e clientes) são as mesmas e só são criadas se ainda não existirem. As tabelas
-- deste módulo começam com "xml_".
--
-- Senhas do ATF: chegam aqui já cifradas pelo portal com a chave pública do robô
-- (coluna senha_cifrada, formato "v1:..."). Só o robô, no seu PC, tem a chave que abre.
-- =====================================================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------------- login e clientes
-- (mesma estrutura do portal de CND; se ele já roda neste projeto, nada muda)
create table if not exists public.organizacoes (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null,
  documento      text not null default '',
  plano          text not null default 'piloto',
  limite_mensal  integer check (limite_mensal is null or limite_mensal >= 0),
  assinatura_ate date,
  ativo          boolean not null default true,
  observacoes    text not null default '',
  criado_em      timestamptz not null default now()
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

create or replace function public.minha_org() returns uuid
language sql stable security definer set search_path = public as $$
  select org_id from public.perfis where id = auth.uid() and ativo
$$;

create or replace function public.meu_papel() returns text
language sql stable security definer set search_path = public as $$
  select papel from public.perfis where id = auth.uid() and ativo
$$;

create or replace function public.sou_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.meu_papel() = 'admin', false)
$$;

-- ------------------------------------------------------------------------- tabelas do XML
-- Empresas de cada cliente, com o acesso ao ATF (senha sempre cifrada)
create table if not exists public.xml_empresas (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizacoes(id) on delete cascade,
  cnpj           text not null check (cnpj ~ '^[0-9]{14}$'),
  apelido        text not null check (length(apelido) between 1 and 60),
  login_atf      text not null default '',                 -- vazio = o próprio CNPJ
  senha_cifrada  text not null check (senha_cifrada like 'v1:%'),
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  unique (org_id, cnpj)
);

-- Cada planilha enviada na área de agendamento
create table if not exists public.xml_agendamentos (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizacoes(id) on delete cascade,
  criado_por    uuid references auth.users(id) on delete set null,
  nome_arquivo  text not null default '',
  data_inicio   date not null,
  data_fim      date not null,
  tipos         text[] not null,
  executar_em   timestamptz not null default now(),       -- quando o robô pode começar
  total         integer not null default 0,
  criado_em     timestamptz not null default now(),
  check (data_fim >= data_inicio),
  check (tipos <@ array['nfe_emitidas', 'nfe_recebidas', 'nfce_emitidas'] and cardinality(tipos) > 0)
);

-- Uma tarefa por empresa do agendamento (o robô faz todos os tipos numa sessão do ATF)
create table if not exists public.xml_tarefas (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizacoes(id) on delete cascade,
  agendamento_id  uuid not null references public.xml_agendamentos(id) on delete cascade,
  empresa_id      uuid references public.xml_empresas(id) on delete set null,
  cnpj            text not null check (cnpj ~ '^[0-9]{14}$'),
  apelido         text not null default '',
  status          text not null default 'pendente' check (status in (
                    'pendente', 'processando', 'concluido', 'sem_notas', 'senha_invalida',
                    'erro', 'fora_do_ar', 'cancelado')),
  mensagem        text not null default '',
  qtd_xml         integer not null default 0,
  detalhes        jsonb not null default '{}'::jsonb,       -- por tipo: salvos, repetidos, conferir
  pasta           text not null default '',                  -- nome da pasta no PC do robô
  robo            text,
  criado_em       timestamptz not null default now(),
  iniciado_em     timestamptz,
  concluido_em    timestamptz
);
create index if not exists xml_tarefas_fila_idx on public.xml_tarefas (criado_em) where status = 'pendente';
create index if not exists xml_tarefas_agendamento_idx on public.xml_tarefas (agendamento_id);
create index if not exists xml_agendamentos_org_idx on public.xml_agendamentos (org_id, criado_em desc);

-- Robôs (o programa que roda no PC e baixa os XML)
create table if not exists public.xml_robos (
  id           text primary key,
  ultimo_sinal timestamptz not null default now(),
  versao       text not null default '',
  info         jsonb not null default '{}'::jsonb
);

-- ------------------------------------------------------------------------- fila do robô
-- Pega a próxima tarefa liberada (executar_em já chegou), com o acesso ao ATF da empresa.
-- Vários robôs podem rodar juntos: "for update skip locked" evita que dois peguem a mesma.
drop function if exists public.xml_pegar_tarefa(text);
create or replace function public.xml_pegar_tarefa(p_robo text)
returns table (id uuid, org_id uuid, cnpj text, apelido text, tipos text[], data_inicio date, data_fim date,
               login_atf text, senha_cifrada text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  t_id uuid;
begin
  -- tarefa "presa" (o robô caiu no meio) volta para a fila depois de 60 min
  update public.xml_tarefas set status = 'pendente', iniciado_em = null, robo = null
   where xml_tarefas.status = 'processando' and xml_tarefas.iniciado_em < now() - interval '60 minutes';

  select t.id into t_id
    from public.xml_tarefas t
    join public.xml_agendamentos a on a.id = t.agendamento_id
   where t.status = 'pendente' and a.executar_em <= now()
   order by a.executar_em, t.criado_em
   limit 1
   for update of t skip locked;
  if t_id is null then return; end if;

  update public.xml_tarefas set status = 'processando', iniciado_em = now(), robo = p_robo where xml_tarefas.id = t_id;

  -- empresa apagada depois do agendamento: encerra a tarefa com aviso
  if not exists (select 1 from public.xml_tarefas t join public.xml_empresas e on e.id = t.empresa_id where t.id = t_id) then
    update public.xml_tarefas set status = 'erro', concluido_em = now(),
           mensagem = 'Empresa removida do cadastro; envie a planilha de novo.' where xml_tarefas.id = t_id;
    return;
  end if;

  return query
  select t.id, t.org_id, t.cnpj, t.apelido, a.tipos, a.data_inicio, a.data_fim, e.login_atf, e.senha_cifrada
    from public.xml_tarefas t
    join public.xml_agendamentos a on a.id = t.agendamento_id
    join public.xml_empresas e on e.id = t.empresa_id
   where t.id = t_id;
end $$;

-- Cancelar as tarefas de um agendamento que ainda não começaram
create or replace function public.xml_cancelar_agendamento(p_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.xml_tarefas set status = 'cancelado', concluido_em = now(), mensagem = 'Cancelado pelo usuário.'
   where agendamento_id = p_id and status = 'pendente'
     and (org_id = public.minha_org() or public.sou_admin());
  get diagnostics n = row_count;
  return n;
end $$;

-- ------------------------------------------------------------------------- segurança (RLS)
-- Leitura pelo portal com a sessão do usuário; gravação pelo servidor do portal (chave secreta),
-- depois de conferir a organização de quem enviou, e pelo robô.
alter table public.organizacoes     enable row level security;
alter table public.perfis           enable row level security;
alter table public.xml_empresas     enable row level security;
alter table public.xml_agendamentos enable row level security;
alter table public.xml_tarefas      enable row level security;
alter table public.xml_robos        enable row level security;

do $$ begin
  -- regras de leitura de organizacoes/perfis só se ainda não houver (o portal de CND já cria as dele)
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'organizacoes') then
    create policy org_ler on public.organizacoes for select to authenticated
      using (public.sou_admin() or id = public.minha_org());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'perfis') then
    create policy perfis_ler on public.perfis for select to authenticated
      using (public.sou_admin() or id = auth.uid());
  end if;
end $$;

drop policy if exists xml_empresas_ler on public.xml_empresas;
create policy xml_empresas_ler on public.xml_empresas for select to authenticated
  using (public.sou_admin() or org_id = public.minha_org());
-- a senha cifrada não sai para o navegador: só as colunas abaixo podem ser lidas pelo usuário
revoke select on public.xml_empresas from anon, authenticated;
grant select (id, org_id, cnpj, apelido, login_atf, criado_em, atualizado_em) on public.xml_empresas to authenticated;

drop policy if exists xml_agendamentos_ler on public.xml_agendamentos;
create policy xml_agendamentos_ler on public.xml_agendamentos for select to authenticated
  using (public.sou_admin() or org_id = public.minha_org());

drop policy if exists xml_tarefas_ler on public.xml_tarefas;
create policy xml_tarefas_ler on public.xml_tarefas for select to authenticated
  using (public.sou_admin() or org_id = public.minha_org());

drop policy if exists xml_robos_ler on public.xml_robos;
create policy xml_robos_ler on public.xml_robos for select to authenticated using (true);

-- funções: quem pode chamar
revoke all on function public.xml_pegar_tarefa(text) from public, anon, authenticated;
grant execute on function public.xml_pegar_tarefa(text) to service_role;
revoke all on function public.xml_cancelar_agendamento(uuid) from public, anon;
grant execute on function public.xml_cancelar_agendamento(uuid) to authenticated;

-- avisa a API (PostgREST) para reler as tabelas e funções novas
notify pgrst, 'reload schema';
