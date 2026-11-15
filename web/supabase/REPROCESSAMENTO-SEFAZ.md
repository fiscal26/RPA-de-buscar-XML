# Reprocessamento de erros SEFAZ

Aplicar `migrations/20261115002947_sefaz_reprocessar_erros.sql` no Supabase (ou o `schema.sql` completo atualizado) e publicar a versão correspondente do portal. O robô usa sua fila atual; não há alteração de Python para esta funcionalidade. Ele precisa estar ligado e com acesso ao ATF no horário marcado.

Depois de todas as empresas do agendamento terminarem, 15 ou mais empresas cadastradas com serviços em erro geram uma tentativa automática às próximas 22h de Brasília. Se já forem 22h ou mais tarde, fica para o dia seguinte. Serviços concluídos, sem movimento e cancelados não são incluídos. CT-e remetente e destinatário são avaliados separadamente.

A página de detalhes mostra no cabeçalho um aviso com data/hora e link para o novo agendamento. Para menos de 15 empresas, mostra o botão **Reprocessar erros**, que cria uma tentativa imediata ao clicar. Quem já pode agendar no escritório também pode reprocessar; o banco confere sessão, perfil ativo e organização. Um reprocessamento existente substitui o botão pelo aviso.

Cada agendamento tem no máximo uma tentativa vinculada. Novas atualizações do robô e cliques repetidos reaproveitam essa tentativa. Uma tentativa não gera outra automaticamente; se continuar com erros, a equipe pode usar o botão no detalhe dela para tentar novamente. O histórico original é mantido.

O disparo é feito no banco, ao receber a finalização das tarefas. Não depende de manter o navegador aberto. A migração não agenda retrospectivamente erros antigos; o botão permite tratar agendamentos antigos concluídos.

Validação: `npm run test:sefaz:db`, `npm run test:mei:db` e `npm run typecheck` na pasta `web`. Os testes usam PostgreSQL local/PGlite, sem dados reais.
