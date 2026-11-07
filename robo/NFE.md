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
  próxima consulta só sai depois de 1 hora. O botão "Consultar agora" do portal respeita isso.
- **Resumo e XML completo**: a nota destinada chega primeiro como resumo (`resNFe`). Com a ciência ligada para a
  empresa, o robô registra a **Ciência da Operação** (evento neutro: não confirma nem recusa a operação) e busca o XML
  completo pela chave. O que não vier na hora chega na consulta seguinte.
- **Cancelamento**: o evento 110111 marca a nota como cancelada no portal e fica salvo em `Eventos/`.
- **ICP-Brasil**: os servidores da SEFAZ usam certificados da ICP-Brasil, que não vêm no sistema. O robô baixa o
  pacote oficial do ITI (`acraiz.icpbrasil.gov.br`) e guarda em `chaves/icp-brasil.pem`, renovando a cada 30 dias.

## Onde ficam os arquivos
`<destino>/<Escritório>/Arquivos baixados/<ID>-<Nome>/<MMAAAA>/NF-e Recebidas/<chave>.xml` e `<chave>.pdf` (DANFE
gerado a partir do XML pela biblioteca `brazilfiscalreport`), no mês da emissão. Eventos em `NF-e Recebidas/Eventos/`.

## Ainda não
NF-e emitidas e NFC-e: dependem da SEFAZ de cada estado (a da Paraíba ainda não oferece um serviço próprio).
