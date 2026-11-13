const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { consolidarCarteira } = require('../lib/mei-carteira.ts');
const { analisarAno } = require('../lib/mei.ts');
const org = 'escritorio-a', cnpj = '11222333000181', ie = '161234567';
const cadastro = { org_id: org, cnpj, nome: 'Prestadora MEI', ativo: true, inicio_atividade: '2025-02-10', inicio_mei: '2025-02-01', fim_mei: null };
const vinculo = { org_id: org, ie, cnpj, nome: 'Comércio e serviços' };
const servico = { org_id: org, cnpj, competencia: '2026-03-01', valor: 1000, quantidade: 1, consultado_em: '2026-04-01T12:00:00Z' };
const atf = { org_id: org, ie, nome: vinculo.nome, competencia: '2026-03-01', saidas: 2000, entradas: 200,
  cartao: 0, simei: true, sem_movimento: false, inicio_atividade: null, itens: [{ tipo: 'NFEs', saidas: 2000 }] };
const grupo = { org, ie, nome: vinculo.nome, meses: [atf], ajustes: [] };

test('prestadora cadastrada aparece zerada, sem inventar consulta ou SIMEI comprovado', () => {
  const [m] = consolidarCarteira(2026, [], [], [cadastro], [], []);
  assert.equal(m.ie, cnpj); assert.equal(m.ano.faturamento.total, 0); assert.equal(m.ano.nivel, 'sem_dados');
  assert.equal(m.ano.simei, false); assert.equal(m.ano.meses[2].consultadoNfse, false);
});
test('zero consultado difere de ausência de consulta', () => {
  const [m] = consolidarCarteira(2026, [], [], [cadastro], [{ ...servico, valor: 0, quantidade: 0 }], []);
  assert.equal(m.ano.meses[2].consultadoNfse, true); assert.equal(m.ano.meses[2].semMovimento, true);
  assert.equal(m.ano.nivel, 'ok'); assert.equal(m.ano.meses[1].consultado, false);
});
test('SEFAZ e NFS-e se unem pelo CNPJ dentro do escritório', () => {
  const [m] = consolidarCarteira(2026, [grupo], [vinculo], [cadastro], [servico], []);
  assert.equal(m.ano.faturamento.total, 3000); assert.equal(m.ano.compras.total, 200);
  assert.equal(m.ano.nfse, 1000); assert.ok(m.aliases.includes(ie)); assert.ok(m.aliases.includes(cnpj));
});
test('nota de serviço já apresentada no ATF é substituída pelo total nacional', () => {
  const g = { ...grupo, meses: [{ ...atf, saidas: 3000, itens: [...atf.itens, { tipo: 'NFS-e', saidas: 1000 }] }] };
  const [m] = consolidarCarteira(2026, [g], [vinculo], [cadastro], [servico], []);
  assert.equal(m.ano.faturamento.total, 3000);
});
test('resumo sem discriminação pede conferência e não soma fontes cegamente', () => {
  const g = { ...grupo, meses: [{ ...atf, itens: [], origem: 'execucao' }] };
  const [m] = consolidarCarteira(2026, [g], [vinculo], [cadastro], [servico], []);
  assert.equal(m.ano.faturamento.total, 2000); assert.equal(m.ano.conferirFontes, true);
});
test('outros escritórios e empresas sem marcação não entram por uma importação', () => {
  const m = consolidarCarteira(2026, [], [], [cadastro], [{ ...servico, org_id: 'outro' }], []);
  assert.equal(m.length, 1); assert.equal(m[0].ano.nfse, 0);
  assert.equal(consolidarCarteira(2026, [], [], [], [servico], []).length, 0);
});
test('pausa e período de enquadramento são respeitados sem apagar histórico', () => {
  assert.equal(consolidarCarteira(2026, [grupo], [vinculo], [{ ...cadastro, ativo: false }], [servico], []).length, 0);
  const [m] = consolidarCarteira(2026, [], [], [{ ...cadastro, inicio_mei: '2026-04-01' }], [servico], []);
  assert.equal(m.ano.nfse, 0); assert.equal(m.ano.nivel, 'sem_dados');
  assert.equal(consolidarCarteira(2027, [], [], [{ ...cadastro, fim_mei: '2026-10-01' }], [], []).length, 0);
});
test('cartão é comparado ao total das notas, preservando ajustes por IE e CNPJ uma vez', () => {
  const ajuste = { id: '1', org_id: org, ie, competencia: '2026-03-01', tipo: 'receita', valor: 100 };
  const g = { ...grupo, meses: [{ ...atf, cartao: 5000 }], ajustes: [ajuste] };
  const [m] = consolidarCarteira(2026, [g], [vinculo], [cadastro], [servico], [ajuste,
    { ...ajuste, id: '2', ie: cnpj, valor: 200 }]);
  assert.equal(m.ano.faturamento.total, 5300); assert.equal(m.ano.receitaManual, 300);
});
test('abertura sem consulta preserva proporcionalidade e histórico legado permanece', () => {
  const [m] = consolidarCarteira(2026, [], [], [{ ...cadastro, inicio_atividade: '2026-07-20', inicio_mei: '2026-07-01' }], [], []);
  assert.equal(m.ano.faturamento.limite, 40500);
  const [antigo] = consolidarCarteira(2026, [grupo], [], [], [], []);
  assert.equal(antigo.ie, ie); assert.equal(antigo.ano.faturamento.total, 2000);
});
test('análise preserva o cálculo legado quando não há serviços', () => {
  assert.equal(analisarAno(2026, [atf], []).faturamento.total, 2000);
});

test('carteira com mais de mil empresas é carregada em páginas, inclusive o último mês', async () => {
  const Module = require('node:module'), original = Module._load;
  Module._load = function (name, ...args) {
    if (name === 'server-only') return {};
    if (name.startsWith('@/')) return original.call(this, require('node:path').join(__dirname, '..', name.slice(2)), ...args);
    return original.call(this, name, ...args);
  };
  let carregarMeis;
  try { ({ carregarMeis } = require('../lib/mei-dados.ts')); } finally { Module._load = original; }
  const empresas = Array.from({ length: 1200 }, (_, i) => ({ org_id: org, ie: String(200000000 + i), cnpj: '', nome: `Empresa ${i}`, tipos: ['mei'] }));
  const tabelas = { xml_empresas: empresas, xml_mei_meses: [{ ...atf, ie: empresas[1199].ie }], xml_mei_ajustes: [], xml_tarefas: [], xml_mei_cadastros: [], xml_mei_nfse_meses: [] };
  let paginas = 0;
  const supabase = { from: (tabela) => {
    const q = { select: () => q, gte: () => q, lte: () => q, order: () => q, contains: () => q,
      range: async (de, ate) => { paginas++; return { data: tabelas[tabela].slice(de, ate + 1), error: null }; } };
    return q;
  } };
  const { meis, erros } = await carregarMeis(supabase, 2026);
  assert.equal(erros.length, 0); assert.equal(meis.length, 1200); assert.ok(paginas >= 8);
  assert.equal(meis.find((m) => m.ie === empresas[1199].ie).ano.faturamento.total, 2000);
});
