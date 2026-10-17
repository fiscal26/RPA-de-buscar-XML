"""XML baixados: abre ZIP, lê cada documento, confere se é da empresa e salva organizado.

Pasta final:  <destino>/<ID> - <Nome fantasia>/<AAAA-MM>/<NF-e Saida | NF-e Entrada | NFC-e>/<chave>.xml
(sem ID na planilha: <Nome fantasia> - IE <inscrição>). O mês é o da emissão de cada nota.
XML que não é da empresa consultada (IE/CNPJ do emitente ou destinatário diferente) vai para a
subpasta "_conferir", nunca para a de outra empresa.
"""
from __future__ import annotations

import io
import re
import unicodedata
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from xml.etree import ElementTree as ET

from planilha import formatar_ie

# os mesmos nomes das colunas da planilha modelo
TIPOS = {
    "nfe_saida": "NF-e Saida",
    "nfe_entrada": "NF-e Entrada",
    "nfce": "NFC-e",
}
_MAX_ARQUIVOS_ZIP = 50_000
_MAX_TAMANHO_XML = 20 * 1024 * 1024


@dataclass
class InfoXml:
    chave: str = ""
    modelo: str = ""          # 55 = NF-e, 65 = NFC-e
    cnpj_emit: str = ""
    cnpj_dest: str = ""
    ie_emit: str = ""
    ie_dest: str = ""
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
        emit, dest = _filho(inf, "emit"), _filho(inf, "dest")
        info.cnpj_emit = _texto(emit, "CNPJ") or _texto(emit, "CPF")
        info.cnpj_dest = _texto(dest, "CNPJ") or _texto(dest, "CPF")
        info.ie_emit = re.sub(r"\D", "", _texto(emit, "IE"))
        info.ie_dest = re.sub(r"\D", "", _texto(dest, "IE"))
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


def pasta_empresa(destino: str | Path, nome: str, ie: str, codigo: str = "") -> Path:
    if codigo:
        return Path(destino) / nome_de_pasta(f"{codigo} - {nome}")
    return Path(destino) / f"{nome_de_pasta(nome)} - IE {formatar_ie(ie)}"


def _mesmo_ie(a: str, b: str) -> bool:
    return bool(a) and bool(b) and a.lstrip("0") == b.lstrip("0")


def pertence(info: InfoXml, ie: str, cnpj: str, tipo: str) -> bool:
    """O XML é da empresa? Saída/NFC-e: ela é a emitente. Entrada: ela é a destinatária.
    Confere pela IE e, se houver, pelo CNPJ. Evento só traz o autor e a chave (CNPJ do emitente
    nas posições 7 a 20)."""
    emitente_chave = info.chave[6:20]
    if tipo != "nfe_entrada":
        if info.evento:
            return not cnpj or cnpj in (info.cnpj_emit, emitente_chave)
        return _mesmo_ie(info.ie_emit, ie) or (bool(cnpj) and cnpj in (info.cnpj_emit, emitente_chave))
    if info.evento:
        return not cnpj or info.cnpj_emit == cnpj or emitente_chave != cnpj
    return _mesmo_ie(info.ie_dest, ie) or (bool(cnpj) and info.cnpj_dest == cnpj)


def salvar(arquivos: list[tuple[str, bytes]], destino: str | Path, nome: str, ie: str, cnpj: str, tipo: str,
           codigo: str = "") -> Resumo:
    resumo = Resumo()
    base = pasta_empresa(destino, nome, ie, codigo)
    nome_tipo = TIPOS.get(tipo, tipo)
    for nome, dados in arquivos:
        info = ler_xml(dados)
        if not info:
            resumo.invalidos += 1
            continue
        mes = info.emissao[:7]
        pasta = base / mes / nome_tipo
        conferir = not pertence(info, ie, cnpj, tipo)
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
