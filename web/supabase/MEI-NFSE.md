# Ativação do Monitoramento MEI com NFS-e

Esta atualização envolve três componentes: banco, portal e robô. Um deploy da Vercel não aplica SQL ao Supabase nem atualiza o Python que roda no computador/servidor.

## Publicação

1. Antes do merge, executar `migrations/20261112_mei_nfse.sql` no SQL Editor do projeto Supabase deste portal. A migração é transacional e reaplicável. Não apaga tabelas nem valores existentes; cria cadastro por CNPJ, totais NFS-e e uma função de reprocessamento. O `schema.sql` completo também contém a atualização para instalações novas.
2. Publicar o portal pela branch aprovada. Sem a migração, o portal informa que o cadastro novo depende da atualização do banco; o monitoramento antigo continua disponível com aviso de leitura parcial. Alertas automáticos não são enviados a partir de leituras parciais.
3. Atualizar o código do robô para o mesmo commit aprovado e reiniciar o processo. Não trocar as chaves, certificados, arquivos de configuração ou cache. Um robô antigo continua baixando notas, mas não envia os novos totais NFS-e. Após a atualização, o resultado final da tarefa grava o faturamento no banco na mesma transação.

## Uso

- Em **Empresas → Cadastro de MEI**, escolher uma empresa com CNPJ já cadastrada, informar abertura e primeiro/último mês de enquadramento. Apenas gestor ou administrador pode editar. A empresa entra no monitoramento mesmo sem notas. A classificação de um XML apenas sugere conferir o cadastro, nunca confirma o enquadramento atual automaticamente.
- O cadastro vale por CNPJ **dentro do escritório**. SEFAZ e NFS-e são reunidas na mesma linha; URLs antigas por IE continuam resolvendo o MEI. Ajustes manuais anteriores e avisos já enviados sob a IE são preservados.
- Em **Monitoramento MEI → empresa → Atualizar faturamento**, escolher a competência e usar **Reprocessar competência**. A fila normal recebe as consultas das fontes cadastradas. Consulta já pendente/em execução é reaproveitada por fonte. Os links exibidos permitem acompanhar os agendamentos.
- O robô deve ter acesso ATF/certificado A1 aplicável à empresa. A confirmação de envio à fila não significa consulta concluída. Se uma fonte falhar, os últimos valores válidos ficam disponíveis; não se transforma falha em faturamento zero.
- Ao agendar uma empresa MEI no ATF (serviço Dossiê MEI ou cadastro manual ativo na competência), o banco cria um agendamento **Complemento NFS-e do MEI (ATF)** se houver meses sem consulta nacional entre janeiro e a competência solicitada. O cadastro NFS-e é criado por CNPJ quando necessário; tarefas equivalentes já na fila são reaproveitadas. O acesso depende de certificado A1 aplicável e, quando necessário, procuração; falta de acesso aparece como pendência no agendamento complementar.
- O robô lê os meses de `xml_mei_nfse_meses` dentro da organização antes de consultar NFS-e. Meses anteriores já registrados, inclusive zero, não são refeitos. Pastas locais não comprovam consulta no banco: totais de versões antigas são recuperados do cache atualizado mesmo quando os XML já foram baixados. A competência explicitamente agendada continua sendo atualizada para permitir correções/cancelamentos.
- Para ativar esse comportamento, aplicar `migrations/20261114234945_mei_nfse_historico_banco.sql` (ou o schema completo) e atualizar/reiniciar o robô. Vale para novos agendamentos ATF; agendamentos antigos não são recriados pela migração. Um robô antigo não usa o banco para decidir o histórico. Nenhum deploy da Vercel substitui esses dois passos.

## Totais e histórico

- NFS-e: soma dos valores dos serviços das notas **emitidas** da competência, sem canceladas e sem repetir chaves. Recebidas e valores líquidos após retenções não entram na receita de serviços.
- Reconsultar substitui o total daquele CNPJ/mês, inclusive se uma nota foi cancelada e o total passou a zero. Uma tarefa iniciada antes não sobrescreve uma consulta mais recente.
- A coluna de NFS-e é separada da fonte ATF. Se o ATF discriminar NFS-e, essa parcela é substituída pela nacional, evitando duplicidade. Quando só há resumo antigo sem discriminação, o total é provisório: utiliza o maior entre o resumo e a NFS-e, exibe **Conferir fontes** e suspende alertas até reprocessar o Dossiê MEI.
- A comparação com cartão e os limites já existentes são mantidos, agora sobre o total de notas mais serviços. Compras seguem ATF e ajustes manuais; NFS-e recebidas não são tratadas automaticamente como compras.
- **Sem consulta** difere de **consultado sem notas**. Compras sem fonte consultada aparecem como sem dados. Não há consulta fiscal externa para comprovar o enquadramento atual ou a data de abertura: o cadastro é informado pelo escritório.
- Para parar de acompanhar, pausar o cadastro. Para registrar desenquadramento mantendo anos anteriores visíveis, preencher o último mês. Pausar não apaga importações, ajustes ou alertas.

## Validação reproduzível

Na pasta `web`, depois de `npm ci`:

```text
npm run typecheck
npm run test:mei
npm run test:mei:db
npm run build
```

Os testes SQL usam PostgreSQL local em memória (PGlite), sem dados ou credenciais reais. Cobrem instalação e reaplicação da migração, RLS, papéis, período, fila das duas fontes, reaproveitamento de tarefas, substituição por zero, falhas e retorno atrasado.

Na raiz, com as dependências de `robo/requirements.txt` e `pytest` instaladas:

```text
python -m pytest robo/tests/test_nfse.py robo/tests/test_detalhes_finais.py -q
```

Antes de ativar em produção, conferir uma empresa exclusivamente prestadora e outra com comércio/serviços, reprocessar uma competência conhecida e comparar os totais com os XMLs e o Dossiê MEI. O preview da Vercel depende da migração para demonstrar o cadastro usando o Supabase conectado.
