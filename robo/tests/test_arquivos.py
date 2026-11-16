import io
import zipfile
from pathlib import Path

import arquivos
import mei
import pytest
from armazenamento import ContextoArmazenamento, abrir_empresa
from util import IE_EMPRESA, IE_OUTRA, chave, cte, evento, evento_cte, nfe

EMPRESA = "11222333000181"
OUTRA = "45723174000110"
CTX = ContextoArmazenamento("portal", "7b245ed0-a8a0-4242-bcf0-24c8eb2895c6", "sefaz_pb", "ie", IE_EMPRESA, "Empresa", "7")


@pytest.fixture
def tmp_path(tmp_path_factory):
    return tmp_path_factory.mktemp("a")


@pytest.fixture
def pasta_validada(tmp_path):
    with abrir_empresa(tmp_path, CTX) as pasta:
        yield pasta


def _zip(itens: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for nome, dados in itens.items():
            z.writestr(nome, dados)
    return buf.getvalue()


def test_le_nfe():
    info = arquivos.ler_xml(nfe(EMPRESA, OUTRA, 7, ie_emit=IE_EMPRESA))
    assert info.chave == chave(EMPRESA, numero=7)
    assert (info.cnpj_emit, info.cnpj_dest, info.emissao, info.modelo, info.ie_emit) == \
        (EMPRESA, OUTRA, "2026-09-15", "55", IE_EMPRESA)


def test_rejeita_lixo():
    assert arquivos.ler_xml(b"<html>erro</html>") is None
    assert arquivos.ler_xml(b"nao e xml") is None


def test_extrai_zip_dentro_de_zip():
    interno = _zip({"b.xml": nfe(EMPRESA, OUTRA, 2)})
    externo = _zip({"a.xml": nfe(EMPRESA, OUTRA, 1), "lote2.zip": interno, "leiame.txt": b"oi"})
    assert sorted(n for n, _ in arquivos.extrair(externo, "x.zip")) == ["a.xml", "b.xml"]


def test_saida_organizada_e_separa_outra_empresa(pasta_validada):
    xmls = [("1.xml", nfe(EMPRESA, OUTRA, 1, ie_emit=IE_EMPRESA)),
            ("2.xml", nfe(EMPRESA, OUTRA, 2, ie_emit=IE_EMPRESA)),
            ("3.xml", nfe(OUTRA, EMPRESA, 3, ie_emit=IE_OUTRA)), ("ruim.bin", b"ilegivel")]
    alvo = arquivos.Alvo(IE_EMPRESA, EMPRESA, ["nfe_saida"])
    por, fora, conferir = arquivos.distribuir_por_empresa(xmls, [alvo])
    assert fora == [xmls[2]] and conferir == [xmls[3]]
    r = arquivos.salvar_originais(por[(IE_EMPRESA, "nfe_saida")], pasta_validada, alvo, "nfe_saida", "2026-09")
    assert r["novos"] == 2 and r["notas"] == 2
    assert len(list(Path(r["pasta"]).glob("*.xml"))) == 2
    r2 = arquivos.salvar_originais(por[(IE_EMPRESA, "nfe_saida")], pasta_validada, alvo, "nfe_saida", "2026-09")
    assert r2["novos"] == 0 and r2["repetidos"] == 2


def test_entrada_confere_destinatario_pela_ie_sem_cnpj(pasta_validada):
    alvo = arquivos.Alvo(IE_EMPRESA, "", ["nfe_entrada"])
    r = arquivos.salvar_originais([("x.xml", nfe(OUTRA, EMPRESA, 9, ie_dest=IE_EMPRESA))],
                                  pasta_validada, alvo, "nfe_entrada", "2026-09")
    assert r["novos"] == 1 and r["notas"] == 1
    assert list(Path(r["pasta"]).glob("*.xml"))


def test_nfce(pasta_validada):
    alvo = arquivos.Alvo(IE_EMPRESA, EMPRESA, ["nfce"])
    r = arquivos.salvar_originais([("c.xml", nfe(EMPRESA, "", 4, modelo="65", ie_emit=IE_EMPRESA))],
                                  pasta_validada, alvo, "nfce", "2026-09")
    assert r["novos"] == 1 and r["notas"] == 1
    assert list(Path(r["pasta"]).glob("*.xml"))


def test_evento_posterior_preservado_e_descontado_do_total(pasta_validada):
    alvo = arquivos.Alvo(IE_EMPRESA, EMPRESA, ["nfe_saida"])
    nota = nfe(EMPRESA, OUTRA, 1, ie_emit=IE_EMPRESA)
    arquivos.salvar_originais([("nota.xml", nota)], pasta_validada, alvo, "nfe_saida", "2026-09")
    cancelamento = evento(EMPRESA, chave(EMPRESA, numero=1))
    r = arquivos.salvar_originais([("evento.xml", cancelamento)], pasta_validada, alvo, "nfe_saida", "2026-09")
    assert r["novos"] == 1 and r["notas"] == 0 and r["valor"] == 0
    assert {p.read_bytes() for p in Path(r["pasta"]).glob("*.xml")} == {nota, cancelamento}


def test_distribuir_pelo_conteudo():
    """Uma nota da Padaria (IE_EMPRESA) para o Mercado (IE_OUTRA) vai para a saída de uma e a entrada
    da outra; NFC-e pelo modelo 65; evento segue a nota; XML de empresa fora da rodada é sobra."""
    venda = nfe(EMPRESA, OUTRA, 1, ie_emit=IE_EMPRESA, ie_dest=IE_OUTRA)
    cupom = nfe(OUTRA, "", 2, modelo="65", ie_emit=IE_OUTRA)
    estranha = nfe(OUTRA, OUTRA, 3, ie_emit="161112226")
    cancel = evento(EMPRESA, chave(EMPRESA, numero=1))
    alvos = [arquivos.Alvo(IE_EMPRESA, "", ["nfe_saida", "nfe_entrada"]), arquivos.Alvo(IE_OUTRA, "", ["nfe_entrada", "nfce"])]
    por, sobras = arquivos.distribuir([("v", venda), ("c", cupom), ("e", estranha), ("ev", cancel)], alvos)
    assert [n for n, _ in por[(IE_EMPRESA, "nfe_saida")]] == ["v", "ev"]
    assert [n for n, _ in por[(IE_OUTRA, "nfe_entrada")]] == ["v", "ev"]
    assert [n for n, _ in por[(IE_OUTRA, "nfce")]] == ["c"]
    assert (IE_EMPRESA, "nfe_entrada") not in por
    assert [n for n, _ in sobras] == ["e"]


def test_pasta_id_nome(tmp_path):
    assert arquivos.pasta_empresa(tmp_path, "joao", IE_EMPRESA, "5") == tmp_path / "Arquivos baixados" / "5-joao"
    assert arquivos.pasta_empresa(tmp_path, "joao", IE_EMPRESA).name == "joao"


def test_arquivo_que_nao_e_xml_nao_se_perde(tmp_path):
    salvos = arquivos.salvar_nao_identificados([("relatorio.pdf", b"%PDF-1.4 teste")], tmp_path)
    assert salvos[0].parent == tmp_path
    assert salvos[0].read_bytes() == b"%PDF-1.4 teste" and salvos[0].suffix == ".pdf"
    assert arquivos.tipo_de_arquivo(b"%PDF-1.4") == "PDF"


def test_gzip(tmp_path):
    import gzip
    assert [n for n, _ in arquivos.extrair(gzip.compress(nfe(EMPRESA, OUTRA, 1)), "nota.xml.gz")] == ["nota.xml"]


def test_zip_guardado_como_veio_e_total_no_nome_da_pasta(pasta_validada):
    zip1 = _zip({"a.xml": nfe(EMPRESA, OUTRA, 1, ie_emit=IE_EMPRESA, valor=1000.5),
                 "b.xml": nfe(EMPRESA, OUTRA, 2, ie_emit=IE_EMPRESA, valor=234.06),
                 "c.xml": nfe(EMPRESA, OUTRA, 3, ie_emit=IE_EMPRESA, valor=99999),
                 "cancel.xml": evento(EMPRESA, chave(EMPRESA, numero=3)).replace(b"<tpEvento>110111", b"<tpEvento>110111")})
    r = arquivos.salvar_originais([("Dados 2026.zip", zip1)], pasta_validada, arquivos.Alvo(IE_EMPRESA, EMPRESA, ["nfe_saida"]), "nfe_saida", "2026-09")
    pasta = pasta_validada / "092026" / "NF-e Saida - R$ 1.234,56"
    assert r["pasta"] == str(pasta) and (r["notas"], r["valor"]) == (2, 1234.56)  # a nota 3 foi cancelada
    (arquivo,) = list(pasta.iterdir())
    assert arquivo.name == "NF-e Saida 2026-09.zip" and arquivo.read_bytes() == zip1  # o ZIP intacto

    # rodar de novo não duplica; um ZIP novo soma no total e a pasta é renomeada
    assert arquivos.salvar_originais([("x.zip", zip1)], pasta_validada, arquivos.Alvo(IE_EMPRESA, EMPRESA, ["nfe_saida"]), "nfe_saida", "2026-09")["repetidos"] == 1
    zip2 = _zip({"d.xml": nfe(EMPRESA, OUTRA, 4, ie_emit=IE_EMPRESA, valor=10)})
    r = arquivos.salvar_originais([("y.zip", zip2)], pasta_validada, arquivos.Alvo(IE_EMPRESA, EMPRESA, ["nfe_saida"]), "nfe_saida", "2026-09")
    assert r["pasta"].endswith("NF-e Saida - R$ 1.244,56") and len(list(Path(r["pasta"]).iterdir())) == 2


def test_distribuir_arquivos_inteiros():
    venda = _zip({"v1.xml": nfe(EMPRESA, OUTRA, 1, ie_emit=IE_EMPRESA, ie_dest=IE_OUTRA),
                  "v2.xml": nfe(EMPRESA, "", 2, ie_emit=IE_EMPRESA)})
    alvos = [arquivos.Alvo(IE_EMPRESA, "", ["nfe_saida"]), arquivos.Alvo(IE_OUTRA, "", ["nfe_entrada"])]
    por, sem_empresa, nao = arquivos.distribuir_por_empresa([("z.zip", venda), ("r.pdf", b"%PDF")], alvos)
    assert set(por) == {(IE_EMPRESA, "nfe_saida"), (IE_OUTRA, "nfe_entrada")}
    assert por[(IE_EMPRESA, "nfe_saida")][0][1] == venda
    assert len(por[(IE_OUTRA, "nfe_entrada")]) == 1 and arquivos.ler_xml(por[(IE_OUTRA, "nfe_entrada")][0][1])
    assert not sem_empresa and [n for n, _ in nao] == ["r.pdf"]


def test_documento_pdf_na_pasta_do_servico(pasta_validada):
    pdf = b"%PDF-1.4\n% certidao\n%%EOF"
    r = arquivos.salvar_documentos([("Saida.pdf", pdf)], pasta_validada, "certidao", "2026-09")
    assert r["novos"] == 1
    arq = pasta_validada / "092026" / "Certidão de Débitos" / "Certidão de Débitos 2026-09.pdf"
    assert arq.read_bytes() == pdf
    # de novo: o mesmo arquivo não repete; um novo fica ao lado
    assert arquivos.salvar_documentos([("Saida.pdf", pdf)], pasta_validada, "certidao", "2026-09")["repetidos"] == 1
    arquivos.salvar_documentos([("Saida.pdf", pdf + b" ")], pasta_validada, "certidao", "2026-09")
    assert (arq.parent / "Certidão de Débitos 2026-09 (2).pdf").exists()


def test_cte_vai_para_a_destinataria_com_o_valor_da_prestacao():
    transportadora = "45723174000110"
    c1 = cte(transportadora, "11222333000181", 1, ie_dest=IE_EMPRESA, valor=120.5)
    c2 = cte(transportadora, "11222333000181", 2, ie_dest=IE_EMPRESA, valor=80.0)
    cancelado = evento_cte(transportadora, chave(transportadora, "2609", "57", 2))
    marcado = evento_cte(transportadora, chave(transportadora, "2609", "57", 1), "310610")  # MDF-e autorizado
    info = arquivos.ler_xml(c1)
    assert (info.modelo, info.ie_dest, info.valor) == ("57", IE_EMPRESA, 120.5)
    assert arquivos.ler_xml(cancelado).evento
    zip_ = io.BytesIO()
    with zipfile.ZipFile(zip_, "w") as z:
        for i, d in enumerate((c1, c2, cancelado, marcado)):
            z.writestr(f"{i}.xml", d)
    alvos = [arquivos.Alvo(IE_EMPRESA, "", ["cte_rem", "cte_dest"]), arquivos.Alvo(IE_OUTRA, "", ["cte_dest", "nfe_saida"])]
    por, sem, brutos = arquivos.distribuir_por_empresa([("CTe_XML.zip", zip_.getvalue())], alvos)
    assert list(por) == [(IE_EMPRESA, "cte_dest")] and not sem and not brutos
    # a mesma empresa como remetente vai para "CT-e Remetente"
    rem = cte("45723174000110", "", 3, cnpj_rem="11222333000181", ie_rem=IE_EMPRESA)
    assert list(arquivos.distribuir([("r.xml", rem)], alvos)[0]) == [(IE_EMPRESA, "cte_rem")]
    assert arquivos.expandir_tipos(["nfe_saida", "cte"]) == ["nfe_saida", "cte_rem", "cte_dest"]
    assert arquivos.valor_total(arquivos.extrair(zip_.getvalue())) == (1, 120.5)  # o 2 foi cancelado


REAL = [["Totais docs fiscais eletrônicos", "", "", "", ""],  # como no print do ATF (20/10/2026)
        ["Tipos de docs eletrônicos", "Qte. Entradas", "Entradas", "Qte. Saídas", "Saídas"],
        ["- NFEs:", "0", "0,00", "1", "0,00"], ["- NFAEs:", "0", "0,00", "0", "0,00"],
        ["- NFCEs:", "---", "---", "0", "0,00"], ["- NF Avulsa ATF:", "0", "0,00", "0", "0,00"],
        ["- BPe:", "---", "---", "0", "0,00"], ["TOTAIS", "", "0,00", "", "0,00"], ["- Cartão:", "---", "---", "0", "0,00"]]


def test_ler_docs_fiscais_como_no_atf():
    from atf_pb import ler_docs_fiscais
    d = ler_docs_fiscais(REAL)
    assert (d["entradas"], d["saidas"], d["qtd_saidas"], d["cartao"]) == (0.0, 0.0, 1, {"qtd": 0, "valor": 0.0})
    assert [i["tipo"] for i in d["itens"]] == ["NFEs", "NFAEs", "NFCEs", "NF Avulsa ATF", "BPe"]  # todas, mesmo zeradas
    assert d["itens"][2] == {"tipo": "NFCEs", "qtd_entradas": None, "entradas": None, "qtd_saidas": 0, "saidas": 0.0}
    assert not d["sem_movimento"]  # 1 NF-e de saída (mesmo com valor 0,00) é movimento
    zerado = [linha if linha[0] != "- NFEs:" else ["- NFEs:", "0", "0,00", "0", "0,00"] for linha in REAL]
    assert ler_docs_fiscais(zerado)["sem_movimento"]
    com_valor = [["Tipos de docs eletrônicos", "Qte. Entradas", "Entradas", "Qte. Saídas", "Saídas"],
                 ["- NFEs:", "2", "1.000,00", "3", "3.000,50"], ["- NFCEs:", "---", "---", "9", "1.200,00"],
                 ["TOTAIS", "", "1.000,00", "", "4.200,50"], ["- Cartão:", "---", "---", "4", "13.585,00"]]
    d = ler_docs_fiscais(com_valor)
    assert (d["entradas"], d["saidas"], d["cartao"]["valor"]) == (1000.0, 4200.5, 13585.0)  # cartão fora da soma
    assert ler_docs_fiscais([["outra tabela", "1,00"]])["entradas"] is None


def test_faturamento_mei_acumula_os_meses(tmp_path):
    import json
    from atf_pb import ler_docs_fiscais
    com_valor = [["Tipos de docs eletrônicos", "Qte. Entradas", "Entradas", "Qte. Saídas", "Saídas"],
                 ["- NFEs:", "1", "10,00", "5", "30.000,00"], ["TOTAIS", "", "10,00", "", "30.000,00"]]
    com_valor.append(["- Cartão:", "---", "---", "3", "2.000,00"])
    for mes, linhas in (("2026-08", com_valor), ("2026-09", REAL)):
        r = mei.salvar(tmp_path, CTX, mes, ler_docs_fiscais(linhas))
    assert (r["notas_acumulado"], r["notas_percentual"]) == (30000.0, 37.0)  # notas e cartão separados
    assert (r["cartao_acumulado"], r["cartao_percentual"]) == (2000.0, 2.5)
    pasta = Path(r["pasta"])
    dados = json.loads((pasta / "Faturamento MEI 2026.json").read_text(encoding="utf-8"))
    assert sorted(dados["meses"]) == ["2026-08", "2026-09"] and len(dados["meses"]["2026-09"]["itens"]) == 5
    from openpyxl import load_workbook
    wb = load_workbook(pasta / "Faturamento MEI 2026.xlsx")
    assert [c.value for c in wb.worksheets[0][2]][:3] == ["2026-08", "com movimento", 30000.0]
    assert [c.value for c in wb.worksheets[0][3]][8:12] == [0.0, 0, 2000.0, 0.0247]  # setembro: cartão zerado
    assert [c.value for c in wb["Por documento"][4]][:2] == ["2026-09", "NFEs"]


def test_meses_que_faltam_e_limite_proporcional(tmp_path):
    from datetime import date
    assert [p[0].month for p in mei.periodos(tmp_path, CTX, date(2026, 4, 1))] == [1, 2, 3]
    mei.salvar(tmp_path, CTX, "2026-02", {"saidas": 1.0, "entradas": 0, "qtd_saidas": 1, "qtd_entradas": 0, "sem_movimento": False, "itens": []})
    assert [p[0].month for p in mei.periodos(tmp_path, CTX, date(2026, 4, 1))] == [1, 3]
    assert len(mei.periodos(tmp_path, CTX, date(2026, 4, 1), refazer_ano=True)) == 3
    assert mei.periodos(tmp_path, CTX, date(2026, 1, 1)) == []
    assert arquivos.limite_mei(2026, None) == 81000.0
    assert arquivos.limite_mei(2026, "2026-03-10") == 67500.0  # março a dezembro: 10 x 6.750
    assert arquivos.limite_mei(2026, "2010-05-14") == 81000.0


def test_historicos_mei_para_o_painel(tmp_path):
    """O que já está salvo no PC vai para o painel: um item por empresa/ano, sem a tabela bruta."""
    for mes, saidas in (("2026-08", 1000.0), ("2026-09", 2500.5)):
        mei.salvar(tmp_path, CTX, mes,
                                        {"saidas": saidas, "entradas": 300.0, "cartao": {"qtd": 2, "valor": 90.0},
                                         "qtd_saidas": 1, "qtd_entradas": 1,
                                         "sem_movimento": False, "linhas": [["NFEs", "1"]], "inicio_atividade": "2026-03-10"})
    (h,) = mei.historicos_portal(tmp_path)
    assert h["ie"] == IE_EMPRESA and h["org_id"] == CTX.contexto_id and h["inicio_atividade"] == "2026-03-10"
    assert sorted(h["meses"]) == ["2026-08", "2026-09"] and h["meses"]["2026-09"]["saidas"] == 2500.5
    assert all("linhas" not in m for m in h["meses"].values())
    assert list(mei.historicos_portal(tmp_path / "vazio")) == []


def test_pasta_por_escritorio_e_historico_mei_dentro_dela(tmp_path):
    import json
    destino = arquivos.destino_do_escritorio(tmp_path, "Contábil Sousa / Filial", True)
    assert destino == str(tmp_path / "Contábil Sousa Filial")  # caractere proibido no Windows sai
    assert arquivos.destino_do_escritorio(tmp_path, "Contábil Sousa", False) == str(tmp_path)  # computador: como antes
    assert arquivos.destino_do_escritorio(tmp_path, "", True) == str(tmp_path)  # portal antigo sem o escritório
    for raiz in (tmp_path, tmp_path / "Contábil Sousa"):  # MEI salvo antes (sem escritório) e depois (com)
        pasta = raiz / arquivos.PASTA_BAIXADOS / "5-Joao" / "Dossiê MEI"
        pasta.mkdir(parents=True)
        (pasta / "Faturamento MEI 2026.json").write_text(json.dumps(
            {"empresa": {"ie": "16" + str(len(str(raiz))).zfill(7), "nome": "Joao"}, "meses": {"2026-01": {"saidas": 1}}}),
            encoding="utf-8")
    assert list(mei.historicos_portal(tmp_path)) == []  # dados sem identidade não são reenviados


def test_pdf_de_cada_nota_do_atf(pasta_validada):
    """NF-e, NFC-e e CT-e baixados do ATF ganham o PDF (DANFE, DANFC-e, DACTE) em <tipo>/PDF/<chave>.pdf;
    nota cancelada fica sem PDF; rodar de novo não refaz."""
    import xml_completo as xc
    cancelada = xc.chave("55", 2)
    pacote = _zip({"1.xml": xc.nfe("55", 1), "2.xml": xc.nfe("55", 2),
                   "c.xml": evento(EMPRESA, cancelada), "3.xml": xc.nfe("65", 3), "4.xml": xc.cte(4)})
    alvo = arquivos.Alvo(IE_EMPRESA, EMPRESA, ["nfe_saida", "nfce", "cte_rem"])
    por, _, conferir = arquivos.distribuir_por_empresa([("Dados.zip", pacote)], [alvo])
    assert conferir == [("Dados.zip", pacote)]
    for tipo, chave_pdf in (("nfe_saida", xc.chave("55", 1)), ("nfce", xc.chave("65", 3)), ("cte_rem", xc.chave("57", 4))):
        r = arquivos.salvar_originais(por[(IE_EMPRESA, tipo)], pasta_validada, alvo, tipo, "2026-11")
        pdfs = Path(r["pasta"]) / arquivos.PASTA_PDF
        assert r["pdfs"] == 1 and {p.name for p in pdfs.iterdir()} == {f"{chave_pdf}.pdf"}
        assert all(p.read_bytes().startswith(b"%PDF") for p in pdfs.iterdir())
        assert arquivos.salvar_originais(por[(IE_EMPRESA, tipo)], pasta_validada, alvo, tipo, "2026-11")["pdfs"] == 0


def test_sem_pdf_quando_desligado(pasta_validada, monkeypatch):
    import xml_completo as xc
    monkeypatch.setattr(arquivos, "GERAR_PDF", False)
    r = arquivos.salvar_originais([("a.xml", xc.nfe("55", 1))], pasta_validada, arquivos.Alvo(IE_EMPRESA, EMPRESA, ["nfe_saida"]), "nfe_saida", "2026-11")
    assert r["pdfs"] == 0 and not (Path(r["pasta"]) / arquivos.PASTA_PDF).exists()


def test_cte_com_nfe_transportada_continua_sendo_cte():
    import xml_completo as xc
    info = arquivos.ler_xml(xc.cte(4))
    assert info and info.modelo == "57" and info.chave == xc.chave("57", 4) and info.valor == 80.0


def test_danfe_com_rodape_da_lotivisse():
    import pdf_fiscal
    import xml_completo as xc
    pdf = pdf_fiscal.gerar(xc.nfe("55", 1), rodape=pdf_fiscal.RODAPE_MONITOR)
    sem = pdf_fiscal.gerar(xc.nfe("55", 1), rodape="")
    assert pdf.startswith(b"%PDF") and len(pdf) > len(sem)  # o rodapé (texto e símbolo) entra no PDF
    assert pdf_fiscal.simbolo_png().startswith(b"\x89PNG")
