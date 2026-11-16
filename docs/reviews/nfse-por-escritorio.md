# Revisão da integração NFS-e por escritório

Branch `integracao/nfse-por-escritorio`. Base do produto atualizada para `ae2eadc`,
incorporando o cadastro individual que entrou na main durante a implementação.
O plano vem de `c0a2b9e`, originalmente sobre `5256b9b`. Comparar a entrega com
`ae2eadc` e com as garantias de `5f76f92`.

## Escopo e decisões

Esta etapa integra a NFS-e atual com armazenamento por escritório, preservando
procuração, filial, PDF alternativo, lote ABRASF e faturamento MEI. Os fluxos ATF/MEI
e Monitor Fiscal terão integração própria nas próximas etapas.

- A fila usada pela NFS-e passa a `xml_nfse_pegar_lote_v2`, com organização explícita,
  certificado selecionado, procurador, acompanhamento MEI e pausa. A migração é aditiva
  em relação aos contratos atualmente usados por instalações anteriores. Uma definição
  v2 de ensaio é substituída em transação, com recusa se houver dependência registrada.
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

Relatar defeitos por gravidade, com cenário, arquivo/linha, consequência e evidência.
Distinguir aceite do código, publicação quando autorizada e ativação operacional.

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
