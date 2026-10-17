# LotiVisse XML — robô de XML da SEFAZ-PB (piloto)

Robô que entra no **ATF da SEFAZ-PB com o login do contador**, pesquisa as notas de cada empresa
pela **inscrição estadual** e salva os XML da competência numa pasta do seu computador:

```
<pasta destino>/
  015 - Padaria Centro/            (ID - NOME FANTASIA; sem ID: "Nome - IE 16.012.345-3")
    2026-09/
      NF-e Saida/      <chave>.xml ...     empresa como emitente
      NF-e Entrada/    <chave>.xml ...     empresa como destinatária
      NFC-e/           <chave>.xml ...
        Eventos/       cancelamentos, cartas de correção
    _conferir/         XML que veio de outra empresa (nunca vai para a pasta errada)
```

O robô é ativado pelo **portal web**: o cliente envia a planilha modelo na área de agendamento,
escolhe a competência e o horário, e o robô no seu PC executa.

| Peça | Onde roda | Pasta |
|---|---|---|
| Portal LotiVisse XML (login, agendamento, acompanhamento) | Vercel + Supabase próprio, em `xml.lotivisse.com.br` | `web/` |
| Robô (ATF, download, organização das pastas) | Seu PC, com o Chrome | `robo/` |
| Planilha modelo | Portal e robô | `modelos/modelo_empresas_sefaz_pb.xlsx` |

Passo a passo de implantação: **[web/IMPLANTACAO.md](web/IMPLANTACAO.md)**.

## Planilha modelo

As colunas são achadas pelo nome do cabeçalho. O robô de XML usa:

| Coluna | Uso |
|---|---|
| ATIVA | em branco ou S = ativa; N = ignorada |
| ID, ID_FILIAL | códigos do escritório; o ID entra no nome da pasta |
| CNPJ | opcional; ajuda a conferir os XML |
| INSCRICAO ESTADUAL | **obrigatória**: é por ela que o ATF pesquisa (dígito verificador da PB conferido) |
| NOME FANTASIA | nome da pasta |
| LOGIN, SENHA | acesso do contador ao ATF. A senha só precisa vir uma vez por login |
| NF-e Saida, NF-e Entrada, NFC-e | **S** (ou X, SIM) = baixar esse XML |

CT-e, Download Faturas, Extrato de Pagamentos, Omissão e Inadimplência, Certidão de Débitos,
Conferência Cartão de Crédito e Dossiê MEI ficam para outros serviços: este robô não usa essas colunas.

## Roteiro no ATF

1. Login com LOGIN e SENHA do contador. **Um login, uma sessão:** todas as empresas daquele login
   são feitas em sequência, sem sair e entrar de novo. Se a sessão expirar (15 min), o robô entra de novo.
2. **NF-e Saída / Entrada:** menu *NF-e* > *Consulta NF-e por Emitentes/Destinatários* (FIS_1322).
   *Data de Emissão* do 1º ao último dia da competência; inscrição estadual no bloco **Emitente** (saída)
   ou **Destinatário** (entrada), com *Tipo de Identificação* = Inscrição Estadual; *Pesquisar*.
3. **NFC-e:** menu *NFC-e* > *Consulta por Emitente* (FIS_1484). *Data Emissão Inicial/Final* e a
   inscrição no bloco **Emitente**; *Pesquisar*.
4. Na lista de notas: marca todas e baixa o XML/ZIP. Se o menu não responder, abre a tela pelo campo
   *Função* do topo (FIS_1322 / FIS_1484).
5. Abre ZIP, confere cada XML pela IE/CNPJ (emitente na saída e NFC-e, destinatário na entrada) e salva
   sem duplicar: rodar de novo a mesma competência não repete arquivos.

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

### Diagnóstico

Quando uma etapa não é reconhecida, o robô salva em `<destino>/_diagnostico/` uma pasta com
`tela.png`, `campos.txt` (campos, botões, opções e links, **sem valores digitados**), `texto.txt`
e `log.txt`. É com esse pacote que ajustamos o roteiro.

## Situação do piloto

- [x] Planilha modelo do escritório, lida igual no portal e no robô
- [x] Portal: login, agendamento por competência e horário, acompanhamento, cancelamento, empresas e logins
- [x] Banco próprio: fila com agendamento futuro, agrupamento por login, regras de acesso por cliente
- [x] Robô: login do contador, telas FIS_1322 e FIS_1484, blocos Emitente/Destinatário, captura do download, modo assistido
- [ ] **Validar no ATF real**: tela de login e o que aparece depois do *Pesquisar* (lista de notas e botão de download)

## Testes

```bash
cd robo && python -m pytest -q tests
```

Inclui um **ATF simulado** com o menu, as telas FIS_1322/FIS_1484 e os blocos Emitente/Destinatário,
num Chrome de verdade: prova que duas empresas do mesmo login usam uma sessão só e que uma senha
recusada não é tentada de novo.
