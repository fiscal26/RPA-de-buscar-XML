const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
test('cache público mínimo, privilégios e limite compartilhado',async(t)=>{
  const db=new PGlite();const a='37335118000180',b='11222333000181';
  const q=async(sql,params=[])=>(await db.query(sql,params)).rows[0];
  const reservar=async(cnpj,forcar=false)=>(await q('select xml_cnpja_reservar($1,$2) as r',[cnpj,forcar])).r;
  const finalizar=async(doc,token,dados=null,bloqueio=0)=>(await q('select xml_cnpja_finalizar($1,$2,$3::jsonb,$4) as ok',[doc,token,dados?JSON.stringify(dados):null,bloqueio])).ok;
  try{
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    const pasta=path.join(__dirname,'../supabase/migrations');
    const migration=fs.readFileSync(path.join(pasta,fs.readdirSync(pasta).find(f=>f.endsWith('_cnpja_publica_cache_limite.sql'))),'utf8');
    await db.exec(migration);await db.exec(migration);
    await t.test('navegador e anon não leem o cache nem executam reservas',async()=>{
      const p=await q("select has_table_privilege('authenticated','xml_cnpja_cache','SELECT') as ler,has_function_privilege('anon','xml_cnpja_reservar(text,boolean)','EXECUTE') as anon,has_function_privilege('authenticated','xml_cnpja_finalizar(text,uuid,jsonb,integer)','EXECUTE') as gravar");
      assert.deepEqual(p,{ler:false,anon:false,gravar:false});
      assert.equal((await q("select relrowsecurity as rls from pg_class where relname='xml_cnpja_cache'")).rls,true);
    });
    const r=await reservar(a);
    await t.test('mesmo CNPJ e outras instâncias respeitam reserva e espaçamento',async()=>{
      assert.equal(r.status,'consultar');
      const repetida=await reservar(a),outra=await reservar(b);
      assert.equal(repetida.status,'aguardar');assert.ok(repetida.segundos>=24);
      assert.equal(outra.status,'aguardar');assert.ok(outra.segundos>=12);
    });
    const dados={cnpj:a,abertura:'2020-06-05',mei:false};await finalizar(a,r.token,dados);
    await t.test('cache por 7 dias e atualização forçada sem furar mínimo de 5 minutos',async()=>{
      assert.equal((await reservar(a)).status,'cache');assert.equal((await reservar(a,true)).status,'cache');
      await db.exec("update xml_cnpja_cache set consultado_em=now()-interval '6 minutes' where dados is not null; update xml_cnpja_controle set ultima_consulta=now()-interval '20 seconds'");
      assert.equal((await reservar(a)).status,'cache');
      const novo=await reservar(a,true);assert.equal(novo.status,'consultar');
      await finalizar(a,novo.token,null,60);
      assert.deepEqual((await reservar(a)).dados,dados);
      const outra=await reservar(b);assert.equal(outra.status,'aguardar');assert.ok(outra.segundos>=59);
    });
    await t.test('reserva expirada pode ser retomada e resposta velha não sobrescreve nova',async()=>{
      await db.exec("update xml_cnpja_controle set ultima_consulta=null,bloqueado_ate=null; update xml_cnpja_cache set consultado_em=now()-interval '8 days' where dados is not null");
      const velho=await reservar(a);
      await db.exec("update xml_cnpja_cache set reserva_ate=now()-interval '1 second'; update xml_cnpja_controle set ultima_consulta=now()-interval '20 seconds'");
      const novo=await reservar(a);
      assert.notEqual(velho.token,novo.token);
      assert.equal(await finalizar(a,velho.token,{cnpj:a,mei:true}),false);
      await finalizar(a,novo.token,{cnpj:a,mei:null});
      assert.equal((await reservar(a)).dados.mei,null);
    });
  }finally{await db.close();}
});
