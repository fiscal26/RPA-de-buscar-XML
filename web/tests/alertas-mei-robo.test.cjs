const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function rota(pedidos) {
  const fonte = fs.readFileSync(path.join(__dirname, '../app/api/robo/alertas-mei/route.ts'), 'utf8');
  const codigo = ts.transpileModule(fonte, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const contexto = { exports: {}, Buffer, process: { env: { SUPABASE_SERVICE_ROLE_KEY:'segredo-ficticio' } },
    require(nome) {
      if (nome === 'node:crypto') return require(nome);
      if (nome === 'next/server') return { NextResponse: { json: (dados, opcoes) => ({ dados, status:opcoes?.status ?? 200 }) } };
      if (nome === '@/lib/alertas-mei') return { verificarAlertasMei: async filtro => {
        pedidos.push(JSON.parse(JSON.stringify(filtro)));
        return { verificados:1, enviados:0, erros:[] };
      } };
      throw new Error(`Import inesperado: ${nome}`);
    },
  };
  vm.runInNewContext(codigo, contexto);
  return (dados, chave='segredo-ficticio') => contexto.exports.POST({ headers: { get: () => chave }, json: async () => dados });
}

test('alerta do robô atualizado leva escritório explícito; chamada antiga continua aceita', async () => {
  const pedidos = [], post = rota(pedidos), org='7b245ed0-a8a0-4242-bcf0-24c8eb2895c6';
  assert.equal((await post({ ie:'16.012.345-3', org_id:org })).status, 200);
  assert.equal((await post({ ie:'160123453' })).status, 200);
  assert.deepEqual(pedidos, [{ ie:'160123453', org }, { ie:'160123453' }]);
});

test('alerta recusa identidade inválida e acesso sem segredo antes de conferir a carteira', async () => {
  const pedidos = [], post = rota(pedidos);
  for (const org_id of ['', null, 123, {}, 'nao-e-uuid']) {
    assert.equal((await post({ ie:'160123453', org_id })).status, 400);
  }
  assert.equal((await post({ ie:'160123453' }, 'errado')).status, 401);
  assert.equal((await post({ ie:'' })).status, 400);
  assert.deepEqual(pedidos, []);
});
