# Handoff: LotiVisse XML (robô de XML + portal)

Situação em 14/11/2026. Este documento resume a conversa "Robô de busca XML Sefaz/PB" para quem continuar
o trabalho (pessoa ou nova sessão do Claude).

## 1. O que é o projeto

| Parte | Onde | O que faz |
|---|---|---|
| **Portal** | `web/` (Next.js 15 + Supabase), publicado pela Vercel em `xml.lotivisse.com.br` | Escritórios contábeis agendam competências, cadastram certificados A1, acompanham o Monitor Fiscal, o Monitoramento MEI e as notificações |
| **Robô** | `robo/` (Python + Playwright, Chrome via CDP) | Atende as filas do portal: ATF da SEFAZ-PB, NFS-e do Portal Nacional (ADN) e NF-e destinadas do Ambiente Nacional |
| **Servidor** | `servidor/` | Instala o robô na VPS (Hostinger, Ubuntu 24.04, 4 GB, 48 GB), junto do robô de certidões (repositório `consulta-de-CND`). `drive.sh` envia os arquivos ao Google Drive (rclone) |
| **Banco** | `web/supabase/schema.sql` | Tabelas, regras de acesso por escritório (RLS) e as funções das filas. Pode ser rodado de novo sem perder dados |

### Serviços do robô
1. **SEFAZ-PB (ATF, login do contador):**
   - NF-e de saída e de entrada, NFC-e e CT-e, recebidos pela caixa de mensagens;
   - faturas, extrato, omissão, certidão e conferência de cartão;
   - Dossiê MEI.

   A consulta é feita primeiro em HTML: se não há notas, o XML nem é pedido.
2. **NFS-e (API do ADN, certificado A1):**
   - notas emitidas e recebidas;
   - DANFSe em PDF: do portal ou gerado a partir do XML;
   - relatório de retenções;
   - XML único do mês, no envelope ABRASF, para a Domínio importar;
   - procuração do escritório;
   - MEI sem histórico sai com o ano inteiro.
3. **Monitor Fiscal (NF-e destinadas, NFeDistribuicaoDFe):**
   - consulta diária no horário escolhido pelo escritório;
   - Ciência da Operação automática;
   - XML e DANFE em PDF;
   - eventos de cancelamento.
4. **Alertas MEI por e-mail (Brevo):** enviados assim que o robô grava o Dossiê MEI, e todo dia pelo cron da Vercel.

### Pastas geradas
`<destino>/<Escritório>/Arquivos baixados/<ID>-<Nome>/<MMAAAA>/...`
- `MMAAAA` (por exemplo, `102026`) é o caminho que a importação automática da Domínio lê.
- Na VPS, o destino é `/home/lotivisse/xml/arquivos`. O `drive.sh` copia para o Google Drive a cada 10 minutos.

## 2. Estado do Git

- **Repositório:** `fiscal26/RPA-de-buscar-XML`.
- **Branch de trabalho:** `claude/blissful-hypatia-8a3wdc`.
- **Combinado com a usuária:** quando ela diz "faça o merge para o main", abrir o PR e fazer o merge. Depois, recriar o branch a partir do `origin/main` (`git checkout -B claude/blissful-hypatia-8a3wdc origin/main`).
- **Pendente de merge:** o commit `def11cc`, que faz o Monitor Fiscal buscar o XML de novo em 1 hora quando ele não sai logo depois da Ciência da Operação.
  - O `main` recebeu depois disso o PR #46 (`codex/trabalho`, listagem de Empresas com filtros), feito fora desta conversa.
  - Ao abrir o PR, confira se há conflito.
- **Último merge desta conversa:** PR #43 (componentes da marca no portal).

## 3. Passos que dependem da usuária

| Quando | O que fazer |
|---|---|
| Depois de cada merge que mexe em `robo/` | Na VPS: `sudo lotivisse atualizar xml` |
| Depois de merge com biblioteca nova em `robo/requirements.txt` | `sudo -u lotivisse /home/lotivisse/xml/venv/bin/pip install -q -r /home/lotivisse/xml/app/servidor/requirements.txt` e `sudo systemctl restart lotivisse-robo@xml` |
| Depois de merge que mexe em `web/supabase/schema.sql` | Colar o arquivo inteiro no SQL Editor do Supabase do portal de XML e clicar em Run. Depois, se precisar: `notify pgrst, 'reload schema';` |
| Merge só de `web/` | Nada: a Vercel publica sozinha |

Comandos úteis na VPS:
- `sudo lotivisse status|log|atualizar|configurar|ver-tela xml`
- `systemctl status lotivisse-xml-drive.service`

## 4. Pontos em aberto

1. **Monitor Fiscal com notas em resumo.**
   - A usuária viu notas em "resumo", sem pasta na VPS nem no Drive.
   - Causa: o Ambiente Nacional só libera o XML completo depois da Ciência da Operação, e às vezes alguns minutos depois dela.
   - A correção (`def11cc`) aguarda merge e `sudo lotivisse atualizar xml`.
   - Se a nota aparecer como "Só resumo" no Histórico, a ciência não foi registrada: ver a mensagem na coluna Situação do Monitor.
2. **Conexão real com a SEFAZ (Monitor Fiscal):** nunca foi validada por log nesta conversa, só com uma SEFAZ simulada.
   - O robô baixa a cadeia ICP-Brasil do ITI para `chaves/icp-brasil.pem`.
   - Pedir à usuária o trecho do log com "Monitor Fiscal".
3. **Auditoria (11/11):** relatório entregue, e a usuária vai dizer o que aprova. Itens resumidos:
   - **A. Segurança:**
     - A1: chave `service_role` na VPS → criar um papel restrito para o robô;
     - A2: ICP-Brasil baixado por HTTP sem verificação;
     - A3: MFA;
     - A4: CI e proteção do `main`;
     - A5: fixar as versões Python;
     - A6: segredo próprio para `/api/robo/alertas-mei`;
     - A7: derrubar as sessões ao trocar a senha;
     - A8: `/sair` por GET;
     - A9: CSP com nonce;
     - A10: permissões do usuário comum.
   - **B. Funcionamento:**
     - B1: limpeza de disco na VPS;
     - B2: alerta de robô parado;
     - B3: sino pesado;
     - B4: limite de 5.000 tarefas na tela inicial;
     - B5: agendamento duplicado;
     - B6: ciência recusada tentada por 90 dias;
     - B7: Monitor avança um lote por dia;
     - B8: validar a SEFAZ real;
     - B9: testes automáticos.
   - **C. LGPD:**
     - C1: Política de Privacidade e Termos (a usuária redige o texto jurídico);
     - C2: trilha de auditoria;
     - C3: retenção dos arquivos.
   - **D. Verificações nos painéis:**
     - Vercel Hobby versus uso comercial;
     - cadastro público desligado no Supabase;
     - backups;
     - `NEXT_PUBLIC_SITE_URL`;
     - portas VNC e CDP fechadas;
     - cópia da chave privada fora da VPS.
4. **NFC-e e NF-e emitidas no Monitor Fiscal:** ficaram para depois, porque dependem de serviço da SEFAZ de cada estado e a da Paraíba não oferece.
5. **Visual:** os componentes da marca (`web/components/ui/`) ainda não foram aplicados na página inicial pública nem nas tabelas grandes. A listagem de Empresas foi mexida no PR #46, fora desta conversa.

## 5. Regras combinadas (não quebrar)

- **Segredos:** nunca colocar no chat nem no GitHub. Isso vale para a chave `service_role`, `BREVO_API_KEY`, `CRON_SECRET` (só ASCII), `robo_privada.pem`, certificados A1 e senhas.
- **Chave privada do robô:** só vai para a VPS por WinSCP ou é gerada nela.
- **Cifragem:**
  - senhas do ATF: `v1:` (RSA-OAEP-SHA256);
  - certificados: `v2:` (AES-256-GCM com a chave em RSA);
  - chave pública em `XML_CHAVE_PUBLICA`, na Vercel.
- **Planilhas enviadas:** o portal nunca guarda a planilha, porque ela tem senhas.
- **Captcha:** não automatizar sem discutir antes.
- **Git:**
  - não usar force-push;
  - não pôr identificador de modelo em commit nem PR;
  - `web/lib/supabase/mock.ts` nunca entra no git.
- **Comunicação:** a usuária escreve em português e é da área contábil e tributária. Explicar em linguagem simples e com os passos exatos.

## 6. Testes

- **Robô:** `cd robo && python3 -m pytest -q tests`.
  - Os testes rápidos (sem `test_atf_simulado.py` e `test_gravador.py`) levam cerca de 10 s.
  - O simulador do ATF leva cerca de 18 min e precisa do Chromium.
- **Portal:** `cd web && npx tsc --noEmit`.
- **Banco:** dá para testar o `schema.sql` num PostgreSQL 16 local, com stubs dos papéis `anon`, `authenticated` e `service_role` e do schema `auth`.

## 7. Arquivos-chave

- `robo/robo_xml.py`: filas, Executor do ATF, NFS-e (`executar_nfse`), Monitor Fiscal (`executar_monitor`) e filas paralelas (`_fila_paralela`).
- `robo/atf_pb.py`: automação do ATF (consulta HTML/XML, permissão, Dossiê MEI com Optante SIMEI).
- `robo/nfse.py`: ADN, cache por NSU, DANFSe e lote ABRASF.
- `robo/nfe.py`: NFeDistribuicaoDFe, Ciência da Operação (XMLDSig), DANFE e ICP-Brasil. Documentação em `robo/NFE.md`.
- `robo/config.py`: opções, como `monitor_nfe`, `paralelo_nfse`, `pastas.formato_competencia` e `atf.gravar_passos`.
- `web/supabase/schema.sql`: tudo do banco.
- `web/app/painel/monitor/`: aba Monitor Fiscal.
- `web/lib/mei-dados.ts`: quem entra no Monitoramento MEI (só Optante SIMEI e empresas marcadas como MEI).
- `web/components/ui/`: componentes da marca (`Escolha`, `SeletorArquivo`, `Segmentado`, `BotaoConfirmar`).
- `servidor/LEIAME.md`: instalação e rotina da VPS.
