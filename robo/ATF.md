# ATF/MEI por escritório

Esta integração depende da NFS-e corrigida em `2af5bde`. Sua revisão de
código é separada da autorização para publicar e ativar as instalações.

## Identidade, pastas e comandos

O portal entrega `org_id` com a tarefa. Antes de abrir a senha, o robô valida esse
identificador, a IE e o período. As rodadas agrupam somente tarefas do mesmo
escritório, acesso e período, sem repetir a IE na mesma rodada. Trocar nome/código
não cria outra identidade e não renomeia a pasta existente.

```text
<destino>/Arquivos por empresa v2/portal/org_<uuid>--<rotulo>/
  sefaz_pb/ie_<ie>--<rotulo>/
    empresa.json
    <MMAAAA>/<servico>/
    Dossiê MEI/Faturamento MEI <ano>.json
    Dossiê MEI/Faturamento MEI <ano>.xlsx
```

O modo local usa `local/contexto_<uuid>--<rotulo>` com identificador persistente em
`config.json`. A primeira criação exige confirmação explícita; repetir o comando
reutiliza o identificador. Ele não consulta nem envia dados ao portal.

Na pasta `robo`, após preparar a `.venv` e a configuração:

```powershell
..\.venv\Scripts\python.exe -B robo_xml.py --conferir-banco
..\.venv\Scripts\python.exe -B robo_xml.py --confirmar-banco https://SEU-PROJETO.supabase.co
..\.venv\Scripts\python.exe -B robo_xml.py --enviar-mei --confirmar-banco https://SEU-PROJETO.supabase.co
..\.venv\Scripts\python.exe -B robo_xml.py --local empresas.xlsx --competencia 09/2026 --criar-contexto-local
```

Depois da primeira criação, omita `--criar-contexto-local`. `--mei-ano` refaz as
consultas anteriores do ano; continua validando o histórico existente. Os atalhos
encaminham os argumentos. `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` prevalecem
sobre o JSON; a URL efetiva precisa ser confirmada antes de iniciar ou reenviar.
A chave não aparece no comando de conferência.

Novos meses usam MMAAAA; meses existentes em AAAA-MM continuam nesse caminho.
Os dois formatos para o mesmo mês/identidade bloqueiam a rodada antes da consulta.
No Windows, o resolvedor reserva espaço para a pasta do serviço e o PDF com a
chave completa. Se uma pasta já existente não couber, a execução pede uma raiz
mais curta; não tenta renomear ou mover os dados automaticamente.

## Caixa postal e arquivos

`_travas` protege operações nos arquivos da mesma empresa. `_caixas_atf` reserva a
caixa real pelo login, independentemente do escritório. São proteções diferentes:
a primeira dura enquanto o arquivo está sendo trabalhado; a segunda permanece
enquanto uma resposta puder estar pendente ou exigir conferência.

Antes das consultas XML, o robô reserva a caixa e lista as mensagens existentes.
Essas mensagens ficam fora da coleta nova. Enquanto A aguarda resposta, outra
rodada B do mesmo login é recusada, inclusive em outro processo na mesma raiz.
Trocar de sessão ou de escritório não cria outra caixa. A leitura final de A pode
concluir a pendência e liberar a reserva; só depois B deve ser reagendada.

Ausência de notas exige HTML com zero ou resposta final explícita e válida.
ZIP truncado/parcial, aviso de anexo sem download e mensagens excedentes ficam
para conferência, preservam os originais e mantêm a reserva. Não viram receita
zero nem serviço sem movimento.

Cada XML é atribuído pela IE/CNPJ e pelo papel da empresa no documento. ZIPs
mistos são separados, e o original fica em conferência quando necessário. Uma
nota pode aparecer em mais de um anexo recebido; os totais usam a chave fiscal
para contar cada nota uma vez e descontar cancelamentos. PDFs são gerados somente
para as notas atribuídas à empresa/tipo. Escritas concluídas substituem o arquivo
por meio de um temporário no mesmo diretório.

Diagnósticos, passos, anexos sem dono e relatórios ficam no contexto/execução.
A reserva e as travas exigem a mesma raiz física: cópias sincronizadas em máquinas
diferentes não oferecem essa exclusão. Não misture consultas manuais ou instalações
antigas e novas no mesmo login durante uma rodada.

## Histórico e retorno ao painel

`mei.py` valida identidade, versão, ano, valores e data com fuso antes de consumir
o histórico. O JSON é a fonte local; a planilha é derivada. Uma coleta mais antiga
ou equivalente não substitui um mês mais recente, mesmo com fuso diferente.
Notas e cartão mantêm seus acumulados separados.

Se o Excel impedir a substituição da planilha, o JSON continua válido e a planilha
anterior permanece. O painel recebe os meses salvos e o resultado informa
“Dados salvos, planilha pendente”. A próxima leitura/salvamento do histórico tenta
reconstruir a planilha sem consultar novamente os meses já coletados.

O envio da coleta leva tarefa, organização e IE. O reenvio automático/manual lê
somente históricos do portal com identidade válida e chama a função pelo contexto
exato. Históricos locais, diretórios anteriores e JSON incompatível não são
reenviados por IE para vários escritórios. Uma falha de comunicação não interrompe
os demais históricos; a ausência de contrato no banco interrompe explicitamente.
O pedido de alerta imediato também leva a organização; o endpoint continua
aceitando chamadas de versões anteriores durante a transição.

## Banco e retomada

A migração `20261116110000_atf_mei_por_contexto.sql` cria os contratos por
escritório. Depois da migração de reserva da NFS-e, aplique
`20261123181000_reserva_tarefas_atf.sql`. O robô usa `xml_atf_reservar_lote`
e renova as tarefas em andamento e as que aguardam Minhas Mensagens.
Progresso, conclusão e a gravação MEI exigem a tentativa vigente.
O reenvio de históricos usa `xml_mei_registrar_contexto`.
O SQL preserva contratos anteriores, a fila NFS-e e os gatilhos de complemento
NFS-e e reprocessamento. A aplicação operacional aguarda homologação e autorização.
Pause versões anteriores de ATF e NFS-e que consomem o mesmo banco antes da troca.

As funções usam as permissões do proprietário (`SECURITY DEFINER`) para trabalhar
nas tabelas protegidas; somente `service_role` pode chamá-las. A fila reserva as
tarefas na mesma operação que as devolve e ignora tarefas já bloqueadas por outra
sessão (`SKIP LOCKED`). O ensaio local não comprova disputa entre conexões reais.

Ao pausar, registre IDs das tarefas, organização, IE, período, login e marcador da
caixa, sem guardar senha/chave no registro. Não devolver tudo para pendente nem
apagar `_caixas_atf` em lote. A fila pode retomar ATF após 90 minutos sem renovação.
A reserva física da caixa continua até a conferência. Anexos que chegaram
depois da perda da tentativa ficam na área interna da rodada para conferência.

Após interrupção, confira os documentos, a caixa e as tarefas com uma versão
compatível com essas funções. Se houver reserva pendente, faça a conferência do
login e das respostas antes de remover especificamente o marcador correspondente
e reagendar. Não recomende retorno automático ao motor anterior nem restauração
integral do banco depois de novas gravações.

Antes da ativação permanecem os ensaios com duas conexões PostgreSQL independentes,
as chamadas HTTP pelo PostgREST, a atualização dos serviços Windows/VPS e o
mapeamento final de Drive/Domínio. A atualização do site deve incluir o endpoint
de alerta com `org_id` antes de ligar o robô novo; uma versão anterior aceita a
requisição, mas ainda ignora esse campo. O Monitor Fiscal será integrado na próxima
entrega; sua resolução anterior de pastas não é usada pelo ATF novo.
