"""XML baixados: abre ZIP, lê cada documento, confere se é da empresa e salva organizado.

Pasta final:  <destino>/<Apelido> - <CNPJ>/<AAAA-MM>/<Tipo>/<chave>.xml
O mês é o da emissão de cada nota (não o do pedido). XML que não é da empresa consultada
(CNPJ do emitente/destinatário diferente) vai para a subpasta "_conferir", nunca para a de outra.
"""
from __future__ import annotations

import io
import re
import unicodedata
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from xml.etree import ElementTree as ET

from planilha import formatar_cnpj

TIPOS = {
    "nfe_emitidas": "NF-e Emitidas",
    "nfe_recebidas": "NF-e Recebidas",
    "nfce_emitidas": "NFC-e Emitidas",
}
_MAX_ARQUIVOS_ZIP = 50_000
_MAX_TAMANHO_XML = 20 * 1024 * 1024


@dataclass
class InfoXml:
    chave: str = ""
    modelo: str = ""          # 55 = NF-e, 65 = NFC-e
    cnpj_emit: str = ""
    cnpj_dest: str = ""
    emissao: str = ""          # aaaa-mm-dd
    evento: bool = False       # cancelamento, carta de correção etc.


@dataclass
class Resumo:
    salvos: int = 0
    repetidos: int = 0
    conferir: int = 0
    invalidos: int = 0
    pastas: set[str] = field(default_factory=set)

    @property
    def total(self) -> int:
        return self.salvos + self.repetidos

    def somar(self, outro: "Resumo"):
        self.salvos += outro.salvos
        self.repetidos += outro.repetidos
        self.conferir += outro.conferir
        self.invalidos += outro.invalidos
        self.pastas |= outro.pastas


def extrair(dados: bytes, nome: str = "") -> list[tuple[str, bytes]]:
    """Devolve (nome, conteúdo) de cada XML, abrindo ZIP (inclusive ZIP dentro de ZIP)."""
    if dados[:4] == b"PK\x03\x04":
        saida: list[tuple[str, bytes]] = []
        with zipfile.ZipFile(io.BytesIO(dados)) as z:
            for i, item in enumerate(z.infolist()):
                if i >= _MAX_ARQUIVOS_ZIP:
                    break
                if item.is_dir() or item.file_size > _MAX_TAMANHO_XML * 5:
                    continue
                conteudo = z.read(item)
                saida.extend(extrair(conteudo, item.filename))
        return saida
    if _parece_xml(dados):
        return [(Path(nome).name or "documento.xml", dados)]
    return []


def _parece_xml(dados: bytes) -> bool:
    inicio = dados[:200].lstrip(b"\xef\xbb\xbf \r\n\t")
    return inicio.startswith(b"<")


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def ler_xml(dados: bytes) -> InfoXml | None:
    """Lê os dados que importam de uma NF-e/NFC-e (nfeProc, NFe) ou evento (procEventoNFe)."""
    if len(dados) > _MAX_TAMANHO_XML:
        return None
    try:
        raiz = ET.fromstring(dados)
    except ET.ParseError:
        return None
    info = InfoXml()
    nomes = {_local(e.tag): e for e in raiz.iter()}  # primeira ocorrência basta para estes campos
    raiz_nome = _local(raiz.tag)

    if "infNFe" in nomes:
        inf = nomes["infNFe"]
        info.chave = re.sub(r"\D", "", inf.get("Id", ""))
        ide = _filho(inf, "ide")
        info.modelo = _texto(ide, "mod")
        info.emissao = (_texto(ide, "dhEmi") or _texto(ide, "dEmi"))[:10]
        info.cnpj_emit = _texto(_filho(inf, "emit"), "CNPJ") or _texto(_filho(inf, "emit"), "CPF")
        dest = _filho(inf, "dest")
        info.cnpj_dest = _texto(dest, "CNPJ") or _texto(dest, "CPF")
    elif "infEvento" in nomes or raiz_nome in ("procEventoNFe", "evento"):
        inf = nomes.get("infEvento")
        info.evento = True
        info.chave = _texto(inf, "chNFe")
        info.cnpj_emit = _texto(inf, "CNPJ") or _texto(inf, "CPF")
        info.emissao = _texto(inf, "dhEvento")[:10]
        info.modelo = info.chave[20:22] if len(info.chave) == 44 else ""
    else:
        return None
    if not re.fullmatch(r"\d{44}", info.chave or ""):
        return None
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", info.emissao):
        # sem data legível: usa ano e mês da própria chave (posições 3 a 6 = AAMM)
        info.emissao = f"20{info.chave[2:4]}-{info.chave[4:6]}-01"
    return info


def _filho(elem, nome):
    if elem is None:
        return None
    for e in elem:
        if _local(e.tag) == nome:
            return e
    return None


def _texto(elem, nome) -> str:
    e = _filho(elem, nome)
    return (e.text or "").strip() if e is not None and e.text else ""


def nome_de_pasta(texto: str) -> str:
    texto = unicodedata.normalize("NFKC", texto).strip()
    texto = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', " ", texto)  # caracteres proibidos no Windows
    return re.sub(r"\s+", " ", texto).strip(" .")[:60] or "Empresa"


def pasta_empresa(destino: str | Path, apelido: str, cnpj: str) -> Path:
    # sem a barra do CNPJ (o Windows não aceita) e sem pontos no fim
    doc = formatar_cnpj(cnpj).replace("/", "-")
    return Path(destino) / f"{nome_de_pasta(apelido)} - {doc}"


def pertence(info: InfoXml, cnpj: str, tipo: str) -> bool:
    """O XML é da empresa? Emitidas: ela é a emitente. Recebidas: ela é a destinatária.
    Evento de nota recebida pode vir do emitente: confere pela chave (CNPJ nas posições 7 a 20)."""
    if tipo.endswith("_emitidas"):
        return info.cnpj_emit == cnpj or info.chave[6:20] == cnpj
    if info.evento:
        return info.cnpj_emit == cnpj or info.chave[6:20] != cnpj
    return info.cnpj_dest == cnpj


def salvar(arquivos: list[tuple[str, bytes]], destino: str | Path, apelido: str, cnpj: str, tipo: str) -> Resumo:
    resumo = Resumo()
    base = pasta_empresa(destino, apelido, cnpj)
    nome_tipo = TIPOS.get(tipo, tipo)
    for nome, dados in arquivos:
        info = ler_xml(dados)
        if not info:
            resumo.invalidos += 1
            continue
        mes = info.emissao[:7]
        pasta = base / mes / nome_tipo
        conferir = not pertence(info, cnpj, tipo)
        if conferir:
            pasta = base / "_conferir"
        if info.evento:
            pasta = pasta / "Eventos"
        arquivo = pasta / (f"{info.chave}-evento-{_sufixo(nome)}.xml" if info.evento else f"{info.chave}.xml")
        resumo.pastas.add(str(base))
        repetido = arquivo.exists() and arquivo.read_bytes() == dados
        if not repetido:
            pasta.mkdir(parents=True, exist_ok=True)
            arquivo.write_bytes(dados)
        if conferir:
            resumo.conferir += 1  # conta sempre: o portal avisa que há XML de outro CNPJ
        elif repetido:
            resumo.repetidos += 1
        else:
            resumo.salvos += 1
    return resumo


def _sufixo(nome: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "", Path(nome).stem)[-20:] or "1"
