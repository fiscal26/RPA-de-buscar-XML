const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');

test('ATF agenda complemento NFS-e somente quando há lacunas no banco', async (t) => {
  const db = new PGlite({extensions:{pgcrypto}});
  const org='00000000-0000-4000-8000-000000000001', user='00000000-0000-4000-8000-000000000011';
  const cnpj='11222333000181';
  const q=async(sql,params=[]) => (await db.query(sql,params)).rows;
  try {
    await db.exec(`create schema auth; create table auth.users(id uuid primary key);
      create role anon; create role authenticated; create role service_role bypassrls;
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;`);
    await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/schema.sql'),'utf8'));
    const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261114234945_mei_nfse_historico_banco.sql'),'utf8');
    await db.exec(migration); // reaplicável
    await db.exec(`insert into auth.users values ('${user}');
      insert into organizacoes(id,nome) values ('${org}','Escritório');
      insert into perfis(id,org_id,nome,email,papel) values ('${user}','${org}','Gestor','a@example.test','gestor');
      insert into xml_empresas(org_id,ie,cnpj,nome,tipos) values ('${org}','161234567','${cnpj}','MEI',array['mei']);`);
    const agendar=async()=>{
      const [a]=await q(`insert into xml_agendamentos(org_id,criado_por,competencia,total,origem) values ($1,$2,'2026-03-01',1,'sefaz') returning id`,[org,user]);
      await q(`insert into xml_tarefas(org_id,agendamento_id,empresa_id,ie,nome,tipos)
        select org_id,$1,id,ie,nome,array['mei'] from xml_empresas where org_id=$2`,[a.id,org]);
    };
    const complementos=()=>q("select * from xml_agendamentos where origem='nfse'");
    await agendar();
    await t.test('primeiro MEI ATF sem cadastro NFS-e gera consulta emitidas',async()=>{
      assert.equal((await complementos()).length,1);
      const [n]=await q('select * from xml_nfse_empresas'); assert.equal(n.cnpj,cnpj);
      const [tarefa]=await q('select * from xml_tarefas where nfse_empresa_id=$1',[n.id]);
      assert.deepEqual(tarefa.tipos,['nfse_emitidas']);
      assert.equal(tarefa.status,'pendente');
    });
    await agendar();
    await t.test('pedido simultâneo equivalente reaproveita fila',async()=>assert.equal((await complementos()).length,1));
    await t.test('sem certificado não inventa receita zero',async()=>{
      await q("select * from xml_nfse_pegar_lote('teste',10)");
      assert.equal((await q('select * from xml_mei_nfse_meses')).length,0);
      assert.equal((await q('select status from xml_tarefas where nfse_empresa_id is not null'))[0].status,'certificado');
    });
    await db.exec(`insert into xml_mei_nfse_meses(org_id,cnpj,competencia,valor,quantidade,iniciado_em)
      values ('${org}','${cnpj}','2026-01-01',0,0,now()),('${org}','${cnpj}','2026-03-01',100,1,now());`);
    await agendar();
    await t.test('lacuna em fevereiro gera nova consulta mesmo com janeiro zero e março preenchido',async()=>assert.equal((await complementos()).length,2));
    await db.exec(`update xml_tarefas set status='erro' where nfse_empresa_id is not null;
      insert into xml_mei_nfse_meses(org_id,cnpj,competencia,valor,quantidade,iniciado_em) values ('${org}','${cnpj}','2026-02-01',0,0,now());`);
    await agendar();
    await t.test('ano coberto inclusive zeros não gera nova fila',async()=>assert.equal((await complementos()).length,2));
    await t.test('outro escritório não reaproveita os meses do primeiro e cadastro manual também ativa complemento',async()=>{
      const outro='00000000-0000-4000-8000-000000000002';
      await db.exec(`insert into organizacoes(id,nome) values ('${outro}','Outro');
        insert into xml_empresas(org_id,ie,cnpj,nome,tipos) values ('${outro}','161234567','${cnpj}','Outra',array['nfe_saida']);`);
      const [a]=await q(`insert into xml_agendamentos(org_id,criado_por,competencia,total,origem) values ($1,$2,'2026-03-01',1,'sefaz') returning id`,[outro,user]);
      const inserir=()=>q(`insert into xml_tarefas(org_id,agendamento_id,empresa_id,ie,nome,tipos)
        select org_id,$1,id,ie,nome,array['nfe_saida'] from xml_empresas where org_id=$2`,[a.id,outro]);
      await inserir();
      assert.equal((await complementos()).length,2); // sem marcação MEI não muda o agendamento
      await q(`insert into xml_mei_cadastros(org_id,cnpj,nome,inicio_atividade,inicio_mei)
        values ($1,$2,'Outra','2025-01-01','2025-01-01')`,[outro,cnpj]);
      await inserir();
      assert.equal((await complementos()).length,3);
      assert.equal((await q("select count(*)::int as n from xml_tarefas where org_id=$1 and nfse_empresa_id is not null",[outro]))[0].n,1);
    });
    await t.test('navegador não executa função de trigger diretamente',async()=>{
      await db.exec('set role authenticated');
      await assert.rejects(db.query('select xml_mei_agendar_nfse_atf()'),/permission denied/);
      await db.exec('reset role');
    });
  } finally { await db.close(); }
});
