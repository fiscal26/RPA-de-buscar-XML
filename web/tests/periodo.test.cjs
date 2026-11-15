const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, file);
const {erroPeriodo,competenciasPeriodo}=require('../lib/periodo.ts');
const agora=new Date('2026-11-15T00:00:00Z');
test('intervalo inclusivo atravessa dezembro e aceita um único mês',()=>{
 assert.deepEqual(competenciasPeriodo('2025-12','2026-02'),['2025-12','2026-01','2026-02']);
 assert.deepEqual(competenciasPeriodo('2026-02','2026-02'),['2026-02']);
 assert.equal(erroPeriodo('2026-01','2026-09','2023-01',agora),null);
});
test('recusa ordem invertida, mês inválido, futuro e começo anterior à fonte',()=>{
 for(const [inicio,fim] of [['2026-09','2026-01'],['2026-13','2026-13'],['',''],['2026-11','2026-12'],['2022-12','2023-01']])assert.ok(erroPeriodo(inicio,fim,'2023-01',agora));
});
test('mês corrente segue Brasília na virada UTC',()=>{
 assert.ok(erroPeriodo('2026-12','2026-12','2023-01',new Date('2026-12-01T01:00:00Z')));
 assert.equal(erroPeriodo('2026-12','2026-12','2023-01',new Date('2026-12-01T04:00:00Z')),null);
});
