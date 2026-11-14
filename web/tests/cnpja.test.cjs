const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'), ts=require('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {interpretarCnpj,buscarDadosCnpj,segundosDeEspera}=require('../lib/cnpja.ts');
const cnpj='37335118000180';
const resposta={taxId:cnpj,founded:'2020-06-05',updated:'2026-11-11T12:00:00Z',company:{name:'Exemplo',simples:{optant:true},simei:{optant:true,since:'2022-01-01'},members:[{name:'Não guardar'}]},status:{text:'Ativa'},emails:['não guardar']};
const dados=interpretarCnpj(resposta,cnpj);
function banco(reserva={status:'consultar',token:'reserva'}) {
  const finalizacoes=[];
  return {finalizacoes,reservar:async()=>reserva,finalizar:async(...args)=>{finalizacoes.push(args);return true;}};
}
test('abertura e início MEI distintos; não armazena contatos ou sócios',()=>{
  assert.equal(dados.abertura,'2020-06-05');assert.equal(dados.inicioMei,'2022-01-01');
  assert.equal(dados.mei,true);assert.equal('members' in dados,false);assert.equal('emails' in dados,false);
});
test('Simples não significa MEI e campo ausente não significa falso',()=>{
  assert.equal(interpretarCnpj({...resposta,company:{name:'Exemplo',simples:{optant:true}}},cnpj).mei,null);
  const nao=interpretarCnpj({...resposta,company:{name:'Exemplo',simei:{optant:false,since:'2022-01-01'}}},cnpj);
  assert.equal(nao.mei,false);assert.equal(nao.inicioMei,null);
});
test('recusa CNPJ diferente e ignora data inválida sem inventar início MEI',()=>{
  assert.throws(()=>interpretarCnpj({...resposta,taxId:'11222333000181'},cnpj));
  const r=interpretarCnpj({...resposta,founded:'2020-02-31',company:{name:'Exemplo',simei:{optant:true}}},cnpj);
  assert.equal(r.abertura,null);assert.equal(r.inicioMei,null);
});
test('consulta sem chave somente no endpoint público, com timeout e sem redirecionamento',async()=>{
  const db=banco();let chamadas=0;
  const r=await buscarDadosCnpj(cnpj,false,db,async(url,opcoes)=>{
    chamadas++;assert.equal(url,'https://open.cnpja.com/office/'+cnpj);
    assert.equal(opcoes.headers.Authorization,undefined);assert.equal(opcoes.redirect,'error');assert.ok(opcoes.signal);
    return new Response(JSON.stringify(resposta));
  });
  assert.equal(chamadas,1);assert.equal(r.dados.abertura,'2020-06-05');assert.equal(db.finalizacoes[0][2].cnpj,cnpj);
});
test('cache e reserva concorrente não fazem requisição externa',async()=>{
  const naoChamar=()=>{throw Error('não deveria consultar');};
  const r=await buscarDadosCnpj(cnpj,false,banco({status:'cache',dados,consultado_em:'2026-11-11T12:00:00Z'}),naoChamar);
  assert.equal(r.reutilizado,true);
  const aguardando=await buscarDadosCnpj(cnpj,false,banco({status:'aguardar',segundos:13}),naoChamar);
  assert.equal(aguardando.aguardar,13);
});
test('429 respeita Retry-After e mantém consulta anterior como desatualizada',async()=>{
  const db=banco({status:'consultar',token:'r',dados,consultado_em:'2026-10-01T12:00:00Z'});
  const r=await buscarDadosCnpj(cnpj,true,db,async()=>new Response('{}',{status:429,headers:{'Retry-After':'75'}}));
  assert.equal(db.finalizacoes[0][3],75);assert.equal(db.finalizacoes[0][2],null);assert.ok(r.aviso);assert.equal(r.dados,dados);
});
test('404, erro de rede e resposta inválida não viram não-MEI nem apagam cache',async()=>{
  for(const fetcher of [async()=>new Response('{}',{status:404}),async()=>{throw Error('rede');},async()=>new Response('HTML')]){
    const db=banco();const r=await buscarDadosCnpj(cnpj,false,db,fetcher);
    assert.ok(r.erro);assert.equal(r.dados,undefined);assert.equal(db.finalizacoes[0][2],null);
  }
});
test('retorno sem reserva válida não é apresentado como confirmado',async()=>{
  const db=banco();db.finalizar=async()=>false;
  const r=await buscarDadosCnpj(cnpj,false,db,async()=>new Response(JSON.stringify(resposta)));
  assert.ok(r.erro.includes('expirou'));assert.equal(r.dados,undefined);
});
test('CNPJ inválido não consome reserva e Retry-After aceita data HTTP com teto',async()=>{
  const r=await buscarDadosCnpj('00000000000000',false,{reservar:()=>{throw Error('não chamar');}},fetch);
  assert.equal(r.erro,'CNPJ inválido.');assert.equal(segundosDeEspera('inválido'),60);
  assert.equal(segundosDeEspera('999999'),3600);
  assert.equal(segundosDeEspera('Thu, 12 Nov 2026 12:01:00 GMT',Date.parse('2026-11-12T12:00:00Z')),60);
});

test('ação do servidor exige gestor e empresa visível antes de acessar o cache compartilhado',async()=>{
  const Module=require('node:module'),path=require('node:path'),original=Module._load;
  let perfil={papel:'gestor',org_id:'org-a'},visivel=false,acessosAdmin=0;
  const sessao={contexto:async()=>({perfil,admin:false,supabase:{from:()=>{
    const q={select:()=>q,eq:()=>q,limit:async()=>({data:visivel?[{id:'empresa'}]:[],error:null})};return q;
  }}})};
  const admin={clienteAdmin:()=>{acessosAdmin++;return {rpc:async()=>({data:{status:'cache',dados},error:null})};}};
  Module._load=function(name,...args){
    if(name==='@/lib/sessao')return sessao;if(name==='@/lib/supabase/admin')return admin;
    if(name.startsWith('@/'))return original.call(this,path.join(__dirname,'..',name.slice(2)),...args);
    return original.call(this,name,...args);
  };
  let consultarCnpj;try{({consultarCnpj}=require('../app/painel/mei/consulta-cnpj.ts'));}finally{Module._load=original;}
  assert.ok((await consultarCnpj('outra-org',cnpj)).erro);
  perfil={papel:'usuario',org_id:'org-a'};assert.ok((await consultarCnpj('org-a',cnpj)).erro);
  perfil={papel:'gestor',org_id:'org-a'};assert.ok((await consultarCnpj('org-a',cnpj)).erro);
  assert.equal(acessosAdmin,0);
  visivel=true;assert.equal((await consultarCnpj('org-a',cnpj)).dados.cnpj,cnpj);assert.equal(acessosAdmin,1);
});
