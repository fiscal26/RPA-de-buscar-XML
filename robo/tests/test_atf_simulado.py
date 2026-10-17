"""Ponta a ponta contra um ATF de mentira que copia a estrutura do ATF real (gravação de out/2026):

- /atf/seg/SEGf_Login.jsp: edtNoLogin (#login), edtDsSenha (#senha), botão btnAvancar;
- /atf/ em quadros: cabeçalho (botão "Mensagens"), menu e conteúdo;
- NF-e: fis/FISf_ConsultarNFeXml2.do?limparSessao=true com edtDtInicial/edtDtFinal, cmbTpDoccmpEmit/Dest,
  e o Número + Pesquisar + Nome de cada bloco num quadro próprio (componentes/CodDescLstBS.jsp?id=..._cmpEmit).
  O Pesquisar guarda a IE no servidor (como o ATF): sem ele, o Consultar não sabe a empresa. O ATF recusa
  Emitente e Destinatário juntos. cmbTpExibicao (HTML/TXT/XML) e #btnConsulta; resposta "O resultado será
  enviado para sua caixa de mensagens do ATF";
- NFC-e: "Consulta por Emitente" com a mesma estrutura de blocos;
- seg/SEGf_MinhasMensagens.do: uma mensagem mãe por consulta ("(3 Mensagens )",
  javascript:abrirFilhas('id',3)) que abre 3 filhas; a final ("Tarefa executada com sucesso") tem o
  anexo javascript:mostrarArquivo(0) com o ZIP; sem dados = final sem anexo; a caixa só pode ser lida de
  tempos em tempos (no ATF real, 1 minuto); mensagens de outra competência e consulta manual no meio.
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
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest

import config
import robo_xml
from util import IE_EMPRESA, IE_OUTRA, nfe

EMPRESA = "11222333000181"
FORNECEDOR = "45723174000110"
IE_ESTRANHA = "161112226"  # empresa fora da rodada (consulta feita à mão no mesmo login)
IE_INEXISTENTE = "160555558"  # o Pesquisar do ATF não traz nome
INTERVALO_CAIXA = 3  # segundos entre leituras da caixa de mensagens (no ATF real: 60)
CHROME = os.environ.get("CHROME_TESTE") or next(
    (str(p) for p in Path("/opt/pw-browsers").glob("chromium-*/chrome-linux/chrome")), shutil.which("chromium") or "")

ESTADO = {"logins": [], "consultas": [], "mensagens": [], "recusas": [], "ultima_lista": 0.0, "lista_cedo": 0,
          "blocos": {}, "abertas": []}


def _zip(itens: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for nome, dados in itens.items():
            z.writestr(nome, dados)
    return buf.getvalue()


def _agora() -> str:
    return datetime.now().strftime("%d/%m/%Y %H:%M:%S")


def sessao():
    return (f'<div class="sessao">Login: mar00134 Função: FIS_1322 Sessão expira em: 14 min '
            f'{_agora()} Produção</div>')


def _nova_mensagem(codigo: str, assunto: str, atraso: float, anexo: bytes | None, texto: str,
                   periodo: str = "01/09/2026 a 30/09/2026"):
    """Como o ATF: uma mãe ("3 Mensagens") com 3 filhas; só a final tem o anexo."""
    pronta = (datetime.now() + timedelta(seconds=atraso)).replace(microsecond=0)
    mae = {"id": str(104505000 + len(ESTADO["mensagens"]) * 10), "codigo": codigo, "assunto": assunto,
           "pronta": pronta, "filhas": []}
    final = (f"{texto}<br>NFe: Consulta Genérica<br>Período solicitado: {periodo}<br><br>Tarefa executada com sucesso."
             "<br>Abra o arquivo em anexo para ver o relatório gerado.<br>Observação: A não existência de arquivo "
             "em anexo significa que não existem dados para o período consultado.") if anexo else (
        f"{texto}<br>NFe: Consulta Genérica<br>Período solicitado: {periodo}<br><br>"
        "Mensagem: Nenhum registro satisfaz a pesquisa.")
    for i, (txt, arq) in enumerate((("Tarefa recebida.", None), (final, anexo), ("Tarefa em processamento.", None))):
        mae["filhas"].append({"id": str(int(mae["id"]) + i + 1), "texto": txt, "anexo": arq})
    ESTADO["mensagens"].append(mae)


def _filha(fid: str):
    for m in ESTADO["mensagens"]:
        for f in m["filhas"]:
            if f["id"] == fid:
                return m, f
    raise KeyError(fid)


def _responder(tela: str, campos: dict) -> str:
    """O que o ATF faz com a consulta: gera (com atraso) a mensagem com o ZIP."""
    emit, dest = ESTADO["blocos"].get(f"{tela}_cmpEmit", ""), ESTADO["blocos"].get(f"{tela}_cmpDest", "")
    q = {"tela": tela, "emit": emit, "dest": dest, "ini": campos.get("edtDtInicial", ""),
         "fim": campos.get("edtDtFinal", ""), "exib": campos.get("cmbTpExibicao", "")}
    ESTADO["consultas"].append(q)
    if emit and dest:
        ESTADO["recusas"].append(q)
        return "Erro: informe apenas o Emitente ou o Destinatário."
    assert (q["ini"], q["fim"], q["exib"]) == ("01/09/2026", "30/09/2026", "3"), q
    assert campos.get("cmbTpDoccmpEmit") == "IE" and campos.get("cmbTpDoccmpDest", "IE") == "IE", campos
    ie = emit or dest
    assert ie, "Pesquisar do bloco não foi clicado (o ATF não sabe a empresa)"
    if ESTADO.pop("manual", False):
        _nova_mensagem("FIS_1322", "NFe: Consulta Genérica (Ano 2026)", 0,
                       _zip({"x.xml": nfe(FORNECEDOR, "", 7, ie_emit=IE_ESTRANHA)}), "consulta manual")
    if tela == "nfce":
        _nova_mensagem("FIS_1484", "NFCe: Consulta Genérica da NFC-e", 2,
                       _zip({"c1.xml": nfe(EMPRESA, "", 5, modelo="65", ie_emit=ie)}), f"emitente {ie}")
    elif emit:
        _nova_mensagem("FIS_1322", "NFe: Consulta Genérica (Ano 2026)", 4,
                       _zip({"s1.xml": nfe(EMPRESA, FORNECEDOR, 1, ie_emit=ie, ie_dest=IE_OUTRA),
                             "s2.xml": nfe(EMPRESA, FORNECEDOR, 2, ie_emit=ie)}), f"emitente {ie}")
    elif ie == IE_OUTRA:  # a Mercado comprou da Padaria (nota s1)
        _nova_mensagem("FIS_1322", "NFe: Consulta Genérica (Ano 2026)", 1,
                       _zip({"e1.xml": nfe(EMPRESA, FORNECEDOR, 1, ie_emit=IE_EMPRESA, ie_dest=IE_OUTRA)}),
                       f"destinatário {ie}")
    else:
        _nova_mensagem("FIS_1322", "NFe: Consulta Genérica (Ano 2026)", 1, None, f"destinatário {ie}")
    return "O resultado será enviado para sua caixa de mensagens do ATF"


def form_consulta(tela: str, aviso: str = "") -> str:
    titulo = "Consulta NF-e por Emitentes/Destinatários" if tela == "nfe" else "Consulta Genérica da NFC-e"
    datas = ('<label>Data de Emissão</label><input name="edtDtInicial" class="form-control"> - '
             '<input name="edtDtFinal" class="form-control">') if tela == "nfe" else (
        '<label>Data Emissão Inicial</label><input name="edtDtInicial"><label>Data Emissão Final</label>'
        '<input name="edtDtFinal">')
    bloco = lambda nome, suf: (  # noqa: E731
        f'<div class="card-header">{nome}</div><select name="cmbTpDoccmp{suf}" id="cmbTpDoccmp{suf}" class="form-select">'
        '<option value="IE">Inscrição Estadual</option><option value="CNPJ">CNPJ</option><option value="CPF">CPF</option>'
        f'</select><iframe src="/atf/componentes/CodDescLstBS.jsp?id={tela}_cmp{suf}" height="120"></iframe>'
        f'<label>UF</label><select name="cmbUF{suf}"><option>---</option></select>')
    alerta = f'<div class="alert alert-success">{aviso}</div>' if aviso else ""
    return (sessao() + f'<h5>{titulo}</h5>{alerta}<form method="post" action="/atf/fis/consultar_{tela}.do">{datas}'
            '<label>Situação</label><select name="cmbSituacao"><option>---</option></select>'
            + bloco("Emitente", "Emit") + bloco("Destinatário", "Dest")
            + '<label>Tipo de Exibição</label><select name="cmbTpExibicao"><option value="1">HTML</option>'
              '<option value="2">TXT</option><option value="3">XML</option></select>'
              '<button type="submit" name="btnConsultar" id="btnConsulta" class="g-recaptcha btn">Consultar</button>'
              '<button type="submit" class="btn btn-light">Limpar</button></form>')


class AtfFalso(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _html(self, corpo: str, cookie: str = "", status: int = 200, local: str = ""):
        dados = f"<html><head><meta charset='utf-8'></head><body>{corpo}</body></html>".encode()
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        if local:
            self.send_header("Location", local)
        self.end_headers()
        self.wfile.write(dados)

    def _campos(self) -> dict:
        tamanho = int(self.headers.get("Content-Length") or 0)
        return {k: v[0] for k, v in parse_qs(self.rfile.read(tamanho).decode(), keep_blank_values=True).items()}

    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query, keep_blank_values=True).items()}
        logado = "sessao=ok" in (self.headers.get("Cookie") or "")
        p = u.path
        if p == "/atf/":
            if not logado:
                self._html("", status=302, local="/atf/seg/SEGf_Login.jsp")
                return
            self._html('<iframe name="cab" src="/atf/cabecalho.htm" height="60" width="900"></iframe>'
                       '<iframe name="menu" src="/atf/seg/SEGf_Menu.jsp" height="400" width="300"></iframe>'
                       '<iframe name="conteudo" src="/atf/seg/SEGf_PrincipalSistema.jsp" height="900" width="1000"></iframe>')
        elif p == "/atf/seg/SEGf_Login.jsp":
            self._html('<form id="loginForm" method="post" action="/atf/seg/SEGf_Login.jsp"><b>Login</b> SEFAZ-PB'
                       '<label for="login">Usuário</label><input type="text" id="login" name="edtNoLogin" class="form-control">'
                       '<label for="senha">Senha</label><input type="password" id="senha" name="edtDsSenha">'
                       '<button type="submit" name="btnAvancar" class="btn btn-primary">Avançar</button>'
                       '<a href="#">Acesse via Certificado Digital</a></form>')
        elif not logado:
            self._html("Sessão expirada. Faça login.")
        elif p == "/atf/cabecalho.htm":
            self._html('<header>Sistema ATF <input placeholder="Função"><button id="toggleMenuHeader" aria-label="Menu">☰</button>'
                       '<button type="button" aria-label="Mensagens" onclick="parent.frames[\'conteudo\'].location='
                       '\'/atf/seg/SEGf_MinhasMensagens.do?limparSessao=true\'">🔔</button>'
                       '<button aria-label="Encerrar Sessão" onclick="top.location=\'/atf/sair\'">⎋</button></header>')
        elif p == "/atf/seg/SEGf_Menu.jsp":
            if q.get("caminho") == "nfe":
                self._html('<div id="sidebar"><a href="/atf/seg/SEGf_Menu.jsp">/ MEN</a><ul><li>NF-E ↲</li></ul><ul>'
                           '<li><a href="#">Consulta Completa</a></li>'
                           '<li><a href="../fis/FISf_ConsultarNFeXml2.do?limparSessao=true" target="conteudo">'
                           'Consulta NF-e por<br>Emitentes/Destinatários</a></li><li><a href="#">Gerar XML NF-e</a></li></ul></div>')
            elif q.get("caminho") == "nfce":
                self._html('<div id="sidebar"><a href="/atf/seg/SEGf_Menu.jsp">/ MEN</a><ul><li>NFC-E ↲</li></ul><ul>'
                           '<li><a href="#">Consulta por CPF</a></li>'
                           '<li><a href="../fis/FISf_ConsultarNFCe.do?limparSessao=true" target="conteudo">Consulta por Emitente</a></li>'
                           '</ul></div>')
            else:
                self._html('<div id="sidebar"><a href="/atf/seg/SEGf_Menu.jsp">/ MEN</a><ul>'
                           '<li><a href="/atf/seg/SEGf_Menu.jsp?caminho=nfe">NF-e</a></li>'
                           '<li><a href="/atf/seg/SEGf_Menu.jsp?caminho=nfce">NFC-e</a></li></ul></div>')
        elif p == "/atf/seg/SEGf_PrincipalSistema.jsp":
            self._html(sessao() + "Bem-vindo ao ATF")
        elif p in ("/atf/fis/FISf_ConsultarNFeXml2.do", "/atf/fis/FISf_ConsultarNFCe.do"):
            tela = "nfe" if "NFeXml2" in p else "nfce"
            if q.get("limparSessao") == "true":
                ESTADO["blocos"].pop(f"{tela}_cmpEmit", None)
                ESTADO["blocos"].pop(f"{tela}_cmpDest", None)
            self._html(form_consulta(tela))
        elif p == "/atf/componentes/CodDescLstBS.jsp":
            self._html(self._componente(q["id"], ESTADO["blocos"].get(q["id"], "")))
        elif p == "/atf/seg/SEGf_MinhasMensagens.do":
            self._mensagens(q)
        elif p == "/atf/seg/SEGf_LerMensagem.do":
            mae, f = _filha(q["hidsqMensagem"])
            ESTADO["abertas"].append((mae["id"], f["id"]))
            anexo = ('<img src="/clip.png"> 1 Anexo(s):<br><a href="javascript:mostrarArquivo(0)">Dados referentes ao '
                     f'ano de 2026</a><script>function mostrarArquivo(i) {{ location = "/atf/seg/arquivo?id={f["id"]}"; }}'
                     '</script>' if f["anexo"] else "")
            self._html(sessao() + f'<b>Ler Mensagem</b><h5>{mae["assunto"]}</h5>- De: {mae["codigo"]} - Consulta<br>'
                       f'- Enviada: {mae["pronta"]:%d/%m/%Y %H:%M:%S}<br>{anexo}<p>{f["texto"]}</p>'
                       '<button name="btnVoltar" class="g-recaptcha">Voltar</button>'
                       + ('<script>setTimeout(() => mostrarArquivo(0), 1500)</script>' if q.get("auto") else ""))
        elif p == "/atf/seg/arquivo":
            dados = _filha(q["id"])[1]["anexo"]
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Disposition", 'attachment; filename="xml.zip"')
            self.end_headers()
            self.wfile.write(dados)
        elif p == "/atf/sair":
            self._html("Sessão encerrada", cookie="sessao=; Max-Age=0; Path=/")
        else:
            self._html(sessao() + "Página")

    def _componente(self, cid: str, ie: str) -> str:
        suf = cid.rsplit("_cmp", 1)[1]
        nome = "" if not ie or ie == IE_INEXISTENTE else f"EMPRESA {ie}"
        return (f'<form method="post" action="/atf/componentes/CodDescLstBS.jsp"><input type="hidden" name="id" value="{cid}">'
                f'<div class="form-floating"><input type="text" name="hidNrDocumentocmp{suf}" id="hidNrDocumentocmp{suf}" '
                f'class="form-control" value="{ie}"><label>Número</label></div>'
                '<button type="submit" name="btnPesquisar" class="btn btn-primary">Pesquisar</button>'
                f'<div class="form-floating"><input type="text" name="hidNoHumanoInstcmp{suf}" id="hidNoHumanoInstcmp{suf}" '
                f'class="form-control" value="{nome}"><label>Nome/Razão Social</label></div></form>')

    def _mensagens(self, q: dict):
        agora = datetime.now()
        if q.get("limparSessao") == "true":
            if time.time() - ESTADO["ultima_lista"] < INTERVALO_CAIXA:
                ESTADO["lista_cedo"] += 1
                self._html(sessao() + '<b>Minhas Mensagens</b><br><b>ATENÇÃO: Você poderá consultar sua caixa de '
                           'mensagens em 1 minuto. AGUARDE!</b>')
                return
            ESTADO["ultima_lista"] = time.time()
            linhas = "".join(
                f'<tr><td><input type="checkbox" name="chbSqMensagems"></td>'
                f'<td><a href="javascript:abrirFilhas(\'{m["id"]}\',3)"><img src="env.png"></a></td>'
                + (f'<td><a href="javascript:abrirFilhas(\'{m["id"]}\',3)"><img src="clip.gif"></a></td>'
                   if any(f["anexo"] for f in m["filhas"]) else '<td></td>')
                + f'<td><a href="javascript:abrirFilhas(\'{m["id"]}\',3)">{m["codigo"]} - Consulta Genérica (3 Mensagens )</a></td>'
                f'<td><a href="javascript:abrirFilhas(\'{m["id"]}\',3)">{m["assunto"]}</a></td>'
                f'<td><a href="javascript:abrirFilhas(\'{m["id"]}\',3)">{m["pronta"]:%d/%m/%Y %H:%M:%S}</a></td></tr>'
                for m in sorted(ESTADO["mensagens"], key=lambda m: m["pronta"], reverse=True) if m["pronta"] <= agora)
        else:
            mae = next(m for m in ESTADO["mensagens"] if m["id"] == q["hidsqMensagem"])
            linhas = "".join(
                f'<tr><td><input type="checkbox"></td><td><a href="javascript:abrirFilhas(\'{f["id"]}\',0)"><img src="env.png"></a></td>'
                + (f'<td><a href="javascript:abrirFilhas(\'{f["id"]}\',0)"><img src="clip.gif"></a></td>' if f["anexo"] else '<td></td>')
                + f'<td><a href="javascript:abrirFilhas(\'{f["id"]}\',0)">'
                f'{mae["codigo"]} - Consulta Genérica</a></td><td><a href="javascript:abrirFilhas(\'{f["id"]}\',0)">'
                f'{mae["pronta"]:%d/%m/%Y %H:%M:%S}</a></td></tr>' for f in mae["filhas"])
        self._html(sessao() + '<b>Minhas Mensagens</b><form><table>' + linhas + '</table>'
                   '<button name="btnVoltar" class="g-recaptcha">Voltar</button>'
                   '<button name="btnNaoVisualizar" class="g-recaptcha">Retirar</button></form>'
                   "<script>function abrirFilhas(id, n) { location = n > 0 ? 'SEGf_MinhasMensagens.do?hidsqMensagem=' + id"
                   " : 'SEGf_LerMensagem.do?hidsqMensagem=' + id; }</script>")

    def do_POST(self):
        campos = self._campos()
        p = urlparse(self.path).path
        if p == "/atf/seg/SEGf_Login.jsp":
            ESTADO["logins"].append(campos.get("edtNoLogin", ""))
            if campos.get("edtNoLogin") == "mar00134" and campos.get("edtDsSenha") == "certa":
                self._html("", cookie="sessao=ok; Path=/", status=302, local="/atf/")
            else:
                self._html("Usuário ou senha inválidos.")
        elif p == "/atf/componentes/CodDescLstBS.jsp":  # Pesquisar do bloco: guarda a IE no servidor
            cid = campos["id"]
            suf = cid.rsplit("_cmp", 1)[1]
            ESTADO["blocos"][cid] = campos.get(f"hidNrDocumentocmp{suf}", "")
            self._html(self._componente(cid, ESTADO["blocos"][cid]))
        elif p.startswith("/atf/fis/consultar_"):
            tela = p.rsplit("_", 1)[1].split(".")[0]
            self._html(form_consulta(tela, _responder(tela, campos)))
        else:
            self._html("?")


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
                      segundos_resposta=5, segundos_assistido=2, minutos_espera_mensagens=1,
                      segundos_entre_verificacoes=INTERVALO_CAIXA + 1)
    yield cfg, pasta
    chrome.terminate()
    servidor.shutdown()


def _trabalho(ie, nome, tipos, senha="certa", codigo="", cnpj=""):
    return robo_xml.Trabalho(ie=ie, nome=nome, login="mar00134", senha=senha, tipos=tipos,
                             inicio=date(2026, 9, 1), fim=date(2026, 9, 30), cnpj=cnpj, codigo=codigo)


def test_rodada_um_login_xml_pelas_mensagens(ambiente):
    cfg, pasta = ambiente
    ESTADO["logins"].clear()
    # mensagem antiga (de antes da rodada) e uma de outra competência: não podem atrapalhar
    _nova_mensagem("FIS_1322", "NFe: Consulta Genérica (Ano 2026)", -3600,
                   _zip({"velha.xml": nfe(EMPRESA, FORNECEDOR, 99, ie_emit=IE_EMPRESA)}), "antiga")
    executor = robo_xml.Executor(cfg)
    try:
        ESTADO["manual"] = True  # alguém consulta outra empresa à mão no mesmo login, durante a rodada
        _nova_mensagem("FIS_1322", "NFe: Consulta Genérica (Ano 2026)", 3,
                       _zip({"agosto.xml": nfe(EMPRESA, FORNECEDOR, 98, "2026-08-10", ie_emit=IE_EMPRESA)}),
                       "outra competência", periodo="01/08/2026 a 31/08/2026")
        r1, r2, r3 = executor.executar_rodada([
            _trabalho(IE_EMPRESA, "Padaria", ["nfe_saida", "nfe_entrada"], codigo="015"),
            _trabalho(IE_OUTRA, "Mercado", ["nfe_entrada", "nfce"], codigo="016"),
            _trabalho(IE_INEXISTENTE, "IE errada", ["nfe_saida"], codigo="017"),
        ])
    finally:
        executor.fechar()

    assert ESTADO["logins"] == ["mar00134"]  # uma sessão só para a rodada
    assert not ESTADO["recusas"]  # nunca Emitente e Destinatário juntos
    blocos = [("E" if c["emit"] else "D", c["emit"] or c["dest"], c["tela"]) for c in ESTADO["consultas"][-4:]]
    assert blocos == [("E", IE_EMPRESA, "nfe"), ("D", IE_EMPRESA, "nfe"), ("D", IE_OUTRA, "nfe"), ("E", IE_OUTRA, "nfce")]

    assert r1.status == "concluido", r1
    assert r1.detalhes["nfe_saida"]["salvos"] == 2 and r1.detalhes["nfe_entrada"]["sem_notas"], r1
    assert r2.status == "concluido", r2
    assert r2.detalhes["nfe_entrada"]["salvos"] == 1 and r2.detalhes["nfce"]["salvos"] == 1, r2
    assert r3.status == "erro" and "não encontrou a IE" in r3.mensagem, r3
    base = pasta / "xml"
    assert len(list(base.glob("015 - Padaria/2026-09/NF-e Saida/*.xml"))) == 2  # a antiga (nº 99) não entrou
    assert not list(base.glob("015 - Padaria/2026-08"))  # resposta de outra competência não entrou
    assert len(list(base.glob("016 - Mercado/2026-09/NF-e Entrada/*.xml"))) == 1
    assert len(list(base.glob("016 - Mercado/2026-09/NFC-e/*.xml"))) == 1
    assert len(list(base.glob("_sem_empresa/2026-09/*.xml"))) == 1  # a da consulta manual
    assert ESTADO["lista_cedo"] == 0  # respeitou o intervalo da caixa de mensagens
    # só abre o necessário: com anexo, só a filha do clipe; sem anexo, para no "Nenhum registro satisfaz"
    por_mae: dict = {}
    for mae_id, filha_id in ESTADO["abertas"]:
        por_mae.setdefault(mae_id, []).append(filha_id)
    for m in ESTADO["mensagens"]:
        abertas = por_mae.get(m["id"], [])
        if not abertas:
            continue
        if any(f["anexo"] for f in m["filhas"]):
            assert abertas == [m["filhas"][1]["id"]], (m["id"], abertas)
        else:
            assert len(abertas) == 2 and m["filhas"][2]["id"] not in abertas, (m["id"], abertas)


def test_senha_errada_nao_insiste(ambiente):
    cfg, _ = ambiente
    ESTADO["logins"].clear()
    executor = robo_xml.Executor(cfg)
    try:
        r1 = executor.executar_rodada([_trabalho(IE_EMPRESA, "Padaria", ["nfe_saida"], senha="errada")])
        r2 = executor.executar_rodada([_trabalho(IE_OUTRA, "Mercado", ["nfe_saida"], senha="errada")])
    finally:
        executor.fechar()
    assert r1[0].status == r2[0].status == "senha_invalida", (r1, r2)
    assert ESTADO["logins"] == ["mar00134"]  # a segunda rodada não tentou de novo
