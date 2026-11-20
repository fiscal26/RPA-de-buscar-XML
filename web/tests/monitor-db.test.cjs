const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");
const { pgcrypto } = require("@electric-sql/pglite/contrib/pgcrypto");

const mig = fs.readFileSync(path.join(__dirname, "../supabase/migrations/20261119143808_monitor_fiscal_resumo.sql"), "utf8");
const migFila = fs.readFileSync(path.join(__dirname, "../supabase/migrations/20261120033056_monitor_fiscal_fila_xml.sql"), "utf8");
const schema = fs.readFileSync(path.join(__dirname, "../supabase/schema.sql"), "utf8").split("-- Cadastro MEI por CNPJ, integração NFS-e e reprocessamento")[0];
const org = "00000000-0000-4000-8000-000000000001";
const outra = "00000000-0000-4000-8000-000000000002";
const gestor = "00000000-0000-4000-8000-000000000011";
const admin = "00000000-0000-4000-8000-000000000012";
const empresa = "11222333000181";
const auth = `create schema auth; create table auth.users(id uuid primary key);
  create role anon; create role authenticated; create role service_role bypassrls;
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
  grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`;

test("resumo do Monitor Fiscal cobre histórico, mês, valor, volume e isolamento por escritório", async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  const resumo = async () => (await db.query(`select xml_nfe_resumo_monitor('2026-11-01T03:00:00Z', '2026-12-01T03:00:00Z') as dados`)).rows[0].dados;
  try {
    await db.exec(auth);
    await db.exec(schema);
    await db.exec(mig);
    await db.exec(mig);
    await db.exec(`insert into auth.users values('${gestor}'),('${admin}');
      insert into organizacoes(id,nome) values('${org}','A'),('${outra}','B');
      insert into perfis(id,org_id,nome,email,papel) values
        ('${gestor}','${org}','Gestor','g@example.test','gestor'),('${admin}',null,'Admin','a@example.test','admin');
      grant select on xml_nfe_notas to authenticated;
      insert into xml_nfe_notas(org_id, chave, cnpj, valor, situacao, emissao)
        select '${org}', lpad(n::text,44,'0'), '${empresa}', 10.05, 'autorizada', '2026-11-01T03:00:00Z' from generate_series(1,1500) n;
      insert into xml_nfe_notas(org_id, chave, cnpj, valor, situacao, emissao) values
        ('${org}', lpad('1501',44,'0'), '${empresa}', 99, 'autorizada', '2026-11-01T02:59:59Z'),
        ('${org}', lpad('1502',44,'0'), '${empresa}', 99, 'cancelada', '2026-11-15T03:00:00Z'),
        ('${org}', lpad('1503',44,'0'), '${empresa}', 99, 'autorizada', '2026-12-01T03:00:00Z'),
        ('${outra}', lpad('1',44,'0'), '${empresa}', 99, 'autorizada', '2026-11-15T03:00:00Z');
      set role authenticated; select set_config('test.uid','${gestor}',false);`);
    assert.deepEqual(await resumo(), [{ org_id: org, cnpj: empresa, notasEncontradas: 1503, notasMes: 1500, comprasMes: 15075 }]);
    await db.query("select set_config('test.uid',$1,false)", [admin]);
    const dadosAdmin = await resumo();
    assert.equal(dadosAdmin.length, 2);
    assert.deepEqual(dadosAdmin.find((x) => x.org_id === outra), { org_id: outra, cnpj: empresa, notasEncontradas: 1, notasMes: 1, comprasMes: 99 });
    await db.exec("reset role; set role anon;");
    await assert.rejects(resumo, /permission denied for function/);
  } finally {
    await db.close();
  }
});

test("fila de XML exclui 632 e coloca as tentativas temporárias depois das chaves nunca consultadas", async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  const chave = (i) => String(i).padStart(44, '0');
  const pegar = async () => (await db.query("select id, pendentes from xml_nfe_pegar_monitor('teste', 1)")).rows[0];
  const concluir = (id, notas) => db.query("select xml_nfe_concluir($1, 0, 0, $2, 'ok', '')", [id, JSON.stringify(notas)]);
  try {
    await db.exec(auth);
    await db.exec(schema);
    await db.exec(migFila);
    await db.exec(migFila);
    await db.exec(`insert into organizacoes(id,nome) values('${org}','A');
      insert into xml_nfe_monitor(org_id,cnpj) values('${org}','${empresa}');
      insert into xml_nfse_certificados(org_id,cnpj,pfx_cifrado,senha_cifrada) values('${org}','${empresa}','v2:teste','v1:teste');
      insert into xml_nfe_notas(org_id, chave, cnpj, manifestada_em)
        select '${org}', lpad(n::text,44,'0'), '${empresa}', now() from generate_series(1,21) n;
      set role service_role;`);
    const primeira = await pegar();
    assert.deepEqual(primeira.pendentes.map((n) => n.chave), Array.from({length: 21}, (_, i) => chave(i + 1)));
    await concluir(primeira.id, primeira.pendentes.slice(0, 20).map((n, i) => ({ chave: n.chave, xml_consultado: true, xml_fora_prazo: i < 10 })));
    await concluir(primeira.id, [{ chave: chave(1), numero: '1' }]);
    await db.exec('reset role; update xml_nfe_monitor set proxima_consulta=now(); set role service_role;');

    const segunda = await pegar();
    assert.deepEqual(segunda.pendentes.map((n) => n.chave), [chave(21), ...Array.from({length: 10}, (_, i) => chave(i + 11))]);
    await concluir(segunda.id, [{ chave: chave(21), completa: true, xml_consultado: true }]);
    await db.exec('reset role;');
    const dados = (await db.query("select completa, xml_fora_prazo, xml_consultado_em is not null as tentou from xml_nfe_notas where chave=any($1) order by chave", [[chave(1), chave(21)]])).rows;
    assert.deepEqual(dados, [{ completa: false, xml_fora_prazo: true, tentou: true }, { completa: true, xml_fora_prazo: false, tentou: true }]);
  } finally {
    await db.close();
  }
});
