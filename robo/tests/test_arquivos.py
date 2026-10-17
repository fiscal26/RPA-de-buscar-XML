import io
import zipfile

import arquivos
from util import chave, evento, nfe

EMPRESA = "11222333000181"
OUTRA = "45723174000110"


def _zip(itens: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for nome, dados in itens.items():
            z.writestr(nome, dados)
    return buf.getvalue()


def test_le_nfe():
    info = arquivos.ler_xml(nfe(EMPRESA, OUTRA, 7))
    assert info.chave == chave(EMPRESA, numero=7)
    assert (info.cnpj_emit, info.cnpj_dest, info.emissao, info.modelo) == (EMPRESA, OUTRA, "2026-09-15", "55")


def test_rejeita_lixo():
    assert arquivos.ler_xml(b"<html>erro</html>") is None
    assert arquivos.ler_xml(b"nao e xml") is None


def test_extrai_zip_dentro_de_zip():
    interno = _zip({"b.xml": nfe(EMPRESA, OUTRA, 2)})
    externo = _zip({"a.xml": nfe(EMPRESA, OUTRA, 1), "lote2.zip": interno, "leiame.txt": b"oi"})
    nomes = [n for n, _ in arquivos.extrair(externo, "x.zip")]
    assert sorted(nomes) == ["a.xml", "b.xml"]


def test_salva_organizado_e_separa_outro_cnpj(tmp_path):
    xmls = [("1.xml", nfe(EMPRESA, OUTRA, 1)), ("2.xml", nfe(EMPRESA, OUTRA, 2, "2026-10-01")),
            ("3.xml", nfe(OUTRA, EMPRESA, 3)), ("ruim.xml", b"<a/>")]
    r = arquivos.salvar(xmls, tmp_path, "Padaria: Centro", EMPRESA, "nfe_emitidas")
    base = tmp_path / "Padaria Centro - 11.222.333-0001-81"
    assert (base / "2026-09" / "NF-e Emitidas" / f"{chave(EMPRESA, numero=1)}.xml").exists()
    assert (base / "2026-10" / "NF-e Emitidas" / f"{chave(EMPRESA, '2610', numero=2)}.xml").exists()
    assert len(list((base / "_conferir").iterdir())) == 1
    assert (r.salvos, r.conferir, r.invalidos) == (2, 1, 1)

    # rodar de novo não duplica
    r2 = arquivos.salvar(xmls, tmp_path, "Padaria: Centro", EMPRESA, "nfe_emitidas")
    assert (r2.salvos, r2.repetidos) == (0, 2)


def test_recebidas_confere_destinatario(tmp_path):
    r = arquivos.salvar([("x.xml", nfe(OUTRA, EMPRESA, 9))], tmp_path, "Loja", EMPRESA, "nfe_recebidas")
    assert r.salvos == 1 and r.conferir == 0


def test_evento_vai_para_subpasta(tmp_path):
    ch = chave(EMPRESA, numero=1)
    r = arquivos.salvar([("ev.xml", evento(EMPRESA, ch))], tmp_path, "Loja", EMPRESA, "nfe_emitidas")
    assert r.salvos == 1
    assert list(tmp_path.glob("*/2026-09/NF-e Emitidas/Eventos/*.xml"))
