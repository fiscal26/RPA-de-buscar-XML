# LotiVisse XML — robô de XML da SEFAZ-PB (piloto)

Robô que entra no **ATF da SEFAZ-PB** de cada empresa, baixa os XML de NF-e/NFC-e do período
pedido e salva numa pasta do seu computador, organizados assim:

```
<pasta destino>/
  Padaria Centro - 11.222.333-0001-81/
    2026-09/
      NF-e Emitidas/   <chave>.xml ...
      NF-e Recebidas/  <chave>.xml ...
        Eventos/       cancelamentos, cartas de correção
    _conferir/         XML que veio com CNPJ de outra empresa (nunca vai para a pasta errada)
```

O robô é ativado pelo **portal web** (mesmo desenho do portal de CND): o cliente envia a planilha
modelo na área de agendamento, escolhe período, tipos e horário, e o robô no seu PC executa.

| Peça | Onde roda | Pasta |
|---|---|---|
| Portal LotiVisse XML (login, agendamento, acompanhamento) | Vercel + Supabase, em `xml.lotivisse.com.br` | `web/` |
| Robô (ATF, download, organização das pastas) | Seu PC, com o Chrome | `robo/` |
| Planilha modelo | Portal e robô | `modelos/modelo_empresas_xml.xlsx` |

Passo a passo de implantação: **[web/IMPLANTACAO.md](web/IMPLANTACAO.md)**.

## Planilha modelo

Aba **Empresas**, uma linha por empresa, a partir da linha 2:

| Coluna | Conteúdo |
|---|---|
| A — CNPJ | com ou sem pontuação; o dígito verificador é conferido |
| B — Apelido | nome curto; vira o nome da pasta |
| C — Senha ATF | obrigatória na primeira vez; depois pode ficar em branco (usa a já cadastrada) |
| D — Login ATF (opcional) | só se o login do ATF não for o próprio CNPJ |

## Segurança das senhas do ATF

- O portal **cifra a senha assim que lê a planilha**, com a chave pública do robô (RSA-OAEP 3072).
- No banco fica só a versão cifrada. O navegador do cliente nem consegue ler essa coluna.
- **Só o robô, no seu PC, tem a chave privada** (`robo/chaves/robo_privada.pem`, fora do Git) e abre
  a senha na hora do login. A senha não vai para logs nem para o pacote de diagnóstico.
- Entre uma empresa e outra o robô sai do ATF e apaga os cookies da SEFAZ-PB, para uma empresa nunca
  herdar a sessão da outra.

Faça uma cópia de segurança da chave privada: sem ela, as senhas cadastradas precisam ser enviadas de novo.

## Robô: instalação e uso

```bash
cd robo
pip install -r requirements.txt
copy config.exemplo.json config.json     # e ajuste a pasta destino e o portal
gerar_chaves.bat                         # uma vez só: cria a chave e mostra a pública para a Vercel
abrir_chrome.bat                         # Chrome com a porta 9222 e perfil próprio
iniciar_robo.bat                         # liga o robô do portal (deixe a janela aberta)
```

Não é preciso `playwright install`: o robô usa o **seu** Google Chrome.

**Teste sem o portal** (direto da planilha, bom para a calibração):

```bash
python robo_xml.py --local empresas.xlsx --inicio 01/09/2026 --fim 30/09/2026 --tipos nfe_emitidas,nfe_recebidas
```

Gera também um relatório em `<destino>/_relatorios/`.

### Como o robô trabalha no ATF

1. **Automático:** abre o ATF, acha login e senha (inclusive dentro de quadros), digita tecla por
   tecla e entra. Se a tela de download estiver configurada (`atf.url_download` no `config.json`),
   preenche o período, marca o tipo e clica em consultar/baixar.
2. **Assistido:** se uma etapa não for reconhecida (tela diferente, captcha, função ainda não
   configurada), o robô avisa e espera você concluir no Chrome. Ele captura sozinho o XML/ZIP baixado,
   seja como download, resposta do site ou arquivo novo na pasta Downloads.
3. Abre ZIP (inclusive ZIP dentro de ZIP), lê cada XML, confere o CNPJ (emitente nas emitidas,
   destinatário nas recebidas) e salva sem duplicar: rodar de novo o mesmo período não repete arquivos.

Situações que aparecem no portal: **XML salvos**, **Sem notas**, **Login recusado** (senha/login do ATF),
**ATF fora do ar**, **Erro** e **Cancelado**.

### Diagnóstico

Quando uma etapa não é reconhecida, o robô salva em `<destino>/_diagnostico/` uma pasta com
`tela.png`, `campos.txt` (campos, botões e links de cada quadro, **sem valores digitados**),
`texto.txt` e `log.txt`. É com esse pacote que calibramos os seletores do ATF.

## Situação do piloto

- [x] Portal: login, agendamento com planilha, período, tipos e data/hora; acompanhamento por empresa; cancelamento; cadastro de empresas
- [x] Banco: fila com agendamento futuro, vários robôs, tarefa presa volta à fila, regras de acesso por cliente
- [x] Robô: login no ATF, captura de downloads, modo assistido, organização e conferência dos XML, relatório
- [ ] **Calibrar no ATF real**: endereços das telas de download por tipo e seletores (o site da SEFAZ-PB
      não abre a partir do ambiente de desenvolvimento; a calibração é feita no seu PC com o diagnóstico)
- [ ] Definir se o login do ATF é o CNPJ ou outro identificador (coluna D já existe)

## Testes

```bash
cd robo && python -m pytest -q tests
```

Inclui um **ATF simulado** (login dentro de quadro, tela de período, ZIP e "nenhuma nota") num Chrome de
verdade, e a prova de que a senha cifrada pelo portal (Node) é aberta pelo robô (Python).
