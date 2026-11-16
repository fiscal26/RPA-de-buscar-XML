const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");
const { pgcrypto } = require("@electric-sql/pglite/contrib/pgcrypto");
const mig = fs.readFileSync(
  path.join(
    __dirname,
    "../supabase/migrations/20261116021315_mei_descoberta_acompanhamento.sql",
  ),
  "utf8",
);
const org = "00000000-0000-4000-8000-000000000001",
  outro = "00000000-0000-4000-8000-000000000002",
  user = "00000000-0000-4000-8000-000000000011";
const cnpj = (n) => String(11222333000000 + n); // A validação dos dígitos verificadores é exercitada no processador TS.
test("descoberta MEI: migração, decisões, fila durável e isolamento", async (t) => {
  const db = new PGlite({ extensions: { pgcrypto } });
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const v = async (sql, args = []) => Object.values((await q(sql, args))[0])[0];
  const empresa = async (n, o = org) =>
    q(
      "insert into xml_nfse_empresas(org_id,cnpj,nome,tipos) values($1,$2,$3,'{nfse_emitidas}')",
      [o, cnpj(n), `Empresa ${n}`],
    );
  const cadastro = async (n, ativo = true) =>
    q(
      "insert into xml_mei_cadastros(org_id,cnpj,nome,ativo,inicio_atividade,inicio_mei) values($1,$2,'Manual',$3,'2025-01-10','2025-02-01')",
      [org, cnpj(n), ativo],
    );
  const decidir = async (n, acao, versao = null, o = org) =>
    v("select xml_mei_decidir($1,$2,$3,$4,p_versao=>$5)", [
      o,
      cnpj(n),
      user,
      acao,
      versao,
    ]);
  const enfileirar = async (n = null, origem = "manual", o = org) =>
    v("select xml_mei_enfileirar($1,$2,$3,$4)", [
      o,
      n === null ? null : cnpj(n),
      origem,
      user,
    ]);
  const pegar = () => v("select xml_mei_pegar_verificacao()");
  const finalizar = async (
    item,
    resultado = "elegivel",
    dados = {},
    data = new Date().toISOString(),
    token = item.token,
  ) =>
    v(
      "select xml_mei_finalizar_verificacao($1,$2,$3,$4,$5,'Resultado da base')",
      [
        item.id,
        token,
        resultado,
        JSON.stringify({
          cnpj: item.cnpj,
          mei: true,
          abertura: "2025-01-10",
          inicioMei: "2025-02-01",
          ...dados,
        }),
        data,
      ],
    );
  const confirmar = async (lote, ns, o = org) =>
    v("select xml_mei_confirmar_lote($1,$2,$3)", [lote, ns.map(cnpj), user]);
  try {
    await db.exec(`create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated; create role service_role bypassrls;
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
   grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
    const schema = fs.readFileSync(
      path.join(__dirname, "../supabase/schema.sql"),
      "utf8",
    );
    await db.exec(
      schema.split(
        "-- Descoberta cadastral e decisões de acompanhamento MEI",
      )[0],
    );
    await db.exec(`insert into auth.users values('${user}'); insert into organizacoes(id,nome) values('${org}','A'),('${outro}','B');
   insert into perfis(id,org_id,nome,email,papel) values('${user}','${org}','Gestor','a@example.test','gestor');
   select set_config('test.uid','${user}',false); grant select on all tables in schema public to authenticated;`);
    await empresa(1);
    await cadastro(1);
    await empresa(2);
    await cadastro(2, false);
    await empresa(3);
    await empresa(4);
    await t.test(
      "migração conserva ativos/pausados e não inclui a carteira antiga",
      async () => {
        await db.exec(mig);
        await db.exec(mig);
        assert.deepEqual(
          await q("select estado from xml_mei_acompanhamento order by cnpj"),
          [{ estado: "ativo" }, { estado: "pausado" }],
        );
        assert.equal(
          await v("select count(*)::int from xml_mei_sincronizacao_itens"),
          0,
        );
      },
    );
    await t.test(
      "RLS e RPCs administrativas bloqueiam o navegador e outros escritórios",
      async () => {
        await empresa(20, outro);
        await db.exec("set role authenticated");
        assert.equal(
          await v("select count(*)::int from xml_mei_acompanhamento"),
          2,
        );
        assert.equal(
          await v("select count(*)::int from xml_mei_sincronizacao_itens"),
          0,
        );
        await assert.rejects(decidir(1, "ignorar"), /permission denied/);
        await assert.rejects(
          db.exec("update xml_mei_acompanhamento set estado='ignorado'"),
          /permission denied/,
        );
        await assert.rejects(
          v(
            "select xml_mei_faturamento_lote($1,$2,'2026-01-01','2026-01-01')",
            [outro, [cnpj(20)]],
          ),
          /permissão/,
        );
        await db.exec("reset role");
        await assert.rejects(decidir(20, "ignorar", null, outro), /gestor/);
        // Retira o item de outro escritório para os cenários seguintes.
        await q("delete from xml_mei_sincronizacoes where org_id=$1", [outro]);
        await db.exec("set role service_role");
        try {
          await pegar();
        } finally {
          await db.exec("reset role");
        }
        const inseguras = await q(
          `select proname from pg_proc where proname in ('xml_mei_decidir','xml_mei_enfileirar','xml_mei_pegar_verificacao','xml_mei_finalizar_verificacao','xml_mei_confirmar_lote') and (has_function_privilege('authenticated',oid,'execute') or has_function_privilege('anon',oid,'execute'))`,
        );
        assert.deepEqual(inseguras, []);
      },
    );
    await t.test(
      "ignorar e pausar independem de datas; reimportação não reativa",
      async () => {
        await decidir(3, "ignorar", 0);
        await decidir(4, "pausar", 0);
        assert.equal(await v("select count(*)::int from xml_mei_cadastros"), 2);
        await q(
          "update xml_nfse_empresas set nome='Reimportado' where cnpj=$1",
          [cnpj(3)],
        );
        await q(
          "insert into xml_empresas(org_id,ie,cnpj,nome,tipos) values($1,'161234567',$2,'Duplicada','{mei}')",
          [org, cnpj(3)],
        );
        assert.equal(
          await v("select count(*)::int from xml_mei_sincronizacao_itens"),
          0,
        );
        const lote = await enfileirar();
        const itens = await q(
          "select cnpj,resultado from xml_mei_sincronizacao_itens where lote_id=$1 order by cnpj",
          [lote],
        );
        assert.deepEqual(
          itens.map((x) => x.resultado),
          ["pendente", "dispensado", "dispensado", "dispensado"],
        );
        assert.equal(itens.length, 4);
        assert.equal(await enfileirar(), lote);
        const item = await pegar();
        assert.equal(await finalizar(item), "acompanhado");
        assert.equal(
          await v("select estado from xml_mei_sincronizacoes where id=$1", [
            lote,
          ]),
          "concluido",
        );
        assert.equal(await v("select count(*)::int from xml_mei_historico"), 2);
      },
    );
    await t.test(
      "novo CNPJ inclui automaticamente com datas completas e nunca zera faturamento",
      async () => {
        await empresa(5);
        const item = await pegar();
        assert.equal(item.cnpj, cnpj(5));
        assert.equal(await finalizar(item), "incluido");
        assert.equal(
          await v("select origem from xml_mei_cadastros where cnpj=$1", [
            cnpj(5),
          ]),
          "automatico",
        );
        assert.equal(
          await v("select count(*)::int from xml_mei_nfse_meses"),
          0,
        );
        assert.equal(await pegar(), null);
      },
    );
    await t.test(
      "lote da carteira só inclui a seleção confirmada, sem duplicar ao repetir",
      async () => {
        // Simula empresas existentes antes da ativação, não um novo cadastro.
        await db.exec(
          "alter table xml_nfse_empresas disable trigger xml_mei_empresa_nova",
        );
        await empresa(6);
        await empresa(7);
        await db.exec(
          "alter table xml_nfse_empresas enable trigger xml_mei_empresa_nova",
        );
        const lote = await enfileirar(6);
        await enfileirar(7);
        assert.equal(await finalizar(await pegar()), "elegivel");
        assert.equal(await finalizar(await pegar()), "elegivel");
        assert.equal(
          await v(
            "select count(*)::int from xml_mei_cadastros where cnpj=any($1::text[])",
            [[cnpj(6), cnpj(7)]],
          ),
          0,
        );
        assert.deepEqual(await confirmar(lote, [6]), { incluido: 1 });
        assert.deepEqual(await confirmar(lote, [6]), {});
        assert.equal(
          await v("select count(*)::int from xml_mei_cadastros where cnpj=$1", [
            cnpj(7),
          ]),
          0,
        );
        await decidir(7, "ignorar");
        assert.deepEqual(await confirmar(lote, [7]), { dispensado: 1 });
      },
    );
    await t.test(
      "decisão simultânea prevalece sobre API; token vencido não grava",
      async () => {
        await empresa(8);
        const item = await pegar();
        await decidir(8, "pausar");
        assert.equal(await finalizar(item), "dispensado");
        await empresa(9);
        const expirado = await pegar();
        await q(
          "update xml_mei_sincronizacao_itens set reserva_ate=now()-interval '1 second' where id=$1",
          [expirado.id],
        );
        assert.equal(await finalizar(expirado), "expirado");
        const novo = await pegar();
        assert.notEqual(novo.token, expirado.token);
        assert.equal(
          await finalizar(
            novo,
            "elegivel",
            {},
            new Date().toISOString(),
            expirado.token,
          ),
          "expirado",
        );
        assert.equal(await finalizar(novo), "incluido");
        await assert.rejects(decidir(9, "ignorar", 0), /mudou/);
      },
    );
    await t.test(
      "incompleto, divergente, cache antigo ou não optante não apagam nem sobrescrevem cadastro",
      async () => {
        await empresa(10);
        assert.equal(
          await finalizar(await pegar(), "elegivel", { inicioMei: null }),
          "revisar",
        );
        await empresa(11);
        assert.equal(
          await finalizar(
            await pegar(),
            "elegivel",
            {},
            new Date(Date.now() - 8 * 86400000).toISOString(),
          ),
          "revisar",
        );
        const lote = await enfileirar(1);
        assert.equal(
          await finalizar(await pegar(), "elegivel", {
            abertura: "2024-01-01",
          }),
          "revisar",
        );
        assert.equal(
          await v(
            "select inicio_atividade::text from xml_mei_cadastros where cnpj=$1",
            [cnpj(1)],
          ),
          "2025-01-10",
        );
        await enfileirar(1);
        assert.equal(
          await finalizar(await pegar(), "nao_mei", { mei: false }),
          "revisar",
        );
        assert.equal(
          await v("select ativo from xml_mei_cadastros where cnpj=$1", [
            cnpj(1),
          ]),
          true,
        );
      },
    );
    await t.test(
      "API com falha é retomada; espera de quota não consome tentativas",
      async () => {
        await empresa(12);
        let item = await pegar();
        assert.equal(await finalizar(item, "aguardar", {}, null), "pendente");
        assert.equal(
          await v(
            "select tentativas from xml_mei_sincronizacao_itens where id=$1",
            [item.id],
          ),
          0,
        );
        assert.equal(await pegar(), null);
        for (let n = 1; n <= 5; n++) {
          await q(
            "update xml_mei_sincronizacao_itens set proxima_tentativa=now()-interval '1 second' where id=$1",
            [item.id],
          );
          item = await pegar();
          assert.equal(
            await finalizar(item, "erro", {}, null),
            n === 5 ? "erro" : "pendente",
          );
        }
        assert.equal(
          await v("select count(*)::int from xml_mei_cadastros where cnpj=$1", [
            cnpj(12),
          ]),
          0,
        );
      },
    );
    await t.test(
      "reativar exige cadastro; encerrar preserva histórico e restringe consultas futuras",
      async () => {
        await assert.rejects(decidir(3, "reativar"), /datas/);
        await decidir(5, "pausar");
        assert.equal(
          await v("select xml_mei_pode_consultar($1,$2,'2026-01-01')", [
            org,
            cnpj(5),
          ]),
          false,
        );
        await decidir(5, "reativar");
        await v(
          "select xml_mei_decidir($1,$2,$3,'encerrar',p_fim=>'2026-06-01')",
          [org, cnpj(5), user],
        );
        assert.equal(
          await v("select xml_mei_pode_consultar($1,$2,'2026-01-01')", [
            org,
            cnpj(5),
          ]),
          true,
        );
        assert.equal(
          await v("select xml_mei_pode_consultar($1,$2,'2026-07-01')", [
            org,
            cnpj(5),
          ]),
          false,
        );
        await assert.rejects(
          v("select xml_mei_reprocessar($1,$2,'2026-07-01')", [org, cnpj(5)]),
          /competência/,
        );
      },
    );
    await t.test(
      "nova tarefa de importação remove somente serviço MEI pausado",
      async () => {
        const ag = await v(
          "insert into xml_agendamentos(org_id,criado_por,competencia,total) values($1,$2,'2026-01-01',1) returning id",
          [org, user],
        );
        const id = await v(
          "insert into xml_tarefas(org_id,agendamento_id,ie,nome,tipos) values($1,$2,'161234567','Ignorado','{mei,nfe_saida}') returning id",
          [org, ag],
        );
        assert.deepEqual(
          await v("select tipos from xml_tarefas where id=$1", [id]),
          ["nfe_saida"],
        );
        assert.equal(
          await v("select count(*)::int from xml_mei_cadastros where cnpj=$1", [
            cnpj(3),
          ]),
          0,
        );
      },
    );
    await t.test(
      "fila NFS-e sinaliza pausa explícita sem cancelar outros documentos e a SEFAZ limpa pendências antigas",
      async () => {
        const ag = await v(
          "insert into xml_agendamentos(org_id,criado_por,competencia,total,origem) values($1,$2,'2026-01-01',1,'nfse') returning id",
          [org, user],
        );
        await q(
          "insert into xml_nfse_certificados(org_id,cnpj,nome,pfx_cifrado,senha_cifrada,validade,procurador) values($1,$2,'Teste','v2:teste','v1:teste',now()+interval '1 year',true)",
          [org, cnpj(1)],
        );
        await q(
          "insert into xml_tarefas(org_id,agendamento_id,nfse_empresa_id,ie,nome,tipos) select $1,$2,id,cnpj,nome,'{nfse_emitidas}' from xml_nfse_empresas where org_id=$1 and cnpj=$3",
          [org, ag, cnpj(3)],
        );
        const lote = await q("select * from xml_nfse_pegar_lote('teste',10)");
        assert.equal(lote.length, 1);
        assert.equal(lote[0].mei_bloqueado, true);
        // Pendência criada antes de uma exclusão: simula o estado antigo sem o trigger de proteção.
        await db.exec(
          "alter table xml_tarefas disable trigger xml_mei_respeitar_decisao",
        );
        const antigo = await v(
          "insert into xml_tarefas(org_id,agendamento_id,ie,nome,tipos) values($1,$2,'161234567','Pendente antiga','{mei,nfe_saida}') returning id",
          [org, ag],
        );
        await db.exec(
          "alter table xml_tarefas enable trigger xml_mei_respeitar_decisao",
        );
        await v("select xml_mei_limpar_fila()");
        assert.deepEqual(
          await v("select tipos from xml_tarefas where id=$1", [antigo]),
          ["nfe_saida"],
        );
      },
    );
    await t.test(
      "faturamento em lote isola falhas por empresa e mantém autorização de gestor",
      async () => {
        await db.exec("set role authenticated");
        const resultados = await v(
          "select xml_mei_faturamento_lote($1,$2,'2026-01-01','2026-01-01')",
          [org, [cnpj(5), cnpj(3)]],
        );
        assert.equal(resultados.length, 2);
        assert.ok(resultados.find((r) => r.cnpj === cnpj(3)).erro);
        assert.ok(
          resultados.find((r) => r.cnpj === cnpj(5)).consultas.length > 0,
        );
        await db.exec("reset role");
        await q("update perfis set papel='usuario' where id=$1", [user]);
        await db.exec("set role authenticated");
        await assert.rejects(
          v(
            "select xml_mei_faturamento_lote($1,$2,'2026-01-01','2026-01-01')",
            [org, [cnpj(5)]],
          ),
          /permissão/,
        );
        await db.exec("reset role");
      },
    );
  } finally {
    await db.close();
  }
});
