# Robô de XML na VPS (Hostinger, Ubuntu 24.04), ao lado do robô de certidões

Este guia leva o robô de XML (o que hoje roda no computador do escritório com o `iniciar_robo.bat` e o Chrome)
para a mesma VPS onde já roda o robô de certidões. O portal continua na Vercel e o banco no Supabase do portal de XML.

## Como a VPS fica
```
/home/lotivisse/
├── certidoes/        robô de certidões (já instalado)
├── xml/              robô de XML (este guia)
│   ├── app/          código (GitHub: RPA-de-buscar-XML)
│   ├── venv/         Python do robô
│   ├── chrome-perfil/  chaves/  Downloads/
│   └── arquivos/     XML, PDF e relatórios, uma pasta por escritório:
│       └── <Escritório>/Arquivos baixados/<ID>-<Nome>/<AAAA-MM>/...
└── Google Chrome oficial (compartilhado pelos robôs)
```

| Robô | Tela virtual | Porta do Chrome | Visualização (VNC) |
|---|---|---|---|
| certidoes | :10 | 9222 | 5900 |
| **xml** | **:11** | **9223** | **5901** |

Cada robô tem o próprio Chrome, perfil e porta: um não atrapalha o outro. Os serviços são os mesmos modelos do
robô de certidões (`lotivisse-tela@xml`, `lotivisse-chrome@xml`, `lotivisse-robo@xml`), religam sozinhos se
caírem ou se a VPS reiniciar, e são renovados às 4h junto com os de certidões. Tarefas em andamento voltam para a
fila, nada se perde.

## O que você precisa ter à mão
- O terminal da VPS (o mesmo do robô de certidões: *Terminal do navegador* no hPanel ou `ssh root@IP-DA-VPS`).
- Do `robo\config.json` do **computador do escritório**: o endereço do Supabase e a chave service_role **do
  portal de XML**. É um Supabase diferente do portal de certidões.
- O arquivo `robo\chaves\robo_privada.pem` do computador do escritório. Ele abre as senhas do ATF e os
  certificados A1 que o portal guardou. **Sem ele, a VPS não abre nada.** Não mande esse arquivo por e-mail nem
  pelo GitHub: você vai colar o conteúdo dele direto no terminal da VPS no passo 4.
- Acesso ao GitHub (repositório `RPA-de-buscar-XML`), para cadastrar a chave de leitura da VPS.

## Passo 1: colar o bloco de preparação no terminal da VPS
Copie o bloco inteiro, do `bash` até o `FIM`, cole no terminal e tecle **Enter**:

```bash
bash <<'FIM'
set -euo pipefail
REPO=git@github.com:fiscal26/RPA-de-buscar-XML.git
id lotivisse >/dev/null 2>&1 || { echo "Instale primeiro o robô de certidões."; exit 1; }
CHAVE=/home/lotivisse/.ssh/github-xml   # cada repositório tem a sua chave de leitura
if [ ! -f "$CHAVE" ]; then
  sudo -u lotivisse mkdir -p -m 700 /home/lotivisse/.ssh
  sudo -u lotivisse ssh-keygen -q -t ed25519 -N "" -C "vps-lotivisse-xml" -f "$CHAVE"
fi
SSHCMD="ssh -i $CHAVE -o StrictHostKeyChecking=accept-new -o BatchMode=yes"
echo
echo "=== Copie a linha abaixo e cadastre no GitHub (repositório RPA-de-buscar-XML > Settings > Deploy keys > Add deploy key)"
echo "=== Título: VPS LotiVisse XML. NÃO marque 'Allow write access'."
echo
cat "$CHAVE.pub"
echo
echo "Aguardando o cadastro da chave no GitHub (confiro a cada 10 segundos)..."
until sudo -u lotivisse env GIT_SSH_COMMAND="$SSHCMD" git ls-remote "$REPO" >/dev/null 2>&1; do sleep 10; done
echo "Chave aceita pelo GitHub."
sudo -u lotivisse mkdir -p /home/lotivisse/xml
if [ ! -d /home/lotivisse/xml/app/.git ]; then
  sudo -u lotivisse env GIT_SSH_COMMAND="$SSHCMD" git clone -q "$REPO" /home/lotivisse/xml/app
fi
sudo -u lotivisse git -C /home/lotivisse/xml/app config core.sshCommand "$SSHCMD"
FIM
cd /home/lotivisse/xml/app && bash servidor/instalar.sh
```

O mesmo bloco está em `servidor/preparar.sh`, só para consulta.

## Passo 2: cadastrar a chave de leitura no GitHub
O terminal mostra uma linha `ssh-ed25519 ...` e fica aguardando.
1. No GitHub, abra o repositório **RPA-de-buscar-XML** → **Settings** → **Deploy keys** → **Add deploy key**.
2. **Title:** `VPS LotiVisse XML`. **Key:** cole a linha `ssh-ed25519 ...` inteira.
3. **Não** marque *Allow write access*.
4. Clique em **Add key**. Em até 10 segundos o terminal diz "Chave aceita pelo GitHub" e a instalação começa.

## Passo 3: responder às perguntas
1. Endereço do Supabase do **portal de XML** (`https://....supabase.co`).
2. Chave service_role do Supabase do **portal de XML**. Ela não aparece enquanto você cola, e isso é normal.
3. Nome deste robô (Enter aceita `vps-hostinger`).
4. Filas deste robô (Enter aceita `sefaz,nfse`, as duas). Veja o último item de *Se algo não funcionar*.

O instalador recusa o endereço do Supabase das certidões, para os dois portais não se misturarem.

## Passo 4: colar a chave privada
O terminal pede a chave privada.
1. No computador do escritório, abra `robo\chaves\robo_privada.pem` no **Bloco de Notas**.
2. Copie **tudo**, de `-----BEGIN PRIVATE KEY-----` até `-----END PRIVATE KEY-----`.
3. Cole no terminal da VPS e tecle **Enter**. Ela não aparece enquanto você cola.

Logo depois, o instalador confere a chave com o portal e mostra:
- `senha do ATF: abre com esta chave` e `certificado A1: abre com esta chave`: tudo certo;
- `NÃO abre`: a chave colada não é a do computador do escritório. Rode `sudo rm /home/lotivisse/xml/chaves/robo_privada.pem`
  e depois `sudo lotivisse configurar xml` para colar de novo.

No fim aparece a situação do robô (`lotivisse status xml`).

## Passo 5: conferir no portal
1. No portal de XML, em **Agendamentos** (entrando como administrador), deve aparecer **"Robô ligado (vps-hostinger)"**.
2. Agende uma competência de teste com 1 ou 2 empresas, da SEFAZ e da NFS-e.
3. Acompanhe com `lotivisse log xml`.

**Computador do escritório:** quando a VPS estiver funcionando, **feche o robô de XML do computador**. Os dois
até rodam juntos sem pegar a mesma tarefa, mas os arquivos ficariam divididos entre o computador e a VPS.

## Passo 6: mandar os arquivos para o Google Drive
Na VPS os arquivos ficam em `/home/lotivisse/xml/arquivos`, com **uma pasta por escritório** (o nome do escritório
cadastrado no portal). Para eles chegarem aos escritórios pelo Google Drive:
```
sudo bash /home/lotivisse/xml/app/servidor/drive.sh
```
O comando explica cada passo:
1. **No seu computador**, abra o PowerShell e deixe aberto: `ssh -L 53682:localhost:53682 root@IP-DA-VPS`.
2. Abra no navegador do seu computador o link que a VPS mostrar, entre na conta Google do escritório e autorize.
3. Escolha o nome da pasta no Drive (Enter aceita `RPA XML LotiVisse`).

Depois disso, a cada 10 minutos o que é novo vai para essa pasta do Drive:
```
RPA XML LotiVisse/
├── Contábil Sousa/Arquivos baixados/15-Padaria Central/2026-09/...
└── Outro Escritório/Arquivos baixados/...
```
- O envio **só copia**: apagar no Drive não apaga na VPS.
- Só vão os arquivos **dos últimos 35 dias**. O que o escritório apagar, mover ou arquivar no Drive depois disso
  não volta. Na VPS continua tudo guardado.
- O acesso dado ao robô é o mais restrito do Drive: ele só enxerga a pasta que ele mesmo criou, nada mais da conta.

### Dar a cada escritório só a pasta dele
A pasta de um escritório aparece no Drive depois do primeiro agendamento dele.
1. No Google Drive (drive.google.com), entre na conta usada no `drive.sh` e abra **RPA XML LotiVisse**.
2. Clique com o botão direito na pasta do escritório → **Compartilhar**.
3. Digite o e-mail Google do escritório, escolha **Leitor** e clique em **Enviar**.

O escritório vê só a pasta dele, em **Compartilhados comigo**. Para ela aparecer no computador do escritório:
1. No Drive do escritório, em **Compartilhados comigo**, clique com o botão direito na pasta → **Organizar** →
   **Adicionar atalho** → **Meu Drive**.
2. No computador do escritório, instale o **Google Drive para computador** com a conta do escritório. A pasta aparece
   em `G:\Meu Drive\<Escritório>`.
3. Se o sistema contábil importa os XML direto da pasta, nas preferências do Google Drive para computador escolha
   **Espelhar arquivos**, ou clique com o botão direito na pasta → **Disponível off-line**.

Se o escritório for o próprio dono da conta usada no `drive.sh`, não precisa compartilhar: a pasta já está no
**Meu Drive** dele.

## Comandos do dia a dia (no terminal da VPS)
Com os dois robôs instalados, informe qual: `certidoes` ou `xml`.

| Comando | Para quê |
|---|---|
| `lotivisse status` | os dois robôs: serviços, Chrome, memória, disco e últimas linhas do log |
| `lotivisse log xml` | acompanhar o robô de XML ao vivo (Ctrl+C sai) |
| `sudo lotivisse reiniciar xml` | reiniciar o Chrome e o robô de XML |
| `sudo lotivisse atualizar xml` | **depois de cada merge que mexe no robô de XML**: baixa a versão nova e reinicia |
| `sudo lotivisse configurar xml` | trocar a chave do Supabase, o nome do robô ou a chave privada |
| `sudo lotivisse ver-tela xml` | ver o Chrome do robô de XML pelo seu computador (porta **5901**) |
| `systemctl status lotivisse-xml-drive.service` | último envio ao Google Drive |

Para ver a tela do Chrome do robô de XML, siga a seção *Ver a tela do Chrome de um robô* do guia das certidões,
trocando a porta 5900 por **5901**: `ssh -L 5901:localhost:5901 root@IP-DA-VPS` e o VNC em `localhost:5901`.

## Memória
A VPS tem 4 GB e 4 GB de reserva (swap), e cada robô usa um Chrome. Confira de vez em quando com
`lotivisse status` (linha "Memória"). Se ficar acima de 3,5 GB com frequência, vale aumentar o plano da VPS.

## Se algo não funcionar
- Rode `lotivisse status xml` e `lotivisse log xml` e mande o print.
- **"Chrome responde na porta 9223: NÃO":** `sudo lotivisse reiniciar xml` e, um minuto depois, `lotivisse status xml`.
- **O robô não aparece no portal:** `sudo lotivisse configurar xml` e confira o endereço e a chave do Supabase do portal de XML.
- **"Senha não pôde ser lida" ou "certificado não pôde ser aberto" nas tarefas:** a chave privada não é a do
  computador do escritório (passo 4).
- **O ATF não abre ou recusa a conexão:** alguns portais de governo barram IPs de datacenter. Abra a tela do
  Chrome (`sudo lotivisse ver-tela xml`) e tente entrar no ATF à mão. Se o ATF não abrir pela VPS, divida as filas:
  - na VPS: `sudo lotivisse configurar xml` e responda `nfse` na pergunta das filas;
  - no computador do escritório: no `robo\config.json`, dentro de `"portal"`, acrescente `"filas": ["sefaz"]`
    (cuidado com a vírgula na linha de cima) e ligue o robô do computador de novo.

  Assim a SEFAZ fica com o computador e a NFS-e, que usa a API oficial, com a VPS. O início do log de cada robô
  mostra as filas dele ("Filas deste robô: ...").

## Gravar o passo a passo do ATF

O `robo_xml.log` já mostra cada passo (linhas com `·`), inclusive os alertas do ATF que o robô fecha sozinho.
Para ter também um print da tela a cada passo, ligue a gravação:

```
sudo -u lotivisse python3 -c "import json;p='/home/lotivisse/xml/app/robo/config.json';c=json.load(open(p,encoding='utf-8-sig'));c.setdefault('atf',{})['gravar_passos']=True;json.dump(c,open(p,'w',encoding='utf-8'),ensure_ascii=False,indent=2)"
sudo systemctl restart lotivisse-robo@xml
```

Os prints ficam em `/home/lotivisse/xml/arquivos/_diagnostico/passos/` (uma pasta por sessão, com o `passos.txt`),
só dos últimos 3 dias, e não vão para o Google Drive. Baixe pelo WinSCP. Para desligar, troque `True` por `False`
no comando acima e reinicie de novo.
