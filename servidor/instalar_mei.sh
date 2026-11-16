#!/usr/bin/env bash
# Executar após atualizar o código e aplicar a migração do Supabase.
set -euo pipefail
APP=/home/lotivisse/xml/app
PYTHON=/home/lotivisse/xml/venv/bin/python
[ "$(id -u)" = 0 ] || { echo "Use sudo para instalar o serviço MEI." >&2; exit 1; }
[ -x "$PYTHON" ] && [ -f "$APP/robo/config.json" ] && [ -f "$APP/servidor/mei_cadastros.py" ] || {
  echo "Instale/atualize primeiro o robô XML e seu config.json." >&2; exit 1;
}
# Não imprime chaves nem coloca credenciais na unidade systemd.
sudo -u lotivisse "$PYTHON" -c 'import sys; sys.path.insert(0,sys.argv[1]); from mei_cadastros import configuracao; configuracao(sys.argv[2])' "$APP/servidor" "$APP/robo/config.json"
cat > /etc/systemd/system/lotivisse-mei-cadastros.service <<'UNIT'
[Unit]
Description=Verificacao cadastral MEI do portal XML
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=lotivisse
Group=lotivisse
WorkingDirectory=/home/lotivisse/xml/app
ExecStart=/home/lotivisse/xml/venv/bin/python -u /home/lotivisse/xml/app/servidor/mei_cadastros.py --config /home/lotivisse/xml/app/robo/config.json
Restart=always
RestartSec=20
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
UMask=0077
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable lotivisse-mei-cadastros.service
systemctl restart lotivisse-mei-cadastros.service
systemctl --no-pager status lotivisse-mei-cadastros.service
echo "Serviço MEI instalado. Logs: journalctl -u lotivisse-mei-cadastros -n 30 --no-pager"
