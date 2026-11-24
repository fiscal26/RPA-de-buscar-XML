"""NFS-e pela API do Portal Nacional: leitura do XML, retenções, lotes por NSU, cache e relatório."""
import base64
import gzip
import json
from datetime import datetime, timedelta, timezone

import pytest

import nfse
from pathlib import Path
from armazenamento import ContextoArmazenamento, abrir_empresa

ORG = "7b245ed0-a8a0-4242-bcf0-24c8eb2895c6"


@pytest.fixture
def tmp_path(tmp_path_factory):
    return tmp_path_factory.mktemp("n")


def contexto(cnpj="11222333000181", org=ORG):
    return ContextoArmazenamento("portal", org, "nfse_nacional", "cnpj", cnpj, "Lotivisse", "7")


def pasta_empresa(cfg, cnpj="11222333000181"):
    with abrir_empresa(cfg["pastas"]["destino"], contexto(cnpj)) as pasta:
        return pasta

DONO = "11222333000181"
CLIENTE = "44555666000199"
PRESTADOR = "77888999000155"
NS = "http://www.sped.fazenda.gov.br/nfse"


def nota_xml(chave, numero, prest, toma, toma_nome, valor, compet="2026-09", tp_ret_iss="1", iss=0.0,
             irrf=0.0, csll=0.0, inss=0.0, pis=0.0, cofins=0.0, tp_ret_pc="2", total_ret=None, liquido=None,
             simples="") -> bytes:
    total = round((iss if tp_ret_iss in ("2", "3") else 0) + irrf + csll + inss
                  + (pis if tp_ret_pc in ("1", "3") else 0) + (cofins if tp_ret_pc in ("1", "3") else 0), 2)
    total_ret = total if total_ret is None else total_ret
    liquido = round(valor - total_ret, 2) if liquido is None else liquido
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<NFSe xmlns="{NS}" versao="1.00"><infNFSe Id="NFS{chave}">
 <xLocIncid>João Pessoa</xLocIncid><nNFSe>{numero}</nNFSe><cStat>100</cStat>
 <emit><CNPJ>{prest}</CNPJ><xNome>Prestadora {prest[:4]} Ltda</xNome></emit>
 <valores><vBC>{valor:.2f}</vBC><pAliqAplic>5.00</pAliqAplic><vISSQN>{iss:.2f}</vISSQN>
  <vTotalRet>{total_ret:.2f}</vTotalRet><vLiq>{liquido:.2f}</vLiq></valores>
 <DPS versao="1.00"><infDPS Id="DPS1">
  <dhEmi>{compet}-15T10:00:00-03:00</dhEmi><dCompet>{compet}-15</dCompet>
  <prest><CNPJ>{prest}</CNPJ>{f"<regTrib><opSimpNac>{simples}</opSimpNac></regTrib>" if simples else ""}</prest>
  <toma><CNPJ>{toma}</CNPJ><xNome>{toma_nome}</xNome></toma>
  <serv><cServ><cTribNac>010101</cTribNac><xDescServ>Consultoria</xDescServ></cServ></serv>
  <valores><vServPrest><vServ>{valor:.2f}</vServ></vServPrest>
   <trib><tribMun><tribISSQN>1</tribISSQN><pAliq>5.00</pAliq><tpRetISSQN>{tp_ret_iss}</tpRetISSQN></tribMun>
    <tribFed><piscofins><CST>01</CST><vBCPisCofins>{valor:.2f}</vBCPisCofins><vPis>{pis:.2f}</vPis>
     <vCofins>{cofins:.2f}</vCofins><tpRetPisCofins>{tp_ret_pc}</tpRetPisCofins></piscofins>
     <vRetCP>{inss:.2f}</vRetCP><vRetIRRF>{irrf:.2f}</vRetIRRF><vRetCSLL>{csll:.2f}</vRetCSLL></tribFed>
   </trib></valores>
 </infDPS></DPS>
</infNFSe></NFSe>""".encode()


def evento_xml(chave, codigo="e101101") -> bytes:
    return f"""<evento xmlns="{NS}"><infEvento Id="EVT1"><pedRegEvento><infPedReg Id="PRE1">
<chNFSe>{chave}</chNFSe><{codigo}><xDesc>Cancelamento de NFS-e</xDesc></{codigo}></infPedReg></pedRegEvento>
</infEvento></evento>""".encode()


def empacotar(xml: bytes) -> str:
    return base64.b64encode(gzip.compress(xml)).decode()


C1, C2, C3, C4, C5 = (f"2507507{i:043d}" for i in range(1, 6))


def documentos_exemplo():
    return [
        # emitida sem retenção
        (1, "NFSE", C1, nota_xml(C1, "1", DONO, CLIENTE, "Cliente Um SA", 1000.0, iss=50.0)),
        # emitida com ISS retido pelo tomador e PIS/COFINS/CSLL/IRRF retidos
        (2, "NFSE", C2, nota_xml(C2, "2", DONO, CLIENTE, "Cliente Um SA", 10000.0, tp_ret_iss="2", iss=500.0,
                                 irrf=150.0, csll=100.0, pis=65.0, cofins=300.0, tp_ret_pc="3")),
        # recebida com INSS retido
        (3, "NFSE", C3, nota_xml(C3, "77", PRESTADOR, DONO, "Lotivisse", 2000.0, inss=220.0)),
        # emitida e cancelada
        (4, "NFSE", C4, nota_xml(C4, "3", DONO, CLIENTE, "Cliente Um SA", 999.0)),
        (5, "EVENTO", C4, evento_xml(C4)),
        # outra competência
        (6, "NFSE", C5, nota_xml(C5, "4", DONO, CLIENTE, "Cliente Um SA", 500.0, compet="2026-10")),
    ]


class Resposta:
    def __init__(self, status=200, dados=None, conteudo=b"", cabecalhos=None):
        self.status_code = status
        self._dados = dados
        self.content = conteudo
        self.text = json.dumps(dados) if dados is not None else conteudo.decode(errors="ignore")
        self.headers = cabecalhos or {}

    def json(self):
        if self._dados is None:
            raise ValueError("sem JSON")
        return self._dados


class PortalFalso:
    """Imita o ADN: devolve lotes de até 2 documentos com NSU maior que o pedido."""

    def __init__(self, docs, falhas=None):
        self.docs = docs
        self.falhas = list(falhas or [])
        self.pedidos = []

    def get(self, url, params=None, headers=None, timeout=None):
        self.pedidos.append((url, dict(params or {})))
        if self.falhas:
            return self.falhas.pop(0)
        if "/danfse/" in url:
            return Resposta(200, conteudo=b"%PDF-1.4 falso")
        nsu = int(url.rsplit("/", 1)[-1])
        lote = [d for d in self.docs if d[0] > nsu][:2]
        if not lote:
            return Resposta(200, {"StatusProcessamento": "NENHUM_DOCUMENTO_LOCALIZADO", "LoteDFe": []})
        return Resposta(200, {"StatusProcessamento": "DOCUMENTOS_LOCALIZADOS", "LoteDFe": [
            {"NSU": n, "TipoDocumento": t, "ChaveAcesso": c, "ArquivoXml": empacotar(x)} for n, t, c, x in lote]})


def cliente(portal):
    return nfse.ClienteADN(portal, intervalo=0, dormir=lambda s: None)


def test_le_a_nota_e_as_retencoes():
    n = nfse.ler_nfse(documentos_exemplo()[1][3])
    assert (n.chave, n.numero, n.competencia, n.emissao) == (C2, "2", "2026-09", "2026-09-15")
    assert n.prestador_doc == DONO and n.tomador_doc == CLIENTE and n.tomador_nome == "Cliente Um SA"
    assert n.iss_retido and n.ret_iss == 500.0 and n.aliquota_iss == 5.0
    assert (n.ret_irrf, n.ret_pis, n.ret_cofins, n.ret_csll, n.ret_inss) == (150.0, 65.0, 300.0, 100.0, 0.0)
    assert n.total_retido == 1115.0 and n.valor_liquido == 8885.0 and not n.avisos


def test_iss_nao_retido_e_pis_nao_retido_ficam_zerados():
    n = nfse.ler_nfse(nota_xml(C1, "1", DONO, CLIENTE, "X", 1000.0, iss=50.0, pis=6.5, cofins=30.0, tp_ret_pc="2"))
    assert n.valor_iss == 50.0 and not n.iss_retido and n.ret_iss == 0
    assert n.ret_pis == n.ret_cofins == 0 and n.total_retido == 0


def test_avisa_quando_o_total_retido_nao_bate():
    n = nfse.ler_nfse(nota_xml(C1, "1", DONO, CLIENTE, "X", 1000.0, irrf=15.0, total_ret=20.0))
    assert n.total_retido == 20.0 and n.avisos


def test_evento_nao_e_nota():
    assert nfse.ler_nfse(evento_xml(C4)) is None
    assert nfse.chave_do_evento(evento_xml(C4)) == (C4, "e101101")


def test_busca_por_nsu_ate_acabar_e_continua_do_ultimo(tmp_path):
    portal = PortalFalso(documentos_exemplo())
    cache = nfse.Cache(tmp_path / DONO)
    assert nfse.atualizar_cache(cliente(portal), cache) == 6
    assert [p[0].rsplit("/", 1)[-1] for p in portal.pedidos] == ["0", "2", "4", "6"]
    assert portal.pedidos[0][1] == {"lote": "true"}
    # de novo: começa do último NSU guardado e não traz nada repetido
    portal.pedidos.clear()
    assert nfse.atualizar_cache(cliente(portal), nfse.Cache(tmp_path / DONO)) == 0
    assert portal.pedidos[0][0].endswith("/DFe/6")


@pytest.mark.parametrize("xml_invalido", [b"", b"<raiz/>", b"<infNFSe><infDPS/></infNFSe>"])
def test_xml_invalido_nao_avanca_nsu_e_reconsulta_o_documento(tmp_path, xml_invalido):
    primeiro, segundo = documentos_exemplo()[:2]
    incompleto = (*segundo[:3], xml_invalido)
    pasta = tmp_path / DONO
    with pytest.raises(nfse.ErroADN, match="ausente ou inválido"):
        nfse.atualizar_cache(cliente(PortalFalso([primeiro, incompleto])), nfse.Cache(pasta))

    cache = nfse.Cache(pasta)
    assert cache.ultimo_nsu == 1
    assert not (pasta / "2.xml").exists()
    portal = PortalFalso([primeiro, segundo])
    assert nfse.atualizar_cache(cliente(portal), cache) == 1
    assert portal.pedidos[0][0].endswith("/DFe/1")
    assert nfse.Cache(pasta).ultimo_nsu == 2


@pytest.mark.parametrize("valor", [b"", b"<vServ>invalido</vServ>", b"<vServ>NaN</vServ>"])
def test_nota_sem_valor_valido_nao_avanca_nsu(tmp_path, valor):
    nota = documentos_exemplo()[0]
    invalida = (*nota[:3], nota[3].replace(b"<vServ>1000.00</vServ>", valor))
    pasta = tmp_path / DONO
    with pytest.raises(nfse.ErroADN):
        nfse.atualizar_cache(cliente(PortalFalso([invalida])), nfse.Cache(pasta))

    cache = nfse.Cache(pasta)
    assert cache.ultimo_nsu == 0
    assert not (pasta / "1.xml").exists()
    zero = (*nota[:3], nota[3].replace(b"<vServ>1000.00</vServ>", b"<vServ>0.00</vServ>"))
    assert nfse.atualizar_cache(cliente(PortalFalso([zero])), cache) == 1
    assert nfse.resumo_mei(cache, DONO, "2026-09")["valor"] == 0
    assert nfse.resumo_mei(cache, DONO, "2026-09")["quantidade"] == 1


@pytest.mark.parametrize("xml_invalido", [b"", b"<raiz/>", evento_xml("")])
def test_cancelamento_sem_dados_nao_avanca_nsu_e_pode_ser_reconsultado(tmp_path, xml_invalido):
    nota = documentos_exemplo()[0]
    pasta = tmp_path / DONO
    with pytest.raises(nfse.ErroADN):
        nfse.atualizar_cache(cliente(PortalFalso([nota, (2, "EVENTO", C1, xml_invalido)])), nfse.Cache(pasta))

    cache = nfse.Cache(pasta)
    assert cache.ultimo_nsu == 1
    assert nfse.resumo_mei(cache, DONO, "2026-09")["valor"] == 1000
    portal = PortalFalso([nota, (2, "EVENTO", C1, evento_xml(C1))])
    assert nfse.atualizar_cache(cliente(portal), cache) == 1
    assert portal.pedidos[0][0].endswith("/DFe/1")
    assert nfse.resumo_mei(cache, DONO, "2026-09")["valor"] == 0
    assert nfse.Cache(pasta).ultimo_nsu == 2


def test_espera_e_repete_quando_o_portal_limita(tmp_path):
    esperas = []
    portal = PortalFalso(documentos_exemplo()[:1], falhas=[Resposta(429, {}, cabecalhos={"Retry-After": "3"}),
                                                          Resposta(503, {})])
    c = nfse.ClienteADN(portal, intervalo=0.01, dormir=esperas.append)
    assert nfse.atualizar_cache(c, nfse.Cache(tmp_path / DONO)) == 1
    assert 3.0 in esperas and c.intervalo > 0.01


def test_erro_do_portal_vira_mensagem_clara():
    portal = PortalFalso([], falhas=[Resposta(400, {"Erros": [{"Codigo": "E2214", "Descricao": "Erro Cadeia"}]})])
    with pytest.raises(nfse.ErroADN, match="E2214"):
        cliente(portal).lote(0)
    portal = PortalFalso([], falhas=[Resposta(403, {"Erros": [{"Codigo": "E0001", "Descricao": "Negado"}]})])
    with pytest.raises(nfse.ErroADN, match="não aceitou o certificado"):
        cliente(portal).lote(0)


def test_404_sem_documentos_encerra_a_busca():
    portal = PortalFalso([], falhas=[Resposta(404, {"StatusProcessamento": "NENHUM_DOCUMENTO_LOCALIZADO"})])
    assert list(cliente(portal).documentos(10)) == []


def test_baixa_a_competencia_separa_e_monta_o_relatorio(tmp_path):
    from openpyxl import load_workbook

    portal = PortalFalso(documentos_exemplo())
    r = nfse.baixar_competencia(cliente(portal), contexto(), "2026-09", tmp_path / "destino")
    assert [n.numero for n in r.emitidas] == ["1", "2"]          # a cancelada e a de outubro ficam de fora
    assert [n.numero for n in r.recebidas] == ["77"]
    assert r.canceladas == 1 and r.pdfs == 3
    emitidas = r.pasta / nfse.PASTA_EMITIDAS
    assert r.pasta.parent.name.startswith(f"cnpj_{DONO}") and r.pasta.name == "092026"
    assert len(list(emitidas.glob("*.xml"))) == 2 and len(list(emitidas.glob("*.pdf"))) == 2
    assert len(list((r.pasta / nfse.PASTA_RECEBIDAS).glob("*.xml"))) == 1
    # o mês num XML só, no envelope ABRASF (importação da Domínio): cada nota entra como veio, com a assinatura
    import xml.etree.ElementTree as ET
    lotes = sorted(p.name for p in r.pasta.glob("*.xml"))
    assert lotes == [f"{nfse.PASTA_EMITIDAS} 092026.xml", f"{nfse.PASTA_RECEBIDAS} 092026.xml"]
    lote = (r.pasta / lotes[0]).read_bytes()
    raiz = ET.fromstring(lote)
    abrasf = "{http://www.abrasf.org.br/nfse.xsd}"
    assert raiz.tag == f"{abrasf}EnviarLoteRpsSincronoResposta" and raiz.findtext(f"{abrasf}NumeroLote") == "202609"
    assert raiz.findtext(f"{abrasf}Protocolo") == "COMP202609"
    notas = raiz.findall(f"{abrasf}ListaNfse/{abrasf}CompNfse")
    assert len(notas) == 2 and all(n[0].tag.endswith("NFSe") for n in notas)
    for x in emitidas.glob("*.xml"):
        original = x.read_bytes()
        assert original[original.index(b"<NFSe"):].strip() in lote

    wb = load_workbook(r.relatorio)
    assert wb.sheetnames == ["Resumo", "Emitidas", "Recebidas"]
    resumo = {linha[0]: linha[1:3] for linha in wb["Resumo"].iter_rows(values_only=True) if linha and linha[0]}
    assert resumo["Quantidade de notas"] == (2, 1)
    assert resumo["ISS retido"] == (500.0, 0.0) and resumo["INSS"] == (0.0, 220.0)
    assert resumo["Total retido"] == (1115.0, 220.0)
    em = list(wb["Emitidas"].iter_rows(values_only=True))
    assert em[0][3] == "CNPJ/CPF do tomador" and em[2][9] == "Sim" and em[-1][0] == "TOTAL"
    assert em[-1][16] == "=SUM(Q2:Q3)"


def test_sem_notas_na_competencia_nao_cria_relatorio(tmp_path):
    r = nfse.baixar_competencia(cliente(PortalFalso([])), contexto(), "2026-09", tmp_path / "d")
    assert r.relatorio is None and not r.emitidas and not list((tmp_path / "d").rglob("*.xlsx"))


def _pfx(cn: str, senha: str = "1234") -> bytes:
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.primitives.serialization import BestAvailableEncryption, pkcs12
    from cryptography.x509.oid import NameOID

    chave = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    nome = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn)])
    agora = datetime.now(timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(nome).issuer_name(nome).public_key(chave.public_key())
            .serial_number(1).not_valid_before(agora).not_valid_after(agora + timedelta(days=365))
            .sign(chave, hashes.SHA256()))
    return pkcs12.serialize_key_and_certificates(b"a1", chave, cert, None, BestAvailableEncryption(senha.encode()))


def test_le_cnpj_do_certificado_e_abre_o_tls():
    pfx = _pfx(f"LOTIVISSE LTDA:{DONO}")
    info = nfse.dados_do_certificado(pfx, "1234")
    assert info["cnpj"] == DONO and info["nome"] == "LOTIVISSE LTDA"
    with nfse.contexto_tls(pfx, "1234") as ctx:
        assert ctx is not None
    with pytest.raises(nfse.ErroADN, match="senha"):
        nfse.dados_do_certificado(pfx, "errada")


# ---------------------------------------------------------------- tarefa do portal (robô)
@pytest.fixture
def chaves():
    from cryptography.hazmat.primitives.asymmetric import rsa
    import cripto
    privada = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return privada, cripto.publica_de(privada)


def tarefa(chaves, tipos, pfx=None, senha="1234", cnpj=DONO, certificado_cnpj=DONO):
    import cripto
    _, publica = chaves
    pfx = pfx or _pfx(f"LOTIVISSE LTDA:{certificado_cnpj}", senha)
    return {"id": "t1", "org_id": ORG, "org_nome": "Escritório", "cnpj": cnpj, "nome": "Lotivisse", "codigo": "7", "tipos": tipos, "data_inicio": "2026-09-01",
            "certificado_cnpj": certificado_cnpj, "pfx_cifrado": cripto.cifrar_arquivo(pfx, publica),
            "senha_cifrada": cripto.cifrar(senha, publica)}


@pytest.fixture
def cfg_nfse(tmp_path, monkeypatch):
    monkeypatch.setattr(nfse.ClienteADN.__init__, "__defaults__", ("", nfse.ADN, 0, lambda s: None))  # sem esperas
    return {"pastas": {"destino": str(tmp_path / "destino")}}


def test_tarefa_do_portal_baixa_e_conta_por_servico(chaves, cfg_nfse):
    import robo_xml
    portal = PortalFalso(documentos_exemplo())
    r = robo_xml.executar_nfse(cfg_nfse, tarefa(chaves, ["nfse_emitidas", "nfse_recebidas", "nfse_pdf", "nfse_retencoes"]),
                               chaves[0], sessao_falsa=portal)
    assert r.status == "concluido" and r.qtd_xml == 3 and (Path(cfg_nfse["pastas"]["destino"]) / r.pasta) == pasta_empresa(cfg_nfse)
    assert r.detalhes["nfse_emitidas"] == {"situacao": "concluido", "mensagem": "2 nota(s)", "arquivos": 2}
    assert r.detalhes["nfse_recebidas"]["arquivos"] == 1 and r.detalhes["nfse_pdf"]["arquivos"] == 3
    assert r.detalhes["nfse_retencoes"]["situacao"] == "concluido"
    assert "1 cancelada(s) fora" in r.mensagem
    # o CNPJ consultado vai sempre (o Portal Nacional passou a recusar a consulta sem ele)
    assert all(p[1].get("cnpjConsulta") == DONO for p in portal.pedidos if "/DFe/" in p[0])


def test_filial_usa_o_certificado_da_matriz_com_cnpj_consulta(chaves, cfg_nfse):
    import robo_xml
    filial = "11222333000262"
    portal = PortalFalso([])
    r = robo_xml.executar_nfse(cfg_nfse, tarefa(chaves, ["nfse_emitidas"], cnpj=filial), chaves[0], sessao_falsa=portal)
    assert r.status == "sem_notas" and r.detalhes["nfse_emitidas"]["situacao"] == "sem_movimento"
    assert portal.pedidos[0][1]["cnpjConsulta"] == filial


def test_so_emitidas_sem_relatorio_nem_pdf(chaves, cfg_nfse, tmp_path):
    import robo_xml
    portal = PortalFalso(documentos_exemplo())
    r = robo_xml.executar_nfse(cfg_nfse, tarefa(chaves, ["nfse_emitidas"]), chaves[0], sessao_falsa=portal)
    assert r.qtd_xml == 2 and set(r.detalhes) == {"nfse_emitidas", "mei_nfse"}
    assert r.detalhes["mei_nfse"]["meses"] == [{"competencia": "2026-09-01", "valor": 11000.0, "quantidade": 2}]
    pasta = pasta_empresa(cfg_nfse) / "092026"
    assert not (pasta / nfse.PASTA_RECEBIDAS).exists() and not list(pasta.glob("*.xlsx"))
    assert not list(pasta.rglob("*.pdf")) and not any("/danfse/" in p[0] for p in portal.pedidos)


def test_certificado_com_senha_errada(chaves, cfg_nfse):
    import robo_xml
    t = tarefa(chaves, ["nfse_emitidas"])
    t["senha_cifrada"] = __import__("cripto").cifrar("errada", chaves[1])
    r = robo_xml.executar_nfse(cfg_nfse, t, chaves[0], sessao_falsa=PortalFalso([]))
    assert r.status == "certificado" and "senha" in r.mensagem and r.detalhes["nfse_emitidas"]["situacao"] == "erro"
    assert "mei_nfse" not in r.detalhes  # uma falha nunca apaga o último faturamento válido


def test_resumo_mei_reprocessado_inclui_cancelamento_sem_duplicar(chaves, cfg_nfse):
    import robo_xml
    t = tarefa(chaves, ["nfse_emitidas"])
    r = robo_xml.executar_nfse(cfg_nfse, t, chaves[0], sessao_falsa=PortalFalso(documentos_exemplo()))
    assert r.detalhes["mei_nfse"]["meses"][0]["valor"] == 11000.0  # bruto, não o líquido retido
    # O evento novo cancela a nota de 10 mil; recebidas e outra competência não entram na receita.
    cancelamento = [(7, "EVENTO", C2, evento_xml(C2))]
    for _ in range(2):
        r = robo_xml.executar_nfse(cfg_nfse, t, chaves[0], sessao_falsa=PortalFalso(cancelamento))
        assert r.detalhes["mei_nfse"]["meses"] == [{"competencia": "2026-09-01", "valor": 1000.0, "quantidade": 1}]


def test_mei_sem_nota_registra_zero_confirmado(chaves, cfg_nfse):
    import robo_xml
    r = robo_xml.executar_nfse(cfg_nfse, tarefa(chaves, ["nfse_emitidas"]), chaves[0], sessao_falsa=PortalFalso([]))
    assert r.status == "sem_notas"
    assert r.detalhes["mei_nfse"]["meses"] == [{"competencia": "2026-09-01", "valor": 0.0, "quantidade": 0}]


def test_portal_recusa_o_certificado_e_fora_do_ar(chaves, cfg_nfse):
    import robo_xml
    recusa = PortalFalso([], falhas=[Resposta(403, {"Erros": [{"Codigo": "E0", "Descricao": "x"}]})])
    r = robo_xml.executar_nfse(cfg_nfse, tarefa(chaves, ["nfse_emitidas"]), chaves[0], sessao_falsa=recusa)
    assert r.status == "certificado"
    instavel = PortalFalso([], falhas=[Resposta(400, {"Erros": [{"Codigo": "E2214", "Descricao": "Cadeia"}]})])
    r = robo_xml.executar_nfse(cfg_nfse, tarefa(chaves, ["nfse_emitidas"]), chaves[0], sessao_falsa=instavel)
    assert r.status == "fora_do_ar" and "agende de novo" in r.detalhes["nfse_emitidas"]["mensagem"]


def test_tarefa_vai_para_a_pasta_do_escritorio(chaves, cfg_nfse, tmp_path):
    import robo_xml
    cfg_nfse["pastas"]["por_escritorio"] = True
    t = tarefa(chaves, ["nfse_emitidas"])
    t["org_nome"] = "Contábil Sousa"
    r = robo_xml.executar_nfse(cfg_nfse, t, chaves[0], sessao_falsa=PortalFalso(documentos_exemplo()))
    assert r.qtd_xml == 2
    assert (pasta_empresa(cfg_nfse) / "092026" / nfse.PASTA_EMITIDAS).is_dir()


def test_certificado_do_escritorio_por_procuracao(chaves, cfg_nfse):
    """Desde 01/11/2026: o e-CPF do contador (ou o e-CNPJ do escritório) baixa as notas da empresa que deu
    procuração ao escritório, informando o CNPJ dela."""
    import robo_xml
    contador = "12345678909"
    t = tarefa(chaves, ["nfse_emitidas"], cnpj=DONO, certificado_cnpj=contador)
    t["procurador"] = True
    portal = PortalFalso(documentos_exemplo())
    r = robo_xml.executar_nfse(cfg_nfse, t, chaves[0], sessao_falsa=portal)
    assert r.status == "concluido" and r.qtd_xml == 2
    assert portal.pedidos[0][1]["cnpjConsulta"] == DONO
    assert nfse.dados_do_certificado(_pfx(f"FULANO CONTADOR:{contador}"), "1234")["cpf"] == contador


def test_empresa_sem_procuracao_para_o_escritorio(chaves, cfg_nfse):
    import robo_xml
    t = tarefa(chaves, ["nfse_emitidas"], cnpj=DONO, certificado_cnpj="12345678909")
    t["procurador"] = True
    recusa = PortalFalso([], falhas=[Resposta(403, {"Erros": [{"Codigo": "E0001", "Descricao": "Sem permissão"}]})])
    r = robo_xml.executar_nfse(cfg_nfse, t, chaves[0], sessao_falsa=recusa)
    assert r.status == "certificado" and "procuração" in r.mensagem
    assert r.detalhes["nfse_emitidas"]["mensagem"] == "sem procuração da empresa para o escritório"


def _docs_mei(simples="2"):
    chaves = [f"2507507{i:043d}" for i in range(11, 15)]
    return [
        (1, "NFSE", chaves[0], nota_xml(chaves[0], "1", DONO, CLIENTE, "Cliente Um SA", 300.0, compet="2026-02", simples=simples)),
        (2, "NFSE", chaves[1], nota_xml(chaves[1], "2", DONO, CLIENTE, "Cliente Um SA", 400.0, compet="2026-07", simples=simples)),
        (3, "NFSE", chaves[2], nota_xml(chaves[2], "3", DONO, CLIENTE, "Cliente Um SA", 500.0, compet="2026-09", simples=simples)),
    ]


def test_mei_sem_busca_anterior_baixa_desde_janeiro(chaves, cfg_nfse, tmp_path):
    """MEI (emite NFS-e como MEI) que nunca teve busca: sai com os meses de janeiro até a competência."""
    import robo_xml
    r = robo_xml.executar_nfse(cfg_nfse, tarefa(chaves, ["nfse_emitidas"]), chaves[0], sessao_falsa=PortalFalso(_docs_mei()))
    base = pasta_empresa(cfg_nfse)
    assert (base / "092026" / nfse.PASTA_EMITIDAS).is_dir()
    assert (base / "022026" / nfse.PASTA_EMITIDAS).is_dir() and (base / "072026" / nfse.PASTA_EMITIDAS).is_dir()
    assert (base / "072026" / f"{nfse.PASTA_EMITIDAS} 072026.xml").exists()
    assert r.qtd_xml == 1 and "meses anteriores" in r.mensagem, r
    # na próxima competência, os meses presentes no banco não são refeitos
    (base / "022026" / nfse.PASTA_EMITIDAS / "marca.txt").write_text("x")
    assert nfse.meses_sem_busca("2026-10", ["2026-02-01", "2026-07-01", "2026-09-01"]) == [
        "2026-01", "2026-03", "2026-04", "2026-05", "2026-06", "2026-08"]


def test_mei_pelo_cadastro_da_sefaz(chaves, cfg_nfse, tmp_path):
    """Marcado como MEI na planilha da SEFAZ (a fila manda mei=true), mesmo sem o opSimpNac nas notas."""
    import robo_xml
    t = {**tarefa(chaves, ["nfse_emitidas"]), "mei": True}
    robo_xml.executar_nfse(cfg_nfse, t, chaves[0], sessao_falsa=PortalFalso(_docs_mei(simples="")))
    assert (pasta_empresa(cfg_nfse) / "072026").is_dir()


def test_empresa_que_nao_e_mei_baixa_so_a_competencia(chaves, cfg_nfse, tmp_path):
    import robo_xml
    r = robo_xml.executar_nfse(cfg_nfse, tarefa(chaves, ["nfse_emitidas"]), chaves[0], sessao_falsa=PortalFalso(_docs_mei(simples="3")))
    base = pasta_empresa(cfg_nfse)
    assert (base / "092026").is_dir() and not (base / "072026").exists() and not (base / "022026").exists()
    assert "meses anteriores" not in r.mensagem


def test_portal_sem_pdf_o_robo_gera_o_danfse_do_xml(tmp_path):
    """O Portal Nacional às vezes não entrega o PDF: o robô gera o DANFSe a partir do XML e para de insistir."""
    class SemPdf(PortalFalso):
        def get(self, url, params=None, headers=None, timeout=None):
            if "/danfse/" in url:
                self.pedidos.append((url, {}))
                return Resposta(404, {"Erros": [{"Codigo": "E404", "Descricao": "não encontrado"}]})
            return super().get(url, params, headers, timeout)

    docs = [(i, "NFSE", f"2507507{i:043d}", nota_xml(f"2507507{i:043d}", str(i), DONO, CLIENTE, "Cliente Um SA", 100.0 * i))
            for i in range(1, 7)]
    portal = SemPdf(docs)
    r = nfse.baixar_competencia(cliente(portal), contexto(), "2026-09", tmp_path / "d")
    pdfs = list((r.pasta / nfse.PASTA_EMITIDAS).glob("*.pdf"))
    assert len(pdfs) == 6 and all(p.read_bytes().startswith(b"%PDF") for p in pdfs)
    assert r.pdfs == 6 and r.pdfs_gerados == 6 and r.pdfs_faltando == 0
    assert sum("/danfse/" in p[0] for p in portal.pedidos) <= 4  # depois de 3 sem PDF, não pede mais ao portal


def test_historico_do_banco_pula_meses_consultados_inclusive_zero(chaves, cfg_nfse, tmp_path):
    import robo_xml
    t = {**tarefa(chaves, ["nfse_emitidas"]), "mei": True,
         "meses_consultados": ["2026-01", "2026-02", "2026-07"]}
    # Sem pastas locais, o banco continua sendo a referência: janeiro (zero) não é refeito.
    r = robo_xml.executar_nfse(cfg_nfse, t, chaves[0], sessao_falsa=PortalFalso(_docs_mei()))
    meses = {m["competencia"][:7]: m for m in r.detalhes["mei_nfse"]["meses"]}
    assert set(meses) == {"2026-03", "2026-04", "2026-05", "2026-06", "2026-08", "2026-09"}
    assert meses["2026-03"]["valor"] == 0 and meses["2026-03"]["quantidade"] == 0


def test_pasta_antiga_nao_comprova_consulta_no_banco(chaves, cfg_nfse, tmp_path):
    import robo_xml
    base = tmp_path / "destino" / "Arquivos baixados" / "7-Lotivisse"
    (base / "022026" / nfse.PASTA_EMITIDAS).mkdir(parents=True)
    t = {**tarefa(chaves, ["nfse_emitidas"]), "mei": True, "meses_consultados": []}
    r = robo_xml.executar_nfse(cfg_nfse, t, chaves[0], sessao_falsa=PortalFalso(_docs_mei()))
    meses = {m["competencia"][:7]: m for m in r.detalhes["mei_nfse"]["meses"]}
    assert len(meses) == 9 and meses["2026-02"]["valor"] == 300


def test_portal_busca_historico_no_escritorio_da_tarefa(monkeypatch):
    import robo_xml
    chamadas = []
    class RespostaJson:
        def __init__(self, dados): self.dados = dados
        def json(self): return self.dados
    def requisicao(metodo, caminho, **kw):
        chamadas.append((caminho, kw["params"]))
        return RespostaJson([{"org_id": ORG, "ie": DONO}] if caminho.endswith("xml_tarefas") else [{"competencia": "2026-01-01"}])
    portal = robo_xml.Portal("https://example.test", "sb_secret_teste")
    monkeypatch.setattr(portal, "_r", requisicao)
    assert portal.meses_nfse_consultados("tarefa-a", DONO, "2026-09-01", org_id=ORG) == ["2026-01"]
    assert chamadas[0][1]["id"] == "eq.tarefa-a"
    assert chamadas[1][1]["org_id"] == f"eq.{ORG}"
    assert chamadas[1][1]["cnpj"] == f"eq.{DONO}"


def test_falha_ao_ler_historico_nao_consulta_api_nem_grava_zero(monkeypatch):
    import robo_xml
    from types import SimpleNamespace
    finalizados = []
    def falhar(*args, **kwargs): raise RuntimeError("Banco indisponível")
    def nao_consultar(*args): raise AssertionError("Não deve consultar sem ler o histórico")
    monkeypatch.setattr(robo_xml, "executar_nfse", nao_consultar)
    def finalizar(t, resultado, *, reservada):
        assert reservada
        finalizados.append(resultado)
        return True
    portal = SimpleNamespace(atualizar_tarefa_reservada=lambda *a: True, meses_nfse_consultados=falhar)
    robo = SimpleNamespace(portal=portal, cfg={}, privada=None, _finalizar=finalizar)
    robo_xml.Robo._uma_nfse(robo, {"id":"t", "tentativa_id":"reserva", "org_id":ORG, "cnpj":DONO, "nome":"MEI",
                                  "data_inicio":"2026-09-01", "tipos":["nfse_emitidas"]})
    assert finalizados[0].status == "erro"
    assert "mei_nfse" not in finalizados[0].detalhes


def test_mei_pausado_nao_amplia_ano_por_indicacao_no_xml(chaves, cfg_nfse, tmp_path):
    """A decisão do escritório prevalece sobre a marcação antiga e sobre o XML."""
    import robo_xml
    t = {**tarefa(chaves, ["nfse_emitidas"]), "mei": True, "mei_bloqueado": True}
    r = robo_xml.executar_nfse(cfg_nfse, t, chaves[0], sessao_falsa=PortalFalso(_docs_mei()))
    base = pasta_empresa(cfg_nfse)
    assert (base / "092026").is_dir()
    assert not (base / "072026").exists() and not (base / "022026").exists()
    assert "meses anteriores" not in r.mensagem
