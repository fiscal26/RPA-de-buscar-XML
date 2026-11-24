"""Integração ATF por escritório com dados sintéticos e destinos temporários."""
import copy
import io
import json
import os
import subprocess
import sys
import zipfile
from datetime import date, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from openpyxl import load_workbook

import arquivos
import config
import nfse
import robo_xml
from armazenamento import (PASTA_CONTEXTOS, ContextoArmazenamento, IdentidadeArmazenamentoInvalida,
                           abrir_empresa, reservar_caixa_atf, renomear_subpasta_validada, LIMITE_CAMINHO)
from atf_pb import AtfPB, Emissao, Envio, Recolha
from test_nfse import C1, C2, CLIENTE, DONO, PortalFalso, Resposta, chaves, nota_xml, tarefa
from util import IE_EMPRESA, nfe


ORG_A = "7b245ed0-a8a0-4242-bcf0-24c8eb2895c6"
ORG_B = "6d12ae21-e996-4f5d-925a-d844a32399e4"
IE_B = "000000019"
CNPJ_B = "11222333000262"
INICIO = date(2026, 9, 1)
FIM = date(2026, 9, 30)


@pytest.fixture
def cfg(tmp_path_factory):
    cfg = copy.deepcopy(config.PADRAO)
    cfg["pastas"]["destino"] = str(tmp_path_factory.mktemp("v2"))
    cfg["atf"]["conferir_em_html"] = False
    cfg["portal"].update(supabase_url="https://exemplo.invalid", chave_service_role="falsa", site="")
    return cfg


def linha(tid, org, ie=IE_EMPRESA, tipos=None):
    return {
        "id": tid, "tentativa_id": f"reserva-{tid}", "org_id": org, "org_nome": "Mesmo escritório",
        "ie": ie, "nome": "Empresa/A",
        "codigo": "7", "tipos": tipos or ["nfe_saida", "faturas"], "login_atf": "mesmo-login",
        "senha_cifrada": "cifra-fictícia", "data_inicio": str(INICIO), "data_fim": str(FIM),
    }


def registrar_atualizacao(atualizacoes, tarefa, dados):
    assert tarefa["tentativa_id"]
    atualizacoes.setdefault(tarefa["id"], {}).update(dados)
    return True


def zip_notas(*notas):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as arquivo:
        for i, nota in enumerate(notas):
            arquivo.writestr(f"nota-{i}.xml", nota)
    return buffer.getvalue()


class AtfFalso:
    def __init__(self, cfg, recolhas):
        self.atf = cfg["atf"]
        self.login_atual = ""
        self.logins = []
        self.recolhas = iter(recolhas)

    def entrar(self, login, senha):
        self.logins.append((login, senha))
        self.login_atual = login

    def sair(self, silencioso=True):
        self.login_atual = ""

    def sessao_valida(self, login):
        return self.login_atual == login

    def bloqueada(self, ie):
        return ""

    def conferir_html(self, *args):
        return None

    def esperar_respostas_atrasadas(self, *args):
        pass

    def solicitar(self, tipo, ie, *args, registrar_envio=None):
        envio = Envio(ie, tipo, envio_iniciado=True)
        if registrar_envio is not None:
            registrar_envio(envio)
        return envio

    def listar_mensagens(self, **kwargs):
        return []

    def emitir(self, tipo, ie, *args, **kwargs):
        return Emissao(ie, tipo, [("fatura.pdf", f"%PDF-1.4 fatura {ie}".encode())])

    def recolher(self, *args, **kwargs):
        return next(self.recolhas)


def test_portal_nao_recorre_a_funcoes_antigas_quando_falta_um_contrato(monkeypatch):
    pedidos = []

    def requisicao(metodo, url, **kw):
        pedidos.append((metodo, url, kw["json"]))
        return Resposta(404, {"code": "PGRST202"})

    monkeypatch.setattr(robo_xml.requests, "request", requisicao)
    portal = robo_xml.Portal("https://exemplo.invalid", "falsa")
    with pytest.raises(robo_xml.ContratoPortalIndisponivel, match="xml_atf_reservar_lote"):
        portal.pegar_lote("teste", "login", 4)
    with pytest.raises(robo_xml.ContratoPortalIndisponivel, match="xml_nfse_reservar_lote"):
        portal.pegar_lote_nfse("teste", 3)
    with pytest.raises(robo_xml.ContratoPortalIndisponivel, match="xml_mei_registrar_contexto"):
        portal.registrar_mei_contexto(ORG_A, IE_EMPRESA, {}, None)
    assert pedidos == [
        ("POST", "https://exemplo.invalid/rest/v1/rpc/xml_atf_reservar_lote",
         {"p_robo": "teste", "p_login": "login", "p_max": 4}),
        ("POST", "https://exemplo.invalid/rest/v1/rpc/xml_nfse_reservar_lote",
         {"p_robo": "teste", "p_max": 3}),
        ("POST", "https://exemplo.invalid/rest/v1/rpc/xml_mei_registrar_contexto",
         {"p_org": ORG_A, "p_ie": IE_EMPRESA, "p_meses": {}, "p_inicio_atividade": None}),
    ]


def test_motor_atf_separa_totais_arquivos_e_escritorios(cfg, monkeypatch):
    destino = Path(cfg["pastas"]["destino"])
    legado = destino / "Arquivos baixados" / "7-Empresa A"
    legado.mkdir(parents=True)
    (legado / "original.txt").write_bytes(b"legado")
    nota_a = nfe(DONO, CLIENTE, ie_emit=IE_EMPRESA, valor=100)
    nota_b = nfe(CNPJ_B, CLIENTE, ie_emit=IE_B, valor=200)
    nota_c = nfe(DONO, CLIENTE, ie_emit=IE_EMPRESA, valor=300)
    zip_misto = zip_notas(nota_a, nota_b)
    zip_c = zip_notas(nota_c)
    atf = AtfFalso(cfg, [
        Recolha(respostas={(IE_EMPRESA, "nfe_saida"): [("misto.zip", zip_misto)],
                          (IE_B, "nfe_saida"): [("misto.zip", zip_misto)]},
                ignorados=[("ignorado.zip", b"sem dono")]),
        Recolha(respostas={(IE_EMPRESA, "nfe_saida"): [("repetida.xml", nota_a)]}),
        Recolha(respostas={(IE_EMPRESA, "nfe_saida"): [("empresa.zip", zip_c)]}),
    ])
    decifragens = []
    atualizacoes = {}
    monkeypatch.setattr(robo_xml.cripto, "carregar_privada", lambda _: object())
    monkeypatch.setattr(robo_xml.cripto, "decifrar", lambda cifra, _: decifragens.append(cifra) or "falsa")
    robo = robo_xml.Robo(cfg)
    monkeypatch.setattr(robo.executor, "_garantir_chrome", lambda diag: setattr(robo.executor, "atf", atf))
    monkeypatch.setattr(robo.portal, "atualizar_tarefa_reservada",
                        lambda tarefa, dados: registrar_atualizacao(atualizacoes, tarefa, dados))
    lote = [linha("A", ORG_A), linha("B", ORG_A, IE_B), linha("C", ORG_B), linha("sem-org", None),
            linha("D", ORG_A, tipos=["nfe_saida"])]
    robo.processar(lote)
    assert decifragens == ["cifra-fictícia", "cifra-fictícia"]
    assert atf.logins == [("mesmo-login", "falsa"), ("mesmo-login", "falsa")]
    assert atualizacoes["sem-org"]["status"] == "erro" and "UUID" in atualizacoes["sem-org"]["mensagem"]
    assert atualizacoes["D"]["status"] == "concluido"
    assert atualizacoes["D"]["detalhes"]["nfe_saida"]["repetidos"] == 1
    for tid, total, org in [("A", 100, ORG_A), ("B", 200, ORG_A), ("C", 300, ORG_B)]:
        resultado = atualizacoes[tid]
        assert resultado["status"] == "concluido"
        assert resultado["detalhes"]["nfe_saida"]["valor"] == total
        assert resultado["qtd_xml"] == 1
        caminho = Path(resultado["pasta"])
        assert not caminho.is_absolute() and caminho.parts[:2] == (PASTA_CONTEXTOS, "portal")
        assert org in caminho.parts[2]
        assert len(list((destino / caminho).rglob("*.pdf"))) == 1
    pasta_a, pasta_b, pasta_c = (destino / atualizacoes[tid]["pasta"] for tid in "ABC")
    assert [arq.read_bytes() for arq in pasta_a.rglob("*.xml")] == [nota_a]
    assert [arq.read_bytes() for arq in pasta_b.rglob("*.xml")] == [nota_b]
    assert [arq.read_bytes() for arq in pasta_c.rglob("*.zip")] == [zip_c]
    assert [arq.read_bytes() for arq in (destino / PASTA_CONTEXTOS / "_nao_identificados").rglob("*.zip")] == [zip_misto]
    assert len(list((destino / PASTA_CONTEXTOS / "_sem_empresa" / "portal" / ORG_A).rglob("*.bin"))) == 1
    assert list(legado.iterdir()) == [legado / "original.txt"]
    assert (legado / "original.txt").read_bytes() == b"legado"


class CapturaSimulada:
    def __init__(self, *args, **kwargs):
        self.recebidos = []

    def verificar(self):
        pass

    def encerrar(self):
        pass


class CaixaSimulada(AtfFalso):
    recolher = AtfPB.recolher

    def __init__(self, cfg):
        super().__init__(cfg, [])
        self.cfg = cfg
        self.contexto = None
        self.aviso = self._log = lambda _: None
        self._mensagens_lidas = set()
        self.mensagens = []
        self.consultas = []
        self.ao_consultar = None

    def _senha_na_tela(self):
        return None

    def solicitar(self, tipo, ie, *args, registrar_envio=None):
        envio = super().solicitar(tipo, ie, *args, registrar_envio=registrar_envio)
        envio.hora = datetime.now().replace(microsecond=0)
        self.consultas.append(ie)
        if self.ao_consultar:
            self.ao_consultar()
        return envio

    def listar_mensagens(self, **kwargs):
        return list(self.mensagens)

    def ler_consulta(self, mae, capt):
        capt.recebidos.extend(mae["anexos"])
        return mae["texto"], mae["anexos"], True, mae["faltou_anexo"]

    def publicar(self, id_mensagem, anexos, data="", texto="Tarefa executada.", faltou_anexo=False):
        self.mensagens.append({
            "id": id_mensagem, "codigo": "FIS_1322", "data": data, "texto": texto,
            "anexos": anexos, "faltou_anexo": faltou_anexo,
        })


def robo_com_caixa(cfg, monkeypatch, caixa, atualizacoes):
    import atf_pb

    monkeypatch.setattr(atf_pb, "CapturadorArquivos", CapturaSimulada)
    monkeypatch.setattr(robo_xml.cripto, "carregar_privada", lambda _: object())
    monkeypatch.setattr(robo_xml.cripto, "decifrar", lambda *_: "falsa")
    cfg["atf"]["leituras_mensagens"] = 1
    robo = robo_xml.Robo(cfg)
    monkeypatch.setattr(robo.executor, "_garantir_chrome", lambda diag: setattr(robo.executor, "atf", caixa))
    monkeypatch.setattr(robo.portal, "atualizar_tarefa_reservada",
                        lambda tarefa, dados: registrar_atualizacao(atualizacoes, tarefa, dados))
    return robo


@pytest.mark.parametrize("na_ultima_leitura", [False, True])
def test_resposta_atf_de_tentativa_expirada_fica_para_conferencia(cfg, monkeypatch, na_ultima_leitura):
    caixa = CaixaSimulada(cfg)
    atualizacoes = {}
    robo = robo_com_caixa(cfg, monkeypatch, caixa, atualizacoes)
    t = linha("A", ORG_A, tipos=["nfe_saida"])
    nota = nfe(DONO, CLIENTE, ie_emit=IE_EMPRESA)
    venceu = False

    def resposta_atrasada():
        nonlocal venceu
        venceu = True
        caixa.publicar("resposta-A", [("nota.xml", nota)])

    def atualizar(tarefa, dados):
        return not venceu and registrar_atualizacao(atualizacoes, tarefa, dados)

    monkeypatch.setattr(robo.portal, "atualizar_tarefa_reservada", atualizar)
    if not na_ultima_leitura:
        caixa.ao_consultar = resposta_atrasada
    robo.processar([t])
    if na_ultima_leitura:
        assert robo.aguardando
        resposta_atrasada()
        robo._repescar()
    destino = Path(cfg["pastas"]["destino"]) / PASTA_CONTEXTOS
    assert "status" not in atualizacoes["A"]
    assert not list((destino / "portal").rglob("*.xml"))
    assert [p.read_bytes() for p in (destino / "_nao_identificados").rglob("*.xml")] == [nota]
    assert list((destino / "_caixas_atf").glob("*.lock"))


@pytest.mark.parametrize("com_data", [False, True])
def test_motor_nao_confunde_respostas_de_escritorios_com_mesma_caixa(cfg, monkeypatch, com_data):
    caixa = CaixaSimulada(cfg)
    atualizacoes = {}
    robo = robo_com_caixa(cfg, monkeypatch, caixa, atualizacoes)
    a = linha("A", ORG_A, tipos=["nfe_saida"])
    b = linha("B", ORG_B, tipos=["nfe_saida"])
    destino = Path(cfg["pastas"]["destino"]) / PASTA_CONTEXTOS

    robo.processar([a])
    assert len(robo.executor.pendencias) == 1
    trabalho_a = robo.executor.pendencias[0].trabalhos[0]
    assert "status" not in atualizacoes["A"]
    data = (datetime.now() - timedelta(seconds=2)).strftime("%d/%m/%Y %H:%M:%S") if com_data else ""
    nota_a = nfe(DONO, CLIENTE, ie_emit=IE_EMPRESA, valor=100)
    # Sem a reserva, a resposta de A chegaria ao ser enviada a consulta de B.
    caixa.ao_consultar = lambda: caixa.publicar("resposta-A", [("a.xml", nota_a)], data)

    # Outro executor também deve respeitar a reserva gravada na mesma raiz.
    novo_robo = robo_com_caixa(cfg, monkeypatch, caixa, atualizacoes)
    novo_robo.processar([b])
    assert caixa.consultas == [IE_EMPRESA]
    assert atualizacoes["B"]["status"] == "erro" and "caixa ATF" in atualizacoes["B"]["mensagem"]
    assert not list(destino.rglob("*.xml"))

    caixa.ao_consultar = None
    caixa.publicar("resposta-A", [("a.xml", nota_a)], data)
    robo._repescar()
    assert atualizacoes["A"]["status"] == "concluido"
    assert atualizacoes["A"]["detalhes"]["nfe_saida"]["valor"] == 100
    assert trabalho_a.senha == ""
    assert not list((destino / "_caixas_atf").glob("*.lock"))

    nota_b = nfe(DONO, CLIENTE, ie_emit=IE_EMPRESA, valor=200)
    caixa._mensagens_lidas.clear()  # Simula perda da memória da sessão após reinício.
    caixa.ao_consultar = lambda: caixa.publicar("resposta-B", [("b.xml", nota_b)], data)
    novo_robo.processar([b])
    assert caixa.consultas == [IE_EMPRESA, IE_EMPRESA]
    assert atualizacoes["B"]["status"] == "concluido"
    assert atualizacoes["B"]["detalhes"]["nfe_saida"]["valor"] == 200
    for tarefa_id, nota, org in [("A", nota_a, ORG_A), ("B", nota_b, ORG_B)]:
        pasta = Path(cfg["pastas"]["destino"]) / atualizacoes[tarefa_id]["pasta"]
        assert org in str(pasta)
        assert [xml.read_bytes() for xml in pasta.rglob("*.xml")] == [nota]


@pytest.mark.parametrize("mesma_rodada", [False, True])
def test_recusa_antes_do_xml_nao_prende_a_caixa(cfg, monkeypatch, mesma_rodada):
    caixa = CaixaSimulada(cfg)
    cfg["atf"]["conferir_em_html"] = True
    bloqueadas = set()

    def conferir(tipo, ie, *args):
        if ie == IE_EMPRESA:
            bloqueadas.add(ie)
            return None
        return 1

    caixa.conferir_html = conferir
    caixa.bloqueada = lambda ie: "Usuário sem permissão sobre a empresa." if ie in bloqueadas else ""
    atualizacoes = {}
    robo = robo_com_caixa(cfg, monkeypatch, caixa, atualizacoes)
    negada = linha("A", ORG_A, tipos=["nfe_saida"])
    autorizada = linha("B", ORG_A, ie=IE_B, tipos=["nfe_saida"])
    marcadores = Path(cfg["pastas"]["destino"]) / PASTA_CONTEXTOS / "_caixas_atf"
    nota_b = nfe(CNPJ_B, CLIENTE, ie_emit=IE_B, valor=200)

    if mesma_rodada:
        robo.processar([negada, autorizada])
        assert list(marcadores.glob("*.lock"))
        caixa.publicar("XML-B", [("b.xml", nota_b)])
        robo._repescar()
    else:
        robo.processar([negada])
        assert not caixa.consultas
        assert not list(marcadores.glob("*.lock"))
        caixa.ao_consultar = lambda: caixa.publicar("XML-B", [("b.xml", nota_b)])
        robo.processar([autorizada])

    assert atualizacoes["A"]["status"] == "erro"
    assert atualizacoes["B"]["status"] == "concluido"
    assert atualizacoes["B"]["detalhes"]["nfe_saida"]["valor"] == 200
    assert caixa.consultas == [IE_B]
    assert not list(marcadores.glob("*.lock"))


@pytest.mark.parametrize(("clicou", "alerta"), [(False, False), (True, False), (True, True)])
def test_caixa_em_interrupcao_depende_de_envio_possivel(cfg, monkeypatch, clicou, alerta):
    caixa = CaixaSimulada(cfg)
    robo = robo_com_caixa(cfg, monkeypatch, caixa, {})

    def interromper(tipo, ie, *args, registrar_envio):
        envio = Envio(ie, tipo, envio_iniciado=clicou)
        registrar_envio(envio)
        if alerta:
            envio.sem_notas = envio.atrasada = True
            envio.resposta = "Nenhum registro satisfaz a pesquisa."
        raise KeyboardInterrupt

    caixa.solicitar = interromper
    with pytest.raises(KeyboardInterrupt):
        robo.processar([linha("A", ORG_A, tipos=["nfe_saida"])])
    marcadores = Path(cfg["pastas"]["destino"]) / PASTA_CONTEXTOS / "_caixas_atf"
    assert bool(list(marcadores.glob("*.lock"))) is clicou


@pytest.mark.parametrize("chega_xml", [False, True])
def test_zero_da_caixa_nao_invalida_html_com_notas(cfg, monkeypatch, chega_xml):
    cfg["atf"]["conferir_em_html"] = True
    caixa = CaixaSimulada(cfg)
    caixa.conferir_html = lambda *args: 1
    atualizacoes = {}
    robo = robo_com_caixa(cfg, monkeypatch, caixa, atualizacoes)
    caixa.ao_consultar = lambda: caixa.publicar("zero-sem-ie", [], texto="Nenhum registro satisfaz a pesquisa.")
    robo.processar([linha("A", ORG_A, tipos=["nfe_saida"])])

    assert "status" not in atualizacoes["A"]
    assert atualizacoes["A"]["detalhes"]["nfe_saida"]["situacao"] == "aguardando"
    marcadores = Path(cfg["pastas"]["destino"]) / PASTA_CONTEXTOS / "_caixas_atf"
    assert list(marcadores.glob("*.lock"))

    if chega_xml:
        nota = nfe(DONO, CLIENTE, ie_emit=IE_EMPRESA, valor=100)
        caixa.publicar("XML-A", [("a.xml", nota)])
        robo._repescar()
        assert atualizacoes["A"]["status"] == "concluido"
        assert atualizacoes["A"]["detalhes"]["nfe_saida"]["valor"] == 100
        assert not list(marcadores.glob("*.lock"))
    else:
        with pytest.raises(SystemExit):
            robo._repescar()
        assert atualizacoes["A"]["status"] == "erro"
        detalhe = atualizacoes["A"]["detalhes"]["nfe_saida"]
        assert detalhe["situacao"] == "erro" and "HTML mostrou notas" in detalhe["mensagem"]
        assert list(marcadores.glob("*.lock"))


@pytest.mark.parametrize("resposta_b", ["xml", "ausencia_identificada", "sem_resposta"])
def test_ausencia_ambigua_na_mesma_caixa_nao_substitui_xml_de_outra_empresa(cfg, monkeypatch, resposta_b):
    cfg["atf"]["conferir_em_html"] = True
    caixa = CaixaSimulada(cfg)
    caixa.conferir_html = lambda tipo, ie, *args: 1 if ie == IE_EMPRESA else None
    atualizacoes = {}
    robo = robo_com_caixa(cfg, monkeypatch, caixa, atualizacoes)
    sem_notas = "Nenhum registro satisfaz a pesquisa."
    a = linha("A", ORG_A, tipos=["nfe_saida"])
    b = linha("B", ORG_A, ie=IE_B, tipos=["nfe_saida"])

    def publicar():
        caixa.publicar("zero-de-outro-periodo", [], texto=f"Período solicitado: 01/08/2026 a 31/08/2026. {sem_notas}")
        caixa.publicar("zero-de-outra-ie", [], texto=f"IE: 160555558. {sem_notas}")
        caixa.publicar("zero-de-outro-tipo", [], texto=f"IE Destinatário: {IE_EMPRESA}. {sem_notas}")
        anterior = nfe(DONO, CLIENTE, ie_emit=IE_EMPRESA, data="2026-08-15", valor=999)
        caixa.publicar("xml-de-outro-periodo-sem-rotulo", [("anterior.xml", anterior)])
        caixa.publicar("zero-sem-ie", [], texto=sem_notas)
        caixa.publicar("XML-A", [("a.xml", nfe(DONO, CLIENTE, ie_emit=IE_EMPRESA, valor=100))])

    caixa.ao_consultar = lambda: publicar() if len(caixa.consultas) == 2 else None
    robo.processar([a, b])
    assert atualizacoes["A"]["status"] == "concluido"
    assert atualizacoes["A"]["detalhes"]["nfe_saida"]["valor"] == 100
    assert "status" not in atualizacoes["B"]
    assert atualizacoes["B"]["detalhes"]["nfe_saida"]["situacao"] == "aguardando"
    marcador = Path(cfg["pastas"]["destino"]) / PASTA_CONTEXTOS / "_caixas_atf"
    assert list(marcador.glob("*.lock"))
    if resposta_b == "xml":
        caixa.publicar("XML-B", [("b.xml", nfe(CNPJ_B, CLIENTE, ie_emit=IE_B, valor=200))])
        robo._repescar()
        assert atualizacoes["B"]["status"] == "concluido"
        assert atualizacoes["B"]["detalhes"]["nfe_saida"]["valor"] == 200
    elif resposta_b == "ausencia_identificada":
        caixa.publicar("zero-de-B", [], texto=f"IE Emitente: {IE_B}. {sem_notas}")
        robo._repescar()
        assert atualizacoes["B"]["status"] == "sem_notas"
    else:
        with pytest.raises(SystemExit):
            robo._repescar()
        assert atualizacoes["B"]["status"] == "erro"
    assert bool(list(marcador.glob("*.lock"))) == (resposta_b == "sem_resposta")


def test_zero_identificado_de_empresa_com_xml_nao_conta_para_outra(cfg, monkeypatch):
    caixa = CaixaSimulada(cfg)
    atualizacoes = {}
    robo = robo_com_caixa(cfg, monkeypatch, caixa, atualizacoes)
    a = linha("A", ORG_A, tipos=["nfe_saida"])
    b = linha("B", ORG_A, ie=IE_B, tipos=["nfe_saida"])

    def publicar():
        if len(caixa.consultas) == 2:
            caixa.publicar("zero-da-A", [], texto=f"IE: {IE_EMPRESA}. Nenhum registro satisfaz a pesquisa.")
            caixa.publicar("XML-A", [("a.xml", nfe(DONO, CLIENTE, ie_emit=IE_EMPRESA, valor=100))])

    caixa.ao_consultar = publicar
    robo.processar([a, b])
    assert "status" not in atualizacoes["B"]
    assert atualizacoes["B"]["detalhes"]["nfe_saida"]["situacao"] == "aguardando"

    caixa.publicar("XML-B", [("b.xml", nfe(CNPJ_B, CLIENTE, ie_emit=IE_B, valor=200))])
    robo._repescar()
    assert atualizacoes["A"]["status"] == atualizacoes["B"]["status"] == "concluido"
    assert atualizacoes["B"]["detalhes"]["nfe_saida"]["valor"] == 200


def test_nova_sessao_na_leitura_final_nao_conta_a_mesma_ausencia_duas_vezes(cfg, monkeypatch):
    caixa = CaixaSimulada(cfg)
    atualizacoes = {}
    robo = robo_com_caixa(cfg, monkeypatch, caixa, atualizacoes)
    a = linha("A", ORG_A, tipos=["nfe_saida"])
    b = linha("B", ORG_A, ie=IE_B, tipos=["nfe_saida"])

    def publicar():
        if len(caixa.consultas) == 2:
            caixa.publicar("zero-sem-ie", [], texto="Nenhum registro satisfaz a pesquisa.")

    caixa.ao_consultar = publicar
    robo.processar([a, b])
    assert "status" not in atualizacoes["A"] and "status" not in atualizacoes["B"]

    caixa._mensagens_lidas.clear()  # um novo objeto AtfPB não tem o estado da sessão anterior
    ler_consulta = caixa.ler_consulta

    def ler_so_mensagem_nova(mae, capt):
        assert mae["id"] != "zero-sem-ie"
        return ler_consulta(mae, capt)

    caixa.ler_consulta = ler_so_mensagem_nova
    with pytest.raises(SystemExit):
        robo._repescar()
    assert atualizacoes["A"]["status"] == atualizacoes["B"]["status"] == "erro"


@pytest.mark.parametrize("caso", ["truncado", "parcial", "faltou_anexo", "sem_notas"])
def test_motor_publica_resultado_conforme_evidencia_do_atf(cfg, monkeypatch, caso):
    caixa = CaixaSimulada(cfg)
    atualizacoes = {}
    robo = robo_com_caixa(cfg, monkeypatch, caixa, atualizacoes)
    anexos, texto, faltou_anexo = [], f"IE Emitente: {IE_EMPRESA}. Nenhum registro satisfaz a pesquisa.", False
    if caso == "truncado":
        anexos = [("ruim.zip", b"PK\x03\x04truncado")]
    elif caso == "parcial":
        anexos = [("parcial.zip", zip_notas(nfe(DONO, CLIENTE, ie_emit=IE_EMPRESA), b"arquivo ilegivel"))]
    elif caso == "faltou_anexo":
        faltou_anexo = True
    caixa.ao_consultar = lambda: caixa.publicar("resposta", anexos, texto=texto, faltou_anexo=faltou_anexo)
    robo.processar([linha("A", ORG_A, tipos=["nfe_saida"])])
    destino = Path(cfg["pastas"]["destino"]) / PASTA_CONTEXTOS
    if caso == "sem_notas":
        assert atualizacoes["A"]["status"] == "sem_notas"
        assert atualizacoes["A"]["detalhes"]["nfe_saida"]["situacao"] == "sem_movimento"
        assert not list((destino / "_caixas_atf").glob("*.lock"))
        return
    assert robo.executor.pendencias
    robo._repescar(ler=False)
    assert atualizacoes["A"]["status"] == "erro"
    assert atualizacoes["A"]["detalhes"]["nfe_saida"]["situacao"] == "erro"
    assert not atualizacoes["A"]["detalhes"]["nfe_saida"]["sem_notas"]
    assert "ilegível" in atualizacoes["A"]["mensagem"]
    assert list((destino / "_caixas_atf").glob("*.lock"))
    if anexos:
        assert [arq.read_bytes() for arq in (destino / "_nao_identificados").rglob("*.zip")] == [anexos[0][1]]
    assert not list((destino / "portal").rglob("*.xml"))


@pytest.mark.parametrize("duplicata_primeiro", [False, True])
def test_releitura_aceita_xml_pendente_junto_de_duplicata(cfg, monkeypatch, duplicata_primeiro):
    caixa = CaixaSimulada(cfg)
    atualizacoes = {}
    robo = robo_com_caixa(cfg, monkeypatch, caixa, atualizacoes)
    a = linha("A", ORG_A, tipos=["nfe_saida"])
    b = linha("B", ORG_A, ie=IE_B, tipos=["nfe_entrada"])
    # O conteúdo dessas notas, sozinho, é compatível com as consultas de A e B.
    nota_a = nfe(DONO, CNPJ_B, numero=1, ie_emit=IE_EMPRESA, ie_dest=IE_B, valor=100)
    nota_b = nfe(DONO, CNPJ_B, numero=2, ie_emit=IE_EMPRESA, ie_dest=IE_B, valor=200)

    def publicar_a():
        if len(caixa.consultas) == 2:
            caixa.publicar("primeira-A", [("a.xml", nota_a)], texto=f"IE Emitente: {IE_EMPRESA}")

    caixa.ao_consultar = publicar_a

    robo.processar([a, b])
    assert atualizacoes["A"]["status"] == "concluido"
    assert "status" not in atualizacoes["B"]
    mensagens = [
        ("outra-A", [("a.zip", zip_notas(nota_a))], "Tarefa executada."),
        ("primeira-B", [("b.xml", nota_b)], f"IE Destinatário: {IE_B}"),
    ]
    if not duplicata_primeiro:
        mensagens.reverse()
    for mid, anexos, texto in mensagens:
        caixa.publicar(mid, anexos, texto=texto)
    robo._repescar()

    destino = Path(cfg["pastas"]["destino"]) / PASTA_CONTEXTOS
    assert atualizacoes["B"]["status"] == "concluido"
    assert atualizacoes["B"]["detalhes"]["nfe_entrada"]["valor"] == 200
    assert sorted(arq.read_bytes() for arq in (destino / "portal").rglob("*.xml")) == sorted([nota_a, nota_b])
    assert not list((destino / "portal").rglob("*.zip"))
    assert not list((destino / "_nao_identificados").rglob("*"))
    assert not list((destino / "_caixas_atf").glob("*.lock"))


def test_respostas_excedentes_da_mesma_consulta_ficam_para_conferencia(cfg, monkeypatch):
    caixa = CaixaSimulada(cfg)
    atualizacoes = {}
    robo = robo_com_caixa(cfg, monkeypatch, caixa, atualizacoes)
    anexos = [
        ("a.xml", nfe(DONO, CLIENTE, ie_emit=IE_EMPRESA, valor=100)),
        ("b.xml", nfe(DONO, CLIENTE, ie_emit=IE_EMPRESA, valor=200)),
    ]

    def publicar():
        for nome, dados in anexos:
            caixa.publicar(nome, [(nome, dados)])

    caixa.ao_consultar = publicar
    robo.processar([linha("A", ORG_A, tipos=["nfe_saida"])])
    robo._repescar(ler=False)
    destino = Path(cfg["pastas"]["destino"]) / PASTA_CONTEXTOS
    assert atualizacoes["A"]["status"] == "erro"
    assert not list((destino / "portal").rglob("*.xml"))
    salvos = list((destino / "_nao_identificados").rglob("*.xml"))
    assert {arq.read_bytes() for arq in salvos} == {dados for _, dados in anexos}


def test_anexo_com_conteudo_sem_dono_fica_em_conferencia():
    xml = nfe(DONO, CLIENTE, ie_emit=IE_EMPRESA)
    zip_misto = zip_notas(xml, b"%PDF-1.4 sem identidade")
    anexos = [("misto.zip", zip_misto), ("corrompido.zip", b"PK\x03\x04incompleto")]
    por_empresa, sem_empresa, conferir = arquivos.distribuir_por_empresa(
        anexos, [arquivos.Alvo(IE_EMPRESA, DONO, ["nfe_saida"])]
    )
    assert por_empresa == {(IE_EMPRESA, "nfe_saida"): [("nota-0.xml", xml)]}
    assert not sem_empresa
    assert sorted(conferir) == sorted(anexos)


def test_subpasta_redirecionada_nao_escreve_no_legado(cfg):
    destino = Path(cfg["pastas"]["destino"])
    legado = destino / "Arquivos baixados"
    legado.mkdir()
    contexto = ContextoArmazenamento("portal", ORG_A, "sefaz_pb", "ie", IE_EMPRESA, "Empresa")
    with abrir_empresa(destino, contexto) as empresa:
        mes = empresa / "2026-09"
        if os.name == "nt":
            subprocess.run(["cmd", "/c", "mklink", "/J", str(mes), str(legado)], check=True,
                           capture_output=True, timeout=10)
        else:
            mes.symlink_to(legado, target_is_directory=True)
        with pytest.raises(IdentidadeArmazenamentoInvalida):
            arquivos.salvar_documentos([("fatura.pdf", b"%PDF-1.4 teste")], empresa, "faturas", "2026-09")
    assert not list(legado.iterdir())


def test_conflito_de_competencia_bloqueia_antes_do_atf(cfg, monkeypatch):
    ctx = ContextoArmazenamento("portal", ORG_A, "sefaz_pb", "ie", IE_EMPRESA, "Empresa")
    with abrir_empresa(cfg["pastas"]["destino"], ctx) as empresa:
        (empresa / "092026").mkdir()
        (empresa / "2026-09").mkdir()
    executor = robo_xml.Executor(cfg)
    monkeypatch.setattr(executor, "_garantir_chrome", lambda _: pytest.fail("Conflito chegou ao ATF."))
    t = robo_xml.Trabalho(IE_EMPRESA, "Empresa", "login", "senha", ["faturas"], INICIO, FIM, contexto=ctx)
    (r,) = executor.executar_rodada([t])
    assert r.status == "erro" and "competência" in r.mensagem.lower()
    assert not list(empresa.rglob("*.pdf"))


def test_reserva_da_caixa_bloqueia_outro_processo_na_mesma_raiz(cfg):
    destino = cfg["pastas"]["destino"]
    marcador = reservar_caixa_atf(destino, "Mesmo-Login", ORG_A)
    script = """
import sys
from armazenamento import ArmazenamentoOcupado, reservar_caixa_atf
try:
    reservar_caixa_atf(sys.argv[1], ' mesmo-login ', sys.argv[2])
except ArmazenamentoOcupado:
    sys.exit(0)
sys.exit(2)
"""
    processo = subprocess.run([sys.executable, "-B", "-c", script, destino, ORG_B],
                              cwd=Path(robo_xml.__file__).parent, timeout=10, check=False)
    assert processo.returncode == 0
    assert marcador.read_text(encoding="ascii") == f"execucao={ORG_A}\n"


def test_total_no_nome_nao_move_pdf_para_caminho_acima_do_limite(cfg):
    ctx = ContextoArmazenamento("portal", ORG_A, "sefaz_pb", "ie", IE_EMPRESA, "Empresa")
    with abrir_empresa(cfg["pastas"]["destino"], ctx) as empresa:
        arquivo = "0" * 44 + ".pdf"
        reserva = len(f"/PDF/{arquivo}")
        tamanho = LIMITE_CAMINHO - len(str(empresa).encode("utf-16-le")) // 2 - reserva - 1
        pasta = empresa / ("s" * tamanho)
        (pasta / "PDF").mkdir(parents=True)
        pdf = pasta / "PDF" / arquivo
        pdf.write_bytes(b"%PDF-1.4 anterior")
        with pytest.raises(IdentidadeArmazenamentoInvalida, match="longo demais"):
            renomear_subpasta_validada(pasta, pasta.name + "x")
        assert pdf.read_bytes() == b"%PDF-1.4 anterior"
        assert not (empresa / (pasta.name + "x")).exists()


@pytest.mark.parametrize("gera_pdf", [True, False])
def test_motor_valida_espaco_legado_antes_de_enviar(cfg, monkeypatch, gera_pdf):
    import arquivos
    import armazenamento

    caixa = CaixaSimulada(cfg)
    atualizacoes = {}
    robo = robo_com_caixa(cfg, monkeypatch, caixa, atualizacoes)
    tarefa = linha("A", ORG_A, tipos=["nfe_saida"])
    destino = Path(cfg["pastas"]["destino"])
    with abrir_empresa(destino, robo_xml.contexto_portal(tarefa, "sefaz_pb", "ie")) as pasta:
        historico = pasta / "historico.xml"
        historico.write_bytes(b"<historico/>")
        metadados = (pasta / "empresa.json").read_bytes()
    limite = armazenamento._unidades_windows(str(pasta)) + armazenamento.RESERVA_ARQUIVOS
    monkeypatch.setattr(armazenamento, "LIMITE_CAMINHO", limite)
    monkeypatch.setattr(arquivos, "GERAR_PDF", gera_pdf)
    nota = nfe(DONO, CLIENTE, ie_emit=IE_EMPRESA, valor=100)
    caixa.ao_consultar = lambda: caixa.publicar("resposta", [("nota.xml", nota)])
    robo.processar([tarefa])

    assert historico.read_bytes() == b"<historico/>" and (pasta / "empresa.json").read_bytes() == metadados
    assert not list((destino / PASTA_CONTEXTOS / "_caixas_atf").glob("*.lock"))
    if gera_pdf:
        assert atualizacoes["A"]["status"] == "erro"
        assert "raiz mais curta" in atualizacoes["A"]["mensagem"]
        assert not caixa.consultas and list(pasta.rglob("*.xml")) == [historico]
    else:
        assert caixa.consultas == [IE_EMPRESA] and atualizacoes["A"]["status"] == "concluido"


def test_falha_no_retorno_ao_painel_preserva_arquivos_para_reexecucao(cfg, monkeypatch):
    nota = nfe(DONO, CLIENTE, ie_emit=IE_EMPRESA, valor=100)
    atf = AtfFalso(cfg, [Recolha(respostas={(IE_EMPRESA, "nfe_saida"): [("nota.xml", nota)]})
                         for _ in range(2)])
    monkeypatch.setattr(robo_xml.cripto, "carregar_privada", lambda _: object())
    monkeypatch.setattr(robo_xml.cripto, "decifrar", lambda *_: "falsa")
    robo = robo_xml.Robo(cfg)
    monkeypatch.setattr(robo.executor, "_garantir_chrome", lambda _: setattr(robo.executor, "atf", atf))
    atualizacoes = {}

    def falhar_final(tarefa, dados):
        if "status" in dados:
            raise OSError("Painel temporariamente indisponível")
        return True

    monkeypatch.setattr(robo.portal, "atualizar_tarefa_reservada", falhar_final)
    t = linha("A", ORG_A, tipos=["nfe_saida"])
    with pytest.raises(OSError, match="indisponível"):
        robo.processar([t])
    monkeypatch.setattr(robo.portal, "atualizar_tarefa_reservada",
                        lambda tarefa, dados: registrar_atualizacao(atualizacoes, tarefa, dados))
    robo.processar([t])
    assert atualizacoes["A"]["status"] == "concluido" and atualizacoes["A"]["qtd_xml"] == 1
    assert atualizacoes["A"]["detalhes"]["nfe_saida"]["valor"] == 100
    assert atualizacoes["A"]["detalhes"]["nfe_saida"]["repetidos"] == 1
    pasta = Path(cfg["pastas"]["destino"]) / atualizacoes["A"]["pasta"]
    assert [arquivo.read_bytes() for arquivo in pasta.rglob("*.xml")] == [nota]


def test_alerta_mei_do_robo_leva_escritorio_sem_divulgar_chave(monkeypatch):
    pedidos = []
    monkeypatch.setattr(robo_xml.requests, "post", lambda url, **kw: pedidos.append((url, kw)) or Resposta(200, {}))
    portal = robo_xml.Portal("https://banco.invalid", "chave-ficticia", site="https://site.invalid")
    portal.avisar_mei(IE_EMPRESA, org_id=ORG_A)
    assert pedidos[0][1]["json"] == {"ie": IE_EMPRESA, "org_id": ORG_A}
    assert pedidos[0][1]["headers"] == {"x-robo-chave": "chave-ficticia"}


@pytest.mark.parametrize("registrados", [None, 0, 1])
def test_historico_mei_so_envia_alerta_se_o_banco_aceitou_a_tentativa(monkeypatch, registrados):
    tarefa = linha("A", ORG_A, tipos=["mei"])
    contexto = robo_xml.contexto_portal(tarefa, "sefaz_pb", "ie")
    trabalho = robo_xml.Trabalho(IE_EMPRESA, "Empresa", "login", "senha", ["mei"], INICIO, FIM, contexto=contexto)
    robo = robo_xml.Robo.__new__(robo_xml.Robo)
    robo.portal = robo_xml.Portal("https://banco.invalid", "falsa", site="https://site.invalid")
    robo.em_curso = {id(trabalho): (tarefa, {})}
    pedidos, alertas = [], []

    def requisicao(metodo, url, **kwargs):
        pedidos.append((url, kwargs["json"]))
        return SimpleNamespace(status_code=200, json=lambda: registrados)

    monkeypatch.setattr(robo_xml.requests, "request", requisicao)
    monkeypatch.setattr(robo_xml.requests, "post", lambda *a, **kw: alertas.append(kw["json"]) or Resposta(200, {}))
    historico = {"2026-09": {"saidas": 100}}
    robo._mei(trabalho, {"historico": historico})
    url, dados = pedidos[0]
    assert url.endswith("/rpc/xml_mei_registrar_tarefa_reservada")
    assert dados["p_tentativa"] == tarefa["tentativa_id"] and dados["p_org"] == ORG_A
    assert dados["p_ie"] == IE_EMPRESA and dados["p_meses"] == historico
    assert alertas == ([] if registrados is None else [{"ie": IE_EMPRESA, "org_id": ORG_A}])


def test_renovacao_atf_cobre_tarefa_que_espera_a_caixa(monkeypatch):
    robo = robo_xml.Robo.__new__(robo_xml.Robo)
    robo.portal = robo_xml.Portal("https://banco.invalid", "falsa")
    atual = linha("A", ORG_A)
    aguardando = linha("B", ORG_A)
    robo.tarefas_atuais = [atual]
    robo.aguardando = {1: atual, 2: aguardando}
    pedidos = []
    monkeypatch.setattr(robo_xml.requests, "request",
                        lambda metodo, url, **kwargs: pedidos.append((url, kwargs["json"])) or Resposta(204, None))
    robo._renovar_atf()
    assert pedidos == [("https://banco.invalid/rest/v1/rpc/xml_renovar_reservas_atf",
                        {"p_tentativas": [atual["tentativa_id"], aguardando["tentativa_id"]]})]


def test_falha_no_fim_do_lote_nao_reescreve_tarefa_ja_confirmada(cfg, monkeypatch):
    notas = [("a.xml", nfe(DONO, CLIENTE, ie_emit=IE_EMPRESA, valor=100)),
             ("b.xml", nfe(CNPJ_B, CLIENTE, ie_emit=IE_B, valor=200))]
    atf = AtfFalso(cfg, [Recolha(respostas={(IE_EMPRESA, "nfe_saida"): notas[:1], (IE_B, "nfe_saida"): notas[1:]})])
    monkeypatch.setattr(robo_xml.cripto, "carregar_privada", lambda _: object())
    monkeypatch.setattr(robo_xml.cripto, "decifrar", lambda *_: "falsa")
    robo = robo_xml.Robo(cfg)
    monkeypatch.setattr(robo.executor, "_garantir_chrome", lambda _: setattr(robo.executor, "atf", atf))
    lote = [linha("A", ORG_A, tipos=["nfe_saida"]), linha("B", ORG_A, IE_B, ["nfe_saida"])]
    robo.tarefas_atuais = lote.copy()
    confirmadas = {}

    def enviar(tarefa, dados):
        if "status" not in dados:
            return True
        tid = tarefa["id"]
        if tid == "B":
            raise OSError("Falha no retorno da segunda tarefa")
        confirmadas[tid] = dados
        return True

    monkeypatch.setattr(robo.portal, "atualizar_tarefa_reservada", enviar)
    with pytest.raises(OSError, match="segunda tarefa"):
        robo.processar(lote)
    assert confirmadas["A"]["status"] == "concluido" and confirmadas["A"]["qtd_xml"] == 1
    assert [t["id"] for t in robo._lote_interrompido()] == ["B"]


def test_modo_local_usa_contexto_persistente_e_relatorio_isolado(cfg, monkeypatch):
    destino = Path(cfg["pastas"]["destino"])
    arquivo = destino / "config.json"
    monkeypatch.setattr(config, "ARQUIVO_CONFIG", arquivo)
    arquivo.write_text(json.dumps(cfg), encoding="utf-8")
    monkeypatch.setattr(config, "RAIZ", destino)
    empresa = SimpleNamespace(ie=IE_EMPRESA, nome="Empresa", login="login", senha="senha", tipos=["faturas"],
                              cnpj="", codigo="")
    monkeypatch.setattr(robo_xml.planilha, "ler", lambda _: SimpleNamespace(erros=[], avisos=[], empresas=[empresa]))
    atf = AtfFalso(cfg, [])
    monkeypatch.setattr(robo_xml.Executor, "_garantir_chrome", lambda self, diag: setattr(self, "atf", atf))
    comando = ["robo_xml.py", "--local", "planilha.xlsx", "--competencia", "09/2026"]
    monkeypatch.setattr(sys, "argv", comando)
    with pytest.raises(SystemExit, match="criar-contexto-local"):
        robo_xml.main()
    monkeypatch.setattr(sys, "argv", [*comando, "--criar-contexto-local"])
    robo_xml.main()
    contexto = config.carregar_contexto_local()
    monkeypatch.setattr(sys, "argv", comando)
    robo_xml.main()
    assert config.carregar_contexto_local() == contexto
    assert len(list((destino / PASTA_CONTEXTOS / "local").rglob("*.pdf"))) == 1
    assert len(list((destino / PASTA_CONTEXTOS / "_relatorios" / "local" / contexto[0]).rglob("*.xlsx"))) == 2
    assert not (destino / "Arquivos baixados").exists()
