// Ensaio local. O banco é criado em memória e não usa URL ou credencial.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");
const { pgcrypto } = require("@electric-sql/pglite/contrib/pgcrypto");

const pasta = process.argv[2] || path.join(__dirname, "..");
const arquivo = "20261110180000_isolamento_v2.sql";
const ler = (nome) => fs.readFileSync(path.join(pasta, nome), "utf8").replace(/\r\n/g, "\n");
const schema = ler("schema.sql");
const migracao = ler(path.join("migrations", arquivo));
assert.ok(schema.endsWith(migracao), "O bloco v2 do schema diverge da migração.");
const anterior = schema.slice(0, -migracao.length);

const preparar = (db) => db.exec(
  "create role anon; create role authenticated; create role service_role bypassrls;" +
  "create schema auth; create table auth.users(id uuid primary key);" +
  "create function auth.uid() returns uuid language sql stable as 'select null::uuid';"
);
const id = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const ids = (...ns) => ns.map((n) => "'" + id(n) + "'").join(", ");
const ie = "160123453";
const matriz = "11222333000181";
const filial = "11222333000262";

async function verificar(db) {
  const linhas = async (sql, params) => (await db.query(sql, params)).rows;
  await db.exec(`
    insert into public.organizacoes(id, nome, ativo) values
      (${ids(1)}, 'Escritório A', true), (${ids(2)}, 'Escritório B', true), (${ids(3)}, 'Suspenso', false);
    insert into public.xml_acessos(id, org_id, login, senha_cifrada) values
      (${ids(11, 1)}, 'mesmo-login', 'v1:falso-a'), (${ids(12, 2)}, 'mesmo-login', 'v1:falso-b'),
      (${ids(13, 3)}, 'suspenso', 'v1:falso-c');
    insert into public.xml_empresas(id, org_id, ie, nome, acesso_id) values
      (${ids(21, 1)}, '${ie}', 'Empresa A', ${ids(11)}), (${ids(22, 2)}, '${ie}', 'Empresa B', ${ids(12)}),
      (${ids(23, 3)}, '${ie}', 'Empresa suspensa', ${ids(13)}),
      (${ids(24, 1)}, '000000019', 'Acesso incompatível', ${ids(12)}),
      (${ids(25, 1)}, '000000027', 'Outra empresa A', ${ids(11)});
    insert into public.xml_nfse_empresas(id, org_id, cnpj, nome) values
      (${ids(31, 1)}, '${filial}', 'Filial A'), (${ids(32, 2)}, '${filial}', 'Filial B'),
      (${ids(33, 3)}, '${filial}', 'Filial suspensa'), (${ids(34, 1)}, '98765432000198', 'Sem cert A'),
      (${ids(35, 1)}, '${matriz}', 'Matriz A');
    insert into public.xml_nfse_certificados(id, org_id, cnpj, pfx_cifrado, senha_cifrada) values
      (${ids(41, 1)}, '${matriz}', 'v2:falso-matriz-a', 'v1:falsa'),
      (${ids(42, 2)}, '${filial}', 'v2:falso-filial-b', 'v1:falsa'),
      (${ids(43, 3)}, '${matriz}', 'v2:falso-suspenso', 'v1:falsa'),
      (${ids(44, 2)}, '98765432000198', 'v2:falso-fora-do-contexto', 'v1:falsa');
    insert into public.xml_agendamentos(id, org_id, competencia, executar_em, origem) values
      (${ids(51, 1)}, '2026-09-01', now() - interval '2 days', 'sefaz'),
      (${ids(52, 2)}, '2026-09-01', now() - interval '1 day', 'sefaz'),
      (${ids(53, 3)}, '2026-09-01', now(), 'sefaz'),
      (${ids(54, 1)}, '2026-09-01', now(), 'nfse'),
      (${ids(55, 2)}, '2026-09-01', now(), 'nfse'),
      (${ids(56, 3)}, '2026-09-01', now(), 'nfse'),
      (${ids(57, 1)}, '2026-10-01', now(), 'sefaz'),
      (${ids(58, 1)}, '2026-11-01', now() + interval '1 day', 'sefaz');
    insert into public.xml_tarefas(id, org_id, agendamento_id, empresa_id, ie, tipos) values
      (${ids(61, 1, 51, 21)}, '${ie}', array['mei']), (${ids(62, 2, 52, 22)}, '${ie}', array['mei']),
      (${ids(63, 3, 53, 23)}, '${ie}', array['mei']), (${ids(64, 1, 52, 21)}, '${ie}', array['mei']),
      (${ids(65, 1, 51, 22)}, '${ie}', array['mei']), (${ids(66, 1, 51, 24)}, '000000019', array['mei']),
      (${ids(67, 1, 51, 21)}, '000000019', array['mei']),
      (${ids(68, 1, 51, 25)}, '000000027', array['nfe_saida']),
      (${ids(69, 1, 57, 21)}, '${ie}', array['nfe_saida']),
      (${ids(70, 1, 58, 21)}, '${ie}', array['nfe_saida']);
    insert into public.xml_tarefas(id, org_id, agendamento_id, nfse_empresa_id, ie, tipos) values
      (${ids(71, 1, 54, 31)}, '${filial}', array['nfse_emitidas']),
      (${ids(72, 2, 55, 32)}, '${filial}', array['nfse_emitidas']),
      (${ids(73, 3, 56, 33)}, '${filial}', array['nfse_emitidas']),
      (${ids(74, 1, 55, 31)}, '${filial}', array['nfse_emitidas']),
      (${ids(75, 1, 54, 32)}, '${filial}', array['nfse_emitidas']),
      (${ids(76, 1, 54, 34)}, '98765432000198', array['nfse_emitidas']),
      (${ids(77, 1, 54, 35)}, '${filial}', array['nfse_emitidas']);
    update public.xml_tarefas
       set status = 'processando', iniciado_em = now() - interval '91 minutes', robo = 'robo-antigo-nfse'
      where id = ${ids(71)};
    insert into public.xml_mei_meses(org_id, ie, nome, competencia, saidas, consultado_em) values
      (${ids(1)}, '${ie}', 'Anterior', '2026-07-01', 10, null),
      (${ids(2)}, '${ie}', 'Preservar', '2026-09-01', 800, '2026-10-01T15:00:00Z');
  `);

  const legadoSql = `select oid::regprocedure::text as assinatura, pg_get_functiondef(oid) as definicao
      from pg_proc where pronamespace = 'public'::regnamespace and proname in
      ('xml_pegar_lote', 'xml_nfse_pegar_lote', 'xml_mei_registrar', 'xml_mei_registrar_ie')
      order by assinatura`;
  const legado = await linhas(legadoSql);
  assert.equal(legado.length, 4);
  await db.exec(migracao);
  await db.exec(migracao);
  assert.deepEqual(await linhas(legadoSql), legado);
  assert.equal((await linhas("select count(*)::int as n from public.xml_tarefas"))[0].n, 17);
  console.log("Migração sobre banco com dados, reaplicação e contratos legados");

  const funcoes = [
    "xml_pegar_lote_v2(text,text,integer)", "xml_nfse_pegar_lote_v2(text,integer)",
    "xml_mei_registrar_contexto(uuid,text,jsonb,date)", "xml_mei_registrar_v2(uuid,uuid,text,jsonb,date)",
  ];
  for (const funcao of funcoes) {
    const [permissoes] = await linhas(`select
      has_function_privilege('anon', $1, 'execute') as anon,
      has_function_privilege('authenticated', $1, 'execute') as autenticado,
      has_function_privilege('service_role', $1, 'execute') as robo`, ["public." + funcao]);
    assert.deepEqual(permissoes, { anon: false, autenticado: false, robo: true });
  }
  for (const papel of ["anon", "authenticated"]) {
    await db.exec("set role " + papel);
    try {
      await assert.rejects(() => linhas("select * from public.xml_pegar_lote_v2('teste')"), { code: "42501" });
    } finally {
      await db.exec("reset role");
    }
  }
  console.log("Privilégios das quatro funções e execução bloqueada aos papéis web");

  const estado = async (n) => (await linhas(
    "select status, iniciado_em::text, robo from public.xml_tarefas where id = $1", [id(n)]
  ))[0];
  const status = async (n) => (await estado(n)).status;
  const nfseAntiga = await estado(71);
  await db.exec("set role service_role");
  const primeiro = await linhas("select * from public.xml_pegar_lote_v2('robo', 'mesmo-login')");
  const segundo = await linhas("select * from public.xml_pegar_lote_v2('robo', 'mesmo-login')");
  const outroMes = await linhas("select * from public.xml_pegar_lote_v2('robo', 'mesmo-login')");
  await db.exec("reset role");
  assert.deepEqual(await estado(71), nfseAntiga, "A fila ATF alterou uma tarefa antiga da NFS-e.");

  // A tarefa ATF envelhece antes de a fila NFS-e verificar suas próprias retomadas.
  await db.query("update public.xml_tarefas set iniciado_em = now() - interval '91 minutes', robo = 'robo-antigo-atf' where id = $1",
    [id(69)]);
  const atfAntiga = await estado(69);
  await db.exec("set role service_role");
  const nfse = await linhas("select * from public.xml_nfse_pegar_lote_v2('robo')");
  await db.exec("reset role");
  assert.deepEqual(await estado(69), atfAntiga, "A fila NFS-e alterou uma tarefa antiga do ATF.");
  assert.deepEqual(primeiro.map((t) => t.id), [id(61), id(68)]);
  assert.ok(primeiro.every((t) => t.org_id === id(1) && t.org_nome === "Escritório A" && t.senha_cifrada === "v1:falso-a"));
  assert.deepEqual(segundo.map((t) => [t.id, t.org_id, t.ie, t.senha_cifrada]), [[id(62), id(2), ie, "v1:falso-b"]]);
  assert.deepEqual(outroMes.map((t) => t.id), [id(69)]);
  for (const n of [64, 65, 66, 67, 74, 75, 77]) assert.equal(await status(n), "erro");
  for (const n of [63, 70, 73]) assert.equal(await status(n), "pendente");
  assert.equal(await status(76), "certificado");
  assert.deepEqual(nfse.map((t) => [t.id, t.org_id, t.cnpj, t.certificado_cnpj, t.pfx_cifrado]), [
    [id(71), id(1), filial, matriz, "v2:falso-matriz-a"],
    [id(72), id(2), filial, filial, "v2:falso-filial-b"],
  ]);
  const retomada = await linhas("select id from public.xml_pegar_lote_v2('robo')");
  assert.deepEqual(retomada, [{ id: id(69) }]);
  assert.deepEqual(await linhas("select * from public.xml_pegar_lote_v2('robo')"), []);
  assert.deepEqual(await linhas("select * from public.xml_nfse_pegar_lote_v2('robo')"), []);
  console.log("Filas, mesma IE, lote/competência, suspensão, vínculos cruzados, certificado e retomada");

  const payload = (data, valor, mes = "2026-09") => JSON.stringify({ [mes]: { consultado_em: data, saidas: valor } });
  const reenviar = async (org, inscricao, meses) => (await linhas(
    "select public.xml_mei_registrar_contexto($1,$2,$3) as n", [id(org), inscricao, meses]))[0].n;
  const callback = async (tarefa, org, inscricao, meses) => (await linhas(
    "select public.xml_mei_registrar_v2($1,$2,$3,$4) as n", [id(tarefa), id(org), inscricao, meses]))[0].n;
  await db.exec("set role service_role; set timezone = 'Asia/Tokyo';");
  assert.equal(await callback(61, 1, ie, payload("2026-10-01T12:00:00-03:00", 100)), 1);
  assert.equal(await reenviar(1, ie, payload("2026-10-01T14:59:59Z", 200)), 0);
  assert.equal(await reenviar(1, ie, payload("2026-10-01T15:00:00Z", 300)), 0);
  assert.equal(await reenviar(1, ie, payload("2026-10-01T15:00:01Z", 400)), 1);
  assert.equal(await callback(61, 1, ie, payload("2026-10-01T15:00:00Z", 999)), 0);
  assert.equal(await reenviar(1, ie, payload("2026-08-01T12:00:00Z", 70, "2026-07")), 1);
  for (const data of [null, "2026-10-01T15:00:02", "2026-13-01T15:00:02Z"]) {
    await assert.rejects(() => reenviar(1, ie, payload(data, 999)));
  }
  await assert.rejects(() => reenviar(3, ie, payload("2026-10-01T15:00:02Z", 999)), { code: "22023" });
  await assert.rejects(() => reenviar(2, "000000019", payload("2026-10-01T15:00:02Z", 999)), { code: "22023" });
  await assert.rejects(() => callback(61, 2, ie, payload("2026-10-01T15:00:02Z", 999)), { code: "22023" });
  await assert.rejects(() => callback(65, 1, ie, payload("2026-10-01T15:00:02Z", 999)), { code: "22023" });
  const mesesInvalidos = JSON.stringify({
    "2026-09": { consultado_em: "2026-10-01T15:00:03Z", saidas: 999 },
    "2026-10": { consultado_em: "2026-11-01T12:00:00", saidas: 10 },
  });
  await assert.rejects(() => reenviar(1, ie, mesesInvalidos), { code: "22023" });
  await db.exec("reset role");
  assert.deepEqual(await linhas(`select org_id, nome, to_char(competencia, 'YYYY-MM') as mes, saidas::int
    from public.xml_mei_meses order by org_id, competencia`), [
    { org_id: id(1), nome: "Empresa A", mes: "2026-07", saidas: 70 },
    { org_id: id(1), nome: "Empresa A", mes: "2026-09", saidas: 400 },
    { org_id: id(2), nome: "Preservar", mes: "2026-09", saidas: 800 },
  ]);
  console.log("MEI por contexto, callback, fusos e proteção contra coleta antiga");

  await db.exec(`update public.organizacoes set ativo = true where id = ${ids(3)};
    update public.xml_tarefas set status = 'pendente' where id in (${ids(61, 68)});`);
  const preferido = await linhas("select id from public.xml_pegar_lote_v2('robo', 'suspenso', 1)");
  const limitado = await linhas("select id from public.xml_pegar_lote_v2('robo', '', 1)");
  assert.deepEqual(preferido, [{ id: id(63) }]);
  assert.deepEqual(limitado, [{ id: id(61) }]);
  assert.equal(await status(68), "pendente");
  console.log("Reativação, preferência de login e limite do lote");

  await db.exec(schema);
  assert.equal((await linhas("select count(*)::int as n from public.xml_tarefas"))[0].n, 17);
  assert.deepEqual(await linhas(legadoSql), legado);
  console.log("Schema consolidado reaplicado com dados existentes");
}

async function ensaio() {
  const db = new PGlite({ extensions: { pgcrypto } });
  const novo = new PGlite({ extensions: { pgcrypto } });
  try {
    await preparar(db);
    await db.exec(anterior);
    await verificar(db);
    await preparar(novo);
    await novo.exec(schema);
    await novo.query("select * from public.xml_pegar_lote_v2('teste')");
    await novo.query("select * from public.xml_nfse_pegar_lote_v2('teste')");
    console.log("Instalação limpa do schema consolidado");
  } finally {
    await db.close();
    await novo.close();
  }
}

ensaio().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
