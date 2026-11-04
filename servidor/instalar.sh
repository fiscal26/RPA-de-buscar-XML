#!/usr/bin/env bash
# Instala o robô de XML da LotiVisse na VPS (Ubuntu 24.04), ao lado do robô de certidões. Rode como root.
# Usa a organização que o instalador do robô de certidões (repositório consulta-de-CND) já montou:
#
#   /home/lotivisse/xml/app            código (clone do GitHub: RPA-de-buscar-XML)
#   /home/lotivisse/xml/venv           Python do robô
#   /home/lotivisse/xml/chrome-perfil  perfil do Chrome deste robô
#   /home/lotivisse/xml/chaves         chave privada (abre as senhas do ATF e os certificados A1)
#   /home/lotivisse/xml/arquivos       XML, PDF e relatórios baixados (Arquivos baixados/<ID>-<Nome>/<AAAA-MM>/...)
#   /etc/lotivisse/xml.env             tela :11, Chrome 9223, visualização 5901
#
# Serviços: os mesmos modelos do robô de certidões (lotivisse-tela@xml, lotivisse-chrome@xml, lotivisse-robo@xml).
# Pode ser rodado de novo sem problema: o que já existe é mantido (para trocar uma chave, rode de novo).
set -euo pipefail

USUARIO=lotivisse
CASA=/home/$USUARIO
ROBO=xml
DIR=$CASA/$ROBO
APP=$DIR/app
VENV=$DIR/venv
CHAVES=$DIR/chaves
ARQUIVOS=$DIR/arquivos
PORTA_CHROME=9223

passo() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok() { printf '\033[1;32m%s\033[0m\n' "$*"; }
falha() { printf '\033[1;31mERRO: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || falha "rode como root (ou com sudo)."
[ -f "$APP/robo/robo_xml.py" ] || falha "não achei $APP/robo/robo_xml.py. Siga o passo a passo do servidor/LEIAME.md."
. /etc/os-release
[ "${ID:-}" = ubuntu ] || falha "este instalador é para Ubuntu (24.04). Sistema encontrado: ${PRETTY_NAME:-desconhecido}."

# A base da VPS (usuário, tela virtual, Chrome oficial, serviços-modelo, firewall, comando lotivisse) vem do
# instalador do robô de certidões. Este instalador só acrescenta o robô de XML a ela.
passo "Conferindo a base da VPS (instalada com o robô de certidões)"
for f in /etc/systemd/system/lotivisse-tela@.service /etc/systemd/system/lotivisse-chrome@.service \
         /etc/systemd/system/lotivisse-robo@.service /usr/local/bin/lotivisse; do
  [ -e "$f" ] || falha "falta $f. Instale primeiro o robô de certidões (servidor/LEIAME.md do repositório consulta-de-CND)."
done
command -v google-chrome-stable >/dev/null || falha "o Google Chrome oficial não está instalado. Rode: sudo lotivisse atualizar certidoes"
id "$USUARIO" >/dev/null 2>&1 || falha "o usuário $USUARIO não existe. Instale primeiro o robô de certidões."
ok "Base encontrada: usuário $USUARIO, Chrome $(google-chrome-stable --version | grep -oE '[0-9.]+' | head -1), serviços e comando lotivisse."

passo "Pastas do robô de XML"
install -d -o "$USUARIO" -g "$USUARIO" "$DIR" "$DIR/Downloads" "$DIR/chrome-perfil" "$ARQUIVOS"
install -d -o "$USUARIO" -g "$USUARIO" -m 700 "$CHAVES"
chown -R "$USUARIO:$USUARIO" "$APP"
cat > /etc/lotivisse/$ROBO.env <<EOF
# Robô de XML (RPA-de-buscar-XML). Portas reservadas: certidoes = :10/9222/5900, xml = :11/9223/5901
DISPLAY=:11
NAVEGADOR=/usr/bin/google-chrome-stable
PORTA_CHROME=$PORTA_CHROME
PORTA_VNC=5901
PROGRAMA=robo/robo_xml.py
LOG=$APP/robo/robo_xml.log
CHROME_EXTRAS=
EOF

passo "Python do robô"
[ -d "$VENV" ] || sudo -u "$USUARIO" python3 -m venv "$VENV"
sudo -u "$USUARIO" "$VENV/bin/pip" install -q --upgrade pip
sudo -u "$USUARIO" "$VENV/bin/pip" install -q -r "$APP/servidor/requirements.txt"

passo "Configuração (config.json)"
CONFIG="$APP/robo/config.json"
pergunta() {  # pergunta <variável> <texto> <secreto 0|1> <valor atual>
  local resp=""
  if [ -n "$4" ]; then
    if [ "$3" = 1 ]; then printf '%s [já configurado; Enter mantém]: ' "$2"; else printf '%s [%s]: ' "$2" "$4"; fi
  else
    printf '%s: ' "$2"
  fi
  if [ "$3" = 1 ]; then read -rs resp </dev/tty; echo; else read -r resp </dev/tty; fi
  printf -v "$1" '%s' "${resp:-$4}"
}
atual() { [ -f "$CONFIG" ] && python3 -c "import json,sys;c=json.load(open(sys.argv[1],encoding='utf-8-sig'));print(c.get(sys.argv[2],{}).get(sys.argv[3],''))" "$CONFIG" "$1" "$2" 2>/dev/null || true; }
# Atenção: o portal de XML tem um Supabase próprio, diferente do portal de certidões
pergunta SUPA "Endereço do Supabase do portal de XML (https://...supabase.co)" 0 "$(atual portal supabase_url)"
pergunta CHAVE "Chave service_role do Supabase do portal de XML (não aparece enquanto digita)" 1 "$(atual portal chave_service_role)"
CERT_CFG=$CASA/certidoes/app/config.json
if [ -f "$CERT_CFG" ] && grep -q "\"supabase_url\": \"${SUPA%/}\"" "$CERT_CFG"; then
  falha "esse é o Supabase do portal de certidões. Use o do portal de XML (o do config.json do robô de XML no computador)."
fi
NOME_PADRAO="$(atual portal nome_robo)"; NOME_PADRAO="${NOME_PADRAO:-vps-hostinger}"
pergunta NOME "Nome deste robô (aparece no portal)" 0 "$NOME_PADRAO"
# Filas: "sefaz" (ATF, usa o Chrome) e "nfse" (Portal Nacional). Se o ATF barrar o IP da VPS, deixe só nfse aqui
# e a SEFAZ com o robô do computador do escritório.
FILAS_PADRAO="$(atual portal filas | tr -d "[]' " | tr -d '"')"; FILAS_PADRAO="${FILAS_PADRAO:-sefaz,nfse}"
pergunta FILAS "Filas deste robô (sefaz, nfse ou sefaz,nfse)" 0 "$FILAS_PADRAO"
case "$SUPA" in https://*.supabase.co*) ;; *) falha "o endereço do Supabase deve começar com https:// e terminar em .supabase.co";; esac
case "$CHAVE" in
  sb_secret_*) ;;
  eyJ*) [ ${#CHAVE} -gt 100 ] || falha "a chave service_role parece incompleta (é um texto longo que começa com eyJ)." ;;
  *) falha "a chave do Supabase deve ser a service_role (começa com eyJ) ou a Secret key (começa com sb_secret_)." ;;
esac
SUPA="$SUPA" CHAVE="$CHAVE" NOME="$NOME" FILAS="$FILAS" DIR="$DIR" ARQUIVOS="$ARQUIVOS" CHAVES="$CHAVES" PORTA="$PORTA_CHROME" python3 - "$CONFIG" <<'PY'
import json, os, sys
caminho = sys.argv[1]
try:
    cfg = json.load(open(caminho, encoding="utf-8-sig"))
except FileNotFoundError:
    cfg = {}
limpo = lambda v: v.strip().strip('"\'').strip()
cfg.setdefault("portal", {}).update(supabase_url=limpo(os.environ["SUPA"]).rstrip("/"),
                                    chave_service_role=limpo(os.environ["CHAVE"]), nome_robo=limpo(os.environ["NOME"]))
filas = [f.strip().lower() for f in os.environ["FILAS"].split(",") if f.strip()]
if not filas or any(f not in ("sefaz", "nfse") for f in filas):
    sys.exit("Filas: use sefaz, nfse ou sefaz,nfse (veio: " + os.environ["FILAS"] + ").")
cfg["portal"]["filas"] = filas
cfg.setdefault("chrome", {}).update(porta=int(os.environ["PORTA"]), pasta_downloads=os.environ["DIR"] + "/Downloads", fechar_abas=True)
cfg.setdefault("pastas", {}).update(destino=os.environ["ARQUIVOS"])
cfg.setdefault("chaves", {}).update(privada=os.environ["CHAVES"] + "/robo_privada.pem")
json.dump(cfg, open(caminho, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
PY
chown "$USUARIO:$USUARIO" "$CONFIG"; chmod 600 "$CONFIG"
ok "config.json salvo (só o usuário $USUARIO consegue ler)."

passo "Chave privada do robô (a mesma do computador do escritório)"
PEM=$CHAVES/robo_privada.pem
if [ -f /root/robo_privada.pem ]; then
  install -o "$USUARIO" -g "$USUARIO" -m 600 /root/robo_privada.pem "$PEM"
  shred -u /root/robo_privada.pem 2>/dev/null || rm -f /root/robo_privada.pem
  ok "Chave copiada de /root/robo_privada.pem (a cópia de lá foi apagada)."
elif [ -f "$PEM" ]; then
  ok "Chave já instalada."
else
  echo "No computador do escritório, abra robo\\chaves\\robo_privada.pem no Bloco de Notas, copie TUDO"
  echo "(de -----BEGIN até -----END PRIVATE KEY-----) e cole aqui. Não aparece enquanto você cola."
  TMP=$(mktemp); chmod 600 "$TMP"
  stty -echo </dev/tty 2>/dev/null || true
  while IFS= read -r linha </dev/tty; do
    linha=${linha%$'\r'}
    [ -z "$linha" ] && continue   # o terminal transforma a quebra de linha do Windows numa linha vazia a mais
    printf '%s\n' "$linha" >> "$TMP"
    case "$linha" in *"-----END"*) break;; esac
  done
  stty echo </dev/tty 2>/dev/null || true
  echo
  grep -q -- "-----BEGIN" "$TMP" && grep -q -- "-----END" "$TMP" || { rm -f "$TMP"; falha "não reconheci a chave colada (precisa ter as linhas -----BEGIN e -----END)."; }
  install -o "$USUARIO" -g "$USUARIO" -m 600 "$TMP" "$PEM"; shred -u "$TMP" 2>/dev/null || rm -f "$TMP"
  ok "Chave salva em $PEM (só o usuário $USUARIO consegue ler)."
fi
sudo -u "$USUARIO" "$VENV/bin/python" "$APP/servidor/conferir_chave.py" \
  || printf '\033[1;33m%s\033[0m\n' "ATENÇÃO: a chave não abriu o que está no portal. Rode de novo com a chave certa: sudo rm $PEM && sudo lotivisse configurar xml"

passo "Logs do robô de XML (semanal, guarda 8 semanas)"
cat > /etc/logrotate.d/lotivisse-xml <<EOF
$APP/robo/*.log {
  weekly
  rotate 8
  compress
  missingok
  notifempty
  copytruncate
}
EOF

passo "Ligando o robô de XML"
systemctl daemon-reload
systemctl enable --now "lotivisse-tela@$ROBO" "lotivisse-chrome@$ROBO" "lotivisse-robo@$ROBO"
systemctl restart "lotivisse-chrome@$ROBO" "lotivisse-robo@$ROBO"

passo "Conferindo"
sleep 10
curl -s --max-time 5 "http://127.0.0.1:$PORTA_CHROME/json/version" >/dev/null \
  && ok "Chrome do robô de XML respondendo na porta $PORTA_CHROME." \
  || echo "O Chrome ainda não respondeu na porta $PORTA_CHROME. Rode em 1 minuto: lotivisse status xml"
lotivisse status xml || true
echo
ok "Instalação concluída. No portal de XML, em Agendamentos (como administrador), deve aparecer \"Robô ligado ($NOME)\"."
echo "Os arquivos ficam em $ARQUIVOS. Para mandá-los ao Google Drive: sudo bash $APP/servidor/drive.sh"
echo "Comandos úteis: lotivisse status xml | lotivisse log xml | sudo lotivisse reiniciar xml | sudo lotivisse atualizar xml"
