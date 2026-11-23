const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');

const schema = fs.readFileSync(path.join(__dirname, '../supabase/schema.sql'), 'utf8').replace(/\r\n/g, '\n');
const migracao = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261116100000_nfse_por_contexto.sql'), 'utf8');
const migracaoReserva = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261123180000_reserva_tarefas_nfse.sql'), 'utf8').replace(/\r\n/g, '\n');
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const ids = (...ns) => ns.map(n => `'${id(n)}'`).join(',');
const cnpj = '11222333000262';
for (const bloco of [migracao, migracaoReserva]) {
  assert.ok(schema.includes(bloco.replace(/\r\n/g, '\n')));
}

test('NFS-e por contexto preserva contratos, recursos atuais e isolamento', async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  const rows = async (sql, params) => (await db.query(sql, params)).rows;
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as 'select null::uuid';`);
    await db.exec(schema.replace(migracaoReserva, ''));
    const contratos = `select oid::regprocedure::text as assinatura,pg_get_functiondef(oid) as definicao
      from pg_proc where pronamespace='public'::regnamespace and proname in
      ('xml_nfse_pegar_lote','xml_pegar_lote','xml_mei_registrar','xml_mei_registrar_ie') order by assinatura`;
    const anteriores = await rows(contratos);
    assert.equal(anteriores.length, 4);
    await db.exec(migracao);
    await db.exec(migracao);
    await db.exec(migracaoReserva);
    await db.exec(migracaoReserva);
    assert.deepEqual(await rows(contratos), anteriores);
    await db.exec("create view public.dependencia_ensaio as select id from public.xml_nfse_pegar_lote_v2('ensaio',1)");
    await assert.rejects(db.exec(migracao), erro => erro.code === '2BP01');
    await db.exec('rollback; drop view public.dependencia_ensaio');
    assert.deepEqual(await rows(contratos), anteriores);
    const [permissoes] = await rows(`select
      has_function_privilege('anon','public.xml_nfse_pegar_lote_v2(text,integer)','execute') as anon,
      has_function_privilege('authenticated','public.xml_nfse_pegar_lote_v2(text,integer)','execute') as web,
      has_function_privilege('service_role','public.xml_nfse_pegar_lote_v2(text,integer)','execute') as robo`);
    assert.deepEqual(permissoes, { anon: false, web: false, robo: true });
    for (const assinatura of ['xml_nfse_reservar_lote(text,integer)', 'xml_atualizar_tarefa_reservada(uuid,uuid,jsonb)']) {
      const [p] = await rows(`select has_function_privilege('anon',$1,'execute') as anon,
        has_function_privilege('authenticated',$1,'execute') as web,
        has_function_privilege('service_role',$1,'execute') as robo`, [assinatura]);
      assert.deepEqual(p, permissoes);
    }

    await db.exec(`
      insert into public.organizacoes(id,nome,ativo) values
        (${ids(1)},'Mesmo escritório',true),(${ids(2)},'Mesmo escritório',true),(${ids(3)},'Suspenso',false);
      insert into public.xml_acessos(id,org_id,login,senha_cifrada) values (${ids(11,1)},'login','v1:falsa');
      insert into public.xml_empresas(id,org_id,ie,nome,acesso_id) values
        (${ids(21,1)},'160123453','Empresa',${ids(11)});
      insert into public.xml_nfse_empresas(id,org_id,cnpj,nome) values
        (${ids(31,1)},'${cnpj}','Filial'),(${ids(32,2)},'${cnpj}','Filial'),(${ids(33,3)},'${cnpj}','Suspensa');
      insert into public.xml_nfse_certificados(id,org_id,cnpj,pfx_cifrado,senha_cifrada,procurador) values
        (${ids(41,1)},'11222333000181','v2:matriz-a','v1:senha-a',false),
        (${ids(42,2)},'${cnpj}','v2:filial-b','v1:senha-b',false),
        (${ids(43,1)},'12345678909','v2:procurador-a','v1:senha-a',true),
        (${ids(44,2)},'45723174000110','v2:outro-b','v1:senha-b',false),
        (${ids(45,3)},'${cnpj}','v2:suspenso','v1:senha-c',false);
      insert into public.xml_agendamentos(id,org_id,competencia,executar_em,origem,certificado_id) values
        (${ids(51,1)},'2026-09-01',now()-interval '1 day','nfse',${ids(43)}),
        (${ids(52,2)},'2026-09-01',now()-interval '1 day','nfse',null),
        (${ids(53,3)},'2026-09-01',now()-interval '1 day','nfse',null),
        (${ids(54,1)},'2026-09-01',now()-interval '1 day','nfse',${ids(44)}),
        (${ids(55,1)},'2026-09-01',now()-interval '1 day','sefaz',null),
        (${ids(56,1)},'2026-10-01',now()-interval '1 day','nfse',${ids(41)});
      insert into public.xml_tarefas(id,org_id,agendamento_id,nfse_empresa_id,ie,tipos) values
        (${ids(61,1,51,31)},'${cnpj}',array['nfse_emitidas']),
        (${ids(62,2,52,32)},'${cnpj}',array['nfse_emitidas']),
        (${ids(63,3,53,33)},'${cnpj}',array['nfse_emitidas']),
        (${ids(64,1,52,31)},'${cnpj}',array['nfse_emitidas']),
        (${ids(65,1,51,32)},'${cnpj}',array['nfse_emitidas']),
        (${ids(66,1,51,31)},'11222333000181',array['nfse_emitidas']),
        (${ids(67,1,54,31)},'${cnpj}',array['nfse_emitidas']),
        (${ids(68,1,56,31)},'${cnpj}',array['nfse_emitidas']);
      insert into public.xml_tarefas(id,org_id,agendamento_id,empresa_id,ie,tipos,status,iniciado_em,robo) values
        (${ids(69,1,55,21)},'160123453',array['mei'],'processando',now()-interval '91 minutes','atf-antigo');
      update public.xml_tarefas set status='processando',iniciado_em=now()-interval '91 minutes',robo='nfse-antigo'
        where id=${ids(68)};
      insert into public.xml_mei_cadastros(org_id,cnpj,nome,ativo,inicio_atividade,inicio_mei) values
        (${ids(1)},'${cnpj}','Filial',true,'2026-01-01','2026-01-01'),
        (${ids(2)},'${cnpj}','Filial',false,'2026-01-01','2026-01-01');
    `);
    const atf = await rows(`select status,iniciado_em,robo from public.xml_tarefas where id=${ids(69)}`);
    await db.exec('set role service_role');
    const lote = await rows("select * from public.xml_nfse_reservar_lote('ensaio',20)");
    await db.exec('reset role');
    assert.deepEqual(lote.map(t => t.id).sort(), [id(61), id(62), id(68)].sort());
    assert.deepEqual(await rows(`select status,iniciado_em,robo from public.xml_tarefas where id=${ids(69)}`), atf);
    const a = lote.find(t => t.id === id(61)), b = lote.find(t => t.id === id(62));
    assert.equal(a.org_id, id(1));
    assert.equal(a.pfx_cifrado, 'v2:procurador-a');
    assert.equal(a.certificado_cnpj, '12345678909');
    assert.equal(a.procurador, true);
    assert.equal(a.mei, true);
    assert.equal(b.org_id, id(2));
    assert.equal(b.pfx_cifrado, 'v2:filial-b');
    assert.equal(b.mei_bloqueado, true);
    assert.equal(lote.find(t => t.id === id(68)).certificado_cnpj, '11222333000181');
    const estados = await rows(`select id,status from public.xml_tarefas where id in (${ids(63,64,65,66,67)}) order by id`);
    assert.deepEqual(estados.map(t => t.status), ['pendente','erro','erro','erro','certificado']);
    assert.equal((await rows("select * from public.xml_nfse_reservar_lote('outro',20)")).length, 0);

    const atualizar = async (tarefa, tentativa, campos) => (await rows(
      "select public.xml_atualizar_tarefa_reservada($1,$2,$3) as aceitou",
      [tarefa, tentativa, campos]))[0].aceitou;
    assert.ok(a.tentativa_id && b.tentativa_id && a.tentativa_id !== b.tentativa_id);

    await db.exec(`update public.xml_tarefas set reserva_ate = now() + interval '2 minutes',
      iniciado_em = now() - interval '91 minutes' where id = '${a.id}'`);
    const estado = async () => (await rows(
      'select status,iniciado_em,reserva_ate,tentativa_id,robo,mensagem from public.xml_tarefas where id=$1', [a.id]))[0];
    const antes = await estado();
    assert.equal(await atualizar(a.id, a.tentativa_id, { mensagem: 'Em andamento' }), true);
    const renovada = await estado();
    assert.deepEqual(renovada.iniciado_em, antes.iniciado_em);
    assert.ok(renovada.reserva_ate > antes.reserva_ate);
    assert.equal((await rows("select id from public.xml_nfse_reservar_lote('outro',1)")).length, 0);

    await db.exec(`update public.xml_tarefas set reserva_ate = now() - interval '1 second' where id = '${a.id}'`);
    assert.equal(await atualizar(a.id, a.tentativa_id, { mensagem: 'Expirada' }), false);
    const [nova] = await rows("select * from public.xml_nfse_reservar_lote('outro',1)");
    assert.equal(nova.id, a.id);
    assert.notEqual(nova.tentativa_id, a.tentativa_id);
    assert.equal(await atualizar(a.id, a.tentativa_id, { status: 'erro', mensagem: 'Conclusão atrasada' }), false);
    assert.equal(await atualizar(b.id, nova.tentativa_id, { status: 'erro' }), false);
    assert.equal((await estado()).robo, 'outro');
    assert.equal((await estado()).status, 'processando');
    await assert.rejects(atualizar(a.id, nova.tentativa_id, { org_id: b.org_id }), erro => erro.code === '22023');

    for (const [tarefa, valor] of [[nova,100],[b,200]]) {
      const detalhes = { mei_nfse: { meses: [{ competencia: '2026-09-01', valor, quantidade: 1 }] } };
      assert.equal(await atualizar(tarefa.id, tarefa.tentativa_id, { status: 'concluido', detalhes }), true);
      assert.equal(await atualizar(tarefa.id, tarefa.tentativa_id, { status: 'erro' }), false);
    }
    assert.equal((await estado()).tentativa_id, null);
    const totais = await rows(`select org_id,valor from public.xml_mei_nfse_meses where cnpj=$1 order by org_id`, [cnpj]);
    assert.deepEqual(totais.map(m => [m.org_id, Number(m.valor)]), [[id(1),100],[id(2),200]]);
    await db.exec(schema);
    assert.deepEqual(await rows(contratos), anteriores);
  } finally {
    await db.close();
  }
});
