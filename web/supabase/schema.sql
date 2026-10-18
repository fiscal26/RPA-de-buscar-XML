-- =====================================================================================
-- LotiVisse XML — estrutura do banco (Supabase / PostgreSQL)
--
-- Projeto próprio do Supabase (separado do portal de CND; só o domínio e a marca são os mesmos).
-- Como usar: no painel do Supabase, abra "SQL Editor", cole TODO este arquivo e clique em "Run".
-- Pode rodar de novo sem perder dados.
--
-- Senhas do ATF: chegam aqui já cifradas pelo portal com a chave pública do robô
-- (coluna senha_cifrada, formato "v1:..."). Só o robô, no seu PC, tem a chave que abre.
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
    check (tipos <@ array['nfe_saida', 'nfe_entrada', 'nfce', 'faturas', 'extrato', 'omissao', 'certidao'])
);

-- Banco criado antes dos serviços de PDF (faturas, extrato, omissão, certidão): troca a regra dos tipos
alter table public.xml_empresas drop constraint if exists xml_empresas_tipos_check;
alter table public.xml_empresas add constraint xml_empresas_tipos_check
  check (tipos <@ array['nfe_saida', 'nfe_entrada', 'nfce', 'faturas', 'extrato', 'omissao', 'certidao']);

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
                    'pendente', 'processando', 'concluido', 'sem_notas', 'senha_invalida',
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

-- Robôs (o programa que roda no PC e baixa os XML)
create table if not exists public.xml_robos (
  id           text primary key,
  ultimo_sinal timestamptz not null default now(),
  versao       text not null default '',
  info         jsonb not null default '{}'::jsonb
);

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
               login_atf text, senha_cifrada text)
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
  select t.id, t.ie, e.cnpj, t.nome, t.codigo, t.tipos, a.data_inicio, a.data_fim, c.login, c.senha_cifrada
    from public.xml_tarefas t
    join public.xml_agendamentos a on a.id = t.agendamento_id
    join public.xml_empresas e on e.id = t.empresa_id
    join public.xml_acessos c on c.id = e.acesso_id
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
     and (org_id = public.minha_org() or public.sou_admin());
  get diagnostics n = row_count;
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

drop policy if exists org_ler on public.organizacoes;
create policy org_ler on public.organizacoes for select to authenticated
  using (public.sou_admin() or id = public.minha_org());

drop policy if exists perfis_ler on public.perfis;
create policy perfis_ler on public.perfis for select to authenticated
  using (public.sou_admin() or id = auth.uid()
         or (org_id = public.minha_org() and public.meu_papel() = 'gestor'));

drop policy if exists xml_acessos_ler on public.xml_acessos;
create policy xml_acessos_ler on public.xml_acessos for select to authenticated
  using (public.sou_admin() or org_id = public.minha_org());
-- a senha cifrada não sai para o navegador: só as colunas abaixo podem ser lidas pelo usuário
revoke select on public.xml_acessos from anon, authenticated;
grant select (id, org_id, login, criado_em, atualizado_em) on public.xml_acessos to authenticated;

drop policy if exists xml_empresas_ler on public.xml_empresas;
create policy xml_empresas_ler on public.xml_empresas for select to authenticated
  using (public.sou_admin() or org_id = public.minha_org());

drop policy if exists xml_agendamentos_ler on public.xml_agendamentos;
create policy xml_agendamentos_ler on public.xml_agendamentos for select to authenticated
  using (public.sou_admin() or org_id = public.minha_org());

drop policy if exists xml_tarefas_ler on public.xml_tarefas;
create policy xml_tarefas_ler on public.xml_tarefas for select to authenticated
  using (public.sou_admin() or org_id = public.minha_org());

drop policy if exists xml_robos_ler on public.xml_robos;
create policy xml_robos_ler on public.xml_robos for select to authenticated using (true);

-- funções: quem pode chamar
revoke all on function public.xml_pegar_lote(text, text, integer) from public, anon, authenticated;
grant execute on function public.xml_pegar_lote(text, text, integer) to service_role;
revoke all on function public.xml_cancelar_agendamento(uuid) from public, anon;
grant execute on function public.xml_cancelar_agendamento(uuid) to authenticated;

-- avisa a API (PostgREST) para reler as tabelas e funções novas
notify pgrst, 'reload schema';
