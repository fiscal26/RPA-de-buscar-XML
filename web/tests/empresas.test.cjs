const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { agruparEmpresas } = require('../lib/empresas.ts');
const cadastro = { org_id: 'a', id: '1', origem: 'sefaz', nome: 'Empresa', cnpj: '11222333000181', mei: 'ativo', pendencia: false };

test('SEFAZ e NFS-e contam uma empresa por CNPJ, preservando ambos os cadastros', () => {
  const linhas = [cadastro, { ...cadastro, id: '2', origem: 'nfse', cnpj: '11.222.333/0001-81', pendencia: true }];
  const [empresa] = agruparEmpresas(linhas);
  assert.equal(agruparEmpresas(linhas).length, 1);
  assert.equal(empresa.cadastros.length, 2);
  assert.equal(empresa.pendencia, true);
  assert.equal(empresa.mei, 'ativo');
  assert.equal(linhas[0].pendencia, false);
});
test('cadastros repetidos da mesma origem não aumentam o total de empresas', () => {
  assert.equal(agruparEmpresas([cadastro, { ...cadastro, id: '2' }]).length, 1);
});
test('organizações distintas e documentos distintos permanecem separados', () => {
  assert.equal(agruparEmpresas([cadastro, { ...cadastro, org_id: 'b' }, { ...cadastro, cnpj: '99888777000166' }]).length, 3);
});
test('documentos ausentes não são agrupados como uma única empresa', () => {
  assert.equal(agruparEmpresas([{ ...cadastro, cnpj: '' }, { ...cadastro, id: '2', cnpj: '' }]).length, 2);
});
