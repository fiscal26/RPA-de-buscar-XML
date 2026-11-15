const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const original = Module._load;
Module._load = function(name,parent,...args) {
  if (name==='server-only') return {};
  return original.call(this,name.startsWith('@/') ? path.resolve(__dirname,'..',name.slice(2)) : name,parent,...args);
};
require.extensions['.ts'] = (m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText,file);
const {lembretesCadastroMei,carregarLembretesCadastroMei}=require('../lib/mei-sugestoes.ts');
const cnpj='11222333000181',outra='99888777000166';
const d={org_id:'a',ie:cnpj,nome:'Nome antigo',concluido_em:'2026-11-15T01:00:00Z'};
const e={org_id:'a',cnpj,nome:'Empresa atual'};

test('possível MEI gera lembrete e link com empresa selecionada, sem duplicar execuções',()=>{
 const lista=lembretesCadastroMei([d,{...d,concluido_em:'2026-10-01T01:00:00Z'}],[],[e]);
 assert.equal(lista.length,1);assert.equal(lista[0].titulo,'Possível MEI: Empresa atual');
 assert.match(lista[0].texto,/cadastre a empresa no Monitoramento MEI/);
 assert.equal(new URL(lista[0].link,'https://example.test').searchParams.get('mei'),`a|${cnpj}`);
 assert.equal(lista[0].quando,d.concluido_em);
 assert.equal(lista[0].id,lembretesCadastroMei([{...d,concluido_em:'2026-12-01'}],[],[e])[0].id);
});
test('cadastro confirmado ou pausado remove o lembrete apenas no mesmo escritório',()=>{
 const deteccoes=[d,{...d,org_id:'b'}],empresas=[e,{...e,org_id:'b'}];
 for(const ativo of [true,false]) {
  const lista=lembretesCadastroMei(deteccoes,[{org_id:'a',cnpj,ativo}],empresas);
  assert.equal(lista.length,1);assert.match(lista[0].id,/b\|/);
 }
});
test('documento inválido ou empresa removida não gera lembrete impossível de cadastrar',()=>{
 assert.deepEqual(lembretesCadastroMei([d,{...d,ie:'161234567'}],[],[]),[]);
 assert.deepEqual(lembretesCadastroMei([{...d,ie:'161234567'}],[],[e]),[]);
});
function cliente(tabelas,erroTabela) {
 const chamadas=[];
 return {chamadas,from(tabela) {
  const q={select(){return q},contains(coluna,valor){chamadas.push({tabela,coluna,valor});return q},order(){return q},
   async range(de,ate){chamadas.push({tabela,de,ate});return {data:erroTabela===tabela?null:(tabelas[tabela]??[]).slice(de,ate+1),error:erroTabela===tabela?{message:'indisponível'}:null};}};return q;
 }};
}
test('consulta a mesma indicação do XML e lê além de 1000 resultados',async()=>{
 const deteccoes=Array.from({length:1001},()=>d).concat({...d,ie:outra});
 const client=cliente({xml_tarefas:deteccoes,xml_mei_cadastros:Array.from({length:1001},()=>({org_id:'a',cnpj})),xml_empresas:[e,{...e,cnpj:outra}],xml_nfse_empresas:[]});
 const lista=await carregarLembretesCadastroMei(client);
 assert.equal(lista.length,1);assert.ok(lista[0].id.endsWith(outra));
 assert.deepEqual(client.chamadas.find(c=>c.coluna==='detalhes').valor,{mei_nfse:{detectado_no_xml:true}});
 assert.ok(client.chamadas.some(c=>c.tabela==='xml_mei_cadastros'&&c.de===1000));
});
test('falha na leitura não inventa ausência de cadastro e não derruba outros avisos',async()=>{
 const dados={xml_tarefas:[d],xml_mei_cadastros:[],xml_empresas:[e],xml_nfse_empresas:[]};
 assert.deepEqual(await carregarLembretesCadastroMei(cliente(dados,'xml_mei_cadastros')),[]);
 assert.deepEqual(await carregarLembretesCadastroMei(cliente(dados,'xml_tarefas')),[]);
});

test('colaborador recebe orientação para o gestor, sem link para formulário restrito',()=>{
 const [aviso]=lembretesCadastroMei([d],[],[e],false);
 assert.match(aviso.texto,/Peça ao gestor/);assert.equal(aviso.link,'/painel/empresas');
});
