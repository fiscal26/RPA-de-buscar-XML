# Revisão da integração ATF/MEI por escritório

Branch `integracao/atf-mei-por-escritorio`. Compare a entrega com a main
em `23c8d51`, que já inclui o PR #62 da NFS-e.
As garantias anteriores têm referência em `5f76f92`; os arquivos atuais do ATF
foram evoluídos para manter HTML, permissões, PDFs e os serviços recentes.

## Escopo e decisões

- A fila ATF passa a `xml_atf_reservar_lote`. Organização e identidade são obrigatórias
  antes da decifragem da senha; o processamento separa escritório, acesso e período
  e não junta IEs repetidas na mesma rodada.
- O sinal de vida renova as tarefas da rodada e as que aguardam mensagens.
  A tentativa antiga perde acesso ao progresso, ao resultado e à gravação
  do histórico MEI. Anexos atrasados de uma tentativa vencida ficam para
  conferência dentro do contexto da rodada.
- A migração é aditiva, transacional e mantém nomes/assinaturas da referência v2.
  Conserva os contratos anteriores e a fila NFS-e. A retomada de 90 minutos é
  limitada à origem ATF; o acompanhamento MEI pausado continua respeitado.
- As rodadas validam os metadados e a competência antes de abrir o ATF. Meses
  existentes em AAAA-MM são mantidos; novos usam MMAAAA; conflito de formatos é erro.
- A reserva persistente identifica a caixa pelo login normalizado. Enquanto A
  espera, B do mesmo login é bloqueada, inclusive em outro processo na mesma raiz.
  A leitura inicial exclui mensagens já existentes. A leitura final pode liberar
  a reserva quando a resposta fica resolvida; encerrar o processo não a apaga.
- A coleta distingue documentos, ausência explícita, outra consulta e conferência.
  ZIPs parciais/truncados, anexo ausente e respostas excedentes não viram “sem notas”.
  A consulta prévia em HTML e as regras atuais de permissão continuam no fluxo.
- A distribuição usa empresa e papel fiscal, separa ZIPs mistos e preserva originais
  em conferência quando necessário. Totais e PDFs usam somente os XMLs do alvo.
  A pasta do serviço pode continuar trazendo seu total; a renomeação valida também
  os caminhos dos PDFs internos antes de mover o diretório.
- `mei.py` valida o JSON, preserva meses mais recentes e gera a planilha do histórico.
  Falha na planilha mantém o arquivo anterior e informa a pendência; os dados salvos
  podem ser enviados e reconstruídos. Notas/cartão permanecem separados.
- A coleta enviada ao banco leva tarefa, organização e IE; o reenvio enumera somente
  históricos válidos do portal. Nenhum histórico sem contexto é distribuído por IE.
  As travas são liberadas antes da comunicação com o painel.
- O alerta imediato leva `org_id` no ATF e na NFS-e. O endpoint valida o identificador
  e passa o filtro ao serviço existente, mantendo chamadas antigas aceitas.
- Uma falha posterior no lote não reescreve tarefas já confirmadas pelo painel.
  A pausa não devolve indiscriminadamente as tarefas ATF. A reserva pode exigir
  conferência mesmo quando a fila considera uma tarefa antiga retomável.
- O modo local exige a identidade persistente já usada pelo teste NFS-e. Relatórios,
  diagnósticos, passos e anexos sem dono ficam no contexto/execução.
- Foram retirados os helpers antigos sem consumidores de gravação/distribuição ATF
  e de histórico/reenvio MEI. A resolução anterior de pastas permanece somente para
  o Monitor Fiscal, que terá sua própria integração.

## Roteiro para o Codex 2

1. Conferir o diff contra `23c8d51` e os recursos atuais da main; não substituir o
   ATF atual pelo arquivo inteiro da referência anterior.
2. Conferir tarefa sem UUID/IE válida antes da senha; mesmo nome, mesma IE em dois
   escritórios, IEs repetidas e períodos diferentes. Conferir arquivos, totais e
   resultado efetivamente enviado ao painel.
3. Reproduzir A pendente, B no mesmo login/IE/período, resposta atrasada sem data e
   com data dentro da tolerância, reinício e leitura final. A reserva deve sobreviver
   a falha/encerramento e impedir nova consulta ambígua na mesma raiz.
4. Conferir mensagens antigas, ZIP truncado/parcial, falta de anexo, resposta excedente,
   ausência explícita e HTML com zero. Validar resultado final, originais de conferência
   e presença/remoção do marcador; não aceitar anexo ilegível como ausência fiscal.
5. Conferir ZIP misto, cancelamento separado, NF-e/NFC-e/CT-e, PDFs por empresa/tipo,
   repetição e total da pasta. Conferir PDF já existente perto do limite do Windows:
   a renomeação deve falhar antes de mover um arquivo para um caminho inválido.
6. Conferir JSON MEI inválido, fuso, coleta equivalente/antiga, planilha aberta,
   reconstrução sem nova coleta, reenvio após falha de outro escritório e modo local.
   Um histórico válido anterior não deve ficar ilegível pela reserva maior dos PDFs.
7. Conferir falha no retorno ao painel, reexecução sem duplicar documentos/receita
   e falha na segunda tarefa sem reescrever a primeira já confirmada.
8. Conferir a migração sobre a base NFS-e e sobre contratos v2 anteriores; permissões,
   vínculos inválidos, escritório suspenso, MEI pausado, datas e fila NFS-e intacta
   entre chamadas. Os contratos anteriores devem continuar idênticos.
9. Conferir o filtro do alerta no endpoint, autenticação, chamadas antigas e necessidade
   de atualizar o site antes do robô. Não executar envios reais de e-mail na revisão.
10. Emitir pareceres separados para código, publicação e ativação, com gravidade,
    cenário, arquivo/linha, consequência e evidência para cada achado.

## Validação e limites

Na rodada da reserva por tentativa, passaram 193 testes Python sem Chrome,
121 testes Node, a checagem TypeScript e o build do portal com configuração fictícia. Passaram também
três cenários escolhidos com Chrome e ATF simulado, cobrindo downloads da
caixa, resposta atrasada e reaproveitamento do histórico MEI. Em Python,
os testes direcionados cobrem a rejeição de tentativa vencida, a preservação
dos anexos para conferência e a renovação enquanto a tarefa aguarda a caixa.

Na validação original de `4332d7e`, passaram **172 testes Python sem navegador** e **69 testes
Node/web/banco**, incluindo subcasos. Os **18 cenários distintos com Chrome**
ficaram aprovados: 16 passaram na rodada do módulo e três foram rechecados após
adaptar os testes da resposta atrasada e dos caminhos CT-e/MEI. A rechecagem
inclui um dos 16 casos para fortalecer a verificação de ausência de histórico.
Não se trata de uma única rodada integral de Chrome sem falhas intermediárias.

Na adaptação do simulador, a primeira aceleração de pausas também reduzia a espera
obrigatória da caixa; esse ajuste foi corrigido antes das evidências finais.
O caso atrasado agora controla quando o servidor fictício termina a resposta,
depois de comprovar a pendência e o bloqueio da segunda rodada. As regras de
produção não foram enfraquecidas para aprovar os testes.

Foi conferida a estrutura do código, ignorando formatação: `ler_docs_fiscais`,
`conferir_html`, `solicitar`, `emitir`, `_faturamento_mei`, `ler_xml`, `valor_total`
e `_destinos` preservam a lógica da main. `nfe.py`, `nfse.py` e `pdf_fiscal.py`
continuam sem alterações nesta etapa. O diff não tem erros de espaçamento.

As verificações usam dados fictícios, destinos temporários, banco PGlite descartável
e servidor ATF local. A checagem TypeScript passou após instalar as dependências
declaradas pelo `package-lock.json`, sem scripts de instalação e sem alterar os
arquivos de dependências. A investigação de retenções permanece separada.

Comandos, na raiz do checkout, com Python da `.venv` preparada. Nesta máquina a
rodada reutiliza o Python da cópia NFS-e aprovada; nenhuma configuração operacional
foi copiada. Use uma raiz temporária curta e exclusiva para o pytest:

```powershell
$python = '..\integracao-nfse\.venv\Scripts\python.exe' # intérprete usado nesta cópia
$base = Join-Path $env:TEMP ('at-' + [guid]::NewGuid().ToString('N').Substring(0, 6))
& $python -B -m pytest -q --tb=short -p no:cacheprovider --basetemp $base robo/tests --ignore=robo/tests/test_atf_simulado.py --ignore=robo/tests/test_gravador.py
$env:CHROME_TESTE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
$base = Join-Path $env:TEMP ('at-' + [guid]::NewGuid().ToString('N').Substring(0, 6))
& $python -B -m pytest -q --tb=short -p no:cacheprovider --basetemp $base robo/tests/test_atf_simulado.py
node --test web/tests/*-db.test.cjs web/tests/alertas-mei-robo.test.cjs
node web/node_modules/typescript/bin/tsc --noEmit --incremental false -p web/tsconfig.json
```

Gere um `$base` novo para cada rodada. Os cenários Chrome usam perfil descartável
sem interface; conservam os prazos de resposta, leitura da caixa e repetição. As
pausas aleatórias de interação são abreviadas no simulador. O histórico e o estado
fictício são preparados pelo próprio teste, sem depender da ordem dos casos.

Não houve push, merge, reinício de serviço ou aplicação de migração operacional.
Antes da ativação permanecem duas conexões PostgreSQL independentes, chamadas pelo
PostgREST, atualização do endpoint/site e das instalações Windows/VPS e mapeamento
Drive/Domínio. A reserva protege somente a mesma raiz; sincronização entre cópias
e consultas manuais exigem coordenação operacional.

Procedimento e comandos oficiais: `robo/ATF.md`. Monitor Fiscal e retirada dos
contratos antigos não integram esta entrega.
