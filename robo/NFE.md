# Monitor Fiscal: NF-e destinadas (Ambiente Nacional)

O robô consulta, todo dia no horário escolhido pelo escritório (padrão 11h, horário de Brasília; o gestor muda em
Monitor Fiscal > Configurações), o **Ambiente Nacional da NF-e** com o certificado A1 de cada
empresa monitorada no portal (aba Monitor Fiscal) e traz as notas em que ela é a **destinatária**, de qualquer estado.

## Serviços usados
| Serviço | Endereço (produção) | Para quê |
|---|---|---|
| NFeDistribuicaoDFe (`distNSU`) | `https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx` | tudo o que é novo desde o último NSU |
| NFeDistribuicaoDFe (`consChNFe`) | o mesmo | o XML completo de uma nota pela chave, depois da ciência |
| NFeRecepcaoEvento4 (cOrgao 91) | `https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx` | Ciência da Operação (evento 210210) |

Homologação: `hom1.nfe.fazenda.gov.br` (opção `monitor_nfe.ambiente` = `"2"` no config.json).

## Regras que o robô respeita
- **Certificado**: o A1 da própria empresa ou o da matriz (mesma raiz do CNPJ). A procuração do e-CAC não vale aqui.
- **Uma hora de espera**: quando `ultNSU` = `maxNSU` (nada novo) ou a SEFAZ responde 656 (consumo indevido), a
  próxima consulta só sai depois de 1 hora. O botão "Consultar agora" do portal respeita isso. No 656, se o
  robô ainda não tem NSU salvo e a SEFAZ informa o último NSU do CNPJ, a próxima rodada parte desse número.
  Se já existe um NSU salvo, o robô preserva o cursor e avisa quando a SEFAZ informa um NSU maior.
- **Consultas pela chave**: o robô faz até 20 por rodada. A SEFAZ compartilha essa cota por hora com consultas
  pontuais por NSU de outros sistemas para o mesmo CNPJ. A fila prioriza chaves nunca consultadas e depois as
  tentativas mais antigas. A rejeição 632 encerra as consultas pela chave e mantém o resumo no histórico.
- **Resumo e XML completo**: a nota destinada chega primeiro como resumo (`resNFe`). Com a ciência ligada para a
  empresa, o robô registra a **Ciência da Operação** e busca o XML completo pela chave. Se houver atraso na liberação,
  a nota continua como pendente. O prazo legal para a ciência é de 10 dias contados da autorização da NF-e.
- **Cancelamento**: o evento 110111 marca a nota como cancelada no portal e fica salvo em `Eventos/`.
- **ICP-Brasil**: os servidores da SEFAZ usam certificados da ICP-Brasil, que não vêm no sistema. O robô baixa o
  pacote oficial do ITI (`acraiz.icpbrasil.gov.br`) e guarda em `chaves/icp-brasil.pem`, renovando a cada 30 dias.

## Notas anteriores ao cadastro

- **15 dias** é a janela da tela de manifestação do Portal Nacional ao marcar “Não tenho chave de acesso”.
- O **serviço de distribuição** disponibiliza documentos por até **90 dias** a partir do recebimento no Ambiente
  Nacional. A consulta em lote depende de NSUs já gerados. No primeiro uso do `distNSU` ou na retomada após mais
  de 60 dias sem consultar, o Ambiente Nacional volta a gerar NSU a partir da consulta, sem preencher o período anterior.
- Com a **chave de acesso**, o serviço admite consulta pontual dentro dos 90 dias mesmo sem NSU prévio, conforme a
  permissão do interessado. Para o destinatário, o XML completo depende de uma manifestação que libere o download.
  O Monitor usa a consulta por chave para notas que já conhece. Para um documento que não chegou ao Monitor,
  use o Portal Nacional com a chave ou obtenha o XML com o emitente.

[NT 2014.002 v1.40 · Distribuição de DF-e](https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=uWO2d%2FgTuWg%3D) ·
[NT 2020.001 v1.60 · Manifestação do destinatário](https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?AspxAutoDetectCookieSupport=1&conteudo=+WTd7iuD21s%3D)

## Onde ficam os arquivos
`<destino>/<Escritório>/Arquivos baixados/<ID>-<Nome>/<MMAAAA>/NF-e Recebidas/<chave>.xml` e `<chave>.pdf` (DANFE
gerado a partir do XML pela biblioteca `brazilfiscalreport`), no mês da emissão. Eventos em `NF-e Recebidas/Eventos/`.

## Ainda não
NF-e emitidas e NFC-e: dependem da SEFAZ de cada estado (a da Paraíba ainda não oferece um serviço próprio).
