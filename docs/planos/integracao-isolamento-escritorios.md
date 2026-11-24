# Plano de integração do isolamento por escritório

Data: 16/11/2026. O plano e a correção NFS-e de `b9d19db` foram aprovados pelo usuário.
A entrega ATF/MEI está implementada e aguarda revisão, na branch
`integracao/atf-mei-por-escritorio`, partindo da NFS-e corrigida em `2af5bde`
e da main `05d9307`.
Monitor Fiscal e atualização operacional continuam pendentes. Nenhuma etapa foi ativada.

## Base e etapas

- Base confirmada com `git fetch origin main`: `origin/main` em `5256b9bee959d61cdaea81b18a32dd2dbe00e78d`.
- Referência das regras e regressões: `correcao/motor-por-contexto`, commit `5f76f92118bb823ed06629722b133dab08276594`, em `C:/Dev/RPA-de-buscar-XML`. Preservar esse checkout e suas alterações locais; elas não integram esta entrega.
- Branch atual: `integracao/plano-isolamento-escritorios`. A instrução atual do usuário substitui a orientação de `AGENTS.md` sobre usar uma branch geral com prefixo `codex/`.
- Integrar sobre a main atual por fluxo completo; não substituir os arquivos novos pelos antigos. Conferir as mudanças da main antes de cada rodada.

| Entrega | Branch prevista | Escopo completo |
|---|---|---|
| 1. Decisão | `integracao/plano-isolamento-escritorios` | Garantias, recursos atuais, caminhos e revisão, antes de alterar pastas operacionais. |
| 2. NFS-e | `integracao/nfse-por-escritorio` | Contrato da fila, identidade, cache, gravação, arquivos, MEI e retorno ao painel. |
| 3. ATF/MEI | `integracao/atf-mei-por-escritorio` | Rodada, caixa de mensagens, documentos, histórico, reenvio e painel. |
| 4. Monitor Fiscal | `integracao/monitor-fiscal-por-escritorio` | Fila própria, consulta, manifestação, persistência, retomada e painel. |
| 5. Operação | `integracao/atualizacao-operacional` | Banco, instalação Windows/VPS, Drive, Domínio e recuperação. |

Cada entrega passa pelo Codex 2, recebe correções e fica disponível para aceite. O aceite da revisão não torna o push automático; a publicação depende da autorização correspondente. Cada branch contém o escopo da etapa sobre as dependências aprovadas. Enquanto essas dependências ainda não estiverem na main, as branches locais ficam encadeadas e registram a base de comparação. Merge e ativação dependem da autorização correspondente.

## Garantias preservadas

**Identidade** é a chave que determina de quem são os dados: tipo de contexto (portal/local), identificador persistente do escritório/contexto, origem e documento fiscal consultado. Nome, código da planilha, login e titular do certificado não substituem essa chave. Usar o CNPJ da filial consultada mesmo com certificado de matriz/procurador. Contexto ausente ou inconsistente bloqueia a tarefa antes da consulta e da escrita.

- Nomes iguais ou sanitizados iguais, renomeação e troca de código não misturam empresas. O mesmo CNPJ em escritórios diferentes mantém arquivos, cache e histórico separados.
- Preservar validação de metadados, limites de caminho Windows, identidade local persistente e separação entre portal e modo local. Não importar, mover, renomear ou apagar automaticamente arquivos/cache legados.
- **Gravação recuperável** mantém a última versão válida e permite retomar após falha: escrever em temporário no mesmo diretório e substituir ao concluir; validar identidade/formato antes de ler. Corrupção ou consulta malsucedida não vira histórico vazio nem faturamento zero.
- **Concorrência** é a execução simultânea por trabalhadores/processos distintos: proteger escrita, avanço de cache e retirada de tarefas. Testar dois processos independentes, além de trabalhadores dentro do mesmo processo. Interrupção preserva documentos confirmados e pendências, sem conclusão falsa no painel.
- Reenvio MEI usa escritório/documento corretos; repetição não duplica receita. JSON válido é a fonte local; a planilha derivada pode ser reconstruída após falha.
- Relatórios e diagnósticos ficam associados ao contexto, sem senhas ou chaves. Conferir o banco efetivo antes de iniciar ou reenviar, respeitando a precedência das variáveis de ambiente.

## Recursos recentes obrigatórios

| Fluxo | Continuar funcionando | Referência atual |
|---|---|---|
| NFS-e | Certificado próprio/matriz/procurador e CNPJ consultado; emitidas/recebidas; cancelamentos; PDF do portal ou gerado do XML; retenções; XML mensal ABRASF para Domínio. | `robo/nfse.py`, `robo/robo_xml.py`, `robo/tests/test_nfse.py`. |
| MEI pela NFS-e | Receita sem duplicação; zero confirmado; completar lacunas conforme histórico do banco por escritório; falha de leitura não consulta API nem grava zero; MEI pausado não amplia o ano. | `robo/tests/test_nfse.py`, `web/tests/mei-historico-db.test.cjs`. |
| ATF/MEI | Consulta prévia em HTML; coleta atrasada; NF-e/NFC-e/CT-e e PDFs; documentos avulsos; notas/cartão separados; histórico/reenvio; reprocessamento SEFAZ manual/automático e períodos. | `robo/atf_pb.py`, `robo/pdf_fiscal.py`, `robo/tests/test_atf_simulado.py`, `web/tests/sefaz-reprocessar-db.test.cjs`, testes `periodo*.test.cjs`. |
| Monitor Fiscal | Fila/horário próprios; distribuição incremental; Ciência da Operação com assinatura vigente; XML/DANFE; cancelamentos; pendências e nova tentativa quando o XML ainda não saiu; avisos de ciência recusada/desligada. | `robo/nfe.py`, `robo/tests/test_nfe.py`, `web/app/painel/monitor/`. |
| Portal/cadastro MEI | Agendamento por período, acompanhamento, descoberta/gestão MEI, notificações e trabalhador de cadastro. Atualizar filas sem perder campos ou efeitos das migrações recentes. | `web/tests/`, `servidor/tests/test_mei_cadastros.py`, migrações de 12 a 16/11. |

Adaptar as regressões da referência em `test_armazenamento.py`, `test_isolamento_arquivos_investigacao.py`, `test_motor_v2.py`, `test_mei.py` e ensaios Chrome/SQL, preservando a intenção. Registrar falhas anteriores de retenções separadamente; não alterar fórmulas incidentalmente.

## Caminhos: decisão anterior à implementação

Adotar a árvore isolada da referência para novas competências, usando **MMAAAA** na pasta mensal lida pela Domínio. Competências existentes continuam acessíveis no caminho original, inclusive quando usam AAAA-MM; não renomear nem criar uma segunda pasta para normalizar o formato. Datas/contratos do banco e nomes de arquivos/serviços mantêm os formatos atuais.

Resolver a competência pela identidade completa e pelo mês antes de ler ou gravar:

- Se existir somente AAAA-MM, manter o caminho original para acesso e reprocessamento.
- Se existir somente MMAAAA, reutilizar esse caminho.
- Se nenhum dos formatos existir, criar a nova competência em MMAAAA.
- Se os dois formatos existirem para a mesma identidade e mês, indicar conflito para conferência e interromper a operação dessa competência antes de gravar, consolidar ou publicar seus arquivos. Não escolher um formato silenciosamente, somar resultados ou importar ambos na Domínio. Os arquivos originais permanecem acessíveis para conferência.

O acesso a caminhos anteriores exige associação comprovada com a identidade; nome da pasta sozinho não comprova escritório/empresa. Registrar caminhos existentes no inventário sem importar ou mover arquivos automaticamente.

```text
<destino>/Arquivos por empresa v2/
  portal/org_<uuid>--<rotulo_inicial>/<origem>/<documento>--<rotulo_inicial>/
    empresa.json
    <MMAAAA>/<servicos e arquivos finais de novas competencias>
    Dossiê MEI/<historico e planilha anual>
  local/<contexto persistente>/...
  _cache/<origem>/<contexto>/<documento>/...
  <areas internas de trava, reserva, pendencias, relatorios e diagnostico>/...
```

O documento inclui tipo/número (`cnpj_...` ou `ie_...`), com identificadores completos. NFS-e usa `nfse_nacional`; ATF usa `sefaz_pb`. Monitor terá origem própria, validada na etapa correspondente, sem reutilizar a identidade de origem/cache da NFS-e. Rótulos físicos iniciais permanecem estáveis após renomeações; metadados guardam os nomes atuais. Devolver ao painel caminho relativo à raiz configurada, incluindo o contexto.

**Domínio:** manter XML mensal ABRASF e XMLs individuais; usar MMAAAA nas competências novas e considerar os caminhos originais das existentes na configuração de importação, inclusive AAAA-MM. Inventariar as raízes já usadas e registrar o mapa por identidade/competência entre caminho local, pasta recebida do Drive e caminho configurado na Domínio. Cadastrar a nova raiz sem perder o acesso aos meses anteriores; não presumir compatibilidade automática nem importar os dois formatos de um mês em conflito. Homologar competência existente, competência nova, conflito entre formatos e nota cancelada/reprocessada, conferindo importação e totais.

**Drive:** publicar somente documentos finais, por pasta estável de escritório identificada pelo UUID. Mapear explicitamente a subárvore `portal/org_<uuid>--<rotulo_inicial>/` para a pasta compartilhada desse escritório, conferindo permissões e escritórios homônimos. Não copiar toda a raiz: cache, metadados internos, JSON de histórico, temporários, travas, certificados e diagnósticos ficam fora. O atual `servidor/drive.sh` copia a raiz inteira e exclui apenas `_diagnostico/**`; adaptá-lo antes da ativação. Preservar cópia sem exclusão no destino, intervalo de 10 minutos e janelas atuais (mínimo 2 minutos; máximo 35 dias), verificando os efeitos na retomada.

## Evidências e revisão por fluxo completo

Para cada cenário, registrar tarefa/escritório, retirada da fila, consulta simulada, caminhos/conteúdo gerados, retorno persistido e estado/valores no painel. Ensaios locais não comprovam API fiscal real, instalação, compartilhamento Drive ou importação Domínio.

1. Mesmo nome com documentos diferentes; mesmo CNPJ em escritórios diferentes; escritórios homônimos; renomeação/código alterado; filial e procuração.
2. Falha antes/depois de salvar documento, índice e planilha; falha ao devolver ao banco; interrupção/reinício. Retomar sem perder arquivo válido, pular documentos ou duplicar receita.
3. Execuções simultâneas da mesma identidade e de identidades diferentes; dois consumidores independentes disputando a fila. Conferir titularidade, arquivos, cache e painel.
4. ATF: resposta atrasada, mesma caixa/login entre escritórios, mensagens antigas, anexo ilegível e ausência explícita de notas. Reserva persistente da caixa e trava de escrita têm finalidades distintas.
5. Monitor: resumo antes do XML, ciência recusada/desligada, cancelamento e retomada sem avanço indevido do marcador de distribuição. Não aplicar à API do Monitor a política de caixa ATF.
6. Caminhos mensais: somente AAAA-MM existente, somente MMAAAA existente, mês novo e ambos para a mesma identidade/mês (inclusive pastas vazias ou conteúdo igual). Comprovar acesso/reprocessamento no caminho original, criação nova em MMAAAA e conflito explícito sem escrita/publicação/importação duplicada; o mesmo mês em identidades diferentes não constitui conflito.

Executar testes pertinentes de Python, portal e SQL por etapa; conferir tipos e build quando houver mudança web. Incluir chamadas HTTP às funções do banco e dois consumidores independentes em homologação. Codex 2 deve emitir pareceres separados para código, publicação e ativação, com evidências e lacunas explícitas.

## Atualização operacional e SQL antigo

Inventariar banco efetivo, funções/permissões, instalações Windows/VPS, serviços/agendadores, trabalhador MEI, credenciais existentes, Drive e importadores Domínio. Preparar atualização e pausa/retomada em homologação; registrar tarefas/reservas em andamento e validar dependências e argumentos dos atalhos/serviços. Não devolver indiscriminadamente tarefas para a fila nem recomendar restaurar o banco inteiro após novas gravações.

Manter funções SQL antigas enquanto existirem consumidores não atualizados ou desconhecidos. A proposta separada `preparacao/retirada-contratos-antigos` (`67155c9`) precisa ser reavaliada contra o banco atual. Retirada exige inventário concluído, consumidores comprovadamente atualizados, homologação e recuperação com versão compatível; não integra implicitamente os fluxos.

Pendências: revisão da integração ATF/MEI pelo Codex 2, implementação do Monitor Fiscal
e preparação/ensaios operacionais. O plano original era apenas documental; as
evidências de cada implementação ficam nos roteiros específicos em `docs/reviews/`.
Migrações operacionais, merge e ativação dependem das autorizações correspondentes.
