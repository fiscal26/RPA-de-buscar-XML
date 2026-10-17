"""Ponta a ponta contra um ATF de mentira que imita o fluxo real (out/2026):

- login (dentro de quadro) com o login do contador;
- menu "/ MEN" > "NF-e" > "Consulta NF-e por Emitentes/Destinatários": Data de Emissão, blocos
  Emitente e Destinatário (o ATF recusa os dois juntos), "Pesquisar" do bloco traz o nome,
  "Tipo de Exibição" = XML e "Consultar";
- "NFC-e" > "Consulta por Emitente";
- depois do Consultar, o aviso "O resultado será enviado para sua caixa de mensagens do ATF";
- o XML NÃO vem na hora: cada consulta gera 3 mensagens em "Minhas Mensagens" (sino), no mesmo
  segundo, e só a final ("Tarefa executada com sucesso") traz o anexo "Dados referentes ao ano de
  2026"; sem dados = mensagem final sem anexo; a caixa só pode ser consultada de tempos em tempos
  (no ATF real, 1 minuto); há mensagens de outra competência e de consulta feita à mão no meio;
- "Ler Mensagem" com "Período solicitado" e o botão Voltar.

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
INTERVALO_CAIXA = 3  # segundos entre consultas à caixa de mensagens (no ATF real: 60)
CHROME = os.environ.get("CHROME_TESTE") or next(
    (str(p) for p in Path("/opt/pw-browsers").glob("chromium-*/chrome-linux/chrome")), shutil.which("chromium") or "")

ESTADO = {"logins": [], "consultas": [], "mensagens": [], "recusas": [], "ultima_lista": 0.0, "lista_cedo": 0}


def _zip(itens: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for nome, dados in itens.items():
            z.writestr(nome, dados)
    return buf.getvalue()


def _agora() -> str:
    return datetime.now().strftime("%d/%m/%Y %H:%M:%S")


def topo():
    return ('<header><b>Sistema ATF</b> <input placeholder="Função" id="f1"> '
            '<a href="/atf/mensagens" title="Mensagens">🔔</a> <a href="/atf/sair" title="Sair">⎋</a></header>'
            f'<div class="sessao">Login: mar00134 · Sessão expira em: 14 min · {_agora()} Produção</div>'
            '<nav><a href="/atf/home">/ MEN</a> <a href="/atf/menu/nfe">NF-e</a> <a href="/atf/menu/nfce">NFC-e</a></nav>')


BLOCO = """<div class="secao card-header"><span>&nbsp;{nome}&nbsp;</span></div>
<div class="form-floating"><select id="s{n}"><option>CPF</option><option>CNPJ</option>
<option selected>Inscrição Estadual</option></select><label>Tipo de Identificação</label></div>
<div class="form-floating"><input id="x{n}" class="form-control"><label>Número</label></div>
<button type="button" onclick="const ie = document.getElementById('x{n}').value; document.getElementById('r{n}').value = ie === '160555558' ? '' : 'EMPRESA ' + ie">Pesquisar</button>
<div class="form-floating"><input id="r{n}"><label>Nome/Razão Social</label></div>
<label>UF</label><select><option>---</option></select>"""

RODAPE = """<label>Tipo de Exibição</label><select id="te"><option>HTML</option><option>PDF</option><option>XML</option></select>
<button type="button" onclick="consultar()"><i class="bi-search"></i> Consultar</button>
<button type="button" onclick="limpar()">Limpar</button>
<div id="aviso"></div>
<div id="calendario" style="display:none; position:fixed; left:0; top:0; width:100%; height:100%; z-index:999;
     background:rgba(255,255,255,.9)">calendário aberto</div>
<script>
// calendário que abre ao focar as datas e cobre a tela até apertar Esc (como os seletores de data)
for (const id of ['d1', 'd2']) document.getElementById(id).addEventListener('focus',
    () => document.getElementById('calendario').style.display = 'block');
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.getElementById('calendario').style.display = 'none'; });
function v(id) { const e = document.getElementById(id); return e ? e.value : ''; }
function limpar() { document.querySelectorAll('input').forEach(e => { if (e.id !== 'f1') e.value = ''; }); }
async function consultar() {
  const q = new URLSearchParams({tela: TELA, ini: v('d1'), fim: v('d2'), emit: v('x1'), dest: v('x2'),
                                 exib: v('te'), tipo1: v('s1'), tipo2: v('s2'), nome1: v('r1'), nome2: v('r2')});
  const r = await fetch('/atf/consultar?' + q.toString());
  const a = document.getElementById('aviso');
  a.className = 'alert alert-success'; a.innerText = await r.text();
}
</script>"""


def tela_nfe():
    return (topo() + '<h4>Consulta NF-e por Emitentes/Destinatários</h4><h5>Consulta NF-e</h5>'
            '<label>Data de Emissão</label><input id="d1"> - <input id="d2">'
            '<label>Número</label><input id="n1"> a <input id="n2">'
            '<label>Situação</label><select><option>---</option></select>'
            '<label>Operação</label><select><option>---</option></select>'
            + BLOCO.format(nome="Emitente", n=1) + BLOCO.format(nome="Destinatário", n=2)
            + "<script>const TELA='nfe'</script>" + RODAPE)


def tela_nfce():
    return (topo() + '<h4>Consulta Genérica da NFC-e</h4><h5>Filtros de Consulta</h5>'
            '<label>Data Emissão Inicial</label><input id="d1"><label>Data Emissão Final</label><input id="d2">'
            '<label>Número</label><input id="n1"><label>Situação</label><select><option>---</option></select>'
            '<label>Chave Acesso</label><input id="ch"><button type="button">Adicionar</button>'
            + BLOCO.format(nome="Emitente", n=1) + BLOCO.format(nome="Destinatário", n=2)
            + "<script>const TELA='nfce'</script>" + RODAPE)


def _nova_mensagem(codigo: str, assunto: str, atraso: float, anexo: bytes | None, texto: str,
                   periodo: str = "01/09/2026 a 30/09/2026"):
    """Como o ATF: 3 mensagens no mesmo segundo; só a final tem o anexo."""
    pronta = (datetime.now() + timedelta(seconds=atraso)).replace(microsecond=0)
    final = (f"{texto}<br>Período solicitado: {periodo}<br><br>Tarefa executada com sucesso.<br>"
             "Abra o arquivo em anexo para ver o relatório gerado.<br>Observação: A não existência de arquivo "
             "em anexo significa que não existem dados para o período consultado.")
    for txt, arq in (("Tarefa recebida.", None), (final, anexo), ("Tarefa em processamento.", None)):
        ESTADO["mensagens"].append({"id": len(ESTADO["mensagens"]) + 1, "codigo": codigo, "assunto": assunto,
                                    "pronta": pronta, "anexo": arq, "texto": txt})


def _responder(q: dict) -> str:
    """O que o ATF faria com a consulta: gera (com atraso) a mensagem com o ZIP."""
    ESTADO["consultas"].append(q)
    if q["emit"] and q["dest"]:
        ESTADO["recusas"].append(q)
        return "Erro: informe apenas o Emitente ou o Destinatário."
    assert (q["ini"], q["fim"], q["exib"]) == ("01/09/2026", "30/09/2026", "XML"), q
    assert q["tipo1"] == "Inscrição Estadual" and q["tipo2"] == "Inscrição Estadual", q
    ie = q["emit"] or q["dest"]
    if ESTADO.pop("manual", False):
        _nova_mensagem("FIS_1322", "NFe: Consulta Genérica (Ano 2026)", 0,
                       _zip({"x.xml": nfe(FORNECEDOR, "", 7, ie_emit=IE_ESTRANHA)}), "consulta manual")
    assert q["nome1" if q["emit"] else "nome2"] == f"EMPRESA {ie}", "Pesquisar do bloco não foi clicado"
    if q["tela"] == "nfce":
        _nova_mensagem("FIS_1484", "NFCe: Consulta Genérica da NFC-e", 2,
                       _zip({"c1.xml": nfe(EMPRESA, "", 5, modelo="65", ie_emit=ie)}), f"Consulta NFC-e emitente {ie}")
    elif q["emit"]:
        _nova_mensagem("FIS_1322", "NFe: Consulta Genérica (Ano 2026)", 4,
                       _zip({"s1.xml": nfe(EMPRESA, FORNECEDOR, 1, ie_emit=ie, ie_dest=IE_OUTRA),
                             "s2.xml": nfe(EMPRESA, FORNECEDOR, 2, ie_emit=ie)}), f"Consulta emitente {ie}")
    elif ie == IE_OUTRA:
        # a Mercado comprou da Padaria (nota s1): mesma nota é saída de uma e entrada da outra
        _nova_mensagem("FIS_1322", "NFe: Consulta Genérica (Ano 2026)", 1,
                       _zip({"e1.xml": nfe(EMPRESA, FORNECEDOR, 1, ie_emit=IE_EMPRESA, ie_dest=IE_OUTRA)}),
                       f"Consulta destinatário {ie}")
    else:
        _nova_mensagem("FIS_1322", "NFe: Consulta Genérica (Ano 2026)", 1, None,
                       f"Consulta destinatário {ie}: nenhum registro encontrado.")
    return "O resultado será enviado para sua caixa de mensagens do ATF"


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

    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query, keep_blank_values=True).items()}
        logado = "sessao=ok" in (self.headers.get("Cookie") or "")
        if u.path == "/atf/":
            if logado:
                self._html(topo() + "Bem-vindo")
            else:
                self._html('<iframe name="principal" src="/atf/login" width="600" height="300"></iframe>')
        elif u.path == "/atf/login":
            self._html('<form method="post" action="/atf/entrar" target="_top"><b>Login</b> SEFAZ-PB'
                       '<div class="form-floating"><input type="text" name="u_a1"><label>Usuário</label></div>'
                       '<div class="form-floating"><input type="password" name="p_b2"><label>Senha</label></div>'
                       '<button class="btn">Avançar</button><a href="#">Acesse via Certificado Digital</a></form>')
        elif not logado:
            self._html("Sessão expirada. Faça login.")
        elif u.path == "/atf/home":
            self._html(topo() + "Menu principal")
        elif u.path == "/atf/menu/nfe":
            self._html(topo() + '<a href="#">NF-E ↲</a><a href="/atf/x">Consulta Completa</a>'
                       '<a href="/atf/fis1322">Consulta NF-e por Emitentes/Destinatários</a><a href="#">Gerar XML NF-e</a>')
        elif u.path == "/atf/menu/nfce":
            self._html(topo() + '<a href="#">NFC-E ↲</a><a href="/atf/x">Consulta por CPF</a>'
                       '<a href="/atf/fis1484">Consulta por Emitente</a><a href="/atf/x">Consultar</a>')
        elif u.path == "/atf/fis1322":
            self._html(tela_nfe())
        elif u.path == "/atf/fis1484":
            self._html(tela_nfce())
        elif u.path == "/atf/consultar":
            dados = _responder(q).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(dados)
        elif u.path == "/atf/mensagens":
            agora = datetime.now()
            if time.time() - ESTADO["ultima_lista"] < INTERVALO_CAIXA and not q.get("voltar"):
                ESTADO["lista_cedo"] += 1
                self._html(topo() + '<h4>Minhas Mensagens</h4><b>ATENÇÃO: Você poderá consultar sua caixa de '
                           'mensagens em 1 minuto. AGUARDE!</b>')
                return
            if not q.get("voltar"):
                ESTADO["ultima_lista"] = time.time()
            linhas = "".join(
                f'<tr><td><input type="checkbox"></td><td>✉ {"<img src=/clip.png alt=anexo>" if m["anexo"] else ""}</td>'
                + (f'<td><a href="javascript:void(0)" onclick="location=\'/atf/mensagem?id={m["id"]}\'">{m["codigo"]} - Consulta Genérica NF-e</a></td>'
                   if m["codigo"] == "FIS_1322" else
                   f'<td><a href="/atf/mensagem?id={m["id"]}">{m["codigo"]} - Consulta de NFC-e por Emitente</a></td>')
                + f'<td>{m["assunto"]}</td>'
                f'<td>{m["pronta"]:%d/%m/%Y %H:%M:%S}</td><td>{m["pronta"] + timedelta(days=5):%d/%m/%Y}</td></tr>'
                for m in sorted(ESTADO["mensagens"], key=lambda m: m["pronta"], reverse=True) if m["pronta"] <= agora)
            self._html(topo() + '<h4>Minhas Mensagens</h4><table><thead><tr><th></th><th></th><th>Remetente</th>'
                       f'<th>Assunto</th><th>Enviada</th><th>Validade</th></tr></thead><tbody>{linhas}</tbody></table>')
        elif u.path == "/atf/mensagem":
            m = ESTADO["mensagens"][int(q["id"]) - 1]
            anexo = (f'<img src="/clip.png"> 1 Anexo(s):<br><a href="/atf/anexo?id={m["id"]}">Dados referentes ao ano de 2026</a>'
                     if m["anexo"] else "")
            self._html(topo() + f'<b>Ler Mensagem</b><h5>{m["assunto"]}</h5>- De: {m["codigo"]}<br>- Enviada: '
                       f'{m["pronta"]:%d/%m/%Y %H:%M:%S}<br>{anexo}<p>{m["texto"]}</p>'
                       '<input type="button" value="Voltar" onclick="location=\'/atf/mensagens?voltar=1\'">')
        elif u.path == "/atf/anexo":
            dados = ESTADO["mensagens"][int(q["id"]) - 1]["anexo"]
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Disposition", f'attachment; filename="xml_{q["id"]}.zip"')
            self.end_headers()
            self.wfile.write(dados)
        elif u.path == "/atf/sair":
            self._html("Sessão encerrada", cookie="sessao=; Max-Age=0; Path=/")
        else:
            self._html(topo() + "Página")

    def do_POST(self):
        tamanho = int(self.headers.get("Content-Length") or 0)
        campos = {k: v[0] for k, v in parse_qs(self.rfile.read(tamanho).decode()).items()}
        ESTADO["logins"].append(campos.get("u_a1", ""))
        if campos.get("u_a1") == "mar00134" and campos.get("p_b2") == "certa":
            self._html(topo() + "Bem-vindo ao ATF", cookie="sessao=ok; Path=/")
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
    # mensagem antiga (de antes da rodada) e uma de empresa fora da rodada: não podem atrapalhar
    _nova_mensagem("FIS_1322", "NFe: Consulta Genérica (Ano 2026)", -3600,
                   _zip({"velha.xml": nfe(EMPRESA, FORNECEDOR, 99, ie_emit=IE_EMPRESA)}), "antiga")
    _nova_mensagem("FIS_1322", "NFe: Consulta Genérica (Ano 2026)", 2,
                   _zip({"agosto.xml": nfe(EMPRESA, FORNECEDOR, 98, "2026-08-10", ie_emit=IE_EMPRESA)}),
                   "outra competência", periodo="01/08/2026 a 31/08/2026")
    executor = robo_xml.Executor(cfg)
    try:
        ESTADO["manual"] = True  # alguém consulta outra empresa à mão no mesmo login, durante a rodada
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
    base = pasta / "xml"
    assert len(list(base.glob("015 - Padaria/2026-09/NF-e Saida/*.xml"))) == 2  # a antiga (nº 99) não entrou
    assert not list(base.glob("015 - Padaria/2026-08"))  # resposta de outra competência não entrou
    assert r3.status == "erro" and "não encontrou a IE" in r3.mensagem, r3
    assert ESTADO["lista_cedo"] == 0  # respeitou o intervalo da caixa de mensagens
    assert len(list(base.glob("016 - Mercado/2026-09/NF-e Entrada/*.xml"))) == 1
    assert len(list(base.glob("016 - Mercado/2026-09/NFC-e/*.xml"))) == 1
    assert len(list(base.glob("_sem_empresa/2026-09/*.xml"))) == 1  # a da consulta manual


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
