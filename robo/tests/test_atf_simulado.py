"""Ponta a ponta contra um ATF de mentira que imita as telas reais (out/2026):

- login (dentro de quadro) com o login do contador;
- menu lateral "/ MEN" > "NF-e" > "Consulta NF-e por Emitentes/Destinatários" (blocos Emitente e
  Destinatário, "Tipo de Identificação" = Inscrição Estadual, botão Pesquisar de cada bloco);
- "NFC-e" > "Consulta por Emitente" ("Data Emissão Inicial/Final");
- lista de notas com "marcar todos" e botão "Download XML" que devolve um ZIP.

Os nomes dos campos são propositalmente estranhos: o robô precisa achá-los pelos textos da tela.
Precisa do Chromium (CHROME_TESTE ou o do Playwright).
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
from util import IE_EMPRESA, IE_OUTRA, nfe

EMPRESA = "11222333000181"
FORNECEDOR = "45723174000110"
CHROME = os.environ.get("CHROME_TESTE") or next(
    (str(p) for p in Path("/opt/pw-browsers").glob("chromium-*/chrome-linux/chrome")), shutil.which("chromium") or "")
LOGINS: list[str] = []
CONSULTAS: list[dict] = []


def _zip(itens: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for nome, dados in itens.items():
            z.writestr(nome, dados)
    return buf.getvalue()


TOPO = ('<header><b>Sistema ATF</b> <input placeholder="Função" id="f1"> '
        '<a href="/atf/sair" title="Sair">⎋</a></header>'
        '<nav><a href="/atf/home">/ MEN</a> <a href="/atf/menu/nfe">NF-e</a> <a href="/atf/menu/nfce">NFC-e</a></nav>')

BLOCO = """<div class="secao">{nome}</div>
<div class="form-floating"><select id="s{n}"><option>CPF</option><option>CNPJ</option>
<option selected>Inscrição Estadual</option></select><label>Tipo de Identificação</label></div>
<div class="form-floating"><input id="x{n}" class="form-control"><label>Número</label></div>
<button type="button" onclick="pesquisar('{nome}', 'x{n}', 's{n}')">Pesquisar</button>
<div class="form-floating"><input id="r{n}"><label>Nome/Razão Social</label></div>"""

SCRIPT = """<script>function pesquisar(bloco, campo, sel) {
  const q = new URLSearchParams({tela: TELA, bloco: bloco, ini: document.getElementById('d1').value,
    fim: document.getElementById('d2').value, ie: document.getElementById(campo).value,
    tipo: document.getElementById(sel).value});
  location.href = '/atf/resultado?' + q.toString();
}</script>"""


def tela_nfe():
    return (TOPO + '<h4>Consulta NF-e por Emitentes/Destinatários</h4><h5>Consulta NF-e</h5>'
            '<label>Data de Emissão</label><input id="d1"> - <input id="d2">'
            '<label>Número</label><input id="n1"> a <input id="n2">'
            '<label>Situação</label><select><option>---</option></select>'
            '<label>Operação</label><select><option>---</option></select>'
            + BLOCO.format(nome="Emitente", n=1) + BLOCO.format(nome="Destinatário", n=2)
            + "<script>const TELA='nfe'</script>" + SCRIPT)


def tela_nfce():
    return (TOPO + '<h4>Consulta Genérica da NFC-e</h4><h5>Filtros de Consulta</h5>'
            '<label>Data Emissão Inicial</label><input id="d1"><label>Data Emissão Final</label><input id="d2">'
            '<label>Número</label><input id="n1"><label>Situação</label><select><option>---</option></select>'
            '<label>Chave Acesso</label><input id="ch"><button type="button">Adicionar</button>'
            + BLOCO.format(nome="Emitente", n=1) + "<script>const TELA='nfce'</script>" + SCRIPT)


class AtfFalso(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _html(self, corpo: str, cookie: str = ""):
        dados = f"<html><head><meta charset='utf-8'></head><body>{corpo}</body></html>".encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(dados)

    def _arquivo(self, dados: bytes):
        self.send_response(200)
        self.send_header("Content-Type", "application/zip")
        self.send_header("Content-Disposition", 'attachment; filename="xml.zip"')
        self.end_headers()
        self.wfile.write(dados)

    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        logado = "sessao=ok" in (self.headers.get("Cookie") or "")
        if u.path == "/atf/":
            if logado:
                self._html(TOPO + "Bem-vindo")
            else:
                self._html('<iframe name="principal" src="/atf/login" width="600" height="300"></iframe>')
        elif u.path == "/atf/login":
            self._html('<form method="post" action="/atf/entrar" target="_top">Login <input type="text" name="u_a1">'
                       'Senha <input type="password" name="p_b2"><input type="submit" value="Entrar"></form>')
        elif not logado:
            self._html("Sessão expirada. Faça login.")
        elif u.path == "/atf/home":
            self._html(TOPO + "Menu principal")
        elif u.path == "/atf/menu/nfe":
            self._html(TOPO + '<a href="#">NF-E ↲</a><a href="/atf/x">Consulta Completa</a>'
                       '<a href="/atf/fis1322">Consulta NF-e por Emitentes/Destinatários</a><a href="#">Gerar XML NF-e</a>')
        elif u.path == "/atf/menu/nfce":
            self._html(TOPO + '<a href="#">NFC-E ↲</a><a href="/atf/x">Consulta por CPF</a>'
                       '<a href="/atf/fis1484">Consulta por Emitente</a><a href="/atf/x">Consultar</a>')
        elif u.path == "/atf/fis1322":
            self._html(tela_nfe())
        elif u.path == "/atf/fis1484":
            self._html(tela_nfce())
        elif u.path == "/atf/resultado":
            CONSULTAS.append(q)
            assert (q["ini"], q["fim"], q["tipo"]) == ("01/09/2026", "30/09/2026", "Inscrição Estadual"), q
            if q["ie"] == IE_OUTRA and q["bloco"] == "Destinatário":
                self._html(TOPO + "Nenhum registro encontrado para os filtros informados.")
                return
            self._html(TOPO + '<table><thead><tr><th><input type="checkbox" id="tds"></th><th>Chave</th></tr></thead>'
                       '<tbody><tr><td><input type="checkbox"></td><td>2526...</td></tr></tbody></table>'
                       f'<button onclick="if(document.getElementById(\'tds\').checked)location.href=\'/atf/arquivo?'
                       f'{u.query}\'">Download XML</button>')
        elif u.path == "/atf/arquivo":
            ie, bloco, tela = q["ie"], q["bloco"], q["tela"]
            if tela == "nfce":
                itens = {"c1.xml": nfe(EMPRESA, "", 5, modelo="65", ie_emit=ie)}
            elif bloco == "Emitente":
                itens = {"s1.xml": nfe(EMPRESA, FORNECEDOR, 1, ie_emit=ie), "s2.xml": nfe(EMPRESA, FORNECEDOR, 2, ie_emit=ie)}
            else:
                itens = {"e1.xml": nfe(FORNECEDOR, EMPRESA, 3, ie_dest=ie)}
            self._arquivo(_zip(itens))
        elif u.path == "/atf/sair":
            self._html("Sessão encerrada", cookie="sessao=; Max-Age=0; Path=/")
        else:
            self._html(TOPO + "Página")

    def do_POST(self):
        tamanho = int(self.headers.get("Content-Length") or 0)
        campos = {k: v[0] for k, v in parse_qs(self.rfile.read(tamanho).decode()).items()}
        LOGINS.append(campos.get("u_a1", ""))
        if campos.get("u_a1") == "mar00134" and campos.get("p_b2") == "certa":
            self._html(TOPO + "Bem-vindo ao ATF", cookie="sessao=ok; Path=/")
        else:
            self._html("Usuário ou senha inválidos.")


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
    cfg = copy.deepcopy(config.PADRAO)
    cfg["chrome"].update(porta=porta_cdp, pasta_downloads=str(pasta / "downloads"))
    cfg["pastas"].update(destino=str(pasta / "xml"), diagnostico=str(pasta / "diag"))
    cfg["atf"].update(url_login=f"http://127.0.0.1:{servidor.server_port}/atf/", segundos_login=15,
                      segundos_automatico=20, segundos_assistido=2)
    yield cfg, pasta
    chrome.terminate()
    servidor.shutdown()


def _trabalho(ie, nome, tipos, senha="certa", codigo=""):
    return robo_xml.Trabalho(ie=ie, nome=nome, login="mar00134", senha=senha, tipos=tipos,
                             inicio=date(2026, 9, 1), fim=date(2026, 9, 30), cnpj="", codigo=codigo)


def test_duas_empresas_um_login(ambiente):
    cfg, pasta = ambiente
    LOGINS.clear()
    executor = robo_xml.Executor(cfg)
    try:
        r1 = executor.executar(_trabalho(IE_EMPRESA, "Padaria", ["nfe_saida", "nfe_entrada"], codigo="015"))
        r2 = executor.executar(_trabalho(IE_OUTRA, "Mercado", ["nfe_entrada", "nfce"], codigo="016"))
    finally:
        executor.fechar()
    assert r1.status == "concluido", r1
    assert r1.qtd_xml == 3 and r1.detalhes["nfe_saida"]["salvos"] == 2 and r1.detalhes["nfe_entrada"]["salvos"] == 1
    assert r2.status == "concluido", r2
    assert r2.detalhes["nfe_entrada"]["sem_notas"] is True and r2.detalhes["nfce"]["salvos"] == 1
    assert "assistido" not in r1.mensagem + r2.mensagem  # tudo no automático
    assert LOGINS == ["mar00134"]  # uma sessão só para as duas empresas
    base = pasta / "xml"
    assert len(list(base.glob("015 - Padaria/2026-09/NF-e Saida/*.xml"))) == 2
    assert len(list(base.glob("015 - Padaria/2026-09/NF-e Entrada/*.xml"))) == 1
    assert len(list(base.glob("016 - Mercado/2026-09/NFC-e/*.xml"))) == 1
    blocos = [(c["tela"], c["bloco"], c["ie"]) for c in CONSULTAS[-4:]]
    assert blocos == [("nfe", "Emitente", IE_EMPRESA), ("nfe", "Destinatário", IE_EMPRESA),
                      ("nfe", "Destinatário", IE_OUTRA), ("nfce", "Emitente", IE_OUTRA)]


def test_senha_errada_nao_insiste(ambiente):
    cfg, _ = ambiente
    LOGINS.clear()
    executor = robo_xml.Executor(cfg)
    try:
        r1 = executor.executar(_trabalho(IE_EMPRESA, "Padaria", ["nfe_saida"], senha="errada"))
        r2 = executor.executar(_trabalho(IE_OUTRA, "Mercado", ["nfe_saida"], senha="errada"))
    finally:
        executor.fechar()
    assert r1.status == r2.status == "senha_invalida", (r1, r2)
    assert LOGINS == ["mar00134"]  # a segunda empresa não tentou de novo
