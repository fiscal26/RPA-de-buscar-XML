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
const { validarCadastroIndividual } = require("../lib/cadastro-individual.ts");
const { iePbValida } = require("../lib/documentos.ts");
function inscricao() {
  for (let n = 0; n < 10; n++)
    if (iePbValida("16123456" + n)) return "16123456" + n;
}
function formulario(dados = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries({
    origem: "nfse",
    cnpj: "11.222.333/0001-81",
    nome: "Prestadora Exemplo",
    tipos: ["nfse_emitidas", "nfse_pdf"],
    ...dados,
  }))
    for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}
module.exports = { formulario, inscricao };
test("cadastro individual normaliza CNPJ, IE, nome e serviços; aceita CPF rural e documento SEFAZ vazio", () => {
  const r = validarCadastroIndividual(formulario());
  assert.equal(r.dados.cnpj, "11222333000181");
  for (const cnpj of ["", "529.982.247-25"]) {
    const v = validarCadastroIndividual(
      formulario({
        origem: "sefaz",
        cnpj,
        ie: inscricao(),
        tipos: ["nfe_saida", "nfe_saida"],
      }),
    );
    assert.ok(v.dados);
    assert.deepEqual(v.dados.tipos, ["nfe_saida"]);
    assert.equal(v.dados.ie, inscricao());
  }
});
test("recusa origem, documentos, IE e serviços indevidos antes de salvar", () => {
  for (const dados of [
    { origem: "outra" },
    { cnpj: "00000000000000" },
    { cnpj: "52998224725" },
    { nome: "" },
    { nome: "a".repeat(61) },
    { tipos: [] },
    { tipos: ["nfse_pdf"] },
    { tipos: ["nfe_saida"] },
    { origem: "sefaz", ie: "111111111", tipos: ["nfe_saida"] },
    { origem: "sefaz", ie: inscricao(), tipos: ["nfse_emitidas"] },
    { codigo: "a".repeat(21) },
  ])
    assert.ok(
      validarCadastroIndividual(formulario(dados)).erro,
      JSON.stringify(dados),
    );
});

test("NFS-e encontra empresa recém-cadastrada depois de mil registros, sem duplicar origens", async () => {
  const { empresasComCnpj } = require("../lib/cadastro-nfse.ts");
  const inicial = {
    org_id: "a",
    cnpj: "11222333000181",
    nome: "Antiga",
    codigo: "1",
    tipos: ["nfse_emitidas"],
  };
  const ultima = { ...inicial, cnpj: "37335118000180", nome: "Nova" };
  const dados = {
    xml_nfse_empresas: Array.from({ length: 1001 }, () => inicial).concat(
      ultima,
    ),
    xml_empresas: [ultima],
  };
  const paginas = [];
  const db = {
    from(tabela) {
      const q = {
        select() {
          return q;
        },
        order() {
          return q;
        },
        async range(a, b) {
          paginas.push([tabela, a]);
          return { data: dados[tabela].slice(a, b + 1), error: null };
        },
      };
      return q;
    },
  };
  const empresas = await empresasComCnpj(db);
  assert.equal(empresas.length, 2);
  assert.ok(empresas.some((e) => e.cnpj === ultima.cnpj));
  assert.ok(paginas.some(([t, i]) => t === "xml_nfse_empresas" && i === 1000));
});
