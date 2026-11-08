"""Monitor Fiscal: NF-e destinadas pelo Ambiente Nacional (DistDFe), com um Ambiente Nacional de mentira."""
import base64
import hashlib
import re

import pytest

import nfe
from nfe_exemplo import DEST, chave, doczip, proc_evento, proc_nfe, res_nfe, ret_dist
from test_nfse import _pfx, chaves  # noqa: F401 (fixture)


class Resposta:
    def __init__(self, conteudo: bytes, status: int = 200):
        self.content = conteudo
        self.status_code = status


class AmbienteFalso:
    """Responde à distribuição por NSU, à consulta por chave e à manifestação, e guarda o que foi pedido."""

    def __init__(self, lotes: dict[int, bytes], por_chave: dict[str, bytes] | None = None, ciencia_cstat: str = "135"):
        self.lotes = lotes                  # ultNSU pedido -> resposta
        self.chaves = por_chave or {}       # chave -> XML completo
        self.ciencia_cstat = ciencia_cstat
        self.pedidos: list[tuple[str, str]] = []
        self.eventos: list[bytes] = []

    def post(self, url, data, headers, timeout):
        corpo = data.decode()
        self.pedidos.append((url, corpo))
        if "RecepcaoEvento" in url:
            self.eventos.append(data)
            rets = "".join(f"<retEvento versao=\"1.00\"><infEvento><cStat>{self.ciencia_cstat}</cStat><chNFe>{c}</chNFe>"
                           "</infEvento></retEvento>" for c in re.findall(r"<chNFe>(\d{44})</chNFe>", corpo))
            return Resposta(f'<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><retEnvEvento '
                            f'xmlns="{nfe.NS}"><cStat>128</cStat>{rets}</retEnvEvento></s:Body></s:Envelope>'.encode())
        m = re.search(r"<chNFe>(\d{44})</chNFe>", corpo)
        if m:
            xml = self.chaves.get(m.group(1))
            return Resposta(ret_dist("138", 0, 0, [doczip(0, "procNFe_v4.00.xsd", xml)]) if xml else ret_dist("137", 0, 0))
        ult = int(re.search(r"<ultNSU>(\d+)</ultNSU>", corpo).group(1))
        return Resposta(self.lotes.get(ult, ret_dist("137", ult, ult)))


@pytest.fixture
def certificado():
    from cryptography.hazmat.primitives.serialization import pkcs12
    pfx = _pfx(f"PADARIA CENTRAL LTDA:{DEST}")
    chave_priv, cert, _ = pkcs12.load_key_and_certificates(pfx, b"1234")
    return pfx, chave_priv, cert


def _cliente(ambiente, pfx=None):
    assinador = nfe.assinador_do_pfx(pfx, "1234") if pfx else None
    return nfe.ClienteNfe(ambiente, DEST, dormir=lambda s: None, assinador=assinador)


def test_baixa_completas_resumos_e_cancelamento(tmp_path, certificado):
    pfx, _, _ = certificado
    c_resumo = chave(2)
    lotes = {
        0: ret_dist("138", 3, 5, [doczip(1, "procNFe_v4.00.xsd", proc_nfe(1)), doczip(2, "resNFe_v1.01.xsd", res_nfe(2)),
                                  doczip(3, "resNFe_v1.01.xsd", res_nfe(3, sit="3"))]),
        3: ret_dist("138", 5, 5, [doczip(4, "procEventoNFe_v1.00.xsd", proc_evento(1)),
                                  doczip(5, "resNFe_v1.01.xsd", res_nfe(9))]),
    }
    amb = AmbienteFalso(lotes, por_chave={c_resumo: proc_nfe(2, valor=90.0), chave(9): proc_nfe(9, valor=10.0)})
    r = nfe.monitorar(_cliente(amb, pfx), 0, tmp_path, "Padaria", "15")

    assert (r.ult_nsu, r.max_nsu) == (5, 5)
    pedidos_nsu = [int(m) for _, c in amb.pedidos for m in re.findall(r"<ultNSU>(\d+)</ultNSU>", c)]
    assert pedidos_nsu == [0, 3]  # parou quando ultNSU = maxNSU (regra do Ambiente Nacional)
    # nota 1: completa e depois cancelada; nota 2 e 9: resumo -> ciência -> XML completo pela chave; 3: cancelada (resumo)
    assert r.notas[chave(1)].situacao == "cancelada" and r.notas[chave(1)].completa
    assert r.notas[c_resumo].completa and r.notas[c_resumo].manifestada and r.notas[c_resumo].valor == 90.0
    assert r.notas[chave(3)].situacao == "cancelada" and not r.notas[chave(3)].manifestada
    assert r.manifestadas == 2 and len(amb.eventos) == 1  # um lote de ciência, só das autorizadas
    pasta = tmp_path / "Arquivos baixados" / "15-Padaria" / "112026" / nfe.PASTA_RECEBIDAS
    assert {p.name for p in pasta.glob("*.xml")} == {f"{chave(1)}.xml", f"{c_resumo}.xml", f"{chave(9)}.xml"}
    assert (pasta / f"{chave(1)}.pdf").read_bytes().startswith(b"%PDF")
    assert (pasta / "Eventos" / f"{chave(1)}-110111.xml").exists()
    portal = {n["chave"]: n for n in (x.para_portal() for x in r.notas.values())}
    assert portal[c_resumo]["pdf"] and portal[c_resumo]["emitente_uf"] == "PE"


def test_sem_ciencia_fica_so_o_resumo(tmp_path):
    amb = AmbienteFalso({0: ret_dist("138", 1, 1, [doczip(1, "resNFe_v1.01.xsd", res_nfe(2))])})
    r = nfe.monitorar(_cliente(amb), 0, tmp_path, "Padaria", "15", ciencia=False)
    assert not amb.eventos and r.resumos == 1 and not r.notas[chave(2)].completa
    assert not list(tmp_path.rglob("*.xml"))


def test_consumo_indevido_espera_uma_hora(tmp_path):
    amb = AmbienteFalso({7: ret_dist("656", 7, 7, motivo="Rejeicao: Consumo Indevido")})
    r = nfe.monitorar(_cliente(amb), 7, tmp_path, "Padaria")
    assert r.espera_minutos == 61 and "1 hora" in r.aviso and r.ult_nsu == 7


def test_erro_do_ambiente_nacional_para_a_rodada(tmp_path):
    amb = AmbienteFalso({0: ret_dist("589", 0, 0, motivo="Rejeicao: NSU informado superior ao maior NSU")})
    with pytest.raises(nfe.ErroSefaz, match="589"):
        nfe.monitorar(_cliente(amb), 0, tmp_path, "Padaria")


def test_pendentes_de_rodadas_anteriores(tmp_path, certificado):
    """Resumo de ontem (ciência ainda não feita) e nota já manifestada: o robô termina as duas hoje."""
    pfx, _, _ = certificado
    amb = AmbienteFalso({}, por_chave={chave(5): proc_nfe(5), chave(6): proc_nfe(6)})
    r = nfe.monitorar(_cliente(amb, pfx), 40, tmp_path, "Padaria", pendentes=[
        {"chave": chave(5), "manifestada": False}, {"chave": chave(6), "manifestada": True}])
    assert len(amb.eventos) == 1 and chave(5) in amb.eventos[0].decode() and chave(6) not in amb.eventos[0].decode()
    assert r.notas[chave(5)].completa and r.notas[chave(6)].completa


def test_assinatura_do_evento_confere(certificado):
    """A assinatura XMLDSig do evento de ciência confere com a chave pública do certificado."""
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding
    from lxml import etree
    _, chave_priv, cert = certificado
    xml = nfe.assinar(nfe.evento_ciencia(DEST, chave(2)), chave_priv, cert)
    raiz = etree.fromstring(xml)
    d = {"n": nfe.NS, "ds": "http://www.w3.org/2000/09/xmldsig#"}
    inf = raiz.find("n:infEvento", d)
    assert inf.get("Id") == f"ID210210{chave(2)}01" and inf.findtext("n:cOrgao", namespaces=d) == "91"
    assina = raiz.find("ds:Signature", d)
    digest = base64.b64encode(hashlib.sha1(etree.tostring(inf, method="c14n")).digest()).decode()
    assert assina.findtext(".//ds:DigestValue", namespaces=d) == digest
    assert assina.find(".//ds:Reference", d).get("URI") == "#" + inf.get("Id")
    cert.public_key().verify(base64.b64decode(assina.findtext("ds:SignatureValue", namespaces=d)),
                             etree.tostring(assina.find("ds:SignedInfo", d), method="c14n"), padding.PKCS1v15(), hashes.SHA1())


def test_pedido_de_distribuicao_no_formato_do_manual():
    amb = AmbienteFalso({})
    nfe.ClienteNfe(amb, "11.222.333/0001-81").distribuicao(12)
    url, corpo = amb.pedidos[0]
    assert url == nfe.DISTRIBUICAO["1"]
    assert '<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">' in corpo
    assert "<tpAmb>1</tpAmb><cUFAutor>25</cUFAutor><CNPJ>11222333000181</CNPJ>" in corpo
    assert "<distNSU><ultNSU>000000000000012</ultNSU></distNSU>" in corpo


def test_tarefa_do_monitor_abre_o_certificado_e_devolve_para_o_portal(tmp_path, chaves):
    import cripto
    import robo_xml
    privada, publica = chaves
    pfx = _pfx(f"PADARIA CENTRAL LTDA:{DEST}")
    m = {"id": "m1", "cnpj": DEST, "nome": "Padaria", "codigo": "15", "ciencia": True, "ultimo_nsu": 0,
         "org_nome": "Contábil Sousa", "pendentes": [],
         "pfx_cifrado": cripto.cifrar_arquivo(pfx, publica), "senha_cifrada": cripto.cifrar("1234", publica)}
    amb = AmbienteFalso({0: ret_dist("138", 2, 2, [doczip(1, "procNFe_v4.00.xsd", proc_nfe(1)),
                                                   doczip(2, "resNFe_v1.01.xsd", res_nfe(2))])},
                        por_chave={chave(2): proc_nfe(2)})
    cfg = {"pastas": {"destino": str(tmp_path), "por_escritorio": True}, "monitor_nfe": {"uf_autor": "25"}}
    r = robo_xml.executar_monitor(cfg, m, privada, sessao_falsa=amb)
    assert r["status"] == "ok" and r["ultimo_nsu"] == 2 and "2 nota(s) com XML" in r["mensagem"], r
    assert {n["chave"] for n in r["notas"]} == {chave(1), chave(2)} and all(n["completa"] for n in r["notas"])
    assert (tmp_path / "Contábil Sousa" / "Arquivos baixados" / "15-Padaria" / "112026" / nfe.PASTA_RECEBIDAS).is_dir()


def test_monitor_com_certificado_vencido_nao_consulta(tmp_path, chaves, monkeypatch):
    import datetime as dt

    import cripto
    import nfse
    import robo_xml
    privada, publica = chaves
    monkeypatch.setattr(nfse, "dados_do_certificado", lambda pfx, senha: {
        "nome": "X", "cnpj": DEST, "cpf": "", "validade": dt.datetime(2025, 1, 1, tzinfo=dt.timezone.utc)})
    m = {"id": "m1", "cnpj": DEST, "nome": "Padaria", "ultimo_nsu": 5,
         "pfx_cifrado": cripto.cifrar_arquivo(_pfx("X"), publica), "senha_cifrada": cripto.cifrar("1234", publica)}
    amb = AmbienteFalso({})
    r = robo_xml.executar_monitor({"pastas": {"destino": str(tmp_path)}}, m, privada, sessao_falsa=amb)
    assert r["status"] == "certificado" and "venceu" in r["mensagem"] and not amb.pedidos


def test_cadeia_icp_brasil_do_pacote_oficial(tmp_path):
    import io
    import zipfile

    from cryptography.hazmat.primitives.serialization import Encoding, pkcs12
    _, cert, _ = pkcs12.load_key_and_certificates(_pfx("AC RAIZ"), b"1234")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("raiz.crt", cert.public_bytes(Encoding.DER))
        z.writestr("leiame.txt", b"texto")
    arq = nfe.cadeia_icp_brasil(tmp_path, baixar=lambda url: buf.getvalue())
    assert arq.read_bytes().startswith(b"-----BEGIN CERTIFICATE-----")
    assert nfe.cadeia_icp_brasil(tmp_path, baixar=lambda url: 1 / 0) == arq  # já baixada: não baixa de novo


def test_robo_grava_o_resultado_do_monitor_no_portal(monkeypatch):
    import robo_xml

    class PortalFalso:
        def __init__(self):
            self.concluidos = []

        def concluir_monitor(self, mid, r):
            self.concluidos.append((mid, r))
            return 2

    robo = robo_xml.Robo.__new__(robo_xml.Robo)
    robo.cfg, robo.privada, robo.parar, robo.portal = {}, None, False, PortalFalso()
    robo._sinal = lambda: None
    monkeypatch.setattr(robo_xml, "executar_monitor", lambda cfg, m, privada: {"status": "ok", "mensagem": "1 nota", "notas": [{"chave": "1"}]})
    robo.processar_monitor([{"id": "m1", "nome": "Padaria"}])
    assert robo.portal.concluidos == [("m1", {"status": "ok", "mensagem": "1 nota", "notas": [{"chave": "1"}]})]

    def quebra(cfg, m, privada):
        raise RuntimeError("x")
    monkeypatch.setattr(robo_xml, "executar_monitor", quebra)
    robo.processar_monitor([{"id": "m2", "nome": "Mercado", "ultimo_nsu": 9}])
    mid, r = robo.portal.concluidos[-1]
    assert mid == "m2" and r["status"] == "erro" and r["ultimo_nsu"] == 9 and r["espera_minutos"] == 61


def test_filas_de_api_rodam_varias_empresas_ao_mesmo_tempo():
    """NFS-e e Monitor Fiscal: até N empresas em paralelo, pegando mais assim que uma termina; o mesmo CNPJ
    (duas competências) nunca roda junto, porque divide o cache e as pastas."""
    import threading
    import time

    import robo_xml

    fila = [{"id": f"t{i}", "nome": f"E{i}", "cnpj": f"{i:014d}"} for i in range(8)] + \
           [{"id": "t8", "nome": "E0 de novo", "cnpj": f"{0:014d}"}]
    robo = robo_xml.Robo.__new__(robo_xml.Robo)
    robo.cfg, robo.nome, robo.parar = {"portal": {"intervalo_segundos": 0.05}}, "teste", False
    robo._trava, robo._travas_cnpj = threading.Lock(), {}
    em_curso, feitos, juntos, pico = {}, [], set(), [0]
    trava = threading.Lock()

    def pegar(nome, maximo):
        with trava:
            lote = fila[:maximo]
            del fila[:maximo]
        return lote

    def processar(t):
        with trava:
            juntos.add(t["cnpj"])
            pico[0] = max(pico[0], len(juntos))
        time.sleep(0.2)
        with trava:
            juntos.discard(t["cnpj"])
            feitos.append(t["id"])
        if len(feitos) == 9:
            robo.parar = True

    linha = threading.Thread(target=robo._fila_paralela, args=("teste", pegar, processar, em_curso, 4))
    inicio = time.time()
    linha.start()
    linha.join(10)
    assert sorted(feitos) == sorted(f"t{i}" for i in range(9)) and not em_curso
    assert pico[0] == 4                      # 4 ao mesmo tempo
    assert time.time() - inicio < 1.5        # 9 tarefas de 0,2 s: em série levariam 1,8 s
