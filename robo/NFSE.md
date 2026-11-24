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
- O XML vem no campo `ArquivoXml` de cada item do lote, compactado (gzip) e em base64.

## Onde está no código

| O quê | Arquivo |
|---|---|
| Cliente da API (mTLS, lotes por NSU, espera e repetição, DANFSe) | `robo/nfse.py` (`ClienteADN`, `contexto_tls`, `sessao_com_certificado`) |
| Leitura do XML e das retenções | `robo/nfse.py` (`ler_nfse`, `NotaServico`) |
| Pastas, cache por escritório/CNPJ e relatório de retenções | `robo/nfse.py` e `robo/armazenamento.py` |
| Tarefa vinda do portal | `robo/robo_xml.py` (`executar_nfse`, `Robo.processar_nfse`, `Portal.pegar_lote_nfse`) |
| Teste com um .pfx do PC | `robo/testar_nfse.bat` → `robo_xml.py --nfse-teste` (`testar_nfse`) |
| Certificado cifrado (v2) | `web/lib/cripto.ts` (`cifrarArquivo`) e `robo/cripto.py` (`decifrar_arquivo`) |
| Envio e conferência do .pfx | `web/lib/certificado.ts`, `web/app/painel/certificados/`, `web/app/painel/actions-nfse.ts` |
| Planilha e agendamento da NFS-e | `web/lib/planilha-nfse.ts`, `web/app/painel/FormAgendamentoNfse.tsx`, `web/app/painel/agendar/page.tsx` |
| Banco (tabelas e fila) | `web/supabase/schema.sql` (`xml_nfse_certificados`, `xml_nfse_empresas`, `xml_nfse_pegar_lote`) |
| Testes | `robo/tests/test_nfse.py` |

## Documentação oficial

- Portal da NFS-e, documentação técnica (leiaute do XML, manuais da API e do ADN): https://www.gov.br/nfse
  → *Biblioteca* → *Documentação técnica*.
- Ambiente de testes (produção restrita) do ADN: `https://adn.producaorestrita.nfse.gov.br` (mesmos caminhos).


## Procuração eletrônica (desde 01/11/2026)

O Portal da NFS-e anunciou que, a partir de 01/11/2026, a representação por terceiros vale também para as APIs de
Emissão e Distribuição, com a procuração eletrônica cadastrada na Receita (e-CAC) ou com os vínculos do CNPJ.

- O robô usa um certificado por empresa nesta ordem: o da própria empresa, o da matriz (mesma raiz do CNPJ) e, se não
  houver, o **certificado do escritório** (`xml_nfse_certificados.procurador`): o e-CNPJ do escritório ou o e-CPF do
  contador.
- A consulta sempre informa `cnpjConsulta=<CNPJ da empresa>`. Há relato (03/11/2026) de que o ADN passou a recusar
  a consulta sem esse parâmetro.
- Se o ADN recusar o certificado do escritório para uma empresa (401/403), a tarefa fica como "certificado" com a
  mensagem de que falta a procuração da empresa no e-CAC.
- **Conferir no teste real:** a documentação oficial (adn.nfse.gov.br/contribuintes/docs) não pôde ser lida daqui.
  Confirmar o nome do parâmetro, o tipo de procuração exigido (serviço da NFS-e no e-CAC) e se o e-CPF é aceito.

## Integração da NFS-e por escritório

A fila do robô atualizado usa `xml_nfse_reservar_lote`. Cada retirada ganha um novo
`tentativa_id`. A função `xml_atualizar_tarefa_reservada` aceita progresso e
conclusão somente durante a reserva correspondente. O processamento renova a
reserva de 90 minutos em pontos de verificação. Se perder a reserva, interrompe
a gravação ao verificar a titularidade e descarta o resultado para o painel.
Se outro processo ainda estiver usando a pasta, a tentativa atual devolve a
tarefa à fila para tentar depois de um minuto.

A estrutura de documentos é
`<destino>/Arquivos por empresa v2/portal/org_<uuid>--<rótulo>/nfse_nacional/cnpj_<cnpj>--<rótulo>/`.
O cache está em `_cache/nfse/portal/<uuid>/<cnpj>/` sob a mesma raiz. Renomear o
escritório ou a empresa mantém os identificadores e os históricos associados.

Novas competências usam MMAAAA. Meses já gravados em AAAA-MM são reutilizados.
Se ambos os formatos existirem para a mesma identidade e competência, a tarefa
para com erro de conferência. O lote mensal mantém seu nome MMAAAA. XMLs individuais
usam a chave de acesso e entram no lote ABRASF com o conteúdo original.

Se o cache estiver ilegível ou apontar para XML ausente, preserve a pasta e confira
o erro. A falha impede atualizar o faturamento como zero. Se apenas a publicação da
planilha falhar, uma nova tentativa pode reconstruí-la dos documentos do cache.
Os dados do cache antigo permanecem disponíveis para uma migração planejada.

Os arquivos `.lock` podem permanecer na pasta após a execução. O sistema
operacional libera a trava quando o processo termina, inclusive após uma queda.
Mantenha esses arquivos na pasta para que todos os processos usem a mesma trava.

Na raiz da instalação, confira o banco efetivo e inicie com a URL esperada.
`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` prevalecem sobre o JSON.

```powershell
.\.venv\Scripts\python.exe robo/robo_xml.py --conferir-banco
.\robo\iniciar_robo.bat --confirmar-banco https://PROJETO-ESPERADO.supabase.co
```

O comando `--nfse-teste` consulta o Portal Nacional real com um certificado local.
Na primeira execução, `--criar-contexto-local` autoriza gravar um identificador no
config.json. Reutilize o mesmo identificador nas próximas execuções.

```powershell
.\robo\testar_nfse.bat --criar-contexto-local
```

Confira o histórico do ambiente antes de aplicar as migrações
`20261116100000_nfse_por_contexto.sql` e `20261123180000_reserva_tarefas_nfse.sql`.
O robô atualizado usa as funções da segunda migração. Os contratos anteriores
continuam disponíveis durante a transição. A fila legada de ATF só reabre
tarefas SEFAZ. Pause os consumidores de NFS-e que ainda usam o contrato anterior
antes de iniciar o robô atualizado no mesmo banco.
A aplicação operacional depende da revisão, da homologação e da autorização da
troca. O roteiro está na [revisão da entrega](../docs/reviews/nfse-por-escritorio.md).
