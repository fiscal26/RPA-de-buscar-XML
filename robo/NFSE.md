# NFS-e Portal Nacional: como o portal funciona (anotações para o módulo do robô)

Levantado em 26/10/2026 a partir do comportamento da extensão "Baixar NFSe" (versão 3.0.0.18).
O robô terá implementação própria; aqui ficam só os endereços e as regras do portal.

## Duas formas de acesso

| | Login e senha (Emissor Nacional) | Certificado A1 (API oficial ADN) |
|---|---|---|
| Lista das notas | sim, sem captcha | sim |
| Detalhe com tributos e retenções | sim, sem captcha | sim (no próprio XML) |
| XML | captcha "Sou humano" (hCaptcha) a cada nota | sim, em lote, sem captcha |
| PDF (DANFSe) | captcha a cada nota | gerado a partir do XML |

## Login e senha (www.nfse.gov.br/EmissorNacional)

- Sessão por cookie depois do login em `/EmissorNacional/Login`. Uma chamada a `/EmissorNacional/`
  a cada ~4 min mantém a sessão; se a resposta for para `/Login`, a sessão caiu.
- Lista: `GET /EmissorNacional/Notas/Emitidas` ou `/Notas/Recebidas`
  `?pg=<página>&executar=1&busca=&datainicio=dd/mm/aaaa&datafim=dd/mm/aaaa` (HTML, tabela `table-striped`).
  Cada linha traz a chave de acesso. Páginas além da última repetem o conteúdo: parar quando não houver chave nova.
- Detalhe: `GET /EmissorNacional/Notas/Visualizar/Index/<chave>` (HTML, sem captcha). Abas `#nfse`,
  `#pessoas`, `#servicos`, `#tributacao`; cada campo é `<label><span>RÓTULO</span></label>` seguido de
  `<span class="form-control-static">VALOR</span>`. Na aba de tributação: ISSQN (tributação, alíquota,
  valor, retenção), IBS/CBS (opcional), IRRF, PIS, COFINS, CSLL, contribuições retidas. Os eventos
  (cancelamento, substituição) aparecem na mesma página.
- Download `Download/NFSe` e `Download/DANFSe`: protegido por captcha. Sem captcha resolvido, volta uma página
  HTML em vez do arquivo (conferir o content-type antes de salvar).
- Ritmo que o portal aguenta: 4 pedidos ao mesmo tempo, 15 s de limite, 150 ms entre um e outro.

## Certificado A1 (adn.nfse.gov.br)

- `GET https://adn.nfse.gov.br/contribuintes/DFe/<NSU>?lote=true` com mTLS (e-CNPJ A1), `Accept: application/json`.
  Devolve os documentos com NSU maior que o informado; guardar o último NSU por empresa e continuar dele.
- Erros: JSON `{"Erros":[{"Codigo":"E…","Descricao":"…"}]}`. 429/502/503/504 são passageiros: esperar
  (respeitar `Retry-After`) e repetir; em 429 aumentar o intervalo entre chamadas (começar em ~0,7 s).
- O XML vem compactado (gzip + base64) em cada item do lote.
