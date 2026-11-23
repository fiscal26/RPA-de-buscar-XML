const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');

test('períodos de agendamento e reprocessamento MEI são atômicos', async(t)=>{
 const db=new PGlite({extensions:{pgcrypto}});
 const org='00000000-0000-4000-8000-000000000001',outro='00000000-0000-4000-8000-000000000002',user='00000000-0000-4000-8000-000000000011',cnpj='11222333000181';
 const q=async(s,p=[]) => (await db.query(s,p)).rows;
 try {
 await db.exec(`create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated; create role service_role bypassrls;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
 await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/schema.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261115004207_agendamentos_periodo.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261120033220_mei_reprocessamento_complemento.sql'),'utf8'));
 await db.exec(`insert into auth.users values ('${user}'); insert into organizacoes(id,nome) values ('${org}','A'),('${outro}','B');
 insert into perfis(id,org_id,nome,email,papel) values ('${user}','${org}','Gestor','a@example.test','gestor');
 select set_config('test.uid','${user}',false);
 insert into xml_acessos(org_id,login,senha_cifrada) values ('${org}','contador','v1:teste');
 insert into xml_empresas(org_id,ie,cnpj,nome,acesso_id,tipos) select '${org}','161234567','${cnpj}','Empresa',id,array['nfe_saida'] from xml_acessos;
 insert into xml_nfse_empresas(org_id,cnpj,nome,tipos) values ('${org}','${cnpj}','Empresa',array['nfse_emitidas']);
 insert into xml_nfse_certificados(org_id,cnpj,nome,pfx_cifrado,senha_cifrada,validade) values ('${org}','${cnpj}','A1','v2:teste','v1:teste',now()+interval '1 year');`);
 const [e]=await q('select id from xml_empresas');const [n]=await q('select id from xml_nfse_empresas');const [c]=await q('select id from xml_nfse_certificados');
 const agendar=async(inicio,fim,origem='sefaz',empresa=e.id,escritorio=org)=> (await q('select xml_agendar_periodo($1,$2,$3,$4,now(),$5,$6,$7::jsonb,$8) as ids',[escritorio,user,inicio,fim,origem,'Planilha',JSON.stringify([{id:empresa,tipos:[origem==='sefaz'?'nfe_saida':'nfse_emitidas']}]),origem==='nfse'?c.id:null]))[0].ids;
 const total=async()=>Number((await q('select count(*) as n from xml_agendamentos'))[0].n);
 await t.test('intervalo inclusivo atravessa o ano e preserva competência por tarefa',async()=>{
 const ids=await agendar('2025-12-01','2026-02-01');assert.equal(ids.length,3);
 const meses=await q('select competencia::text as mes,total from xml_agendamentos where id=any($1::uuid[]) order by competencia',[ids]);
 assert.deepEqual(meses.map(x=>x.mes),['2025-12-01','2026-01-01','2026-02-01']);assert.ok(meses.every(x=>x.total===1));
 assert.equal((await q('select * from xml_tarefas where agendamento_id=any($1::uuid[])',[ids])).length,3);
 });
 await t.test('um único mês continua permitido e NFS-e mantém o certificado escolhido',async()=>{
 const ids=await agendar('2026-03-01','2026-03-01','nfse',n.id);assert.equal(ids.length,1);
 assert.equal((await q('select certificado_id from xml_agendamentos where id=$1',[ids[0]]))[0].certificado_id,c.id);
 });
 await t.test('ordem invertida, futuro, dia incorreto e empresa de outro escritório não criam lote parcial',async()=>{
 const antes=await total();
 for(const args of [['2026-03-01','2026-01-01'],['2099-01-01','2099-02-01'],['2026-01-15','2026-02-01'],['2026-01-01','2026-02-01','sefaz',e.id,outro]])await assert.rejects(agendar(...args));
 assert.equal(await total(),antes);
 });
 await t.test('falha na segunda competência desfaz também a primeira',async()=>{
 const antes=await total();
 await db.exec(`create function falhar_fevereiro() returns trigger language plpgsql as $$ begin if new.competencia='2026-02-01' then raise exception 'falha teste'; end if; return new; end $$;
 create trigger falha_periodo before insert on xml_agendamentos for each row execute function falhar_fevereiro();`);
 await assert.rejects(agendar('2026-01-01','2026-03-01'),/falha teste/);assert.equal(await total(),antes);
 await db.exec('drop trigger falha_periodo on xml_agendamentos; drop function falhar_fevereiro()');
 });
 await db.exec(`insert into xml_mei_cadastros(org_id,cnpj,nome,inicio_atividade,inicio_mei) values ('${org}','${cnpj}','MEI','2025-01-01','2025-01-01');`);
 const reprocessar=async(inicio,fim,escritorio=org)=>(await q('select xml_mei_reprocessar_periodo($1,$2,$3,$4) as r',[escritorio,cnpj,inicio,fim]))[0].r;
 await t.test('MEI cria as duas fontes por mês, reaproveitando as que já estão na fila',async()=>{
 await db.exec('set role authenticated');
 const r=await reprocessar('2026-04-01','2026-06-01');assert.equal(r.agendamentos.length,6);assert.equal(r.existente,false);assert.equal(r.consultas.length,6);assert.deepEqual([...new Set(r.consultas.map(c=>c.origem))].sort(),['nfse','sefaz']);
 const outra=await reprocessar('2026-04-01','2026-06-01');assert.equal(outra.existente,true);assert.deepEqual(outra.agendamentos,r.agendamentos);
 await db.exec('reset role');
 });
 await t.test('MEI cadastrado só na SEFAZ retorna o ID do complemento NFS-e gerado pelo trigger', async () => {
   const soSefaz = '65264879000174';
   const mes = '2026-06-01';
   await q(`insert into xml_empresas(org_id,ie,cnpj,nome,acesso_id,tipos)
     select $1,'162345678',$2,'MEI comércio',id,array['mei'] from xml_acessos where org_id=$1`, [org, soSefaz]);
   await q(`insert into xml_mei_cadastros(org_id,cnpj,nome,inicio_atividade,inicio_mei)
     values($1,$2,'MEI comércio','2025-01-01','2025-01-01')`, [org, soSefaz]);
   assert.deepEqual(await q('select id from xml_nfse_empresas where org_id=$1 and cnpj=$2', [org, soSefaz]), []);
   const enviar = async () => (await q('select xml_mei_reprocessar_periodo($1,$2,$3,$3) as r', [org, soSefaz, mes]))[0].r;

   await db.exec('set role authenticated');
   const r = await enviar();
   const repetido = await enviar();
   await db.exec('reset role');
   assert.equal(r.existente, false);
   assert.equal(repetido.existente, true);
   assert.deepEqual(repetido.consultas, r.consultas);
   assert.deepEqual(r.consultas.map(c => [c.competencia, c.origem]), [[mes, 'nfse'], [mes, 'sefaz']]);
   const [nfse] = await q('select nome_arquivo from xml_agendamentos where id=$1', [r.consultas[0].id]);
   assert.equal(nfse.nome_arquivo, 'Complemento NFS-e do MEI (ATF)');
   assert.ok(r.agendamentos.includes(r.consultas[0].id));
 });
 await t.test('MEI fora do enquadramento no último mês desfaz os anteriores',async()=>{
 await db.exec(`update xml_mei_cadastros set fim_mei='2025-12-01'`);const antes=await total();
 await assert.rejects(reprocessar('2025-10-01','2026-01-01'),/nessa competência/);assert.equal(await total(),antes);
 });
 await t.test('navegador não pode executar RPC interna nem reprocessar outro escritório',async()=>{
 await db.exec('set role authenticated');await assert.rejects(agendar('2026-01-01','2026-03-01'),/permission denied/);
 await assert.rejects(reprocessar('2026-01-01','2026-03-01',outro),/Somente gestor/);await db.exec('reset role');
 });
 } finally {await db.close();}
});
