"""O gravador registra os passos feitos no Chrome (por uma "pessoa" simulada) sem gravar a senha."""
import copy
import json
import threading
import time

import config
from gravador import Gravador
from test_atf_simulado import ambiente  # noqa: F401  (mesmo ATF simulado e Chrome)


def test_grava_passos_sem_senha(ambiente):  # noqa: F811
    cfg, pasta = ambiente
    cfg = copy.deepcopy(cfg)
    resultado = {}

    def gravar():
        resultado["arquivo"] = Gravador(cfg).gravar(segundos=25)

    t = threading.Thread(target=gravar)
    t.start()
    time.sleep(3)  # o gravador conecta

    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{cfg['chrome']['porta']}")
        page = browser.contexts[0].new_page()
        page.goto(cfg["atf"]["url_login"])
        page.wait_for_timeout(1500)
        quadro = page.frames[1]
        quadro.fill('input[name="u_a1"]', "mar00134")
        quadro.fill('input[name="p_b2"]', "certa")
        quadro.dispatch_event('input[name="p_b2"]', "change")
        quadro.click("button")
        page.wait_for_timeout(1500)
        page.click("text=NF-e")
        page.wait_for_timeout(1000)
        page.click("text=Consulta NF-e por Emitentes/Destinatários")
        page.wait_for_timeout(1500)
        page.fill("#x1", "160123453")
        page.dispatch_event("#x1", "change")
        page.locator("button", has_text="Pesquisar").first.click()
        page.select_option("#te", label="XML")
        page.wait_for_timeout(1500)
    t.join(40)

    dados = json.loads(resultado["arquivo"].read_text(encoding="utf-8"))
    texto = json.dumps(dados, ensure_ascii=False)
    assert "certa" not in texto  # a senha nunca vai para o arquivo
    alterou = [e for e in dados["eventos"] if e["acao"] == "alterou"]
    assert any(e["valor"] == "***" for e in alterou)
    ie = next(e for e in alterou if e["valor"] == "160123453")
    assert ie["id"] == "x1" and ie["rotulo"] == "Número" and ie["secao"] == "Emitente", ie
    assert any(e["acao"] == "clique" and e["texto"] == "Pesquisar" and e["secao"] == "Emitente" for e in dados["eventos"])
    assert any(e.get("opcao") == "XML" for e in alterou)
    assert any("fis1322" in t["url"] for t in dados["telas"])
    resultado["arquivo"].unlink()
