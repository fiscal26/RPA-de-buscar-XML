# Modernização da interface do LotiVisse XML

Proposta para revisão visual antes da aprovação e do merge. Base: `main` em `b981af0`.

## O que muda para o escritório

- Seletores de organização e certificado com busca, teclado, opção ativa identificada para leitores de tela e listas que se acomodam nas bordas da janela. Certificados desativados são ignorados pelas setas.
- Menus de perfil e notificações na camada nativa do navegador, com alternativa para navegadores antigos. Falhas de atualização dos avisos mostram uma mensagem e permitem tentar novamente.
- Tabelas operacionais com cabeçalhos fixos no computador e linhas em cartões em espaços estreitos, preservando a semântica e a rolagem por teclado.
- Grade de tarefas e Monitor Fiscal com busca e páginas de 25 empresas. As contagens e o progresso continuam considerando a execução inteira.
- Mensagens das tarefas abertas por clique, toque ou teclado. O detalhe expandido ocupa a largura do cartão no celular.
- Formulários interativos com resumo de campos inválidos, ligações para cada campo, estados de acessibilidade e mensagens após a interação. A prévia do agendamento recebe foco para a conferência.
- Progresso em `<progress>`, conclusão anunciada sem mover o foco e explicação de que uma tarefa processada pode ter terminado com erro.
- Atualização automática pausada com a aba escondida ou sem internet, com atualização ao retornar.
- Espaços de carregamento reservados, transições breves nos filtros/paginação e renderização adiada de seções inferiores da página pública. Preferência por menos movimento respeitada.
- Manifesto, ícones e atalhos para instalar o portal como aplicativo quando o navegador permitir. O convite depende de ação da pessoa. O portal continua exigindo internet e nenhum cache offline de documentos foi criado.

## Verificação

- `npm run build`: compilação de produção e verificação de tipos.
- `node --test tests/*.test.cjs`: 81 testes existentes de regras e banco local.
- `npm run test:interface`: suíte de navegador em uma cópia temporária, sem credenciais, com sessão e empresas fictícias e toda gravação recusada. Inclui teclado, validação, prévia NFS-e, busca, paginação, celular, tema escuro, axe, manifesto, convite de instalação simulado, recuperação de avisos e alternativa sem Popover/Anchor Positioning. Instruções em `web/tests/INTERFACE.md`.
- Capturas de antes/depois em 1440 × 1000 e 390 × 844 com os mesmos dados fictícios. A versão original foi preservada antes das alterações.

Os testes de interface não consultam a SEFAZ, o Portal Nacional ou o banco de produção. Não houve migração de banco nem alteração no robô. As verificações automáticas de acessibilidade não equivalem a uma auditoria manual completa com leitores de tela. Não há promessa de redução do tempo de resposta dos serviços fiscais.

## Modern Web Guidance

Consultei os guias publicados do projeto [Modern Web Guidance](https://github.com/GoogleChrome/modern-web-guidance-src), adaptados ao Next.js existente:

- **`viewport-aware-dropdowns`**: usei Popover e âncoras CSS com detecção de suporte e alternativa manual para a lista continuar utilizável ("layer that pattern's full semantics and keyboard contract on top"). O posicionamento não substitui a navegação e a semântica do combobox.
- **`responsive-table`**: mantive a tabela, os cabeçalhos e uma região acessível com foco ("maintaining the relationship between data cells and their headers"). Os rótulos de cada coluna acompanham a apresentação em cartões.
- **`validate-input-after-interaction` / `accessible-error-announcement`**: associei os erros apenas enquanto inválidos, preservando as dicas existentes ("Don't reference the error from aria-describedby in the markup"). O navegador mantém a validação e o foco no primeiro campo inválido.
- **`progress`**: usei o elemento nativo e uma região de status para a conclusão ("Announce completion without stealing focus"). As regras de pintura de Chrome/WebKit e Firefox permanecem separadas.
- **`same-document-transitions`**: usei transições somente em mudanças locais de listagem; sem API ou com movimento reduzido, a atualização é imediata ("DO respect user preferences for reduced motion").
- **`defer-rendering-heavy-content`**: limitei o adiamento a seções inferiores da apresentação pública e reservei tamanho ("MUST pair content-visibility: auto with contain-intrinsic-size"). O conteúdo inicial continua sendo renderizado normalmente.
- **`install-web-app`**: mantive identidade estável no manifesto, convite somente quando há suporte e instruções alternativas ("Installation is always completed through browser-controlled consent UI").

A revisão de React considerou os guias `vercel:react-best-practices` e `vercel:verification`: componentes sem dependências de interface adicionais em produção, efeitos com limpeza e verificações do fluxo completo de prévia em ambiente isolado.
