import io
import zipfile

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
    base = tmp_path / "015 - Padaria Centro"
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
    assert list(tmp_path.glob("Loja - IE 16.012.345-3/2026-09/NF-e Entrada/*.xml"))


def test_nfce(tmp_path):
    r = arquivos.salvar([("c.xml", nfe(EMPRESA, "", 4, modelo="65", ie_emit=IE_EMPRESA))], tmp_path, "Loja",
                        IE_EMPRESA, EMPRESA, "nfce")
    assert r.salvos == 1 and list(tmp_path.glob("*/2026-09/NFC-e/*.xml"))


def test_evento_vai_para_subpasta(tmp_path):
    ch = chave(EMPRESA, numero=1)
    r = arquivos.salvar([("ev.xml", evento(EMPRESA, ch))], tmp_path, "Loja", IE_EMPRESA, EMPRESA, "nfe_saida")
    assert r.salvos == 1
    assert list(tmp_path.glob("*/2026-09/NF-e Saida/Eventos/*.xml"))
