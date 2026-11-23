const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');

const schema = fs.readFileSync(path.join(__dirname, '../supabase/schema.sql'), 'utf8');
const migracao = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261116110000_atf_mei_por_contexto.sql'), 'utf8');
const migracaoReserva = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261123181000_reserva_tarefas_atf.sql'), 'utf8');
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const ids = (...ns) => ns.map(n => `'${id(n)}'`).join(',');
const ie = '160123453';
const normalizar = texto => texto.replace(/\r\n/g, '\n');
for (const bloco of [migracao, migracaoReserva]) assert.ok(normalizar(schema).includes(normalizar(bloco)));

test('ATF/MEI por contexto preserva fila, períodos, decisões e contratos anteriores', async t => {
  const db = new PGlite({ extensions: { pgcrypto } });
  const rows = async (sql, params) => (await db.query(sql, params)).rows;
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as 'select null::uuid';`);
    const base = normalizar(schema).replace(normalizar(migracao), '').replace(normalizar(migracaoReserva), '');
    await db.exec(base);
    const contratos = `select oid::regprocedure::text as assinatura,pg_get_functiondef(oid) as definicao
      from pg_proc where pronamespace='public'::regnamespace and proname in
      ('xml_pegar_lote','xml_nfse_pegar_lote','xml_nfse_pegar_lote_v2','xml_mei_registrar','xml_mei_registrar_ie',
       'xml_mei_limpar_fila','xml_sefaz_reprocessar_erros') order by assinatura`;
    const anteriores = await rows(contratos);
    await db.exec(migracao);
    await db.exec(migracao);
    await db.exec(migracaoReserva);
    await db.exec(migracaoReserva);
    assert.deepEqual(await rows(contratos), anteriores);

    await t.test('somente service_role pode retirar tarefas e registrar MEI', async () => {
      for (const assinatura of ['xml_pegar_lote_v2(text,text,integer)',
        'xml_mei_registrar_v2(uuid,uuid,text,jsonb,date)', 'xml_mei_registrar_contexto(uuid,text,jsonb,date)',
        'xml_atf_reservar_lote(text,text,integer)', 'xml_renovar_reservas_atf(uuid[])',
        'xml_mei_registrar_tarefa_reservada(uuid,uuid,uuid,text,jsonb,date)']) {
        const [p] = await rows(`select has_function_privilege('anon',$1,'execute') as anon,
          has_function_privilege('authenticated',$1,'execute') as web,
          has_function_privilege('service_role',$1,'execute') as robo`, [assinatura]);
        assert.deepEqual(p, { anon: false, web: false, robo: true });
      }
    });

    await db.exec(`insert into public.organizacoes(id,nome,ativo) values
      (${ids(1)},'Mesmo nome',true),(${ids(2)},'Mesmo nome',true),(${ids(3)},'Suspenso',false);
      insert into public.xml_acessos(id,org_id,login,senha_cifrada) values
      (${ids(11,1)},'mesmo-login','v1:senha-a'),(${ids(12,2)},'mesmo-login','v1:senha-b'),(${ids(13,3)},'suspenso','v1:senha-c');
      insert into public.xml_empresas(id,org_id,ie,cnpj,nome,acesso_id,tipos) values
      (${ids(21,1)},'${ie}','11222333000181','Empresa A',${ids(11)},array['mei','nfe_saida']),
      (${ids(22,2)},'${ie}','11222333000181','Empresa B',${ids(12)},array['mei']),
      (${ids(23,3)},'${ie}','11222333000181','Empresa suspensa',${ids(13)},array['mei']),
      (${ids(24,1)},'160987652','45723174000110','Pausada',${ids(11)},array['mei','nfe_saida']),
      (${ids(25,2)},'000000019','','Acesso incompatível',${ids(11)},array['nfe_saida']);
      insert into public.xml_mei_acompanhamento(org_id,cnpj,estado) values
      (${ids(1)},'45723174000110','pausado');
      insert into public.xml_agendamentos(id,org_id,competencia,executar_em,origem) values
      (${ids(51,1)},'2026-09-01',now()-interval '2 days','sefaz'),
      (${ids(52,2)},'2026-09-01',now()-interval '1 day','sefaz'),
      (${ids(53,3)},'2026-09-01',now(),'sefaz'),
      (${ids(54,1)},'2026-09-01',now(),'nfse'),
      (${ids(55,1)},'2026-10-01',now(),'sefaz');
      insert into public.xml_nfse_empresas(id,org_id,cnpj,nome) values
      (${ids(31,1)},'11222333000181','NFS-e');
      insert into public.xml_tarefas(id,org_id,agendamento_id,empresa_id,ie,tipos) values
      (${ids(61,1,51,21)},'${ie}',array['mei','nfe_saida']),
      (${ids(62,2,52,22)},'${ie}',array['mei']),
      (${ids(63,3,53,23)},'${ie}',array['mei']),
      (${ids(64,1,52,21)},'${ie}',array['nfe_saida']),
      (${ids(65,1,51,22)},'${ie}',array['nfe_saida']),
      (${ids(66,1,51,21)},'000000019',array['nfe_saida']),
      (${ids(67,2,52,25)},'000000019',array['nfe_saida']),
      (${ids(68,1,55,21)},'${ie}',array['nfe_saida']),
      (${ids(70,1,51,24)},'160987652',array['mei']),
      (${ids(71,1,51,24)},'160987652',array['mei','nfe_saida']);
      insert into public.xml_tarefas(id,org_id,agendamento_id,nfse_empresa_id,ie,tipos,status,iniciado_em,robo) values
      (${ids(69,1,54,31)},'11222333000181',array['nfse_emitidas'],'processando',now()-interval '91 minutes','nfse');
      update public.xml_tarefas set status='processando',iniciado_em=now()-interval '91 minutes',robo='atf'
      where id=${ids(61)};`);

    const tentativas = new Map();
    const retirar = async (nome, limite) => {
      const lote = await rows("select * from public.xml_atf_reservar_lote($1,'',$2)", [nome, limite]);
      for (const tarefa of lote) tentativas.set(tarefa.id, tarefa.tentativa_id);
      return lote;
    };
    await t.test('lote mantém escritório, período exato, limite e retomada somente ATF', async () => {
      const nfse = await rows(`select status,iniciado_em,robo from public.xml_tarefas where id=${ids(69)}`);
      await db.exec('set role service_role');
      const a = await retirar('ensaio', 1);
      assert.equal(a.length, 1);
      assert.equal(a[0].id, id(61));
      assert.equal(a[0].org_id, id(1));
      assert.equal(a[0].senha_cifrada, 'v1:senha-a');
      assert.equal(a[0].data_inicio.toISOString().slice(0,10), '2026-09-01');
      assert.equal(a[0].data_fim.toISOString().slice(0,10), '2026-09-30');
      await db.exec("reset role");
      assert.deepEqual(await rows(`select status,iniciado_em,robo from public.xml_tarefas where id=${ids(69)}`), nfse);
      await db.exec("set role service_role");
      const segundo = await retirar('ensaio', 50);
      assert.deepEqual(segundo.map(x => x.id), [id(71)]);
      assert.deepEqual(segundo[0].tipos, ['nfe_saida']);
      const b = await retirar('ensaio', 50);
      assert.deepEqual(b.map(x => x.id), [id(62)]);
      assert.equal(b[0].org_id, id(2));
      assert.equal(b[0].senha_cifrada, 'v1:senha-b');
      const parcial = await retirar('ensaio', 50);
      assert.deepEqual(parcial.map(x => [x.id,x.data_inicio.toISOString().slice(0,10),x.data_fim.toISOString().slice(0,10)]), [[id(68),'2026-10-01','2026-10-31']]);
      assert.deepEqual(await retirar('ensaio', 50), []);
      await db.exec('reset role');
      const estados = await rows(`select id,status from public.xml_tarefas where id in (${ids(63,64,65,66,67,70)}) order by id`);
      assert.deepEqual(estados.map(x => x.status), ['pendente','erro','erro','erro','erro','cancelado']);
    });

    await t.test('MEI vincula tarefa, escritório e IE e não aceita coleta antiga como nova', async () => {
      const meses = (data, valor) => ({ '2026-09': { consultado_em: data, saidas: valor, entradas: 10,
        qtd_saidas: 1, qtd_entradas: 1, sem_movimento: false, simei: true, itens: [] } });
      const callback = async (tarefa,org,inscricao,data,valor,tentativa=tentativas.get(id(tarefa))) => (await rows(
        'select public.xml_mei_registrar_tarefa_reservada($1,$2,$3,$4,$5) as n',
        [id(tarefa),tentativa ?? null,id(org),inscricao,meses(data,valor)]))[0].n;
      await db.exec("set role service_role; set timezone='Asia/Tokyo'");
      assert.equal(await callback(61,1,ie,'2026-10-01T12:00:00-03:00',100), 1);
      assert.equal(await callback(62,2,ie,'2026-10-01T15:00:00Z',900), 1);
      const reenviar = async (data, valor) => (await rows('select public.xml_mei_registrar_contexto($1,$2,$3) as n',
        [id(1),ie,meses(data,valor)]))[0].n;
      assert.equal(await reenviar('2026-10-01T14:59:59Z',999), 0);
      assert.equal(await reenviar('2026-10-01T15:00:00Z',999), 0);
      assert.equal(await reenviar('2026-10-01T15:00:01Z',200), 1);
      await assert.rejects(callback(61,2,ie,'2026-10-01T15:00:02Z',999), { code:'22023' });
      await assert.rejects(callback(61,1,'000000019','2026-10-01T15:00:02Z',999), { code:'22023' });
      await assert.rejects(callback(68,1,ie,'2026-10-01T15:00:02Z',999), { code:'22023' });
      assert.equal(await callback(63,3,ie,'2026-10-01T15:00:02Z',999), null);
      await assert.rejects(reenviar('2026-10-01T15:00:02',999), { code:'22023' });
      await assert.rejects(reenviar('2026-13-01T15:00:02Z',999));
      await db.exec('reset role');
      assert.deepEqual(await rows('select org_id,nome,saidas::int from public.xml_mei_meses order by org_id'), [
        { org_id:id(1), nome:'Empresa A', saidas:200 }, { org_id:id(2), nome:'Empresa B', saidas:900 },
      ]);
      assert.deepEqual(await rows(contratos), anteriores);

      const antiga = tentativas.get(id(61));
      await db.exec(`update public.xml_tarefas set reserva_ate=now()+interval '1 minute'
        where id = ${ids(61)}`);
      const [antes] = await rows('select iniciado_em,reserva_ate from public.xml_tarefas where id=$1', [id(61)]);
      await db.query('select public.xml_renovar_reservas_atf($1::uuid[])', [[antiga]]);
      const [renovada] = await rows('select iniciado_em,reserva_ate from public.xml_tarefas where id=$1', [id(61)]);
      assert.deepEqual(antes.iniciado_em, renovada.iniciado_em);
      assert.ok(renovada.reserva_ate > antes.reserva_ate);
      await db.exec(`update public.xml_tarefas set reserva_ate=now()-interval '1 second'
        where id = ${ids(61)}`);
      await db.query('select public.xml_renovar_reservas_atf($1::uuid[])', [[antiga]]);
      assert.equal(await callback(61,1,ie,'2026-10-01T15:00:02Z',999,antiga), null);
      const [nova] = await retirar('retomada', 1);
      assert.equal(nova.id, id(61));
      assert.notEqual(nova.tentativa_id, antiga);
      assert.equal(await callback(61,1,ie,'2026-10-01T15:00:02Z',999,antiga), null);
      assert.equal(await callback(61,1,ie,'2026-10-01T15:00:03Z',300), 1);
    });
  } finally { await db.close(); }
});
