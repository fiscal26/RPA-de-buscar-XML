const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');

test('reprocessamento SEFAZ: limite, horário, serviços, permissões e repetição', async(t)=>{
  const db = new PGlite({extensions:{pgcrypto}});
  const org='00000000-0000-4000-8000-000000000001', outro='00000000-0000-4000-8000-000000000002', user='00000000-0000-4000-8000-000000000011';
  const q=async(s,p=[]) => (await db.query(s,p)).rows;
  try {
    await db.exec(`create schema auth; create table auth.users(id uuid primary key);
      create role anon; create role authenticated; create role service_role bypassrls;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
      grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
    await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/schema.sql'),'utf8'));
    await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261115002947_sefaz_reprocessar_erros.sql'),'utf8'));
    await db.exec(`insert into auth.users values ('${user}');
      insert into organizacoes(id,nome) values ('${org}','A'),('${outro}','B');
      insert into perfis(id,org_id,nome,email,papel) values ('${user}','${org}','Gestor','a@example.test','gestor');
      select set_config('test.uid','${user}',false);
      insert into xml_empresas(org_id,ie,nome,tipos) select '${org}',lpad(i::text,9,'0'),'Empresa '||i,array['nfe_saida','nfce'] from generate_series(1,16) i;`);
    const agendar=async(n,origem='sefaz',escritorio=org)=>{
      const [a]=await q(`insert into xml_agendamentos(org_id,criado_por,competencia,total,origem) values($1,$2,'2026-09-01',$3,$4) returning id`,[escritorio,user,n,origem]);
      await q(`insert into xml_tarefas(org_id,agendamento_id,empresa_id,ie,nome,tipos) select $2,$1,id,ie,nome,array['nfe_saida','nfce'] from xml_empresas order by ie limit $3`,[a.id,escritorio,n]);return a.id;
    };
    const filhos=id=>q('select * from xml_agendamentos where reprocessamento_de=$1',[id]);
    const falhar=async id=>q(`update xml_tarefas set status='erro',detalhes='{"nfe_saida":{"situacao":"concluido","arquivos":1},"nfce":{"situacao":"erro"}}' where agendamento_id=$1`,[id]);
    await t.test('22h em Brasília, inclusive virada de data e limite exato',async()=>{
      for(const [agora,esperado] of [['2026-11-15T00:30:00Z','2026-11-15T01:00:00Z'],['2026-11-15T01:00:00Z','2026-11-16T01:00:00Z'],['2026-11-15T03:00:00Z','2026-11-16T01:00:00Z']]) {
        const [r]=await q('select xml_proxima_22h($1)::text as hora',[agora]);
        assert.equal(Date.parse(r.hora),Date.parse(esperado));
      }
    });
    await t.test('CT-e parcial e serviços sem movimento preservam o que já terminou',async()=>{
      const [r]=await q(`select xml_tipos_com_erro('concluido',array['cte','nfce','nfe_saida'],$1::jsonb) as tipos`,
        [JSON.stringify({cte_rem:{situacao:'erro'},cte_dest:{situacao:'concluido'},nfce:{sem_notas:true},nfe_saida:{arquivos:3}})]);
      assert.deepEqual(r.tipos,['cte_rem']);
    });
    const pequeno=await agendar(14);
    await q("update xml_tarefas set status='erro' where agendamento_id=$1",[pequeno]);
    await t.test('14 empresas com erros não criam automático',async()=>assert.equal((await filhos(pequeno)).length,0));
    await falhar(pequeno);
    await t.test('gestor cria uma tentativa imediata apenas dos serviços com erro',async()=>{
      await db.exec('set role authenticated');
      const [r]=await q('select xml_reprocessar_erros_sefaz($1) as id',[pequeno]);
      const [repetido]=await q('select xml_reprocessar_erros_sefaz($1) as id',[pequeno]);assert.equal(r.id,repetido.id);
      await db.exec('reset role');
      const tarefas=await q('select tipos,status from xml_tarefas where agendamento_id=$1',[r.id]);
      assert.equal(tarefas.length,14); assert.deepEqual(tarefas[0].tipos,['nfce']);assert.equal(tarefas[0].status,'pendente');
      assert.equal((await filhos(pequeno))[0].reprocessamento_automatico,false);
    });
    const grande=await agendar(16);
    await q(`update xml_tarefas set status='erro' where id in (select id from xml_tarefas where agendamento_id=$1 limit 15)`,[grande]);
    await t.test('espera o restante terminar mesmo já tendo 15 erros',async()=>assert.equal((await filhos(grande)).length,0));
    await q(`update xml_tarefas set status='sem_notas' where agendamento_id=$1 and status='pendente'`,[grande]);
    await t.test('15 empresas criam automático às 22h sem repetir a empresa sem movimento',async()=>{
      const [a]=await filhos(grande);assert.equal(a.total,15);assert.equal(a.reprocessamento_automatico,true);
      assert.equal((await q('select executar_em=xml_proxima_22h(now()) as ok from xml_agendamentos where id=$1',[a.id]))[0].ok,true);
      assert.equal((await q('select count(*)::int as n from xml_tarefas where agendamento_id=$1',[a.id]))[0].n,15);
    });
    await t.test('novas atualizações e cliques manuais não duplicam o automático',async()=>{
      await q("update xml_tarefas set detalhes=detalhes where agendamento_id=$1",[grande]);
      const [r]=await q('select xml_reprocessar_erros_sefaz($1) as id',[grande]);assert.equal(r.id,(await filhos(grande))[0].id);
      assert.equal((await filhos(grande)).length,1);
    });
    await t.test('falhas na tentativa automática não criam ciclo noturno',async()=>{
      const [a]=await filhos(grande);await falhar(a.id);assert.equal((await filhos(a.id)).length,0);
    });
    await t.test('não agenda NFS-e automaticamente',async()=>{
      const a=await agendar(15,'nfse');await falhar(a);assert.equal((await filhos(a)).length,0);
    });
    await t.test('reaplicar migração preserva tentativas e histórico',async()=>{
      const antes=await filhos(grande);
      await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261115002947_sefaz_reprocessar_erros.sql'),'utf8'));
      assert.equal((await filhos(grande))[0].id,antes[0].id);
    });
    await t.test('outro escritório, perfil inativo e sessão ausente são recusados',async()=>{
      await db.exec('set role authenticated');
      await assert.rejects(q('select xml_criar_reprocessamento_sefaz($1,true)',[grande]),/permission denied/);
      await db.exec('reset role');
      const alheio=await agendar(1,'sefaz',outro);await falhar(alheio);
      await assert.rejects(q('select xml_reprocessar_erros_sefaz($1)',[alheio]),/Sem permissão/);
      await q("update perfis set papel='usuario' where id=$1",[user]);
      assert.equal((await q('select xml_reprocessar_erros_sefaz($1) as id',[pequeno]))[0].id,(await filhos(pequeno))[0].id);
      await q("update perfis set ativo=false where id=$1",[user]);
      await assert.rejects(q('select xml_reprocessar_erros_sefaz($1)',[pequeno]),/Sem permissão/);
      await db.exec("select set_config('test.uid','',false)");
      await assert.rejects(q('select xml_reprocessar_erros_sefaz($1)',[pequeno]),/Sem permissão/);
    });
  } finally {await db.close();}
});
