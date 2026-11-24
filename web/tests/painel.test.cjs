const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const original = Module._resolveFilename;
Module._resolveFilename = function (name, ...args) {
  return original.call(this, name.startsWith('@/') ? path.resolve(__dirname, '..', name.slice(2)) : name, ...args);
};
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, file);
const { resumoPainel } = require('../lib/painel.ts');
const { chaveEmpresa } = require('../lib/empresas.ts');
const agendamentos = [{ id: 'n', origem: 'nfse' }, { id: 's', origem: 'sefaz' }];
const chave = chaveEmpresa({org_id:'a', cnpj:'11222333000181', origem:'sefaz', id:'1'});
const tarefa = {id:'s', empresaChave:chave, agendamento_id:'s', ie:'161234567', nome:'Empresa', status:'concluido', mensagem:'', tipos:['nfe_saida'], detalhes:{nfe_saida:{situacao:'concluido'}}, concluido_em:null};
const nfse = {...tarefa, id:'n', agendamento_id:'n', ie:'11222333000181', tipos:['nfse_emitidas'], detalhes:{nfse_emitidas:{situacao:'concluido'}}};

test('empresa com SEFAZ e NFS-e conta uma vez nos indicadores', () => {
  const r = resumoPainel([nfse, tarefa], agendamentos);
  assert.equal(r.empresasProcessadas, 1);
  assert.equal(r.empresasOk, 1);
  assert.equal(r.execucoes.length, 2);
});
test('sucesso mais recente em outra origem não esconde pendência SEFAZ', () => {
  const r = resumoPainel([nfse, {...tarefa,status:'senha_invalida'}], agendamentos);
  assert.equal(r.empresasProcessadas, 1);
  assert.equal(r.empresasOk, 0);
  assert.equal(r.acoes.length, 1);
});
test('origem ainda processando impede marcar a empresa como em dia', () => {
  const r = resumoPainel([{...nfse,status:'processando',detalhes:{}}, tarefa], agendamentos);
  assert.equal(r.empresasOk, 0);
  assert.ok(r.abertas > 0);
});
test('mesmo documento em organizações distintas continua independente', () => {
  const outra = chaveEmpresa({org_id:'b',cnpj:'11222333000181',origem:'nfse',id:'2'});
  const r = resumoPainel([nfse,{...tarefa,empresaChave:outra}], agendamentos);
  assert.equal(r.empresasProcessadas, 2);
});
test('a ação de agendar de novo abre a origem da pendência', () => {
  const r = resumoPainel([{...nfse, status:'fora_do_ar'}, {...tarefa, status:'fora_do_ar'}], agendamentos);
  assert.deepEqual(r.acoes.map((acao) => acao.link), ['/painel/agendar?origem=nfse', '/painel/agendar']);
});
