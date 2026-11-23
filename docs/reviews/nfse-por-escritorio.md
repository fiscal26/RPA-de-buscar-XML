# Revisão da integração NFS-e por escritório

Branch `integracao/nfse-por-escritorio`. A base atual é a main em `05d9307`,
que incorpora as correções do Monitor Fiscal e do reprocessamento MEI do PR #60.
Para revisar a integração completa, compare com `05d9307`. Para revisar a
proteção da retirada, compare com o merge local que incorporou a main à
correção NFS-e `b9d19db`, imediatamente antes do commit da reserva.

## Escopo e decisões

Esta etapa integra a NFS-e atual com armazenamento por escritório, preservando
procuração, filial, PDF alternativo, lote ABRASF e faturamento MEI. Os fluxos ATF/MEI
e Monitor Fiscal terão integração própria nas próximas etapas.

- A fila NFS-e usa `xml_nfse_reservar_lote`, com organização explícita,
  certificado selecionado, procurador, acompanhamento MEI e pausa. A migração da
  reserva acrescenta as funções e preserva os contratos anteriores. A migração
  de 16/11 substitui uma definição v2 de ensaio em transação e recusa a troca
  quando há dependência registrada.
- A tarefa pode ser retirada de novo após 90 minutos sem renovação. A nova
  retirada troca o identificador da tentativa. O banco valida esse identificador
  e o prazo ao receber progresso, renovação ou conclusão. Uma tentativa recusada
  deixa de publicar ao verificar a reserva e não dispara alerta de MEI.
- Os validadores fiscais são compartilhados por planilha e armazenamento em
  `documentos.py`, preservando os imports públicos e a lógica existente.
- Os documentos, o cache, `resumo_mei` e `eh_mei` usam a mesma identidade. O resultado
  da competência leva a fotografia do faturamento obtida sob a trava do cache.
- Competências existentes usam o caminho original. Novas pastas mensais usam MMAAAA.
  Duas representações do mesmo mês exigem conferência. O painel recebe o caminho relativo.
- XML e PDF individuais usam a chave de acesso completa, preservando os nomes já
  produzidos pelo armazenamento por contexto. O nome do lote mensal continua MMAAAA.
- A coleta interrompida pode ter avançado o cache. A planilha anterior é preservada
  quando a publicação falha e a próxima tentativa pode reconstruí-la do cache.
  Uma reconsulta que zera o mês atualiza o lote mensal e a planilha existente.
- O início exige confirmar o endereço efetivo do banco antes do reenvio automático.
  O modo local NFS-e exige identificador persistente. Os atalhos encaminham as opções.
- A inicialização deixa de devolver indiscriminadamente tarefas em andamento. A pausa
  mantém as NFS-e reservadas para conferência. O tratamento de interrupção do ATF e do
  Monitor continua sujeito às respectivas etapas. A fila SQL mantém a retomada de 90 minutos.
- As tarefas da NFS-e são coordenadas por fila, organização e CNPJ no processo, e a
  escrita também é protegida por trava de arquivo entre processos na mesma raiz.

## Roteiro para o Codex 2

1. Conferir identidade antes de abrir credenciais, retornos sem organização e leitura
   do histórico do banco com tarefa, organização e CNPJ compatíveis.
2. Conferir todos os leitores de cache, XML ausente/ilegível, índice inválido, falha de
   gravação, reexecução, cancelamento e falha no retorno do resultado ao banco.
3. Reproduzir duas organizações com mesmo CNPJ e nome, verificando documentos, total,
   planilha e dados enviados ao portal. Conferir dois processos na mesma identidade
   e a execução paralela de organizações diferentes.
4. Conferir procuração por CPF/CNPJ, filial, certificado escolhido, acompanhamento
   pausado, meses já consultados e zero confirmado, sem alterar fórmulas de retenções.
5. Conferir os caminhos existentes AAAA-MM e MMAAAA e a recusa de duplicidade. Avaliar
   a reserva de tamanho no Windows para arquivos, eventos, metadados e temporários.
6. Conferir a migração sobre um banco atual e sobre a definição v2 anterior. Verificar
   permissões, vínculos, escritório suspenso e que a fila NFS-e mantém intacta uma
   tarefa ATF antiga. Comparar o bloco final do schema com a migração.
7. Conferir comandos de início e teste local e a pausa dos trabalhadores. Examinar
   o comportamento diante de contrato indisponível e falha de comunicação.
8. Simular a renovação sem alterar `iniciado_em`, depois a expiração e a retirada
   por outro robô. Verificar que progresso e conclusão da tentativa anterior
   são recusados. Simular a perda da reserva enquanto a API responde e conferir
   cache, documentos finais e alertas.

Relatar defeitos por gravidade, com cenário, arquivo/linha, consequência e evidência.
Distinguir aceite do código, publicação quando autorizada e ativação operacional.

## Validação da reserva sobre o PR #60

Rodada local com 154 testes Python sem navegador e 115 testes Node, incluindo
banco simulado. Os ensaios cobrem renovação, expiração, conclusão atrasada,
permissões, preservação do faturamento por escritório e perda da reserva antes
da escrita. Ainda faltam duas sessões PostgreSQL independentes e chamadas ao
PostgREST em homologação. A correção da revisão limita a retomada pelo ATF
legado às tarefas SEFAZ e testa uma chamada ATF com uma reserva NFS-e renovada.
Quando a pasta está ocupada, a tentativa atual devolve a tarefa para nova retirada
após um minuto. Prepare a troca com os consumidores antigos de NFS-e pausados.

## Correção após a revisão de `2193e54`

O P1 identificado na revisão foi reproduzido nos dois sentidos: consultar apenas
recebidas esvaziava o lote de emitidas e consultar apenas emitidas esvaziava o de
recebidas. A publicação agora ignora a direção desmarcada, preservando seu lote.
Uma direção selecionada continua publicando um lote vazio quando o cancelamento
da última nota zera o mês. Não houve alteração no SQL ou nas regras de retenções.

As duas regressões de consulta parcial falharam antes da correção. Após o ajuste,
passaram os 46 casos de `test_nfse.py` e `test_nfse_contexto.py`, incluindo preservação
integral dos lotes desmarcados, quantidades retornadas, faturamento de R$ 11.000,00
e cancelamento que zera o lote nos dois sentidos. Os ensaios usam dados fictícios.

```powershell
.\.venv\Scripts\python.exe -B -m pytest -q --tb=short -p no:cacheprovider --basetemp $base robo/tests/test_nfse.py robo/tests/test_nfse_contexto.py
```

Para a nova revisão, comparar a correção com `2193e54` e conferir especialmente
essa distinção entre direção desmarcada e direção consultada sem notas. As
evidências anteriores da suíte completa e do banco permanecem registradas abaixo;
essas suítes não foram repetidas nesta correção localizada. A publicação continua
dependendo de revisão e autorização; os limites de ativação permanecem os mesmos.

## Validação e limites operacionais

Na rodada de implementação, passaram 137 testes Python sem navegador, 57 testes
de banco e, após a atualização da main, os seis testes de banco do cadastro individual.
As contagens incluem os subcasos reportados pelo Node.js. O ambiente usou Python 3.14.7,
pytest 9.2.0, PGlite 0.5.16 e as dependências atuais de `robo/requirements.txt`.
Também foram conferidos o JSON de exemplo, a sintaxe dos módulos, o atalho com
`--help`, as dependências instaladas e o diff. A análise de sintaxe confirmou que
`ler_nfse`, `relatorio_retencoes`, `lote_abrasf` e `danfse_do_xml` preservam a lógica da main.

Comandos utilizados, na raiz da cópia de implementação, com uma raiz temporária curta
e exclusiva para o pytest e PGlite disponível ao Node.js.

```powershell
.\.venv\Scripts\python.exe -B -m pytest -q --tb=short --basetemp $base robo/tests --ignore=robo/tests/test_atf_simulado.py --ignore=robo/tests/test_gravador.py
node --test web/tests/*-db.test.cjs
node --test web/tests/cadastro-individual-db.test.cjs
```

Os testes de Python usam certificados e respostas fictícios. Os testes de banco
usam PGlite descartável. Eles exercitam publicação de resultados pelo cliente do portal
e os gatilhos reais do schema, em ensaios separados. A disputa da fila com duas conexões
PostgreSQL independentes e as chamadas via PostgREST ainda exigem homologação.

Esta entrega não certifica configuração de VPS, acesso real aos portais, permissões
do Drive ou importação na Domínio. O serviço da VPS precisa receber o argumento
`--confirmar-banco` com a URL esperada antes de usar esta versão. Instalações antigas
continuam dependendo dos contratos e caminhos atuais da main.

Os arquivos operacionais e as investigações locais da pasta original do usuário ficam
fora da cópia de implementação. A investigação de retenções continua separada.
