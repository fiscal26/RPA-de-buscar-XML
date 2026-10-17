import io
import zipfile
from pathlib import Path

import arquivos
from util import IE_EMPRESA, IE_OUTRA, chave, evento, nfe

EMPRESA = "11222333000181"
OUTRA = "45723174000110"


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


def test_saida_organizada_e_separa_outra_empresa(tmp_path):
    xmls = [("1.xml", nfe(EMPRESA, OUTRA, 1, ie_emit=IE_EMPRESA)),
            ("2.xml", nfe(EMPRESA, OUTRA, 2, "2026-10-01", ie_emit=IE_EMPRESA)),
            ("3.xml", nfe(OUTRA, EMPRESA, 3, ie_emit=IE_OUTRA)), ("ruim.xml", b"<a/>")]
    r = arquivos.salvar(xmls, tmp_path, "Padaria: Centro", IE_EMPRESA, EMPRESA, "nfe_saida", codigo="015")
    base = tmp_path / "Arquivos baixados" / "015-Padaria Centro"
    assert (base / "2026-09" / "NF-e Saida" / f"{chave(EMPRESA, numero=1)}.xml").exists()
    assert (base / "2026-10" / "NF-e Saida" / f"{chave(EMPRESA, '2610', numero=2)}.xml").exists()
    assert len(list((base / "_conferir").iterdir())) == 1
    assert (r.salvos, r.conferir, r.invalidos) == (2, 1, 1)

    r2 = arquivos.salvar(xmls, tmp_path, "Padaria: Centro", IE_EMPRESA, EMPRESA, "nfe_saida", codigo="015")
    assert (r2.salvos, r2.repetidos) == (0, 2)  # rodar de novo não duplica


def test_entrada_confere_destinatario_pela_ie_sem_cnpj(tmp_path):
    r = arquivos.salvar([("x.xml", nfe(OUTRA, EMPRESA, 9, ie_dest=IE_EMPRESA))], tmp_path, "Loja", IE_EMPRESA, "",
                        "nfe_entrada")
    assert r.salvos == 1 and r.conferir == 0
    assert list(tmp_path.glob("Arquivos baixados/Loja/2026-09/NF-e Entrada/*.xml"))


def test_nfce(tmp_path):
    r = arquivos.salvar([("c.xml", nfe(EMPRESA, "", 4, modelo="65", ie_emit=IE_EMPRESA))], tmp_path, "Loja",
                        IE_EMPRESA, EMPRESA, "nfce")
    assert r.salvos == 1 and list(tmp_path.glob("Arquivos baixados/*/2026-09/NFC-e/*.xml"))


def test_evento_vai_para_subpasta(tmp_path):
    ch = chave(EMPRESA, numero=1)
    r = arquivos.salvar([("ev.xml", evento(EMPRESA, ch))], tmp_path, "Loja", IE_EMPRESA, EMPRESA, "nfe_saida")
    assert r.salvos == 1
    assert list(tmp_path.glob("Arquivos baixados/*/2026-09/NF-e Saida/Eventos/*.xml"))


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
    assert salvos[0].parent == tmp_path / "Arquivos baixados" / "_nao_identificados"
    assert salvos[0].read_bytes() == b"%PDF-1.4 teste" and salvos[0].suffix == ".pdf"
    assert arquivos.tipo_de_arquivo(b"%PDF-1.4") == "PDF"


def test_gzip(tmp_path):
    import gzip
    assert [n for n, _ in arquivos.extrair(gzip.compress(nfe(EMPRESA, OUTRA, 1)), "nota.xml.gz")] == ["nota.xml"]


def test_zip_guardado_como_veio_e_total_no_nome_da_pasta(tmp_path):
    zip1 = _zip({"a.xml": nfe(EMPRESA, OUTRA, 1, ie_emit=IE_EMPRESA, valor=1000.5),
                 "b.xml": nfe(EMPRESA, OUTRA, 2, ie_emit=IE_EMPRESA, valor=234.06),
                 "c.xml": nfe(EMPRESA, OUTRA, 3, ie_emit=IE_EMPRESA, valor=99999),
                 "cancel.xml": evento(EMPRESA, chave(EMPRESA, numero=3)).replace(b"<tpEvento>110111", b"<tpEvento>110111")})
    r = arquivos.salvar_originais([("Dados 2026.zip", zip1)], tmp_path, "joao", IE_EMPRESA, "nfe_saida", "2026-09", "5")
    pasta = tmp_path / "Arquivos baixados" / "5-joao" / "2026-09" / "NF-e Saida - R$ 1.234,56"
    assert r["pasta"] == str(pasta) and (r["notas"], r["valor"]) == (2, 1234.56)  # a nota 3 foi cancelada
    (arquivo,) = list(pasta.iterdir())
    assert arquivo.name == "NF-e Saida 2026-09.zip" and arquivo.read_bytes() == zip1  # o ZIP intacto

    # rodar de novo não duplica; um ZIP novo soma no total e a pasta é renomeada
    assert arquivos.salvar_originais([("x.zip", zip1)], tmp_path, "joao", IE_EMPRESA, "nfe_saida", "2026-09", "5")["repetidos"] == 1
    zip2 = _zip({"d.xml": nfe(EMPRESA, OUTRA, 4, ie_emit=IE_EMPRESA, valor=10)})
    r = arquivos.salvar_originais([("y.zip", zip2)], tmp_path, "joao", IE_EMPRESA, "nfe_saida", "2026-09", "5")
    assert r["pasta"].endswith("NF-e Saida - R$ 1.244,56") and len(list(Path(r["pasta"]).iterdir())) == 2


def test_distribuir_arquivos_inteiros():
    venda = _zip({"v1.xml": nfe(EMPRESA, OUTRA, 1, ie_emit=IE_EMPRESA, ie_dest=IE_OUTRA),
                  "v2.xml": nfe(EMPRESA, "", 2, ie_emit=IE_EMPRESA)})
    alvos = [arquivos.Alvo(IE_EMPRESA, "", ["nfe_saida"]), arquivos.Alvo(IE_OUTRA, "", ["nfe_entrada"])]
    por, sem_empresa, nao = arquivos.distribuir_arquivos([("z.zip", venda), ("r.pdf", b"%PDF")], alvos)
    assert list(por) == [(IE_EMPRESA, "nfe_saida")] and por[(IE_EMPRESA, "nfe_saida")][0][1] == venda
    assert not sem_empresa and [n for n, _ in nao] == ["r.pdf"]
