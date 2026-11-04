#!/usr/bin/env bash
# Primeiro passo na VPS para o robô de XML (o repositório é privado): gera a chave de leitura do GitHub deste
# repositório, espera você cadastrá-la, baixa o projeto e chama o instalador. Rode como root.
# Pressupõe o robô de certidões já instalado (usuário lotivisse, Chrome e serviços).
# O conteúdo deste arquivo é o mesmo bloco que está no servidor/LEIAME.md para colar no terminal.
set -euo pipefail
REPO=git@github.com:fiscal26/RPA-de-buscar-XML.git
id lotivisse >/dev/null 2>&1 || { echo "Instale primeiro o robô de certidões (usuário lotivisse não existe)."; exit 1; }
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
cd /home/lotivisse/xml/app && bash servidor/instalar.sh
