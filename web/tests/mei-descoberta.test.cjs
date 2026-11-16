const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  Module = require("node:module"),
  ts = require("typescript");
const original = Module._load;
Module._load = function (name, parent, ...args) {
  if (name === "server-only") return {};
  return original.call(
    this,
    name.startsWith("@/") ? path.resolve(__dirname, "..", name.slice(2)) : name,
    parent,
    ...args,
  );
};
require.extensions[".ts"] = (m, file) =>
  m._compile(
    ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    file,
  );
const { classificarDadosMei } = require("../lib/mei-acompanhamento.ts");
const { processarVerificacaoMei } = require("../lib/mei-descoberta.ts");
const {
  tokenMeiWorker,
  autorizarMeiWorker,
} = require("../lib/mei-worker-auth.ts");
const cnpj = "11222333000181",
  dados = {
    cnpj,
    razaoSocial: "Exemplo",
    mei: true,
    abertura: "2024-01-02",
    inicioMei: "2024-02-01",
  };
test("classificação separa não MEI, desconhecido, incompleto, datas inválidas e elegível", () => {
  assert.equal(classificarDadosMei(dados, "2026-11-16").resultado, "elegivel");
  for (const d of [
    { mei: null },
    { abertura: null },
    { inicioMei: "2023-01-01" },
    { inicioMei: "2024-02-30" },
    { inicioMei: "2027-01-01" },
  ])
    assert.equal(
      classificarDadosMei({ ...dados, ...d }, "2026-11-16").resultado,
      "revisar",
    );
  assert.equal(
    classificarDadosMei({ ...dados, mei: false }, "2026-11-16").resultado,
    "nao_mei",
  );
});
function cliente(reserva, doc = cnpj) {
  const chamadas = [];
  return {
    chamadas,
    async rpc(nome, p) {
      chamadas.push({ nome, p });
      return {
        error: null,
        data:
          nome === "xml_mei_pegar_verificacao"
            ? { id: "item", token: "reserva", cnpj: doc }
            : nome === "xml_cnpja_reservar"
              ? reserva
              : nome === "xml_cnpja_finalizar"
                ? true
                : "finalizado",
      };
    },
  };
}
test("worker reaproveita cache válido sem chamar a API e finaliza com o token reservado", async () => {
  const db = cliente({
    status: "cache",
    dados,
    consultado_em: new Date().toISOString(),
  });
  await processarVerificacaoMei(db, () => {
    throw Error("rede não deve ser usada");
  });
  const final = db.chamadas.find(
    (c) => c.nome === "xml_mei_finalizar_verificacao",
  ).p;
  assert.equal(final.p_resultado, "elegivel");
  assert.equal(final.p_token, "reserva");
  assert.deepEqual(final.p_dados, dados);
});
test("worker respeita limite global e não transforma erro/cache antigo em confirmação", async () => {
  const db = cliente({ status: "aguardar", segundos: 29 });
  await processarVerificacaoMei(db);
  assert.equal(db.chamadas.at(-1).p.p_resultado, "aguardar");
  assert.equal(db.chamadas.at(-1).p.p_espera, 29);
  const stale = cliente({
    status: "consultar",
    token: "api",
    dados,
    consultado_em: "2020-01-01T00:00:00Z",
  });
  await processarVerificacaoMei(
    stale,
    async () => new Response("", { status: 503 }),
  );
  assert.equal(stale.chamadas.at(-1).p.p_resultado, "erro");
  assert.equal(stale.chamadas.at(-1).p.p_dados.mei, true);
});
test("CNPJ inválido vai à revisão sem consumir API; fila vazia prepara revisão periódica", async () => {
  const db = cliente({}, "00000000000000");
  await processarVerificacaoMei(db);
  assert.equal(db.chamadas.length, 2);
  assert.equal(db.chamadas.at(-1).p.p_resultado, "revisar");
  const chamadas = [];
  await processarVerificacaoMei({
    async rpc(n) {
      chamadas.push(n);
      return { data: null, error: null };
    },
  });
  assert.deepEqual(chamadas, [
    "xml_mei_pegar_verificacao",
    "xml_mei_revisar_ativos",
  ]);
});
test("token do serviço tem escopo próprio e não aceita chave administrativa, vazio ou token alterado", () => {
  const segredo = "chave-ficticia";
  const token = tokenMeiWorker(segredo);
  assert.equal(token.length, 64);
  assert.notEqual(token, segredo);
  assert.ok(autorizarMeiWorker(token, segredo));
  for (const t of [segredo, null, "", token.slice(1), token + "a"])
    assert.equal(autorizarMeiWorker(t, segredo), false);
  assert.equal(autorizarMeiWorker(token, ""), false);
});

test("rota recebe o mesmo cabeçalho do serviço Python e não aceita acesso sem credencial", async () => {
  const anterior = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "somente-teste";
  const carregar = Module._load;
  Module._load = function (name, parent, ...args) {
    if (name === "@/lib/supabase/admin")
      return {
        clienteAdmin: () => ({
          rpc: async () => ({ data: null, error: null }),
        }),
      };
    return carregar.call(this, name, parent, ...args);
  };
  let POST;
  try {
    ({ POST } = require("../app/api/robo/mei-cadastros/route.ts"));
  } finally {
    Module._load = carregar;
  }
  try {
    assert.equal(
      (await POST(new Request("https://example.test", { method: "POST" })))
        .status,
      401,
    );
    const r = await POST(
      new Request("https://example.test", {
        method: "POST",
        headers: { "x-mei-worker": tokenMeiWorker("somente-teste") },
      }),
    );
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { processado: false });
  } finally {
    if (anterior === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = anterior;
  }
});
