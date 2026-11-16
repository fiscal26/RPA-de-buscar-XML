# Verificação da interface

Depois de `npm ci`, execute `npm run test:interface`. A suíte usa o Chromium do sistema (quando existe em `/usr/bin/chromium`) ou o navegador instalado pelo Playwright (`npx playwright install chromium`). É possível indicar outro executável com `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

O teste cria uma cópia temporária do portal, ignora arquivos `.env` e `.vercel`, substitui a sessão apenas nessa cópia e usa empresas fictícias de `fixtures/interface-session.ts.txt`. Toda gravação é recusada. O código de autenticação entregue para produção continua sendo o original; não existe modo de demonstração ou acesso sem login no aplicativo.

São exercitados validação e recuperação de erros, seleção por teclado, certificados desativados, prévia NFS-e, busca e paginação, detalhes por toque, tema escuro, acessibilidade automática com axe, manifestação de instalação e alternativa sem Popover/Anchor Positioning. O convite de instalação é simulado: nenhum aplicativo é instalado pelo teste.

A suíte não consulta SEFAZ, Portal Nacional nem banco de produção. Os resultados automáticos não substituem uma auditoria manual completa com leitores de tela.
