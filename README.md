# LotiVisse XML — robô de XML da SEFAZ-PB (piloto)

Robô que entra no **ATF da SEFAZ-PB com o login do contador**, pesquisa as notas de cada empresa
pela **inscrição estadual** e salva os XML da competência numa pasta do seu computador:

```
<pasta destino>/                   (padrão: Documentos\XML SEFAZ-PB)
  Arquivos baixados/
    5-joao/                        (ID-NOME FANTASIA da planilha; sem ID, só o nome)
      2026-09/
        NF-e Saida - R$ 12.345,67/     NF-e Saida 2026-09.zip     (o ZIP do ATF, como veio)
        NF-e Entrada - R$ 8.900,00/    NF-e Entrada 2026-09.zip
        NFC-e - R$ 1.230,50/           NFC-e 2026-09.zip
    _sem_empresa/        arquivo de empresa fora da rodada (ex.: consulta feita à mão no mesmo login)
    _nao_identificados/  arquivo baixado que não é XML/ZIP (guardado como veio, para conferir)
  _relatorios/           relatório de cada rodada
  _diagnostico/          telas e campos quando algo não é reconhecido
```

O ZIP baixado do ATF **não é descompactado**: fica do jeito que veio. O robô só lê o conteúdo para
saber de qual empresa e tipo ele é e para somar o **valor total** (vNF das notas autorizadas, sem as
canceladas), que aparece no nome da pasta. Rodar de novo a mesma competência não duplica o arquivo; um
arquivo novo soma no total e a pasta é renomeada.

O robô é ativado pelo **portal web**: o cliente envia a planilha modelo na área de agendamento,
escolhe a competência e o horário, e o robô no seu PC executa.

| Peça | Onde roda | Pasta |
|---|---|---|
| Portal LotiVisse XML (login, agendamento, acompanhamento) | Vercel + Supabase próprio, em `xml.lotivisse.com.br` | `web/` |
| Robô (ATF, download, organização das pastas) | Seu PC, com o Chrome | `robo/` |
| Planilha modelo | Portal e robô | `modelos/modelo_empresas_sefaz_pb.xlsx` |

Passo a passo de implantação: **[web/IMPLANTACAO.md](web/IMPLANTACAO.md)**.

## Planilha modelo

O modelo já vem com **X** em todas as opções (ATIVA e serviços) nas linhas 2 a 101: o cliente
preenche só os dados das empresas. Linha sem dados de empresa é ignorada. As colunas são achadas
pelo nome do cabeçalho. O robô de XML usa:

| Coluna | Uso |
|---|---|
| ATIVA | X (ou S, ou em branco) = ativa; N = ignorada |
| ID, ID_FILIAL | códigos do escritório; o ID entra no nome da pasta |
| CNPJ | opcional; ajuda a conferir os XML |
| INSCRICAO ESTADUAL | **obrigatória**: é por ela que o ATF pesquisa (dígito verificador da PB conferido) |
| NOME FANTASIA | nome da pasta |
| LOGIN, SENHA | acesso do contador ao ATF. A senha só precisa vir uma vez por login |
| NF-e Saida, NF-e Entrada, NFC-e | **X** (ou S, SIM) = baixar esse XML; apagar o X = não baixar |

CT-e, Download Faturas, Extrato de Pagamentos, Omissão e Inadimplência, Certidão de Débitos,
Conferência Cartão de Crédito e Dossiê MEI ficam para outros serviços: este robô não usa essas colunas.

## Roteiro no ATF

O ATF **não entrega o XML na hora**: a consulta com *Tipo de Exibição = XML* gera, minutos depois,
uma mensagem com o anexo em **Minhas Mensagens** (sino do topo; SEG_064). Por isso o robô trabalha
em **rodadas de um login** (até 15 empresas):

1. **Login** (Usuário, Senha, *Avançar*) com o login do contador, uma vez para a rodada inteira.
2. **Envia as consultas**, uma por empresa e por XML marcado:
   - *NF-e Saída / Entrada:* menu *NF-e* > *Consulta NF-e por Emitentes/Destinatários* (FIS_1322).
     *Limpar*; *Data de Emissão* do 1º ao último dia da competência; IE no bloco **Emitente** (saída)
     **ou** **Destinatário** (entrada), nunca nos dois; **Pesquisar** do bloco (o nome da empresa
     precisa aparecer; se não aparecer, a IE não existe no ATF e a empresa fica com erro);
     *Tipo de Exibição* = XML; *Consultar*. O ATF responde "O resultado será enviado para sua caixa
     de mensagens do ATF".
   - *NFC-e:* menu *NFC-e* > *Consulta por Emitente* (FIS_1484), IE no bloco **Emitente**, mesmo final.
3. **Recolhe as mensagens** (sino; SEG_064). Cada consulta gera **3 mensagens** no mesmo segundo; só a
   final ("Tarefa executada com sucesso") importa: com o anexo *"Dados referentes ao ano de ..."* (o
   XML) ou sem anexo (= não existem dados no período). O robô abre as mensagens enviadas **depois do
   clique em Consultar** (hora do próprio ATF), baixa o anexo e volta pelo *Voltar*. A caixa só pode
   ser consultada de 1 em 1 minuto: o robô espera 65 s entre uma leitura e outra, por até 30 min.
4. **Distribui pelo conteúdo:** as mensagens têm todas o mesmo assunto e chegam fora de ordem, então cada
   XML vai para a empresa pela IE/CNPJ de dentro dele (emitente → NF-e Saída/NFC-e; destinatário →
   NF-e Entrada). Uma venda entre duas empresas da rodada vai para as duas. Resposta de outra
   competência ("Período solicitado") é ignorada; XML de empresa fora da rodada (consulta feita à mão
   no mesmo login) vai para `_sem_empresa` e não conta como resposta.
5. **ATF lento:** se Minhas Mensagens não abrir, o robô espera 30 s e tenta de novo; depois de
   **3 tentativas** ele anuncia o erro e **para**, salvando antes o que já tinha sido baixado
   (no portal, as tarefas voltam para a fila).
6. Empresa/tipo sem XML: **Sem notas** se todas as respostas chegaram; **Erro** ("o ATF não entregou em
   30 min") se o tempo acabou.

**Proteção do login do contador:** se o ATF recusar um login, o robô não tenta de novo com a mesma
senha nas outras empresas (tentativas repetidas podem bloquear o acesso). Elas ficam como
"Login recusado" até a senha ser atualizada.

Se alguma etapa não for reconhecida, o robô salva um pacote de diagnóstico e passa ao **modo
assistido**: você conclui no Chrome e ele captura o arquivo baixado.

## Segurança das senhas do ATF

- O portal **cifra a senha assim que lê a planilha**, com a chave pública do robô (RSA-OAEP 3072).
- No banco fica só a versão cifrada, uma por login. O navegador nem consegue ler essa coluna.
- **Só o robô, no seu PC, tem a chave privada** (`robo/chaves/robo_privada.pem`, fora do Git).
  A senha não vai para logs nem para o diagnóstico.
- Ao trocar de login, o robô sai do ATF e apaga os cookies da SEFAZ-PB.

Faça uma cópia de segurança da chave privada: sem ela, as senhas precisam ser enviadas de novo.

## Robô: instalação e uso

```bash
cd robo
pip install -r requirements.txt
copy config.exemplo.json config.json     # e ajuste a pasta destino e o portal
gerar_chaves.bat                         # uma vez só: cria a chave e mostra a pública para a Vercel
abrir_chrome.bat                         # Chrome com a porta 9222 e perfil próprio
iniciar_robo.bat                         # liga o robô do portal (deixe a janela aberta)
```

**Teste sem o portal**, direto da planilha (bom para a calibração):

```bash
python robo_xml.py --local empresas.xlsx --competencia 09/2026
```

Gera um relatório em `<destino>/_relatorios/`.

### Gravador de passos (para ajustar o robô à tela real)

Se o robô travar numa tela, grave você mesmo o caminho:

1. Abra o Chrome pelo `abrir_chrome.bat`.
2. Rode `gravar_passos.bat` (ou `py robo_xml.py --gravar`).
3. No Chrome, faça o caminho completo no ATF: login, NF-e, a consulta (datas, IE, Pesquisar, XML,
   Consultar), Minhas Mensagens, abrir a mensagem e baixar o anexo.
4. Volte ao PowerShell e aperte **Ctrl+C**. O arquivo fica em `robo/gravacoes/gravacao_<data>.json`.

O arquivo traz cada clique e campo preenchido com o endereço exato do elemento na página e a lista de
campos de cada tela. **A senha não é gravada** (aparece como `***`). Com ele, o robô passa a repetir
exatamente os seus passos. O arquivo que você baixar durante a gravação (o XML) também fica nessa pasta:
com o Chrome ligado à automação, o download iria para uma pasta temporária e sumiria.

### Como o ATF é por dentro (da gravação de 17/10/2026)

- Login: `SEGf_Login.jsp`, campos `edtNoLogin` (#login) e `edtDsSenha` (#senha), botão `btnAvancar`.
- O ATF é dividido em quadros: cabeçalho (`cabecalho.htm`, botões "Mensagens" e "Encerrar Sessão"),
  menu (`SEGf_Menu.jsp`) e conteúdo.
- Consulta NF-e: `fis/FISf_ConsultarNFeXml2.do?limparSessao=true` — `edtDtInicial`, `edtDtFinal`,
  `cmbTpDoccmpEmit`/`cmbTpDoccmpDest`, `cmbTpExibicao` (HTML/TXT/XML) e `btnConsultar` (#btnConsulta, com reCAPTCHA).
  O Número, o Pesquisar e o Nome/Razão Social de cada bloco ficam num **quadro próprio**:
  `componentes/CodDescLstBS.jsp?id=FISf_ConsultarNFeXml2_cmpEmit` (ou `_cmpDest`), com
  `hidNrDocumentocmpEmit`, `btnPesquisar` e `hidNoHumanoInstcmpEmit`.
- Minhas Mensagens: `seg/SEGf_MinhasMensagens.do`. Cada consulta é uma mensagem **mãe**
  (`javascript:abrirFilhas('<id>',3)`, "(3 Mensagens)") com 3 **filhas**; a filha final abre em
  `SEGf_LerMensagem.do?hidsqMensagem=<filha>&sqMensagemPai=<mãe>` e tem o anexo
  `javascript:mostrarArquivo(0)` ("Dados referentes ao ano de ..."). A filha com anexo tem o ícone de
  clipe: o robô abre só ela. Sem anexo, a filha final diz "Mensagem: Nenhum registro satisfaz a
  pesquisa." (sem notas na competência) e o robô para de abrir as demais.

### Diagnóstico

Quando uma etapa não é reconhecida, o robô salva em `<destino>/_diagnostico/` uma pasta com
`tela.png`, `campos.txt` (campos, botões, opções e links, **sem valores digitados**), `texto.txt`
e `log.txt`. É com esse pacote que ajustamos o roteiro.

## Situação do piloto

- [x] Planilha modelo do escritório, lida igual no portal e no robô
- [x] Portal: login, agendamento por competência e horário, acompanhamento, cancelamento, empresas e logins
- [x] Banco próprio: fila com agendamento futuro, agrupamento por login, regras de acesso por cliente
- [x] Robô: login do contador, telas FIS_1322 e FIS_1484, blocos Emitente/Destinatário, captura do download, modo assistido
- [x] Fluxo de Minhas Mensagens: consulta com Tipo de Exibição XML, recolha dos anexos, distribuição pelo conteúdo
- [x] Roteiro conferido com as telas reais: login, consulta, aviso do Consultar, Minhas Mensagens e Ler Mensagem
- [ ] **Primeira rodada no ATF real** (no seu PC, `--local`), para confirmar os cliques e o download do anexo

## Testes

```bash
cd robo && python -m pytest -q tests
```

Inclui um **ATF simulado** num Chrome de verdade, com o menu, as telas FIS_1322/FIS_1484, os blocos
Emitente/Destinatário (recusa os dois juntos) e a entrega atrasada em Minhas Mensagens, fora de ordem,
com mensagem antiga e consulta manual de outra empresa no meio. Prova também que a rodada usa um login
só e que uma senha recusada não é tentada de novo.
