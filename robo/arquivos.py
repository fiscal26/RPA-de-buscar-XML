"""Distribuição e publicação dos documentos fiscais do ATF por empresa e tipo.

O chamador fornece a pasta validada e mantém a trava da identidade durante a escrita.
ZIPs mistos são separados pelo conteúdo; totais e PDFs usam apenas notas do alvo.
A resolução anterior de pasta/competência continua somente para o Monitor Fiscal,
que será integrado em sua própria etapa.
"""
from __future__ import annotations

import io
import hashlib
import re
import unicodedata
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from armazenamento import (arquivo_validado, criar_subpasta_validada, pasta_da_competencia,
                           publicar_arquivo, renomear_subpasta_validada)
from xml.etree import ElementTree as ET

from planilha import formatar_ie

# os mesmos nomes das colunas da planilha modelo
TIPOS = {
    "nfe_saida": "NF-e Saida",
    "nfe_entrada": "NF-e Entrada",
    "nfce": "NFC-e",
    "cte_rem": "CT-e Remetente",
    "cte_dest": "CT-e Destinatario",
    "faturas": "Faturas",
    "extrato": "Extrato de Pagamentos",
    "omissao": "Omissão e Inadimplência",
    "certidao": "Certidão de Débitos",
    "cartao": "Conferência Cartão de Crédito",
    "mei": "Dossiê MEI",
}
# Limite anual de receita bruta do MEI (LC 123/2006, art. 18-A, § 1º)
LIMITE_MEI = 81_000.00
# coluna da planilha que vira mais de uma consulta (CT-e: a empresa como remetente e como destinatária)
SUBTIPOS = {"cte": ("cte_rem", "cte_dest")}


def expandir_tipos(tipos: list[str]) -> list[str]:
    return [sub for t in tipos for sub in SUBTIPOS.get(t, (t,))]


# serviços que o ATF responde na hora com PDF (ou ZIP): o arquivo vai direto para a empresa
SERVICOS_DOCUMENTO = ("faturas", "extrato", "omissao", "certidao", "cartao")
PASTA_BAIXADOS = "Arquivos baixados"
# Nome da pasta da competência: "MMAAAA" (102026, o caminho que a importação automática da Domínio lê) ou "AAAA-MM"
FORMATO_COMPETENCIA = "MMAAAA"
# PDF de cada nota (DANFE, DANFC-e, DACTE) gerado do XML, em <tipo>/PDF/<chave>.pdf ("pastas" > "pdf_das_notas")
GERAR_PDF = True
PASTA_PDF = "PDF"


def pasta_competencia(competencia: str) -> str:
    """Nome da pasta do mês a partir de "AAAA-MM" (ou de uma data "AAAA-MM-DD"): 102026 ou 2026-10."""
    ano, mes = competencia[:4], competencia[5:7]
    return f"{mes}{ano}" if FORMATO_COMPETENCIA == "MMAAAA" else f"{ano}-{mes}"
_MAX_ARQUIVOS_ZIP = 50_000
_MAX_TAMANHO_XML = 20 * 1024 * 1024


@dataclass
class InfoXml:
    chave: str = ""
    modelo: str = ""          # 55 = NF-e, 65 = NFC-e, 57 = CT-e
    cnpj_emit: str = ""
    cnpj_dest: str = ""
    ie_emit: str = ""
    ie_dest: str = ""
    cnpj_rem: str = ""         # CT-e: remetente
    ie_rem: str = ""
    emissao: str = ""          # aaaa-mm-dd
    evento: bool = False       # cancelamento, carta de correção etc.
    tipo_evento: str = ""      # 110111 = cancelamento
    valor: float = 0.0         # vNF (valor total da nota)
    situacao: str = ""         # cStat da autorização (100 = autorizada)
    partes: list = field(default_factory=list)  # CT-e: (CNPJ, IE) de remetente, destinatário, tomador...


def extrair(dados: bytes, nome: str = "", *, incompletos: list | None = None) -> list[tuple[str, bytes]]:
    """Devolve (nome, conteúdo) de cada XML, abrindo ZIP (inclusive ZIP dentro de ZIP) e GZIP."""
    if dados[:2] == b"\x1f\x8b":
        import gzip
        try:
            return extrair(gzip.decompress(dados), Path(nome).stem, incompletos=incompletos)
        except Exception:
            if incompletos is not None:
                incompletos.append(True)
            return []
    if dados[:4] == b"PK\x03\x04":
        saida: list[tuple[str, bytes]] = []
        with zipfile.ZipFile(io.BytesIO(dados)) as z:
            for i, item in enumerate(z.infolist()):
                if i >= _MAX_ARQUIVOS_ZIP:
                    if incompletos is not None:
                        incompletos.append(True)
                    break
                if item.is_dir():
                    continue
                if item.file_size > _MAX_TAMANHO_XML * 5:
                    if incompletos is not None:
                        incompletos.append(True)
                    continue
                conteudo = z.read(item)
                saida.extend(extrair(conteudo, item.filename, incompletos=incompletos))
        return saida
    if _parece_xml(dados):
        return [(Path(nome).name or "documento.xml", dados)]
    if incompletos is not None:
        incompletos.append(True)
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

    if "infCte" in nomes:  # CT-e (cteProc): o valor é o vTPrest. Vem antes da NF-e porque o CT-e
        # lista as NF-e transportadas em <infDoc><infNFe>, e isso não pode fazer ele ser lido como NF-e
        inf = nomes["infCte"]
        info.chave = re.sub(r"\D", "", inf.get("Id", ""))
        ide = _filho(inf, "ide")
        info.modelo = _texto(ide, "mod") or "57"
        info.emissao = (_texto(ide, "dhEmi") or _texto(ide, "dEmi"))[:10]
        emit, dest = _filho(inf, "emit"), _filho(inf, "dest")
        info.cnpj_emit = _texto(emit, "CNPJ") or _texto(emit, "CPF")
        info.cnpj_dest = _texto(dest, "CNPJ") or _texto(dest, "CPF")
        info.ie_emit = re.sub(r"\D", "", _texto(emit, "IE"))
        info.ie_dest = re.sub(r"\D", "", _texto(dest, "IE"))
        rem = _filho(inf, "rem")
        info.cnpj_rem = (_texto(rem, "CNPJ") or _texto(rem, "CPF")) if rem is not None else ""
        info.ie_rem = re.sub(r"\D", "", _texto(rem, "IE")) if rem is not None else ""
        for papel in ("rem", "dest", "exped", "receb"):
            e = _filho(inf, papel)
            if e is not None:
                info.partes.append((_texto(e, "CNPJ") or _texto(e, "CPF"), re.sub(r"\D", "", _texto(e, "IE"))))
        toma4 = _filho(ide, "toma4")
        if toma4 is not None:
            info.partes.append((_texto(toma4, "CNPJ") or _texto(toma4, "CPF"), re.sub(r"\D", "", _texto(toma4, "IE"))))
        try:
            info.valor = float(_texto(_filho(inf, "vPrest"), "vTPrest") or 0)
        except ValueError:
            info.valor = 0.0
        prot = nomes.get("infProt")
        info.situacao = _texto(prot, "cStat") if prot is not None else ""
    elif "infNFe" in nomes:
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
        try:
            info.valor = float(_texto(_filho(_filho(inf, "total"), "ICMSTot"), "vNF") or 0)
        except ValueError:
            info.valor = 0.0
        prot = nomes.get("infProt")
        info.situacao = _texto(prot, "cStat") if prot is not None else ""
    elif "infEvento" in nomes or raiz_nome in ("procEventoNFe", "procEventoCTe", "evento", "eventoCTe"):
        inf = nomes.get("infEvento")
        info.evento = True
        info.chave = _texto(inf, "chNFe") or _texto(inf, "chCTe")
        info.tipo_evento = _texto(inf, "tpEvento")
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


def destino_do_escritorio(destino: str | Path, escritorio: str, por_escritorio: bool) -> str:
    """Com uma pasta por escritório (robô na VPS): <destino>/<Escritório>. Sem: o próprio destino."""
    if not por_escritorio or not (escritorio or "").strip():
        return str(destino)
    return str(Path(destino) / nome_de_pasta(escritorio))


def pasta_empresa(destino: str | Path, nome: str, ie: str, codigo: str = "") -> Path:
    """<destino>/Arquivos baixados/<ID>-<Nome> (ex.: "5-joao"); sem ID, só o nome."""
    base = Path(destino) / PASTA_BAIXADOS
    return base / nome_de_pasta(f"{codigo}-{nome}" if codigo else nome)


def _mesmo_ie(a: str, b: str) -> bool:
    return bool(a) and bool(b) and a.lstrip("0") == b.lstrip("0")


# ---------------------------------------------------------------------- distribuição por conteúdo
# O ATF entrega os XML como anexos em "Minhas Mensagens", todas com o mesmo assunto e sem ordem
# garantida. Por isso cada XML é encaminhado pelo que está DENTRO dele (IE/CNPJ de emitente e
# destinatário, modelo 55/65), e não pela mensagem de onde veio.

@dataclass
class Alvo:
    """Empresa consultada nesta rodada e os XML que ela pediu."""
    ie: str
    cnpj: str
    tipos: list[str]


def _destinos(info: InfoXml, alvos: list[Alvo]) -> list[tuple[str, str]]:
    emit_chave = info.chave[6:20]
    saida: list[tuple[str, str]] = []
    for a in alvos:
        emitente = _mesmo_ie(info.ie_emit, a.ie) or (bool(a.cnpj) and a.cnpj in (info.cnpj_emit, emit_chave))
        if info.modelo == "57":  # CT-e: a empresa como remetente e/ou como destinatária
            if "cte_rem" in a.tipos and (_mesmo_ie(info.ie_rem, a.ie) or (bool(a.cnpj) and info.cnpj_rem == a.cnpj)):
                saida.append((a.ie, "cte_rem"))
            if "cte_dest" in a.tipos and (_mesmo_ie(info.ie_dest, a.ie) or (bool(a.cnpj) and info.cnpj_dest == a.cnpj)):
                saida.append((a.ie, "cte_dest"))
            continue
        if info.modelo == "65":
            if "nfce" in a.tipos and emitente:
                saida.append((a.ie, "nfce"))
            continue
        if "nfe_saida" in a.tipos and emitente:
            saida.append((a.ie, "nfe_saida"))
        if "nfe_entrada" in a.tipos and (_mesmo_ie(info.ie_dest, a.ie) or (bool(a.cnpj) and info.cnpj_dest == a.cnpj)):
            saida.append((a.ie, "nfe_entrada"))
    return saida


def distribuir(arquivos: list[tuple[str, bytes]], alvos: list[Alvo]):
    """Separa os XML recebidos por (IE, tipo). Uma nota entre duas empresas da rodada vai para as
    duas (saída de uma, entrada da outra). Eventos seguem a nota da mesma chave. Devolve
    ({(ie, tipo): [(nome, dados)]}, sobras): sobras são XML de nenhuma empresa da rodada."""
    por_destino: dict[tuple[str, str], list[tuple[str, bytes]]] = {}
    sobras: list[tuple[str, bytes]] = []
    destinos_da_chave: dict[str, list[tuple[str, str]]] = {}
    eventos = []
    for nome, dados in arquivos:
        info = ler_xml(dados)
        if not info:
            continue
        if info.evento:
            eventos.append((nome, dados, info))
            continue
        destinos = _destinos(info, alvos)
        da_chave = destinos_da_chave.setdefault(info.chave, [])
        da_chave.extend(d for d in destinos if d not in da_chave)
        for d in destinos:
            por_destino.setdefault(d, []).append((nome, dados))
        if not destinos:
            sobras.append((nome, dados))
    for nome, dados, info in eventos:
        destinos = destinos_da_chave.get(info.chave)
        if destinos is None and info.modelo == "57":
            destinos = []  # evento de CT-e sem o CT-e: o CNPJ da chave é o da transportadora
        elif destinos is None:  # nota não veio nesta rodada: pelo CNPJ do emitente na chave
            destinos = [(a.ie, "nfce" if info.modelo == "65" else "nfe_saida") for a in alvos
                        if a.cnpj and a.cnpj == info.chave[6:20]
                        and ("nfce" if info.modelo == "65" else "nfe_saida") in a.tipos]
        for d in destinos:
            por_destino.setdefault(d, []).append((nome, dados))
        if not destinos:
            sobras.append((nome, dados))
    return por_destino, sobras


def salvar_nao_identificados(arquivos: list[tuple[str, bytes]], pasta: Path) -> list[Path]:
    """Guarda os anexos como vieram na área de conferência da execução."""
    salvos = []
    for nome, dados in arquivos:
        base = Path(nome_de_pasta(Path(nome).name) or "arquivo")
        nome_seguro = f"{base.stem[:20]}_{hashlib.sha256(dados).hexdigest()[:24]}{extensao(dados)}"
        arquivo = arquivo_validado(pasta, nome_seguro)
        if not arquivo.exists():
            publicar_arquivo(arquivo, lambda temporario: temporario.write_bytes(dados))
        salvos.append(arquivo)
    return salvos


def tipo_de_arquivo(dados: bytes) -> str:
    if dados[:4] == b"PK\x03\x04":
        return "ZIP"
    if dados[:2] == b"\x1f\x8b":
        return "GZIP"
    inicio = dados[:300].lstrip(b"\xef\xbb\xbf \r\n\t").lower()
    if inicio.startswith(b"<?xml") or inicio.startswith(b"<nfeproc") or inicio.startswith(b"<nfe"):
        return "XML"
    if inicio.startswith(b"<!doctype html") or inicio.startswith(b"<html"):
        return "HTML"
    if dados[:4] == b"%PDF":
        return "PDF"
    return "outro"


# ---------------------------------------------------------------------- arquivos como vieram do ATF
# O ZIP baixado é guardado do jeito que chegou (sem descompactar). O conteúdo só é lido para saber
# de qual empresa e tipo ele é, contar as notas e somar o valor que aparece no nome da pasta.


def valor_total(xmls: list[tuple[str, bytes]]) -> tuple[int, float]:
    """(quantidade de notas, soma do vNF) das notas autorizadas e não canceladas."""
    notas: dict[str, float] = {}
    canceladas: set[str] = set()
    for _, dados in xmls:
        info = ler_xml(dados)
        if not info:
            continue
        if info.evento:
            if info.tipo_evento in ("110111", "110112"):  # cancelamento (e por substituição)
                canceladas.add(info.chave)
        elif info.situacao in ("", "100", "150"):
            notas[info.chave] = info.valor
    validas = {k: v for k, v in notas.items() if k not in canceladas}
    return len(validas), round(sum(validas.values()), 2)


def reais(valor: float) -> str:
    return "R$ " + f"{valor:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _pasta_do_tipo(pasta_mes: Path, nome_tipo: str) -> Path:
    """A pasta do tipo pode já existir com o valor no nome ("NF-e Saida - R$ 1.234,56")."""
    if pasta_mes.is_dir():
        for d in sorted(pasta_mes.iterdir()):
            if d.is_dir() and (d.name == nome_tipo or d.name.startswith(nome_tipo + " - R$")):
                return d
    return pasta_mes / nome_tipo


def salvar_originais(brutos: list[tuple[str, bytes]], pasta_validada: Path, alvo: Alvo, tipo: str,
                     competencia: str) -> dict:
    """Guarda os anexos atribuídos à empresa e calcula os totais pelo conteúdo."""
    nome_tipo = TIPOS.get(tipo, tipo)
    pasta_mes = pasta_da_competencia(pasta_validada, competencia)
    pasta = criar_subpasta_validada(pasta_mes, _pasta_do_tipo(pasta_mes, nome_tipo).name)
    existentes = {hashlib.sha1(a.read_bytes()).hexdigest() for a in _arquivos_salvos(pasta)}
    novos = repetidos = 0
    for _, dados in brutos:
        assinatura = hashlib.sha1(dados).hexdigest()
        if assinatura in existentes:
            repetidos += 1
            continue
        existentes.add(assinatura)
        ext = ".zip" if dados[:4] == b"PK\x03\x04" else ".gz" if dados[:2] == b"\x1f\x8b" else ".xml"
        base = f"{nome_tipo} {competencia}"
        arquivo, n = pasta / f"{base}{ext}", 1
        while arquivo.exists():
            n += 1
            arquivo = pasta / f"{base} ({n}){ext}"
        arquivo = arquivo_validado(pasta, arquivo.name)
        publicar_arquivo(arquivo, lambda temporario: temporario.write_bytes(dados))
        novos += 1
    todos = [x for a in _arquivos_salvos(pasta) for x in extrair(a.read_bytes(), a.name)]
    todos = distribuir(todos, [alvo])[0].get((alvo.ie, tipo), [])
    notas, valor = valor_total(todos)
    novo_nome = f"{nome_tipo} - {reais(valor)}" if notas else nome_tipo
    if pasta.name != novo_nome:
        pasta = renomear_subpasta_validada(pasta, novo_nome)
    pdfs = gerar_pdfs(todos, pasta / PASTA_PDF) if GERAR_PDF else 0
    return {"novos": novos, "repetidos": repetidos, "notas": notas, "valor": valor, "pasta": str(pasta), "pdfs": pdfs}


def gerar_pdfs(xmls: list[tuple[str, bytes]], pasta: Path) -> int:
    """Um PDF por nota (só as autorizadas e não canceladas), com a chave no nome. O que já existe não é refeito,
    então rodar de novo só completa o que falta. Devolve quantos PDFs novos."""
    import pdf_fiscal

    canceladas, notas = set(), {}
    for _, dados in xmls:
        info = ler_xml(dados)
        if not info:
            continue
        if info.evento:
            if info.tipo_evento in ("110111", "110112"):
                canceladas.add(info.chave)
        elif info.situacao in ("100", "150") and info.modelo in ("55", "65", "57"):
            notas.setdefault(info.chave, (info.modelo, dados))
    novos = 0
    for chave, (modelo, dados) in notas.items():
        arquivo = arquivo_validado(pasta, f"{chave}.pdf")
        if chave in canceladas or arquivo.exists():
            continue
        pdf = pdf_fiscal.gerar(dados, modelo)
        if pdf:
            pasta = criar_subpasta_validada(pasta.parent, pasta.name)
            publicar_arquivo(arquivo, lambda temporario: temporario.write_bytes(pdf))
            novos += 1
    return novos


def extensao(dados: bytes) -> str:
    if dados[:4] == b"PK\x03\x04":
        return ".zip"
    if dados[:1024].lstrip()[:5] == b"%PDF-":
        return ".pdf"
    if dados[:2] == b"\x1f\x8b":
        return ".gz"
    if dados[:4] == b"\x89PNG":
        return ".png"
    return {"XML": ".xml", "HTML": ".html"}.get(tipo_de_arquivo(dados), ".bin")


def salvar_documentos(brutos: list[tuple[str, bytes]], pasta_validada: Path, tipo: str, competencia: str) -> dict:
    """Guarda o documento como veio e reconhece arquivos repetidos pelo conteúdo."""
    nome_tipo = TIPOS.get(tipo, tipo)
    pasta = criar_subpasta_validada(pasta_da_competencia(pasta_validada, competencia), nome_tipo)
    existentes = {hashlib.sha1(a.read_bytes()).hexdigest() for a in _arquivos_salvos(pasta)}
    novos = repetidos = 0
    for _, dados in brutos:
        assinatura = hashlib.sha1(dados).hexdigest()
        if assinatura in existentes:
            repetidos += 1
            continue
        existentes.add(assinatura)
        ext = extensao(dados)
        base = f"{nome_tipo} {competencia}"
        arquivo, n = pasta / f"{base}{ext}", 1
        while arquivo.exists():
            n += 1
            arquivo = pasta / f"{base} ({n}){ext}"
        arquivo = arquivo_validado(pasta, arquivo.name)
        publicar_arquivo(arquivo, lambda temporario: temporario.write_bytes(dados))
        novos += 1
    return {"novos": novos, "repetidos": repetidos, "pasta": str(pasta) if pasta.is_dir() else ""}


def limite_mei(ano: int, inicio_atividade: str | None) -> float:
    """R$ 81.000,00 no ano; no ano em que a empresa começou, R$ 6.750,00 por mês de atividade, contando o
    mês de início (LC 123/2006, art. 18-A, §§ 1º e 2º)."""
    if inicio_atividade and int(inicio_atividade[:4]) == ano:
        return round(LIMITE_MEI / 12 * (12 - int(inicio_atividade[5:7]) + 1), 2)
    return LIMITE_MEI


def inspecionar_anexo(dados: bytes, nome: str) -> tuple[list[tuple[str, bytes]], bool]:
    incompletos = []
    try:
        return extrair(dados, nome, incompletos=incompletos), bool(incompletos)
    except (zipfile.BadZipFile, RuntimeError, NotImplementedError):
        return [], True


def distribuir_por_empresa(brutos: list[tuple[str, bytes]], alvos: list[Alvo]):
    """Separa XMLs de ZIPs mistos e conserva o original na área de conferência."""
    por_destino, sem_empresa, conferir = {}, [], []
    # Eventos em anexos separados ainda seguem a nota da mesma chave.
    todos = []
    grupos = []
    for nome, dados in brutos:
        xmls, incompleto = inspecionar_anexo(dados, nome)
        if xmls:
            inicio = len(todos)
            todos.extend((str(i), xml) for i, (_, xml) in enumerate(xmls, inicio))
            grupos.append((nome, dados, xmls, inicio, incompleto))
        else:
            conferir.append((nome, dados))
    por_xml, _ = distribuir(todos, alvos)
    destinos_por_indice = {}
    for destino, itens in por_xml.items():
        for indice, _ in itens:
            destinos_por_indice.setdefault(int(indice), []).append(destino)
    for nome, dados, xmls, inicio, incompleto in grupos:
        por_grupo = {}
        for i, xml in enumerate(xmls, inicio):
            for destino in destinos_por_indice.get(i, ()):
                por_grupo.setdefault(destino, []).append(xml)
        if not por_grupo:
            sem_empresa.append((nome, dados))
            continue
        completo = False
        for destino, itens in por_grupo.items():
            todos_do_destino = not incompleto and len(itens) == len(xmls)
            completo |= todos_do_destino
            por_destino.setdefault(destino, []).extend([(nome, dados)] if todos_do_destino else itens)
        if not completo:
            conferir.append((nome, dados))
    return por_destino, sem_empresa, conferir


def _arquivos_salvos(pasta: Path):
    for entrada in sorted(pasta.iterdir()):
        if entrada.is_file() or entrada.is_symlink():
            yield arquivo_validado(pasta, entrada.name)


def meses_pendentes_mei(inicio, feitos, refazer_ano: bool = False) -> list:
    import calendar
    from datetime import date

    saida = []
    for mes in range(1, inicio.month):
        if refazer_ano or f"{inicio.year}-{mes:02d}" not in feitos:
            saida.append((date(inicio.year, mes, 1), date(inicio.year, mes, calendar.monthrange(inicio.year, mes)[1])))
    return saida


def montar_planilha_mei(historico: dict, competencia: str):
    """Gera a planilha e o resumo a partir dos meses que já foram guardados."""
    ano = competencia[:4]
    empresa = historico["empresa"]
    meses = historico["meses"]
    dados = meses[competencia]
    limite = empresa["limite_ano"]

    from openpyxl import Workbook
    from openpyxl.styles import Font

    def negrito(ws):
        for c in ws[1]:
            c.font = Font(bold=True)

    wb = Workbook()
    ws = wb.active
    ws.title = f"Faturamento {ano}"
    ws.append(["Mês", "Movimento",
               "Notas: saídas", "Notas: qtd. saídas", "Notas: entradas", "Notas: qtd. entradas",
               "Notas: saídas acumuladas", f"Notas: % do limite ({reais(limite)})",
               "Cartão: vendas", "Cartão: qtd.", "Cartão: acumulado", f"Cartão: % do limite ({reais(limite)})",
               "Consultado em"])
    notas_acum = cartao_acum = 0.0
    for mes in sorted(meses):
        m = meses[mes]
        cartao = m.get("cartao") or {}
        notas_acum += m.get("saidas") or 0.0
        cartao_acum += cartao.get("valor") or 0.0
        ws.append([mes, "sem movimento" if m.get("sem_movimento") else "com movimento",
                   m.get("saidas"), m.get("qtd_saidas"), m.get("entradas"), m.get("qtd_entradas"),
                   round(notas_acum, 2), round(notas_acum / limite, 4),
                   cartao.get("valor"), cartao.get("qtd"), round(cartao_acum, 2), round(cartao_acum / limite, 4),
                   m.get("consultado_em")])
    negrito(ws)
    for linha in ws.iter_rows(min_row=2):
        for i in (2, 4, 6, 8, 10):
            linha[i].number_format = '#,##0.00'
        for i in (7, 11):
            linha[i].number_format = "0.00%"
    for col, w in zip("ABCDEFGHIJKLM", (10, 16, 15, 12, 15, 13, 18, 22, 15, 11, 17, 22, 20)):
        ws.column_dimensions[col].width = w

    docs = wb.create_sheet("Por documento")
    docs.append(["Mês", "Tipo de documento", "Qtd. entradas", "Entradas", "Qtd. saídas", "Saídas"])
    for mes in sorted(meses):
        for i in meses[mes].get("itens", []):
            docs.append([mes, i.get("tipo"), i.get("qtd_entradas"), i.get("entradas"), i.get("qtd_saidas"), i.get("saidas")])
        c = meses[mes].get("cartao")
        if c:
            docs.append([mes, "Cartão (à parte)", None, None, c.get("qtd"), c.get("valor")])
    negrito(docs)
    docs.column_dimensions["B"].width = 22

    bruto = wb.create_sheet("Tabela do ATF")
    for mes in sorted(meses):
        for celulas in meses[mes].get("linhas", []):
            bruto.append([mes] + list(celulas))
    return wb, {"saidas": dados.get("saidas"), "entradas": dados.get("entradas"),
            "cartao": (dados.get("cartao") or {}).get("valor"), "sem_movimento": dados.get("sem_movimento"),
            "limite": limite, "meses": sorted(meses),
            "notas_acumulado": round(notas_acum, 2), "notas_percentual": round(notas_acum / limite * 100, 1),
            "cartao_acumulado": round(cartao_acum, 2), "cartao_percentual": round(cartao_acum / limite * 100, 1),
            # o ano inteiro (sem a tabela bruta) para o painel de Monitoramento MEI
            "inicio_atividade": empresa.get("inicio_atividade"),
            "historico": meses_mei_para_painel(meses)}


def meses_mei_para_painel(meses: dict) -> dict:
    return {mes: {k: v for k, v in m.items() if k != "linhas"} for mes, m in sorted(meses.items())}
