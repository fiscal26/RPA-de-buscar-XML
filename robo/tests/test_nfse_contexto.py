"""Integração NFS-e com isolamento, recuperação e contratos atuais do painel."""
import json
import os
import subprocess
import sys
import threading
from pathlib import Path

import pytest
from openpyxl import load_workbook

import config
import nfse
import robo_xml
from armazenamento import abrir_empresa, area_do_contexto
from test_nfse import (ORG, C1, C2, DONO, CLIENTE, PortalFalso, Resposta,
                       chaves, contexto, evento_xml, nota_xml, tarefa)

OUTRA_ORG = "6d12ae21-e996-4f5d-925a-d844a32399e4"


@pytest.fixture
def cfg(destino, monkeypatch):
    monkeypatch.setattr(nfse.ClienteADN.__init__, "__defaults__", ("", nfse.ADN, 0, lambda _: None))
    return {"pastas": {"destino": str(destino)}}


def documento(valor=100, chave=C1, numero="1"):
    return (1 if chave == C1 else 2, "NFSE", chave, nota_xml(chave, numero, DONO, CLIENTE, "Cliente", valor))


def test_fluxo_portal_publica_resultados_e_arquivos_separados(cfg, chaves, monkeypatch):
    tarefas = [tarefa(chaves, ["nfse_emitidas", "nfse_retencoes"]) | {"id": str(i), "org_id": org}
               for i, org in enumerate((ORG, OUTRA_ORG), 1)]
    portais = iter([PortalFalso([documento(100)]), PortalFalso([documento(200)])])
    monkeypatch.setattr(nfse, "sessao_com_certificado", lambda _: next(portais))
    finais = {}

    def requisicao(metodo, url, **kw):
        if metodo == "GET" and url.endswith("xml_tarefas"):
            t = next(t for t in tarefas if kw["params"]["id"] == "eq." + t["id"])
            return Resposta(200, [{"org_id": t["org_id"], "ie": t["cnpj"]}])
        if metodo == "GET":
            return Resposta(200, [])
        if "status" in kw["json"]:
            finais[url.rsplit("eq.", 1)[1]] = kw["json"]
        return Resposta(204, {})

    monkeypatch.setattr(robo_xml.requests, "request", requisicao)
    robo = robo_xml.Robo.__new__(robo_xml.Robo)
    robo.cfg, robo.privada, robo.em_curso = cfg, chaves[0], {}
    robo.portal = robo_xml.Portal("https://teste.invalid", "falsa")
    for t in tarefas:
        robo._uma_nfse(t)
    for i, valor in (("1", 100), ("2", 200)):
        final = finais[i]
        assert final["status"] == "concluido" and final["qtd_xml"] == 1
        assert final["detalhes"]["mei_nfse"]["meses"][0]["valor"] == valor
        empresa = Path(cfg["pastas"]["destino"]) / final["pasta"]
        assert not Path(final["pasta"]).is_absolute()
        assert (empresa / "092026" / nfse.PASTA_EMITIDAS / f"{C1}.xml").is_file()
        wb = load_workbook(empresa / "092026" / "Retenções NFS-e 2026-09.xlsx", read_only=True)
        try:
            assert wb["Emitidas"]["G2"].value == valor
        finally:
            wb.close()
    assert finais["1"]["pasta"] != finais["2"]["pasta"]


@pytest.mark.parametrize("tipo", ["indice", "xml_ausente", "xml_ilegivel"])
def test_cache_invalido_bloqueia_antes_da_api(cfg, chaves, tipo):
    raiz = Path(cfg["pastas"]["destino"])
    cache = area_do_contexto(raiz, "_cache", "portal", ORG, DONO)
    indice = cache / "indice.json"
    if tipo == "indice":
        indice.write_bytes(b"{")
    else:
        indice.write_text(json.dumps({"ultimo_nsu": 1, "documentos": {"1": {"tipo": "NFSE", "chave": C1, "xml": True}}}), encoding="utf-8")
        if tipo == "xml_ilegivel":
            (cache / "1.xml").write_bytes(b"<NFSe")
    original = indice.read_bytes()
    portal = PortalFalso([documento()])
    r = robo_xml.executar_nfse(cfg, tarefa(chaves, ["nfse_emitidas"]), chaves[0], sessao_falsa=portal)
    assert r.status == "erro" and "mei_nfse" not in r.detalhes
    assert not portal.pedidos and indice.read_bytes() == original


def test_planilha_anterior_preservada_e_reconstruida_pelo_cache(cfg, chaves, monkeypatch):
    t = tarefa(chaves, ["nfse_emitidas", "nfse_retencoes"])
    r = robo_xml.executar_nfse(cfg, t, chaves[0], sessao_falsa=PortalFalso([documento()]))
    pasta = Path(cfg["pastas"]["destino"]) / r.pasta / "092026"
    planilha = pasta / "Retenções NFS-e 2026-09.xlsx"
    anterior = planilha.read_bytes()

    def falhar(emitidas, recebidas, temporario, *args):
        temporario.write_bytes(b"incompleto")
        raise OSError("Falha antes da publicação")

    with monkeypatch.context() as m:
        m.setattr(nfse, "relatorio_retencoes", falhar)
        r = robo_xml.executar_nfse(cfg, t, chaves[0], sessao_falsa=PortalFalso([documento(), documento(200, C2, "2")]))
    assert r.status == "erro" and "mei_nfse" not in r.detalhes
    assert planilha.read_bytes() == anterior and not list(pasta.glob(".v2-*"))
    portal = PortalFalso([])
    r = robo_xml.executar_nfse(cfg, t, chaves[0], sessao_falsa=portal)
    assert portal.pedidos[0][0].endswith("/2")
    assert r.detalhes["mei_nfse"]["meses"][0]["valor"] == 300


def test_reabre_competencia_antiga_e_bloqueia_formatos_duplicados(cfg, chaves):
    destino = Path(cfg["pastas"]["destino"])
    with abrir_empresa(destino, contexto()) as empresa:
        antiga = empresa / "2026-09"
        antiga.mkdir()
    t = tarefa(chaves, ["nfse_emitidas"])
    r = robo_xml.executar_nfse(cfg, t, chaves[0], sessao_falsa=PortalFalso([documento()]))
    assert r.status == "concluido" and list(antiga.rglob("*.xml"))
    assert not (empresa / "092026").exists()
    (empresa / "092026").mkdir()
    portal = PortalFalso([])
    r = robo_xml.executar_nfse(cfg, t, chaves[0], sessao_falsa=portal)
    assert r.status == "erro" and "Dois diretórios" in r.mensagem and not portal.pedidos


def test_reserva_da_empresa_entre_processos_nao_bloqueia_outro_escritorio(cfg, chaves):
    codigo = """import sys
from armazenamento import abrir_empresa, ContextoArmazenamento
c=ContextoArmazenamento('portal',sys.argv[2],'nfse_nacional','cnpj',sys.argv[3],'Empresa')
with abrir_empresa(sys.argv[1],c):
    print('pronto',flush=True)
    sys.stdin.readline()
"""
    ambiente = os.environ | {"PYTHONPATH": str(Path(robo_xml.__file__).parent)}
    p = subprocess.Popen([sys.executable, "-B", "-c", codigo, cfg["pastas"]["destino"], ORG, DONO],
                         stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=ambiente)
    try:
        assert p.stdout.readline().strip() == "pronto"
        portal = PortalFalso([])
        t = tarefa(chaves, ["nfse_emitidas"])
        r = robo_xml.executar_nfse(cfg, t, chaves[0], sessao_falsa=portal)
        assert r.status == "erro" and not portal.pedidos
        r = robo_xml.executar_nfse(cfg, t | {"org_id": OUTRA_ORG}, chaves[0], sessao_falsa=portal)
        assert r.status == "sem_notas" and portal.pedidos
    finally:
        p.communicate("\n", timeout=10)
    r = robo_xml.executar_nfse(cfg, t, chaves[0], sessao_falsa=PortalFalso([]))
    assert r.status == "sem_notas"


def test_fila_ausente_nao_recorre_ao_contrato_antigo(monkeypatch):
    pedidos = []

    def requisicao(metodo, url, **kwargs):
        pedidos.append(url)
        return Resposta(404, {"code": "PGRST202"})

    monkeypatch.setattr(robo_xml.requests, "request", requisicao)
    portal = robo_xml.Portal("https://teste.invalid", "falsa")
    with pytest.raises(robo_xml.ContratoPortalIndisponivel):
        portal.pegar_lote_nfse("robo", 2)
    assert pedidos == ["https://teste.invalid/rest/v1/rpc/xml_nfse_pegar_lote_v2"]


def test_contexto_invalido_e_historico_de_outra_org_nao_abrem_credenciais(cfg, monkeypatch):
    monkeypatch.setattr(robo_xml.cripto, "decifrar_arquivo", lambda *args: pytest.fail("Credencial aberta antes de validar contexto"))
    r = robo_xml.executar_nfse(cfg, {"cnpj": DONO, "tipos": ["nfse_emitidas"], "data_inicio": "2026-09-01"}, None)
    assert r.status == "erro" and "mei_nfse" not in r.detalhes
    portal = robo_xml.Portal("https://teste.invalid", "falsa")
    pedidos = []

    def resposta(*args, **kw):
        pedidos.append(kw)
        return Resposta(200, [{"org_id": OUTRA_ORG, "ie": DONO}])

    monkeypatch.setattr(robo_xml.requests, "request", resposta)
    with pytest.raises(RuntimeError, match="histórico"):
        portal.meses_nfse_consultados("t", DONO, "2026-09-01", org_id=ORG)
    assert len(pedidos) == 1


def test_teste_local_exige_id_persistente_antes_de_pedir_certificado(destino, monkeypatch):
    arquivo = destino / "config.json"
    arquivo.write_text(json.dumps({"pastas": {"destino": str(destino)}}), encoding="utf-8")
    monkeypatch.setattr(config, "ARQUIVO_CONFIG", arquivo)
    monkeypatch.setattr(config, "RAIZ", destino)
    recebidos = []
    monkeypatch.setattr(robo_xml, "testar_nfse", lambda cfg, comp, **kwargs: recebidos.append(kwargs["contexto_local"]))
    comando = ["robo_xml.py", "--nfse-teste", "--competencia", "09/2026"]
    monkeypatch.setattr(sys, "argv", comando)
    with pytest.raises(SystemExit, match="criar-contexto-local"):
        robo_xml.main()
    monkeypatch.setattr(sys, "argv", [*comando, "--criar-contexto-local"])
    robo_xml.main()
    monkeypatch.setattr(sys, "argv", comando)
    robo_xml.main()
    assert recebidos[0] == recebidos[1] == config.carregar_contexto_local()


def test_fila_paralela_separa_orgs_e_serializa_a_mesma_identidade():
    fila = [{"id": "a1", "org_id": ORG, "cnpj": DONO},
            {"id": "b1", "org_id": OUTRA_ORG, "cnpj": DONO},
            {"id": "a2", "org_id": ORG, "cnpj": DONO}]
    robo = robo_xml.Robo.__new__(robo_xml.Robo)
    robo.cfg, robo.nome, robo.parar = {"portal": {"intervalo_segundos": 0.01}}, "ensaio", False
    robo._trava, robo._travas_empresa = threading.Lock(), {}
    encontro = threading.Barrier(2, timeout=5)
    ativos, feitos, falhas = set(), [], []

    def pegar(nome, maximo):
        lote = fila[:maximo]
        del fila[:maximo]
        return lote

    def processar(t):
        with robo._trava:
            if t["org_id"] in ativos:
                falhas.append("Mesmo contexto executado simultaneamente")
            ativos.add(t["org_id"])
        if t["id"] != "a2":
            try:
                encontro.wait()
            except threading.BrokenBarrierError:
                falhas.append("Escritórios diferentes ficaram bloqueados entre si")
        with robo._trava:
            ativos.discard(t["org_id"])
            feitos.append(t["id"])
            if len(feitos) == 3:
                robo.parar = True

    linha = threading.Thread(target=robo._fila_paralela, args=("NFS-e", pegar, processar, {}, 3), daemon=True)
    linha.start()
    linha.join(10)
    assert not linha.is_alive() and sorted(feitos) == ["a1", "a2", "b1"] and not falhas


def test_indicacao_mei_no_cache_de_um_escritorio_nao_amplia_o_outro(cfg, chaves):
    resultados = []
    for org, simples in ((ORG, "2"), (OUTRA_ORG, "3")):
        xml = nota_xml(C1, "1", DONO, CLIENTE, "Cliente", 100, simples=simples)
        t = tarefa(chaves, ["nfse_emitidas"]) | {"org_id": org}
        resultados.append(robo_xml.executar_nfse(cfg, t, chaves[0], sessao_falsa=PortalFalso([(1, "NFSE", C1, xml)])))
    a, b = [r.detalhes["mei_nfse"] for r in resultados]
    assert a["detectado_no_xml"] and len(a["meses"]) == 9
    assert not b["detectado_no_xml"] and len(b["meses"]) == 1


def test_cancelamento_que_zera_mes_atualiza_lote_e_faturamento(cfg, chaves):
    import xml.etree.ElementTree as ET

    t = tarefa(chaves, ["nfse_emitidas", "nfse_retencoes"])
    r = robo_xml.executar_nfse(cfg, t, chaves[0], sessao_falsa=PortalFalso([documento()]))
    pasta = Path(cfg["pastas"]["destino"]) / r.pasta / "092026"
    lote = pasta / "NFS-e Emitidas 092026.xml"
    assert b"<CompNfse>" in lote.read_bytes()
    r = robo_xml.executar_nfse(cfg, t, chaves[0], sessao_falsa=PortalFalso([(2, "EVENTO", C1, evento_xml(C1))]))
    assert r.status == "sem_notas" and r.detalhes["mei_nfse"]["meses"][0]["valor"] == 0
    assert not ET.fromstring(lote.read_bytes()).findall('.//{http://www.abrasf.org.br/nfse.xsd}CompNfse')
