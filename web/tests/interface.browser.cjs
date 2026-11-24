// Executa uma cópia temporária sem credenciais; MEI usa escritas apenas em memória fictícia.
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
  fs.writeFileSync(path.join(ambiente, "lib/supabase/admin.ts"), 'import { interfaceDb } from "../sessao"; export function clienteAdmin() { return interfaceDb; }');
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
  await teste('Visão geral mostra a operação e mantém tabela e navegação acessíveis em cinco larguras', async () => {
    await page.goto(`${url}/painel`);
    await page.getByRole('heading', { name: 'Visão geral', exact: true }).waitFor();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), 'Pular para o conteúdo');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'conteudo-painel');
    await page.getByRole('heading', { name: 'Robô de consultas Online', exact: true }).waitFor();
    assert.ok(await page.getByText('Última comunicação', { exact: false }).isVisible());
    const pendencias = page.getByRole('region', { name: 'Pendências', exact: true });
    assert.ok(await pendencias.getByText('Mercado Sol', { exact: true }).isVisible());
    assert.equal(await pendencias.getByRole('link', { name: 'Agendar de novo para Mercado Sol' }).getAttribute('href'), '/painel/agendar');
    const taxa = page.getByRole('region', { name: 'Indicadores de processamento' }).locator('.visao-taxa');
    assert.match(await taxa.innerText(), /159 de 160 finalizadas sem erro/);
    assert.match(await taxa.innerText(), /99%/);
    const tabela = page.getByRole('region', { name: 'Agendamentos recentes' });
    for (const [width, height] of [[1366,768], [1440,900], [1920,1080], [2560,1440], [390,844]]) {
      await page.setViewportSize({ width, height });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px`);
      const { y } = await tabela.boundingBox();
      if (width > 390) assert.ok(y < height, `A tabela começa abaixo da primeira dobra em ${width}px`);
    }
    assert.equal(await tabela.evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await tabela.getByRole('link', { name: /Ver execução de 10\/2026 · SEFAZ/ }).waitFor();
    await tabela.getByRole('link', { name: /Ver execução de 10\/2026 · NFS-e/ }).waitFor();
    const menu = page.getByRole('navigation', { name: 'Painel', exact: true });
    assert.ok(await menu.evaluate(el => el.scrollWidth <= el.clientWidth));
    await tabela.focus();
    await page.keyboard.press('End');
    assert.ok(await tabela.evaluate(el => el === document.activeElement));
    const passos = page.locator('.visao-configuracao');
    assert.equal(await passos.getAttribute('open'), null);
    await passos.locator('summary').press('Enter');
    assert.equal(await passos.getAttribute('open'), '');
    assert.ok(await passos.getByRole('link', { name: 'Cadastrar a equipe' }).isVisible());
    await acessivel(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
  });
  await teste('Conectividade distingue offline de ausência de sinal e segue as permissões do perfil', async () => {
    for (const [headers, estado] of [
      [{ 'x-interface-sinal': 'offline' }, 'Offline'],
      [{ 'x-interface-sinal': 'ausente' }, 'Sem comunicação'],
      [{ 'x-interface-papel': 'usuario' }, null],
    ]) {
      const sessao = await navegador.newContext({ extraHTTPHeaders: headers });
      try {
        const p = await sessao.newPage();
        await p.goto(`${url}/painel`);
        await p.getByRole('heading', { name: 'Visão geral', exact: true }).waitFor();
        if (estado) await p.getByRole('heading', { name: `Robô de consultas ${estado}`, exact: true }).waitFor();
        else assert.equal(await p.getByRole('heading', { name: /Robô de consultas/ }).count(), 0);
        if (estado === 'Offline') {
          await p.locator('.visao-configuracao summary').click();
          assert.equal(await p.getByRole('link', { name: 'Ligar o robô', exact: true }).locator('../..').locator('span').first().innerText(), 'Concluído');
        }
      } finally { await sessao.close(); }
    }
  });
  await teste('Gestão MEI verifica lote, permite desmarcar e confirma só a seleção, sem dados reais', async () => {
    await page.goto(`${url}/painel/mei/gerenciar`);
    await page.getByRole('button', {name:'Trazer MEIs cadastrados', exact:true}).click();
    await page.getByRole('progressbar',{name:'Verificação dos CNPJs'}).waitFor();
    const selecionar=page.getByRole('checkbox',{name:'Incluir Mercado Sol no monitoramento',exact:true});await selecionar.uncheck();
    assert.ok(await page.getByRole('button',{name:'Incluir 1 MEI selecionado'}).isEnabled());
    await acessivel(page);
    await page.getByRole('button',{name:'Incluir 1 MEI selecionado'}).click();
    await page.getByText(/Empresas incluídas: 1/).waitFor();
    const filtragem=page.getByRole('combobox',{name:'Acompanhamento',exact:true});await filtragem.selectOption('ativo');
    assert.equal(await page.locator('#empresas-mei article').count(),1);
    assert.ok((await page.locator('#empresas-mei article').innerText()).includes('Ateliê Ponto Fino'));
    await page.getByRole('button',{name:'Confirmar decisão'}).count();
    const empresa=page.locator('#empresas-mei article').first();await empresa.getByText('Alterar acompanhamento',{exact:true}).click();
    await empresa.getByRole('combobox',{name:'Decisão',exact:true}).selectOption('ignorar');
    await empresa.getByRole('textbox',{name:'Motivo (opcional)'}).fill('CNPJ incluído por engano');
    await empresa.getByRole('button',{name:'Confirmar decisão'}).click();
    await filtragem.selectOption('ignorado');await page.getByText('CNPJ incluído por engano',{exact:false}).first().waitFor();
    await page.reload();await page.getByRole('combobox',{name:'Acompanhamento',exact:true}).selectOption('ignorado');
    assert.equal(await page.locator('#empresas-mei article').count(),1);
    await page.setViewportSize({width:390,height:844});await acessivel(page);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:path.join(pasta,'mei-celular.png'),fullPage:true});
    await page.setViewportSize({width:1440,height:1000});
    await page.screenshot({path:path.join(pasta,'mei-computador.png'),fullPage:true});
    const capturas='/tmp/xml-mei-capturas';fs.mkdirSync(capturas,{recursive:true});for(const nome of ['mei-celular.png','mei-computador.png'])fs.copyFileSync(path.join(pasta,nome),path.join(capturas,nome));
  });
  await teste('Cadastro individual NFS-e salva sem certificado e chega à seleção para agendar', async()=>{
    await page.goto(`${url}/painel/empresas/nova`);
    const org=page.getByRole('combobox',{name:'Escritório',exact:true});await org.fill('Horizonte');await org.press('Enter');
    await page.getByRole('textbox',{name:'CNPJ',exact:true}).fill('37335118000180');
    await page.getByRole('textbox',{name:'CNPJ',exact:true}).blur();
    await page.waitForFunction(()=>document.querySelector('#empresa-nome')?.value==='Prestadora Sugerida');
    await page.getByRole('textbox',{name:'Nome da empresa',exact:true}).fill('Prestadora Cadastro Individual');
    await page.getByRole('button',{name:'Salvar empresa',exact:true}).click();
    await page.getByRole('heading',{name:'Empresa cadastrada',exact:true}).waitFor();
    await page.getByRole('link',{name:'Agendar consultas desta empresa'}).click();
    await page.getByRole('group',{name:'Empresas cadastradas',exact:true}).waitFor();
    assert.ok(await page.getByRole('checkbox',{name:/Prestadora Cadastro Individual/}).isChecked());
    await page.getByRole('button',{name:'Conferir empresas',exact:true}).click();await page.getByRole('heading',{name:'Confira as empresas escolhidas'}).waitFor();
    await page.goto(`${url}/painel/empresas`);await page.getByRole('searchbox',{name:'Buscar empresas'}).fill('Prestadora Cadastro Individual');
    await page.waitForFunction(()=>document.querySelectorAll('.empresas-tabela tbody tr').length===1);
    assert.equal(await page.locator('.empresas-tabela tbody tr').count(),1);
  });
  await teste('Cadastro SEFAZ reutiliza login, preserva campos após erro e agenda sem planilha no celular', async()=>{
    await page.goto(`${url}/painel/empresas/nova?origem=sefaz&org=org-1`);
    await page.setViewportSize({width:390,height:844});
    await page.getByRole('textbox',{name:'Nome da empresa',exact:true}).fill('Comercio Cadastro Individual');
    await page.getByRole('combobox',{name:'Login já cadastrado',exact:true}).click();await page.getByRole('option',{name:'contador.exemplo',exact:true}).click();
    await page.getByRole('textbox',{name:'Inscrição estadual da Paraíba'}).fill('161234569');
    await acessivel(page);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const telas='/workspace/capturas-cadastro-individual';fs.mkdirSync(telas,{recursive:true});
    await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(telas,'celular.png'),fullPage:true});
    await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(telas,'computador.png'),fullPage:true});await page.setViewportSize({width:390,height:844});
    await page.getByRole('checkbox',{name:'NF-e Entrada',exact:true}).uncheck();
    await page.getByRole('textbox',{name:'Inscrição estadual da Paraíba'}).fill('111111111');
    await page.getByRole('button',{name:'Salvar empresa',exact:true}).click();await page.getByRole('alert').waitFor();
    assert.equal(await page.getByRole('textbox',{name:'Nome da empresa',exact:true}).inputValue(),'Comercio Cadastro Individual');
    assert.equal(await page.getByRole('textbox',{name:'Inscrição estadual da Paraíba'}).inputValue(),'111111111');
    assert.equal(await page.locator('input[name=acesso_id]').inputValue(),'acesso-1');
    assert.equal(await page.getByRole('checkbox',{name:'NF-e Entrada',exact:true}).isChecked(),false);
    await page.getByRole('textbox',{name:'Inscrição estadual da Paraíba'}).fill('161234569');
    await page.getByRole('button',{name:'Salvar empresa',exact:true}).click();await page.getByRole('heading',{name:'Empresa cadastrada',exact:true}).waitFor();
    await page.getByRole('link',{name:'Agendar consultas desta empresa'}).click();
    await page.getByRole('button',{name:'Conferir empresas',exact:true}).click();await page.getByRole('heading',{name:'Confira as empresas escolhidas'}).waitFor();
    await page.getByRole('button',{name:'Confirmar agendamento',exact:true}).click();await page.getByRole('link',{name:/Acompanhar/}).first().waitFor();
    await page.setViewportSize({width:1440,height:1000});
  });
  await teste('Listas de empresas do agendamento mantêm nome e documento legíveis ao buscar e marcar', async () => {
    for (const [origem, grupo, busca] of [
      ['sefaz', 'Empresas SEFAZ cadastradas', 'Procurar empresa SEFAZ'],
      ['nfse', 'Empresas cadastradas', 'Procurar empresa'],
    ]) {
      await page.goto(`${url}/painel/agendar?origem=${origem}&fonte=cadastro&org=org-1`);
      const lista = page.getByRole('group', { name: grupo, exact: true });
      const buscar = page.getByRole('searchbox', { name: busca, exact: true });
      await buscar.fill('Restaurante Sabor da Terra');
      const empresa = lista.getByRole('checkbox', { name: /Restaurante Sabor da Terra/ });
      await empresa.waitFor();
      for (const width of [1329, 960, 390]) {
        await page.setViewportSize({ width, height: 900 });
        const medidas = await empresa.evaluate((checkbox) => {
          const linha = checkbox.closest('label');
          const nome = linha.querySelector('.nome-empresa').getBoundingClientRect();
          const documento = linha.querySelector('.doc').getBoundingClientRect();
          const limite = linha.getBoundingClientRect();
          return { largura: nome.width, separado: nome.right <= documento.left || nome.bottom <= documento.top,
            contido: documento.right <= limite.right && nome.right <= limite.right };
        });
        assert.ok(medidas.largura > 120 && medidas.separado && medidas.contido, `${origem}, ${width}px: ${JSON.stringify(medidas)}`);
      }
      await buscar.press('Tab');
      assert.ok(await empresa.evaluate((el) => el === document.activeElement));
      await empresa.press('Space');
      assert.ok(await empresa.isChecked());
      await buscar.fill('Mercado Sol');
      await lista.getByRole('checkbox', { name: /Mercado Sol/ }).waitFor();
      assert.equal(await lista.locator('input:checked').count(), 1);
      await acessivel(page);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  });
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
    await page.getByRole('button', { name: 'Conferir empresas', exact: true }).click();
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
  await teste('Totais do Monitor Fiscal acompanham o filtro e a tabela funciona no celular', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('searchbox', { name: 'Buscar empresa nesta execução' }).fill('');
    await page.waitForFunction(() => document.querySelectorAll('.grade-tarefas tbody tr').length === 25);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await acessivel(page);
    await page.goto(`${url}/painel/monitor`);
    assert.equal(await page.locator('.tabela-monitor tbody tr').count(), 25);
    const filtro = page.getByRole('searchbox', { name: 'Filtrar empresas monitoradas' });
    const total = (nome) => page.locator('.monitor-numeros .numero-cartao').filter({ hasText: nome }).locator('.valor');
    assert.equal(await total('Notas encontradas').innerText(), '99');
    await filtro.fill('Mercado Sol');
    await page.waitForFunction(() => document.querySelectorAll('.tabela-monitor tbody tr').length === 1);
    assert.equal(await total('Notas encontradas').innerText(), '5');
    assert.equal(await total('Notas no mês').innerText(), '3');
    assert.equal((await total('Compras no mês').innerText()).replace(/\s+/g, ' '), 'R$ 10.119,00');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await acessivel(page);
    await filtro.fill('Empresa Exemplo');
    await page.getByText('26 de 1001', { exact: true }).waitFor();
    assert.equal(await total('Notas encontradas').innerText(), '78');
    await page.getByRole('button', { name: 'Próxima', exact: true }).click();
    assert.equal(await page.locator('.tabela-monitor tbody tr').count(), 1);
    assert.equal(await total('Notas encontradas').innerText(), '78');
    await filtro.fill('Pesquisa sem resultado');
    await page.getByText('Nenhuma empresa encontrada.', { exact: false }).waitFor();
    assert.equal(await total('Notas encontradas').innerText(), '0');
    assert.equal(await total('Notas no mês').innerText(), '0');
    await filtro.fill('65.264.879/0001-74');
    await page.getByRole('link', { name: 'Notas de Empresa além do limite', exact: true }).waitFor();
    assert.equal(await total('Notas encontradas').innerText(), '1');
    assert.equal(await total('Notas no mês').innerText(), '1');
    assert.equal((await total('Compras no mês').innerText()).replace(/\s+/g, ' '), 'R$ 275,25');
    await filtro.fill('');
    await page.getByText('1001 de 1001', { exact: true }).waitFor();
    assert.equal(await total('Notas encontradas').innerText(), '99');
    await filtro.fill('Mercado Sol');
    await page.getByRole('link', { name: 'Notas de Mercado Sol', exact: true }).click();
    await page.getByRole('heading', { name: /Mercado Sol/ }).waitFor();
    await page.getByRole('region', { name: 'Notas fiscais encontradas', exact: true }).waitFor();
  });
  await teste('Reprocessamento MEI mostra as fontes cadastradas e as fontes que entraram na fila', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const [empresa, fontes] of [['MEI de serviços', 'NFS-e'], ['MEI de comércio', 'SEFAZ'], ['MEI misto', 'NFS-e e SEFAZ']]) {
      await page.goto(`${url}/painel/mei`);
      await page.getByText(empresa, { exact: true }).click();
      const fontesDoCadastro = page.getByText('Fontes do reprocessamento', { exact: false });
      assert.equal(await fontesDoCadastro.locator('strong').innerText(), fontes);
      await page.getByLabel('Mês inicial', { exact: true }).fill('2024-01');
      await page.getByLabel('Mês final', { exact: true }).fill('2024-01');
      await page.getByRole('button', { name: 'Reprocessar período' }).click();
      const fontesDaFila = page.getByText('Fontes na fila', { exact: false });
      assert.equal(await fontesDaFila.locator('strong').innerText(), fontes);
    }
  });
  await teste('Tema escuro é o padrão, tema claro persiste e o menu fecha com Escape', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('.perfil-botao').click();
    assert.equal(await page.getByText('Usar como aplicativo', { exact: true }).count(), 0);
    const tema = page.getByRole('button', { name: /Tema escuro/ });
    assert.equal(await tema.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('html').getAttribute('data-tema'), 'escuro');
    await tema.click();
    assert.equal(await page.locator('html').getAttribute('data-tema'), 'claro');
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('data-tema'), 'claro');
    await page.locator('.perfil-botao').click();
    await tema.click();
    assert.equal(await page.locator('html').getAttribute('data-tema'), 'escuro');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.perfil-botao').getAttribute('aria-expanded'), 'false');
    await acessivel(page);
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
