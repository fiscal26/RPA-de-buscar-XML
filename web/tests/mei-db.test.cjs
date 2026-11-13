const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');

test('migração MEI/NFS-e, isolamento, fila e substituição de competências', async (t) => {
  const db = new PGlite({ extensions: { pgcrypto } });
  const org = '00000000-0000-4000-8000-000000000001';
  const outro = '00000000-0000-4000-8000-000000000002';
  const user = '00000000-0000-4000-8000-000000000011';
  const cnpj = '11222333000181';
  const scalar = async (sql, params = []) => (await db.query(sql, params)).rows[0];
  try {
    await db.exec(`create schema auth; create table auth.users(id uuid primary key);
      create role anon; create role authenticated; create role service_role bypassrls;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
      grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
    const schema = fs.readFileSync(path.join(__dirname, '../supabase/schema.sql'), 'utf8');
    const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261112_mei_nfse.sql'), 'utf8');
    await db.exec(schema);
    await db.exec(migration); // reaplicação não pode apagar dados nem falhar
    await db.exec(`grant select on all tables in schema public to authenticated;
      insert into auth.users values ('${user}');
      insert into organizacoes(id,nome) values ('${org}','Escritório A'),('${outro}','Escritório B');
      insert into perfis(id,org_id,nome,email,papel) values ('${user}','${org}','Gestor','gestor@example.test','gestor');
      select set_config('test.uid','${user}',false);
      insert into xml_nfse_empresas(org_id,cnpj,nome,tipos) values ('${org}','${cnpj}','Prestadora',array['nfse_emitidas']);
      insert into xml_mei_cadastros(org_id,cnpj,nome,inicio_atividade,inicio_mei) values
        ('${org}','${cnpj}','Prestadora','2025-01-10','2025-01-01'),
        ('${outro}','${cnpj}','Outra','2025-01-10','2025-01-01');`);

    await t.test('RLS separa escritórios e não permite gravar pelo navegador', async () => {
      await db.exec('set role authenticated');
      assert.equal((await db.query('select * from xml_mei_cadastros')).rows.length, 1);
      await assert.rejects(db.exec(`update xml_mei_cadastros set ativo=false`));
      await assert.rejects(db.query('select xml_mei_reprocessar($1,$2,$3)', [outro,cnpj,'2026-03-01']));
      await db.exec('reset role');
    });
    await t.test('sem certificado não cria agendamento parcial', async () => {
      await assert.rejects(db.query('select xml_mei_reprocessar($1,$2,$3)', [org,cnpj,'2026-03-01']), /certificado/);
      assert.equal((await scalar('select count(*)::int as n from xml_agendamentos')).n, 0);
    });
    await db.exec(`insert into xml_nfse_certificados(org_id,cnpj,nome,pfx_cifrado,senha_cifrada,validade)
      values ('${org}','${cnpj}','A1','v2:teste','v1:teste',now()+interval '1 year');`);
    const pedido = async () => (await scalar('select xml_mei_reprocessar($1,$2,$3) as r', [org,cnpj,'2026-03-01'])).r;
    const r = await pedido();
    const tarefa = (await scalar('select id from xml_tarefas where agendamento_id=$1',[r.agendamentos[0]])).id;
    await t.test('reprocessamento reaproveita tarefa ativa e a fila reconhece o cadastro manual', async () => {
      assert.equal((await pedido()).existente, true);
      assert.equal((await scalar('select count(*)::int as n from xml_agendamentos')).n, 1);
      const lote = await db.query("select * from xml_nfse_pegar_lote('teste',10)");
      assert.equal(lote.rows[0].mei, true);
    });
    const finalizar = (id, valor, quantidade = 1) => db.query(`update xml_tarefas set status='concluido', concluido_em=now(), detalhes=$2::jsonb where id=$1`,
      [id, JSON.stringify({mei_nfse:{meses:[{competencia:'2026-03-01',valor,quantidade}]}})]);
    await finalizar(tarefa, 1500);
    await t.test('upsert substitui, permite zero e nunca soma reexecuções', async () => {
      await finalizar(tarefa, 1200);
      assert.equal((await scalar('select valor::float as v from xml_mei_nfse_meses')).v,1200);
      await finalizar(tarefa,0,0);
      assert.equal((await scalar('select count(*)::int as n, sum(valor)::float as v from xml_mei_nfse_meses')).n,1);
      assert.equal((await scalar('select valor::float as v from xml_mei_nfse_meses')).v,0);
    });
    await t.test('falha não apaga último resultado e tarefa atrasada não sobrescreve nova', async () => {
      const novo = await pedido();
      const tid=(await scalar('select id from xml_tarefas where agendamento_id=$1',[novo.agendamentos[0]])).id;
      await db.query("update xml_tarefas set iniciado_em=now()+interval '1 minute' where id=$1",[tid]);
      await finalizar(tid,2500);
      await finalizar(tarefa,100);
      assert.equal((await scalar('select valor::float as v from xml_mei_nfse_meses')).v,2500);
      await db.query("update xml_tarefas set status='erro',detalhes='{}' where id=$1",[tid]);
      assert.equal((await scalar('select valor::float as v from xml_mei_nfse_meses')).v,2500);
    });
    await t.test('competência fora da tarefa é recusada atomicamente', async () => {
      const detalhes={mei_nfse:{meses:[{competencia:'2027-03-01',valor:9000,quantidade:1}]}};
      await assert.rejects(db.query("update xml_tarefas set detalhes=$2::jsonb where id=$1",[tarefa,JSON.stringify(detalhes)]));
      assert.equal((await scalar('select valor::float as v from xml_mei_nfse_meses')).v,2500);
    });
    await t.test('empresa mista recebe as duas fontes uma única vez, inclusive cadastro manual', async () => {
      await db.exec(`insert into xml_acessos(org_id,login,senha_cifrada) values ('${org}','contador','v1:teste');
        insert into xml_empresas(org_id,ie,cnpj,nome,acesso_id,tipos)
          select '${org}','161234567','${cnpj}','Mista',id,array['nfe_saida'] from xml_acessos where org_id='${org}';`);
      const r = await pedido();
      assert.equal(r.agendamentos.length,2); assert.equal(r.existente,false);
      const origens=(await db.query('select origem from xml_agendamentos where id=any($1::uuid[])',[r.agendamentos])).rows.map(x=>x.origem).sort();
      assert.deepEqual(origens,['nfse','sefaz']);
      const repetido = await pedido();
      assert.equal(repetido.existente,true); assert.equal(repetido.agendamentos.length,2);
    });
    await t.test('período cadastrado restringe o reprocessamento', async () => {
      await db.exec(`update xml_mei_cadastros set inicio_mei='2026-04-01' where org_id='${org}'`);
      await assert.rejects(pedido(), /nessa competência/);
      await db.exec(`update xml_mei_cadastros set inicio_mei='2025-01-01' where org_id='${org}'`);
    });
    await t.test('colaborador e usuário sem sessão não podem reprocessar', async () => {
      await db.exec(`update perfis set papel='usuario' where id='${user}'`);
      await assert.rejects(pedido(), /Somente gestor/);
      await db.exec("select set_config('test.uid','',false)");
      await assert.rejects(pedido(), /Somente gestor/);
    });
  } finally { await db.close(); }
});
