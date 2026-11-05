#!/usr/bin/env bash
# Envia os arquivos do robô de XML para o Google Drive (rode como root, depois do instalar.sh).
# A cada 10 minutos, o que é novo em /home/lotivisse/xml/arquivos é copiado para uma pasta do Drive, com uma
# subpasta por escritório (cada escritório recebe acesso só à dele, compartilhando no Drive).
# Só copia os arquivos dos últimos 35 dias: o que o escritório apagar ou arquivar no Drive depois disso não volta.
# Apagar no Drive não apaga na VPS, e vice-versa. O acesso ao Drive é o mais restrito possível
# (o robô só enxerga a pasta que ele mesmo criou, nada mais da conta).
# Rodar de novo troca a pasta de destino ou a conta.
set -euo pipefail

USUARIO=lotivisse
DIR=/home/$USUARIO/xml
ARQUIVOS=$DIR/arquivos
REMOTO=gdrive
CONF=/home/$USUARIO/.config/rclone/rclone.conf

passo() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok() { printf '\033[1;32m%s\033[0m\n' "$*"; }
falha() { printf '\033[1;31mERRO: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || falha "rode como root: sudo bash $0"
[ -d "$ARQUIVOS" ] || falha "não achei $ARQUIVOS. Instale antes o robô de XML (servidor/instalar.sh)."

passo "Programa de envio (rclone)"
command -v rclone >/dev/null || { apt-get update -y >/dev/null; DEBIAN_FRONTEND=noninteractive apt-get install -y rclone >/dev/null; }
rclone version 2>/dev/null | sed -n 1p || true  # (head fecharia o cano e o set -e pararia o script)

TROCAR=n
ligado() { sudo -u "$USUARIO" rclone listremotes 2>/dev/null | grep -x "$REMOTO:" >/dev/null; }
if ligado; then
  printf 'O Google Drive já está ligado. Entrar com outra conta? [s/N]: '; read -r TROCAR </dev/tty
fi
if ! ligado || [ "${TROCAR,,}" = s ]; then
  IP=$(curl -4 -s --max-time 5 https://ifconfig.me || hostname -I | awk '{print $1}')
  passo "Entrar na conta Google (uma vez só)"
  cat <<EOF
1. No SEU COMPUTADOR, abra o PowerShell e deixe aberto:
       ssh -L 53682:localhost:53682 root@$IP
2. Volte aqui e tecle Enter. Vai aparecer um link que começa com http://127.0.0.1:53682/auth
3. Abra esse link no navegador do SEU COMPUTADOR, entre na conta Google do escritório e autorize.
4. Quando o navegador mostrar "Success", volte aqui. Depois pode fechar o PowerShell.
EOF
  read -r _ </dev/tty
  if ss -ltn 2>/dev/null | grep -q '127.0.0.1:53682 '; then
    ss -ltnp 2>/dev/null | grep ':53682 ' || true
    falha "a porta 53682 da VPS já está ocupada (um túnel aberto DENTRO da VPS ou uma tentativa anterior presa).
O túnel do passo 1 é no PowerShell do SEU COMPUTADOR (o prompt começa com PS C:\...), não na VPS.
Libere a porta com:  fuser -k 53682/tcp   e rode de novo."
  fi
  sudo -u "$USUARIO" rclone config delete "$REMOTO" >/dev/null 2>&1 || true
  sudo -u "$USUARIO" rclone config create "$REMOTO" drive scope=drive.file </dev/tty \
    || falha "não consegui entrar no Google Drive. Confira o túnel do passo 1 e rode de novo."
  chmod 600 "$CONF"
  ok "Google Drive ligado."
fi

passo "Pasta do Drive"
ATUAL=$(grep -m1 '^PASTA_DRIVE=' /etc/lotivisse/xml-drive.env 2>/dev/null | cut -d= -f2- || true)
printf 'Nome da pasta no Google Drive [%s]: ' "${ATUAL:-RPA XML LotiVisse}"; read -r PASTA </dev/tty
PASTA=${PASTA:-${ATUAL:-RPA XML LotiVisse}}
printf 'PASTA_DRIVE=%s\n' "$PASTA" > /etc/lotivisse/xml-drive.env

passo "Envio automático a cada 10 minutos"
cat > /etc/systemd/system/lotivisse-xml-drive.service <<'EOF'
[Unit]
Description=LotiVisse xml - envia os arquivos novos para o Google Drive
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
User=lotivisse
EnvironmentFile=/etc/lotivisse/xml-drive.env
# --min-age: arquivo ainda sendo gravado pelo robô fica para a próxima rodada; --max-age: só os últimos 35 dias
# (o que o escritório apagar ou arquivar no Drive depois disso não volta); o diagnóstico não vai para o Drive
ExecStart=/usr/bin/rclone copy /home/lotivisse/xml/arquivos "gdrive:${PASTA_DRIVE}" --min-age 2m --max-age 35d --exclude "_diagnostico/**" \
  --log-file /home/lotivisse/xml/drive.log --log-level NOTICE
EOF
cat > /etc/systemd/system/lotivisse-xml-drive.timer <<'EOF'
[Unit]
Description=LotiVisse xml - envio ao Google Drive a cada 10 minutos
[Timer]
OnBootSec=3min
OnUnitActiveSec=10min
[Install]
WantedBy=timers.target
EOF
cat > /etc/logrotate.d/lotivisse-xml-drive <<'EOF'
/home/lotivisse/xml/drive.log {
  weekly
  rotate 8
  compress
  missingok
  notifempty
  copytruncate
}
EOF
systemctl daemon-reload
systemctl enable --now lotivisse-xml-drive.timer

passo "Primeiro envio"
if systemctl start lotivisse-xml-drive.service; then
  ok "Arquivos enviados para a pasta \"$PASTA\" do Google Drive. Daqui em diante, o envio é automático a cada 10 minutos."
  echo "Dentro dela há uma pasta por escritório: compartilhe cada uma com o e-mail Google do escritório (servidor/LEIAME.md)."
else
  echo "O primeiro envio falhou. Veja: tail -n 30 $DIR/drive.log"
fi
echo "Conferir o último envio: systemctl status lotivisse-xml-drive.service --no-pager | tail -n 5"
