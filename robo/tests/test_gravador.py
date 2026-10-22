"""O gravador registra os passos feitos no Chrome (por uma "pessoa" simulada) sem gravar a senha,
inclusive dentro dos quadros do ATF, e guarda o arquivo baixado na pasta de gravações."""
import copy
import json
import threading
import time
import urllib.request
import zipfile

import gravador
from gravador import Gravador
from test_atf_simulado import ESTADO, _nova_mensagem, _zip, ambiente  # noqa: F401  (mesmo ATF simulado)
from util import IE_EMPRESA, nfe


def _quadro(page, trecho):
    for _ in range(30):
        for f in page.frames:
            if trecho in f.url:
                return f
        page.wait_for_timeout(200)
    raise AssertionError(f"quadro {trecho} não abriu")


def test_grava_passos_sem_senha(ambiente, tmp_path, monkeypatch):  # noqa: F811
    cfg, pasta = ambiente
    cfg = copy.deepcopy(cfg)
    monkeypatch.setattr(gravador, "PASTA", tmp_path)
    resultado = {}

    def gravar():
        resultado["arquivo"] = Gravador(cfg, "nfe teste").gravar(segundos=35)

    t = threading.Thread(target=gravar)
    t.start()
    time.sleep(3)  # o gravador conecta

    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{cfg['chrome']['porta']}")
        page = browser.contexts[0].new_page()
        page.goto(cfg["atf"]["url_login"])
        page.wait_for_timeout(1500)
        page.click("#login")
        page.fill("#login", "mar00134")
        page.dispatch_event("#login", "change")
        page.fill("#senha", "certa")
        page.dispatch_event("#senha", "change")
        page.click('button[name="btnAvancar"]')
        page.wait_for_timeout(2000)
        menu = _quadro(page, "SEGf_Menu.jsp")
        menu.click("text=NF-e")
        page.wait_for_timeout(1000)
        _quadro(page, "caminho=nfe").click('a[href*="FISf_ConsultarNFeXml2"]')
        conteudo = _quadro(page, "FISf_ConsultarNFeXml2")
        page.wait_for_timeout(1500)
        conteudo.fill('input[name="edtDtInicial"]', "01/09/2026")
        conteudo.dispatch_event('input[name="edtDtInicial"]', "change")
        emit = _quadro(page, "_cmpEmit")
        page.wait_for_timeout(1200)  # uma pessoa não age em milissegundos: o gravador entra no quadro novo
        emit.fill("#hidNrDocumentocmpEmit", IE_EMPRESA)
        emit.dispatch_event("#hidNrDocumentocmpEmit", "change")
        emit.click('button[name="btnPesquisar"]')
        page.wait_for_timeout(1500)
        conteudo.select_option('select[name="cmbTpExibicao"]', label="XML")
        page.wait_for_timeout(1000)
    t.join(60)

    z = zipfile.ZipFile(resultado["arquivo"])
    assert resultado["arquivo"].name.startswith("gravacao_nfe-teste_")
    dados = json.loads(z.read("gravacao.json"))
    texto = json.dumps(dados, ensure_ascii=False)
    prints = [n for n in z.namelist() if n.startswith("telas/")]
    assert prints and z.read(prints[0])[:4] == b"\x89PNG"  # print de cada tela nova
    assert "certa" not in texto  # a senha nunca vai para o arquivo
    alterou = [e for e in dados["eventos"] if e["acao"] == "alterou"]
    assert any(e["valor"] == "***" and e["id"] == "senha" for e in alterou)
    ie = next(e for e in alterou if e["valor"] == IE_EMPRESA)
    assert ie["id"] == "hidNrDocumentocmpEmit" and "_cmpEmit" in ie["quadro"], ie  # dentro do quadro do bloco
    assert any(e["acao"] == "clique" and e["texto"] == "Pesquisar" for e in dados["eventos"])
    assert any(e.get("opcao") == "XML" for e in alterou)
    assert any("FISf_ConsultarNFeXml2" in t["url"] for t in dados["telas"])


def test_guarda_o_arquivo_baixado(ambiente, tmp_path, monkeypatch):  # noqa: F811
    """Só o gravador conectado ao Chrome (como no PC): a mensagem chama mostrarArquivo(0) e o ZIP
    fica na pasta de gravações (sem o gravador, iria para a pasta temporária da automação)."""
    cfg, _ = ambiente
    monkeypatch.setattr(gravador, "PASTA", tmp_path)
    _nova_mensagem("FIS_1322", "NFe: Consulta Genérica (Ano 2026)", -10,
                   _zip({"s.xml": nfe("11222333000181", "", 1, ie_emit=IE_EMPRESA)}), "gravação")
    filha = ESTADO["mensagens"][-1]["filhas"][1]["id"]
    resultado = {}
    t = threading.Thread(target=lambda: resultado.update(arquivo=Gravador(copy.deepcopy(cfg)).gravar(segundos=12)))
    t.start()
    time.sleep(3)
    base = cfg["atf"]["url_login"].rstrip("/")
    urllib.request.urlopen(urllib.request.Request(
        f"http://127.0.0.1:{cfg['chrome']['porta']}/json/new?{base}/seg/SEGf_LerMensagem.do?hidsqMensagem={filha}"
        "%26auto=1", method="PUT"))
    t.join(40)
    z = zipfile.ZipFile(resultado["arquivo"])
    dados = json.loads(z.read("gravacao.json"))
    assert any(z.read(a)[:2] == b"PK" for a in dados["arquivos_baixados"]), dados["arquivos_baixados"]
