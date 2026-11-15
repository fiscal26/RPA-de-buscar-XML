# Períodos de competências

Os formulários de agendamento SEFAZ, agendamento NFS-e e atualização de faturamento MEI aceitam mês inicial e final, inclusive. Com o mesmo mês nos dois campos, a consulta continua sendo de uma competência. Cada mês gera agendamento próprio; os links de acompanhamento mostram mês e origem.

A preparação e a confirmação validam novamente o intervalo no servidor, com o mês corrente no horário de Brasília. São mantidos os limites das fontes: SEFAZ desde 2006, Portal Nacional NFS-e desde 2023 e reprocessamento MEI desde 2018. O período deve estar na ordem correta e não conter competências futuras.

Os agendamentos de um intervalo são criados em uma única transação. No Monitoramento MEI, cada competência mantém as regras de autorização, enquadramento e acesso fiscal existentes, reaproveitando tarefas já na fila. Se algum mês for inválido, o intervalo inteiro é recusado sem criar agendamentos parciais. Ajustes manuais e valores já importados não são apagados pelo envio à fila.

O preenchimento automático de histórico MEI ainda ausente continua seguindo as regras existentes; selecionar um período define as competências explicitamente reprocessadas.

Para ativar, aplicar `migrations/20261115004207_agendamentos_periodo.sql` após as migrações anteriores (ou o schema completo atualizado) e publicar o portal. Não há mudança no Python para este recurso; a fila continua processando uma competência por tarefa. O robô precisa estar ligado.

Validação local: `npm run test:periodo`, `npm run test:mei:db`, `npm run test:sefaz:db` e `npm run typecheck` na pasta `web`.
