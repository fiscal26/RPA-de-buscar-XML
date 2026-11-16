// Executa o portal em uma cópia temporária, sem credenciais e sem permitir gravações.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { chromium } = require('@playwright/test');
const { AxeBuilder } = require('@axe-core/playwright');
const root = path.resolve(__dirname, '..');
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'xml-interface-'));
const ambiente = path.join(pasta, 'web');
let servidor, navegador;
const resultados = [];
const aguardar = (ms) => new Promise((r) => setTimeout(r, ms));
async function teste(nome, verificar) { await verificar(); resultados.push(nome); console.log(`✓ ${nome}`); }
async function portaLivre() {
  const s = net.createServer(); await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const porta = s.address().port; await new Promise((r) => s.close(r)); return porta;
}
async function acessivel(page) {
  const r = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  assert.deepEqual(r.violations.map((v) => ({ id: v.id, alvos: v.nodes.map((n) => n.target) })), []);
}
(async () => {
  fs.cpSync(root, ambiente, { recursive: true, filter: (file) => {
    const partes = path.relative(root, file).split(path.sep);
    return !partes.some((p) => ['node_modules', '.next', '.vercel', '.git'].includes(p) || p.startsWith('.env'));
  }});
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(ambiente, 'node_modules'), 'dir');
  fs.copyFileSync(path.join(__dirname, 'fixtures/interface-session.ts.txt'), path.join(ambiente, 'lib/sessao.ts'));
  fs.writeFileSync(path.join(ambiente, 'middleware.ts'), 'import { NextResponse } from "next/server"; export function middleware() { return NextResponse.next(); }');
  const porta = await portaLivre();
  const url = `http://127.0.0.1:${porta}`;
  const log = fs.openSync(path.join(pasta, 'servidor.log'), 'w');
  servidor = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', String(porta)], {
    cwd: ambiente, stdio: ['ignore', log, log], env: { PATH: process.env.PATH, NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1',
      NEXT_PUBLIC_SUPABASE_URL: 'https://exemplo.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'chave-ficticia', NEXT_PUBLIC_SITE_URL: url },
  });
  let pronto = false;
  for (let i = 0; i < 90; i++) {
    if (servidor.exitCode !== null) throw Error('O servidor local encerrou durante a inicialização.');
    try { if ((await fetch(`${url}/login`)).ok) { pronto = true; break; } } catch {}
    await aguardar(1000);
  }
  assert.ok(pronto, 'Servidor local não iniciou.');
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  navegador = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
  const contexto = await navegador.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'pt-BR', reducedMotion: 'reduce' });
  const page = await contexto.newPage();
  const erros = []; page.on('pageerror', (e) => erros.push(e.message));
  await teste('Formulário vazio identifica os campos, preserva o foco e remove o erro após a correção', async () => {
    await page.goto(`${url}/login`);
    assert.equal(await page.locator('.validacao-resumo').count(), 0);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await page.locator('.validacao-resumo').waitFor();
    assert.equal(await page.locator('#email').getAttribute('aria-invalid'), 'true');
    assert.equal(await page.locator('#email').getAttribute('aria-describedby'), 'email-erro');
    assert.equal(await page.locator('#email').evaluate((e) => e === document.activeElement), true);
    await page.locator('#email').fill('marina@example.invalid');
    assert.equal(await page.locator('#email').getAttribute('aria-invalid'), 'false');
    assert.equal(await page.locator('#email').getAttribute('aria-describedby'), null);
  });
  await teste('Organização pode ser buscada e escolhida por teclado; a escolha vai ao formulário', async () => {
    await page.goto(`${url}/painel/agendar?origem=nfse`);
    const org = page.getByRole('combobox', { name: 'Organização' });
    await org.fill('Horizonte'); await org.press('ArrowDown'); await org.press('Enter');
    assert.equal(await page.locator('input[name=org_id]').inputValue(), 'org-1');
    assert.equal(await org.inputValue(), 'Contabilidade Horizonte');
    await org.fill('Escritório 02');
    assert.equal(await page.locator('input[name=org_id]').inputValue(), '');
    await org.press('Enter');
    assert.equal(await page.locator('input[name=org_id]').inputValue(), 'org-2');
    await org.fill('Horizonte'); await org.press('Enter');
  });
  await teste('Certificado vencido é ignorado pelas setas e Escape devolve o foco', async () => {
    const cert = page.getByRole('combobox', { name: 'Certificado', exact: true });
    await cert.click();
    const lista = page.getByRole('listbox', { name: 'Certificado', exact: true }); await lista.waitFor();
    const caixa = await lista.boundingBox(); assert.ok(caixa.y >= 0 && caixa.y + caixa.height <= 1000);
    await cert.press('Home');
    for (let i = 0; i < 4; i++) await cert.press('ArrowDown');
    const ativo = await cert.getAttribute('aria-activedescendant');
    assert.equal(await page.locator(`[id="${ativo}"]`).getAttribute('aria-disabled'), null);
    assert.ok(!(await page.locator(`[id="${ativo}"]`).innerText()).includes('vencido'));
    await cert.press('Escape'); assert.equal(await cert.getAttribute('aria-expanded'), 'false');
    assert.ok(await cert.evaluate((el) => el === document.activeElement));
    await acessivel(page);
  });
  await teste('Prévia NFS-e lê o cadastro e leva o foco à conferência sem gravar agendamento', async () => {
    await page.getByRole('radiogroup', { name: 'Empresas', exact: true }).getByText('Escolher entre as cadastradas', { exact: true }).click();
    await page.locator('input[name=cnpjs]').first().check();
    await page.getByRole('button', { name: 'Ler planilha', exact: true }).click();
    await page.locator('.conferencia-planilha').waitFor();
    assert.ok(await page.locator('.conferencia-planilha').evaluate((e) => e === document.activeElement));
    assert.ok(await page.getByRole('button', { name: 'Confirmar agendamento' }).isVisible());
  });
  await teste('Grade pagina 62 empresas, busca, abre o detalhe e mantém progresso real', async () => {
    await page.goto(`${url}/painel/agendamentos/execucao-outubro`);
    await page.locator('.grade-listagem').waitFor();
    assert.equal(await page.locator('.grade-tarefas tbody tr').count(), 25);
    const progress = page.getByRole('progressbar', { name: 'Tarefas processadas' });
    assert.equal(await progress.getAttribute('max'), '248'); assert.equal(await progress.getAttribute('value'), '160');
    await page.getByRole('button', { name: 'Próxima', exact: true }).click();
    assert.ok((await page.locator('.listagem-rodape').innerText()).includes('26–50 de 62'));
    await page.getByRole('searchbox', { name: 'Buscar empresa nesta execução' }).fill('Mercado Sol');
    await page.waitForFunction(() => document.querySelectorAll('.grade-tarefas tbody tr').length === 1);
    const detalhe = page.locator('summary[aria-label^="NF-e Entrada: Erro"]');
    await detalhe.click(); assert.ok(await page.getByText(/O ATF não entregou o XML em Minhas Mensagens/).isVisible());
  });
  await teste('Tabelas funcionam no celular, sem transbordamento, e passam nos critérios automáticos de acessibilidade', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('searchbox', { name: 'Buscar empresa nesta execução' }).fill('');
    await page.waitForFunction(() => document.querySelectorAll('.grade-tarefas tbody tr').length === 25);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await acessivel(page);
    await page.goto(`${url}/painel/monitor`);
    assert.equal(await page.locator('.tabela-monitor tbody tr').count(), 25);
    await page.getByRole('searchbox', { name: 'Filtrar empresas monitoradas' }).fill('Mercado Sol');
    await page.waitForFunction(() => document.querySelectorAll('.tabela-monitor tbody tr').length === 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await acessivel(page);
  });
  await teste('Tema escuro mantém a leitura e o menu fecha com Escape', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('.perfil-botao').click();
    await page.getByRole('button', { name: /Tema escuro/ }).click();
    assert.equal(await page.locator('html').getAttribute('data-tema'), 'escuro');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.perfil-botao').getAttribute('aria-expanded'), 'false');
    await acessivel(page);
  });
  await teste('Manifesto e ícones oferecem instalação sem guardar dados fiscais offline', async () => {
    const resposta = await fetch(`${url}/manifest.webmanifest`); assert.equal(resposta.status, 200);
    const manifest = await resposta.json(); assert.equal(manifest.start_url, '/painel'); assert.equal(manifest.id, '/');
    for (const icon of manifest.icons) assert.equal((await fetch(url + icon.src)).status, 200);
    assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), 0);
  });
  await teste('Instalação só solicita consentimento após clique e aceita cancelamento', async () => {
    await page.evaluate(() => {
      window.__instalacoesTeste = 0;
      const evento = new Event('beforeinstallprompt', { cancelable: true });
      Object.defineProperty(evento, 'prompt', { value: async () => { window.__instalacoesTeste++; } });
      Object.defineProperty(evento, 'userChoice', { value: Promise.resolve({ outcome: 'dismissed' }) });
      window.dispatchEvent(evento);
    });
    await page.locator('.perfil-botao').click();
    await page.getByText('Usar como aplicativo', { exact: true }).click();
    assert.equal(await page.evaluate(() => window.__instalacoesTeste), 0);
    await page.getByRole('button', { name: 'Instalar LotiVisse', exact: true }).click();
    await page.getByText('Você pode continuar usando o portal pelo navegador.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__instalacoesTeste), 1);
    await page.keyboard.press('Escape');
  });
  await teste('Falha de notificações mostra erro e permite tentar novamente', async () => {
    await page.route('**/api/notificacoes', (route) => route.fulfill({ status: 503, body: '{}' }));
    await page.locator('.sino-botao').click();
    await page.getByText('Não foi possível atualizar os avisos.', { exact: true }).waitFor();
    await page.unroute('**/api/notificacoes');
    await page.route('**/api/notificacoes', (route) => route.fulfill({ contentType: 'application/json', body: '{"avisos":[]}' }));
    await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
    await page.getByText('Tudo em dia. Nenhum aviso agora.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Fechar notificações', exact: true }).click();
    await page.unroute('**/api/notificacoes');
  });
  await teste('Fallback sem Popover nem Anchor Positioning mantém seleção e fechamento', async () => {
    const antigo = await navegador.newContext({ viewport: { width: 390, height: 844 } });
    await antigo.addInitScript(() => {
      delete HTMLElement.prototype.popover;
      const supports = CSS.supports.bind(CSS); CSS.supports = (...args) => args.join(' ').includes('position-area') ? false : supports(...args);
    });
    const p = await antigo.newPage(); await p.goto(`${url}/painel/agendar?origem=nfse`);
    await p.waitForFunction(() => document.querySelector('#nfse-org')?.getAttribute('aria-invalid') === 'false');
    const org = p.getByRole('combobox', { name: 'Organização' }); await org.fill('Horizonte');
    await p.locator('[role=listbox][data-fallback=aberto]').waitFor(); await org.press('Enter');
    assert.equal(await p.locator('input[name=org_id]').inputValue(), 'org-1');
    await org.click(); await org.press('Escape'); assert.equal(await org.getAttribute('aria-expanded'), 'false');
    await antigo.close();
  });
  assert.deepEqual(erros, [], 'Erros de execução no navegador');
  console.log(`${resultados.length} verificações de interface aprovadas.`);
})().catch((e) => { console.error(e); console.error(`Diagnóstico local: ${pasta}/servidor.log`); process.exitCode = 1; }).finally(async () => {
  if (navegador) await navegador.close();
  if (servidor) { servidor.kill('SIGTERM'); await new Promise((r) => servidor.once('exit', r)); }
  if (!process.exitCode) fs.rmSync(pasta, { recursive: true, force: true });
});
