#!/usr/bin/env python3
"""Retoma a fila cadastral MEI no portal, independente do Chrome e do robô fiscal."""
import argparse
import hashlib
import hmac
import json
import signal
import threading
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ESCOPO = b"lotivisse:mei-cadastros:v1"


class SemRedirecionamento(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Nunca encaminhar o token a outro endereço.


def configuracao(caminho):
    cfg = json.loads(Path(caminho).read_text(encoding="utf-8-sig"))["portal"]
    site = str(cfg.get("site") or "https://xml.lotivisse.com.br").rstrip("/")
    url = urllib.parse.urlsplit(site)
    if url.scheme != "https" or not url.hostname or url.username or url.password or url.path or url.query or url.fragment:
        raise ValueError("Configure portal.site com a origem HTTPS do portal, sem caminhos ou credenciais.")
    chave = str(cfg.get("chave_service_role") or "").strip()
    if not chave:
        raise ValueError("Falta a chave do portal no config.json existente.")
    token = hmac.new(chave.encode(), ESCOPO, hashlib.sha256).hexdigest()
    return site + "/api/robo/mei-cadastros", token


def consultar(url, token, abrir=None):
    requisicao = urllib.request.Request(url, data=b"{}", method="POST", headers={
        "X-Mei-Worker": token, "Content-Type": "application/json",
    })
    abrir = abrir or urllib.request.build_opener(SemRedirecionamento()).open
    with abrir(requisicao, timeout=25) as resposta:
        return json.loads(resposta.read(16384))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default=str(Path(__file__).resolve().parents[1] / "robo/config.json"))
    parser.add_argument("--uma-vez", action="store_true", help="Processa no máximo um item e encerra.")
    args = parser.parse_args()
    try:
        url, token = configuracao(args.config)
    except (OSError, KeyError, ValueError):
        parser.exit(2, "Configuração cadastral indisponível. Confira o config.json do robô de XML.\n")
    parar = threading.Event()
    for sinal in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sinal, lambda *_: parar.set())
    print("Serviço cadastral MEI iniciado.", flush=True)
    while not parar.is_set():
        intervalo = 15
        try:
            consultar(url, token)
        except urllib.error.HTTPError as erro:
            print(f"Portal cadastral respondeu HTTP {erro.code}; fila preservada.", flush=True)
            intervalo = 60
            if args.uma_vez:
                return 1
        except (OSError, ValueError):
            print("Portal cadastral indisponível; nova tentativa em 60 segundos.", flush=True)
            intervalo = 60
            if args.uma_vez:
                return 1
        if args.uma_vez:
            return 0
        parar.wait(intervalo)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
