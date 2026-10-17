"""Ponta a ponta contra um ATF de mentira (login dentro de quadro, tela de período e ZIP).

Prova o roteiro do robô num Chrome de verdade; os seletores do ATF real são calibrados no PC
com o pacote de diagnóstico. Precisa do Chromium (CHROME_TESTE ou o do Playwright).
"""
import copy
import io
import os
import shutil
import socket
import subprocess
import threading
import time
import urllib.request
import zipfile
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest

import config
import robo_xml
from util import nfe

EMPRESA = "11222333000181"
OUTRA = "45723174000110"
CHROME = os.environ.get("CHROME_TESTE") or next(
    (str(p) for p in Path("/opt/pw-browsers").glob("chromium-*/chrome-linux/chrome")), shutil.which("chromium") or "")


def _zip() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("NFe1.xml", nfe(EMPRESA, OUTRA, 1))
        z.writestr("NFe2.xml", nfe(EMPRESA, OUTRA, 2))
    return buf.getvalue()


class AtfFalso(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _html(self, corpo: str, cookie: str = ""):
        dados = f"<html><body>{corpo}</body></html>".encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(dados)

    def do_GET(self):
        u = urlparse(self.path)
        logado = "sessao=ok" in (self.headers.get("Cookie") or "")
        if u.path == "/atf/":
            self._html('<h1>ATF</h1><iframe name="principal" src="/atf/login" width="600" height="300"></iframe>')
        elif u.path == "/atf/login":
            self._html('<form method="post" action="/atf/entrar">Login <input type="text" name="edtLogin">'
                       'Senha <input type="password" name="edtSenha"><input type="submit" value="Entrar"></form>')
        elif u.path == "/atf/download" and logado:
            self._html('<form action="/atf/arquivo">De <input name="dtInicial"> Até <input name="dtFinal">'
                       '<label><input type="radio" name="tp" value="E">Notas emitidas</label>'
                       '<label><input type="radio" name="tp" value="R">Notas recebidas</label>'
                       '<button type="submit">Consultar</button></form><a href="/atf/sair">Sair</a>')
        elif u.path == "/atf/arquivo" and logado:
            q = parse_qs(u.query)
            if q.get("tp") == ["R"]:
                self._html("Nenhuma nota encontrada para o período informado.")
                return
            assert q.get("dtInicial") == ["01/09/2026"], q
            dados = _zip()
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Disposition", 'attachment; filename="xml.zip"')
            self.end_headers()
            self.wfile.write(dados)
        elif u.path == "/atf/sair":
            self._html("Sessão encerrada", cookie="sessao=; Max-Age=0; Path=/")
        else:
            self._html("Sessão expirada. Faça login.")

    def do_POST(self):
        tamanho = int(self.headers.get("Content-Length") or 0)
        campos = parse_qs(self.rfile.read(tamanho).decode())
        if campos.get("edtLogin") == [EMPRESA] and campos.get("edtSenha") == ["certa"]:
            self._html('Bem-vindo! <a href="/atf/download">Download de XML</a> <a href="/atf/sair">Sair</a>',
                       cookie="sessao=ok; Path=/")
        else:
            self._html("Senha inválida.")


def _porta_livre() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def ambiente(tmp_path_factory):
    if not CHROME or not Path(CHROME).exists():
        pytest.skip("Chromium não encontrado")
    pasta = tmp_path_factory.mktemp("atf")
    servidor = ThreadingHTTPServer(("127.0.0.1", 0), AtfFalso)
    threading.Thread(target=servidor.serve_forever, daemon=True).start()
    porta_cdp = _porta_livre()
    chrome = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={porta_cdp}", "--no-sandbox",
                               f"--user-data-dir={pasta / 'perfil'}", "--no-first-run", "about:blank"],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{porta_cdp}/json/version", timeout=1)
            break
        except Exception:
            time.sleep(0.2)
    base = f"http://127.0.0.1:{servidor.server_port}/atf"
    cfg = copy.deepcopy(config.PADRAO)
    cfg["chrome"].update(porta=porta_cdp, pasta_downloads=str(pasta / "downloads"))
    cfg["pastas"].update(destino=str(pasta / "xml"), diagnostico=str(pasta / "diag"))
    cfg["atf"].update(url_login=f"{base}/", segundos_login=15, segundos_automatico=15, segundos_assistido=3)
    cfg["atf"]["url_download"] = {"nfe_emitidas": f"{base}/download", "nfe_recebidas": f"{base}/download"}
    yield cfg, pasta
    chrome.terminate()
    servidor.shutdown()


def test_baixa_e_organiza(ambiente):
    cfg, pasta = ambiente
    r = robo_xml.executar_com_tratamento(cfg, EMPRESA, "Padaria", EMPRESA, "certa",
                                         ["nfe_emitidas", "nfe_recebidas"], date(2026, 9, 1), date(2026, 9, 30))
    assert r.status == "concluido", r
    assert r.qtd_xml == 2
    assert r.detalhes["nfe_recebidas"]["sem_notas"] is True
    salvos = list((pasta / "xml").glob("Padaria - */2026-09/NF-e Emitidas/*.xml"))
    assert len(salvos) == 2


def test_senha_errada(ambiente):
    cfg, _ = ambiente
    r = robo_xml.executar_com_tratamento(cfg, EMPRESA, "Padaria", EMPRESA, "errada",
                                         ["nfe_emitidas"], date(2026, 9, 1), date(2026, 9, 30))
    assert r.status == "senha_invalida", r
