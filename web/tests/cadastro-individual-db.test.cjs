const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  Module = require("node:module"),
  ts = require("typescript"),
  crypto = require("node:crypto");
const { PGlite } = require("@electric-sql/pglite");
const { pgcrypto } = require("@electric-sql/pglite/contrib/pgcrypto");
const org = "00000000-0000-4000-8000-000000000001",
  outro = "00000000-0000-4000-8000-000000000002",
  user = "00000000-0000-4000-8000-000000000011";
let ctx, cliente;
const rpcChamadas = [];
const original = Module._load;
Module._load = function (name, parent, ...args) {
  if (name === "server-only") return {};
  if (name === "next/cache") return { revalidatePath() {} };
  if (name === "@/lib/sessao") return { contexto: async () => ctx };
  if (name === "@/lib/supabase/admin") return { clienteAdmin: () => cliente };
  return original.call(
    this,
    name.startsWith("@/") ? path.resolve(__dirname, "..", name.slice(2)) : name,
    parent,
    ...args,
  );
};
require.extensions[".ts"] = (m, f) =>
  m._compile(
    ts.transpileModule(fs.readFileSync(f, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    f,
  );
const {
  cadastrarEmpresa,
  consultarCnpjCadastro,
} = require("../app/painel/empresas/cadastro-actions.ts");
const {
  prepararAgendamento,
  confirmarAgendamento,
} = require("../app/painel/actions.ts");
const { iePbValida } = require("../lib/documentos.ts");
const ie = (base) => {
  for (let n = 0; n < 10; n++) if (iePbValida(base + n)) return base + n;
};
function form(dados = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries({
    org_id: org,
    origem: "nfse",
    cnpj: "11222333000181",
    nome: "Prestadora Exemplo",
    tipos: ["nfse_emitidas"],
    ...dados,
  }))
    for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}
test("ações de cadastro individual e agendamento com PostgreSQL local", async (t) => {
  const db = new PGlite({ extensions: { pgcrypto } });
  const anterior = process.env.XML_CHAVE_PUBLICA;
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  process.env.XML_CHAVE_PUBLICA = publicKey.export({
    type: "spki",
    format: "pem",
  });
  function client(sessao = false) {
    return {
      from(tabela) {
        assert.match(tabela, /^[a-z_]+$/);
        let operacao = "select",
          registro,
          colunas = "*",
          unica = false;
        const filtros = [];
        const q = {
          select(c = "*") {
            colunas = c;
            return q;
          },
          eq(c, v) {
            filtros.push([c, v]);
            return q;
          },
          in(c, v) {
            filtros.push([c, v, true]);
            return q;
          },
          limit() {
            return q;
          },
          order() {
            return q;
          },
          maybeSingle() {
            unica = true;
            return q;
          },
          single() {
            unica = true;
            return q;
          },
          insert(r) {
            operacao = "insert";
            registro = r;
            return q;
          },
          async then(resolve, reject) {
            try {
              if (sessao) await db.exec("set role authenticated");
              let sql,
                params = [];
              if (operacao === "insert") {
                const campos = Object.keys(registro);
                params = Object.values(registro);
                sql = `insert into ${tabela}(${campos.join(",")}) values(${campos.map((_, i) => "$" + (i + 1)).join(",")}) returning ${colunas}`;
              } else {
                sql = `select ${colunas} from ${tabela}`;
                if (filtros.length)
                  sql +=
                    " where " +
                    filtros
                      .map(([c, v, multi]) => {
                        assert.match(c, /^[a-z_]+$/);
                        params.push(v);
                        return `${c}${multi ? "=any(" : "="}$${params.length}${multi ? ")" : ""}`;
                      })
                      .join(" and ");
              }
              const r = await db.query(sql, params);
              if (sessao) await db.exec("reset role");
              return resolve({
                data: unica ? (r.rows[0] ?? null) : r.rows,
                error: null,
              });
            } catch (e) {
              if (sessao) await db.exec("reset role");
              return resolve({
                data: null,
                error: { code: e.code, message: e.message },
              });
            }
          },
        };
        return q;
      },
      async rpc(nome, p) {
        rpcChamadas.push({ nome, p });
        if (nome === "xml_cnpja_reservar")
          return { data: { status: "aguardar", segundos: 13 }, error: null };
        const r = await db.query(
          `select ${nome}(${Object.keys(p)
            .map((k, i) => k + "=> $" + (i + 1))
            .join(",")}) as r`,
          Object.values(p),
        );
        return { data: r.rows[0].r, error: null };
      },
    };
  }
  try {
    await db.exec(
      `create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role bypassrls;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`,
    );
    await db.exec(
      fs.readFileSync(path.join(__dirname, "../supabase/schema.sql"), "utf8"),
    );
    await db.exec(
      `grant select on all tables in schema public to authenticated;insert into auth.users values('${user}');insert into organizacoes(id,nome) values('${org}','A'),('${outro}','B');insert into perfis(id,org_id,nome,email,papel) values('${user}','${org}','Usuário','u@example.test','usuario');select set_config('test.uid','${user}',false);`,
    );
    ctx = {
      supabase: client(true),
      perfil: { org_id: org, papel: "usuario", ativo: true },
      user: { id: user },
      admin: false,
    };
    cliente = client();
    const linhas = async (tabela) =>
      (await db.query(`select * from ${tabela}`)).rows;
    await t.test(
      "NFS-e cria cadastro sem certificado/agendamento e dispara a identificação MEI existente",
      async () => {
        const r = await cadastrarEmpresa(undefined, form());
        assert.ok(r.ok);
        assert.equal((await linhas("xml_nfse_empresas")).length, 1);
        assert.equal((await linhas("xml_agendamentos")).length, 0);
        assert.equal((await linhas("xml_mei_sincronizacao_itens")).length, 1);
        assert.equal((await linhas("xml_nfse_empresas"))[0].nome_fixo, true);
        assert.ok(
          (
            await cadastrarEmpresa(
              undefined,
              form({ nome: "Nome sobrescrito" }),
            )
          ).erro,
        );
        assert.equal(
          (await linhas("xml_nfse_empresas"))[0].nome,
          "Prestadora Exemplo",
        );
      },
    );
    await t.test(
      "escritório alheio e suspenso são recusados antes de acessar cache ou salvar",
      async () => {
        assert.ok(
          (await cadastrarEmpresa(undefined, form({ org_id: outro }))).erro,
        );
        assert.ok((await consultarCnpjCadastro(outro, "11222333000181")).erro);
        assert.equal(rpcChamadas.length, 0);
        await db.query("update organizacoes set ativo=false where id=$1", [
          org,
        ]);
        assert.ok((await cadastrarEmpresa(undefined, form())).erro);
        await db.query("update organizacoes set ativo=true where id=$1", [org]);
      },
    );
    await t.test(
      "SEFAZ cria senha cifrada e reaproveita acesso sem substituir segredo ou duplicar empresa",
      async () => {
        const r = await cadastrarEmpresa(
          undefined,
          form({
            origem: "sefaz",
            ie: ie("16123456"),
            tipos: ["nfe_saida"],
            login: "contador",
            senha: "segredo só do robô",
          }),
        );
        assert.ok(r.ok);
        const acesso = (await linhas("xml_acessos"))[0];
        assert.match(acesso.senha_cifrada, /^v1:/);
        assert.equal(
          crypto
            .privateDecrypt(
              {
                key: privateKey,
                padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                oaepHash: "sha256",
              },
              Buffer.from(acesso.senha_cifrada.slice(3), "base64"),
            )
            .toString(),
          "segredo só do robô",
        );
        const outroRegistro = await cadastrarEmpresa(
          undefined,
          form({
            origem: "sefaz",
            ie: ie("16234567"),
            tipos: ["nfe_entrada"],
            acesso_id: acesso.id,
          }),
        );
        assert.ok(outroRegistro.ok);
        assert.equal((await linhas("xml_acessos")).length, 1);
        assert.equal(
          (await linhas("xml_acessos"))[0].senha_cifrada,
          acesso.senha_cifrada,
        );
        const duplicada = await cadastrarEmpresa(
          undefined,
          form({
            origem: "sefaz",
            ie: ie("16123456"),
            tipos: ["nfe_saida"],
            login: "não criar",
            senha: "outra",
          }),
        );
        assert.ok(duplicada.erro);
        assert.equal((await linhas("xml_acessos")).length, 1);
        assert.ok(
          (
            await cadastrarEmpresa(
              undefined,
              form({
                origem: "sefaz",
                ie: ie("16345678"),
                tipos: ["nfe_saida"],
                login: "contador",
                senha: "não sobrescrever",
              }),
            )
          ).erro,
        );
      },
    );
    await t.test(
      "acesso de outro escritório é recusado; admin também precisa escolher escritório ativo",
      async () => {
        const r = await db.query(
          "insert into xml_acessos(org_id,login,senha_cifrada) values($1,'outro','v1:ficticio') returning id",
          [outro],
        );
        assert.ok(
          (
            await cadastrarEmpresa(
              undefined,
              form({
                origem: "sefaz",
                ie: ie("16345678"),
                tipos: ["nfe_saida"],
                acesso_id: r.rows[0].id,
              }),
            )
          ).erro,
        );
        const perfil = ctx;
        ctx = { ...ctx, admin: true, perfil: { org_id: null, papel: "admin" } };
        assert.ok(
          (await cadastrarEmpresa(undefined, form({ org_id: "" }))).erro,
        );
        ctx = perfil;
      },
    );
    await t.test(
      "prévia SEFAZ dispensa arquivo e senha, confirma com dados atuais e não recria empresa removida",
      async () => {
        const e = (await linhas("xml_empresas"))[0];
        const f = form({
          fonte: "cadastro",
          empresas: [e.id],
          competencia: "2026-10",
          competencia_final: "2026-10",
        });
        const previa = await prepararAgendamento(undefined, f);
        assert.equal(previa.itens.length, 1);
        assert.equal(previa.itens[0].ie, e.ie);
        assert.equal(previa.acessos[0].senhaCifrada, null);
        const r = await confirmarAgendamento({
          ...previa,
          itens: [
            { ...previa.itens[0], nome: "Nome falsificado", tipos: ["nfce"] },
          ],
        });
        assert.ok(r.ok);
        assert.equal((await linhas("xml_tarefas"))[0].nome, e.nome);
        assert.deepEqual((await linhas("xml_tarefas"))[0].tipos, e.tipos);
        await db.query("delete from xml_empresas where id=$1", [e.id]);
        assert.ok((await confirmarAgendamento(previa)).erro);
        assert.equal((await linhas("xml_empresas")).length, 1);
        assert.ok(
          (
            await prepararAgendamento(
              undefined,
              form({
                fonte: "cadastro",
                empresas: [crypto.randomUUID()],
                competencia: "2026-10",
              }),
            )
          ).erro,
        );
      },
    );
  } finally {
    if (anterior === undefined) delete process.env.XML_CHAVE_PUBLICA;
    else process.env.XML_CHAVE_PUBLICA = anterior;
    await db.close();
  }
});
