"""NFS-e do Portal Nacional pela API oficial (ADN), com o certificado A1 (e-CNPJ) da empresa.

- busca os documentos da empresa por NSU (emitidas, recebidas e eventos), sem captcha;
- guarda cada XML num cache local por CNPJ (a próxima busca continua do último NSU);
- separa as notas da competência em <empresa>/<AAAA-MM>/NFS-e Emitidas e NFS-e Recebidas;
- monta o relatório de retenções (ISS, IRRF, PIS, COFINS, CSLL, INSS), por nota e em totais.

Endereços e regras do portal: veja NFSE.md.
"""
from __future__ import annotations

import base64
import gzip
import json
import logging
import re
import ssl
import tempfile
import time
import xml.etree.ElementTree as ET
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path

from arquivos import nome_de_pasta, pasta_empresa

log = logging.getLogger("robo_xml")

ADN = "https://adn.nfse.gov.br"
CACHE = Path(__file__).resolve().parent / "nfse_cache"
PASSAGEIROS = {429, 502, 503, 504}
PASTA_EMITIDAS = "NFS-e Emitidas"
PASTA_RECEBIDAS = "NFS-e Recebidas"


class ErroADN(Exception):
    pass


def so_digitos(texto) -> str:
    return re.sub(r"\D", "", str(texto or ""))


# ====================================================================== certificado
@contextmanager
def contexto_tls(pfx: bytes, senha: str):
    """SSLContext com o certificado A1. A chave vai para um arquivo temporário já CIFRADA
    (senha aleatória que só existe na memória) e o arquivo some ao terminar."""
    import secrets

    from cryptography.hazmat.primitives.serialization import (BestAvailableEncryption, Encoding, PrivateFormat,
                                                              pkcs12)

    try:
        chave, cert, cadeia = pkcs12.load_key_and_certificates(pfx, senha.encode() if senha else None)
    except ValueError as e:
        raise ErroADN("Não consegui abrir o certificado: confira a senha do arquivo .pfx.") from e
    if chave is None or cert is None:
        raise ErroADN("O arquivo .pfx não tem a chave do certificado (precisa ser um A1 completo).")
    temporaria = secrets.token_urlsafe(24)
    with tempfile.TemporaryDirectory(prefix="lv_cert_") as pasta:
        arq_cert = Path(pasta) / "cert.pem"
        arq_chave = Path(pasta) / "chave.pem"
        arq_cert.write_bytes(cert.public_bytes(Encoding.PEM)
                             + b"".join(c.public_bytes(Encoding.PEM) for c in (cadeia or [])))
        arq_chave.write_bytes(chave.private_bytes(Encoding.PEM, PrivateFormat.PKCS8,
                                                  BestAvailableEncryption(temporaria.encode())))
        ctx = ssl.create_default_context()
        ctx.load_cert_chain(str(arq_cert), str(arq_chave), password=temporaria)
        yield ctx


def dados_do_certificado(pfx: bytes, senha: str) -> dict:
    """CNPJ, nome e validade do e-CNPJ (o CNPJ fica no fim do nome: "EMPRESA LTDA:12345678000199")."""
    from cryptography.hazmat.primitives.serialization import pkcs12
    from cryptography.x509.oid import NameOID

    try:
        _, cert, _ = pkcs12.load_key_and_certificates(pfx, senha.encode() if senha else None)
    except ValueError as e:
        raise ErroADN("Não consegui abrir o certificado: confira a senha do arquivo .pfx.") from e
    cn = cert.subject.get_attributes_for_oid(NameOID.COMMON_NAME)
    nome = cn[0].value if cn else ""
    cnpj = ""
    if ":" in nome:
        nome, _, resto = nome.rpartition(":")
        cnpj = so_digitos(resto)
    try:
        validade = cert.not_valid_after_utc
    except AttributeError:  # cryptography antiga
        validade = cert.not_valid_after
    return {"nome": nome.strip(), "cnpj": cnpj if len(cnpj) == 14 else "", "validade": validade}


def sessao_com_certificado(ctx: ssl.SSLContext):
    import requests
    from requests.adapters import HTTPAdapter

    class _Adaptador(HTTPAdapter):
        def init_poolmanager(self, *a, **kw):
            kw["ssl_context"] = ctx
            return super().init_poolmanager(*a, **kw)

    s = requests.Session()
    s.mount("https://", _Adaptador())
    s.headers["Accept"] = "application/json"
    return s


# ====================================================================== API (ADN)
def motivo_do_erro(resposta) -> str:
    """O ADN responde {"Erros":[{"Codigo":"E…","Descricao":"…"}]}."""
    try:
        dados = resposta.json()
    except Exception:
        texto = (getattr(resposta, "text", "") or "").strip()
        return "" if texto.startswith("<") else texto[:300]
    if not isinstance(dados, dict):
        return ""
    erros = dados.get("Erros") or dados.get("erros") or []
    partes = [": ".join(x for x in (e.get("Codigo") or "", e.get("Descricao") or e.get("Mensagem") or "")
                        if isinstance(x, str) and x) for e in erros if isinstance(e, dict)]
    return "; ".join(p for p in partes if p)


class ClienteADN:
    """Distribuição de DF-e: GET /contribuintes/DFe/<NSU>?lote=true devolve os documentos com NSU maior."""

    def __init__(self, sessao, cnpj_consulta: str = "", base: str = ADN, intervalo: float = 0.7,
                 dormir=time.sleep):
        self.sessao = sessao
        self.cnpj_consulta = so_digitos(cnpj_consulta)
        self.base = base.rstrip("/")
        self.intervalo = intervalo
        self.dormir = dormir
        self._ultima = 0.0

    def _get(self, url: str, **kw):
        espera = self.intervalo - (time.monotonic() - self._ultima)
        if espera > 0:
            self.dormir(espera)
        try:
            return self.sessao.get(url, timeout=60, **kw)
        finally:
            self._ultima = time.monotonic()

    def lote(self, nsu: int) -> dict:
        url = f"{self.base}/contribuintes/DFe/{nsu}"
        params = {"lote": "true"}
        if self.cnpj_consulta:
            params["cnpjConsulta"] = self.cnpj_consulta
        for tentativa in range(5):
            try:
                r = self._get(url, params=params)
            except Exception as e:
                if tentativa == 4:
                    raise ErroADN(f"Portal Nacional fora do ar ({e}). Tente mais tarde.") from e
                self.dormir(2 * (tentativa + 1))
                continue
            if r.status_code in PASSAGEIROS:
                if r.status_code == 429:
                    self.intervalo = min(5.0, self.intervalo * 1.5)
                try:
                    espera = float(r.headers.get("Retry-After", ""))
                except ValueError:
                    espera = 2 * 2 ** tentativa
                self.dormir(min(espera, 30))
                continue
            if r.status_code == 404:  # sem documento depois do NSU o ADN pode responder 404 com o status
                try:
                    dados = r.json()
                except ValueError:
                    dados = {}
                if isinstance(dados, dict) and dados.get("StatusProcessamento") == "NENHUM_DOCUMENTO_LOCALIZADO":
                    return dados
            if r.status_code >= 400:
                motivo = motivo_do_erro(r)
                if "E2214" in motivo:
                    raise ErroADN("O Portal Nacional recusou a cadeia do certificado (E2214). Costuma ser "
                                  "instabilidade do próprio portal: tente de novo mais tarde.")
                if r.status_code in (401, 403):
                    raise ErroADN(f"O Portal Nacional não aceitou o certificado ({r.status_code}"
                                  f"{': ' + motivo if motivo else ''}). Confira se é o e-CNPJ da empresa e se está válido.")
                raise ErroADN(f"Portal Nacional respondeu {r.status_code}{': ' + motivo if motivo else ''}")
            try:
                return r.json()
            except ValueError as e:
                raise ErroADN("O Portal Nacional devolveu uma resposta que não é JSON.") from e
        raise ErroADN("O Portal Nacional está limitando as consultas (429). Tente em alguns minutos.")

    def documentos(self, desde: int = 0, limite_lotes: int = 2000):
        """Gera (nsu, tipo_documento, chave, xml) a partir do NSU informado, até não haver mais."""
        nsu = desde
        for _ in range(limite_lotes):
            dados = self.lote(nsu)
            itens = dados.get("LoteDFe") or []
            if dados.get("StatusProcessamento") == "NENHUM_DOCUMENTO_LOCALIZADO" or not itens:
                return
            maior = nsu
            for d in itens:
                try:
                    n = int(d.get("NSU"))
                except (TypeError, ValueError):
                    continue
                maior = max(maior, n)
                xml = abrir_xml(d.get("ArquivoXml"))
                yield n, d.get("TipoDocumento") or "", d.get("ChaveAcesso") or "", xml
            if maior <= nsu:  # não avançou: evita ficar parado no mesmo lote
                return
            nsu = maior

    def danfse(self, chave: str) -> bytes | None:
        """PDF oficial da nota (DANFSe). Devolve None quando o portal não entrega um PDF."""
        try:
            r = self._get(f"{self.base}/danfse/{chave}", headers={"Accept": "application/pdf"})
        except Exception:
            return None
        if r.status_code == 200 and r.content[:5] == b"%PDF-":
            return r.content
        return None


def abrir_xml(conteudo: str | None) -> bytes:
    """ArquivoXml vem compactado (gzip) e em base64."""
    if not conteudo:
        return b""
    bruto = base64.b64decode(conteudo)
    return gzip.decompress(bruto) if bruto[:2] == b"\x1f\x8b" else bruto


# ====================================================================== cache por CNPJ
class Cache:
    """<cache>/<CNPJ>/: um XML por NSU e um índice (último NSU e o resumo de cada documento)."""

    def __init__(self, cnpj: str, raiz: Path = CACHE):
        self.pasta = Path(raiz) / so_digitos(cnpj)
        self.arquivo = self.pasta / "indice.json"
        try:
            self.indice = json.loads(self.arquivo.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self.indice = {"ultimo_nsu": 0, "documentos": {}}

    @property
    def ultimo_nsu(self) -> int:
        return int(self.indice.get("ultimo_nsu") or 0)

    def guardar(self, nsu: int, tipo: str, chave: str, xml: bytes):
        self.pasta.mkdir(parents=True, exist_ok=True)
        if xml:
            (self.pasta / f"{nsu}.xml").write_bytes(xml)
        self.indice["documentos"][str(nsu)] = {"tipo": tipo, "chave": chave, "xml": bool(xml)}
        self.indice["ultimo_nsu"] = max(self.ultimo_nsu, nsu)

    def salvar(self):
        self.pasta.mkdir(parents=True, exist_ok=True)
        self.arquivo.write_text(json.dumps(self.indice, ensure_ascii=False), encoding="utf-8")

    def xmls(self):
        for nsu, info in sorted(self.indice["documentos"].items(), key=lambda x: int(x[0])):
            arq = self.pasta / f"{nsu}.xml"
            if info.get("xml") and arq.exists():
                yield int(nsu), info.get("tipo", ""), arq.read_bytes()


def atualizar_cache(cliente: ClienteADN, cache: Cache) -> int:
    """Busca o que for novo desde o último NSU guardado. Devolve quantos documentos chegaram."""
    novos = 0
    try:
        for nsu, tipo, chave, xml in cliente.documentos(cache.ultimo_nsu):
            cache.guardar(nsu, tipo, chave, xml)
            novos += 1
            if novos % 200 == 0:
                cache.salvar()
                log.info("  NFS-e: %d documento(s) recebidos do Portal Nacional...", novos)
    finally:
        cache.salvar()
    return novos


# ====================================================================== leitura do XML
def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _achar(raiz, *caminho):
    """Primeiro elemento que segue o caminho de nomes (sem se importar com o namespace)."""
    atuais = [raiz]
    for nome in caminho:
        prox = []
        for a in atuais:
            prox.extend(e for e in a.iter() if e is not a and _local(e.tag) == nome)
        if not prox:
            return None
        atuais = prox
    return atuais[0]


def _txt(raiz, *caminho) -> str:
    e = _achar(raiz, *caminho)
    return (e.text or "").strip() if e is not None and e.text else ""


def _num(raiz, *caminho) -> float:
    try:
        return float(_txt(raiz, *caminho) or 0)
    except ValueError:
        return 0.0


# tpRetPisCofins (leiaute com CSLL): 0 nenhum, 1 PIS/COFINS, 2 nenhum, 3 PIS/COFINS/CSLL, 4 PIS/COFINS,
# 5 PIS, 6 COFINS, 7 COFINS/CSLL, 8 CSLL, 9 PIS/CSLL
_RET_PIS = {"1", "3", "4", "5", "9"}
_RET_COFINS = {"1", "3", "4", "6", "7"}


@dataclass
class NotaServico:
    chave: str = ""
    numero: str = ""
    emissao: str = ""          # AAAA-MM-DD
    competencia: str = ""      # AAAA-MM
    situacao: str = ""         # código cStat
    prestador_doc: str = ""
    prestador_nome: str = ""
    tomador_doc: str = ""
    tomador_nome: str = ""
    servico_codigo: str = ""
    servico_descricao: str = ""
    municipio_incidencia: str = ""
    valor_servico: float = 0.0
    aliquota_iss: float = 0.0
    valor_iss: float = 0.0
    iss_retido: bool = False
    ret_iss: float = 0.0
    ret_irrf: float = 0.0
    ret_pis: float = 0.0
    ret_cofins: float = 0.0
    ret_csll: float = 0.0
    ret_inss: float = 0.0
    total_retido: float = 0.0
    valor_liquido: float = 0.0
    avisos: list[str] = field(default_factory=list)

    @property
    def retencoes_federais(self) -> float:
        return round(self.ret_irrf + self.ret_pis + self.ret_cofins + self.ret_csll + self.ret_inss, 2)


def ler_nfse(dados: bytes) -> NotaServico | None:
    """Lê a NFS-e do leiaute nacional. Devolve None se o XML não for uma nota (ex.: evento)."""
    try:
        raiz = ET.fromstring(dados)
    except ET.ParseError:
        return None
    inf = raiz if _local(raiz.tag) == "infNFSe" else _achar(raiz, "infNFSe")
    if inf is None:
        return None
    n = NotaServico()
    n.chave = (inf.get("Id") or "").removeprefix("NFS")
    n.numero = _txt(inf, "nNFSe")
    n.situacao = _txt(inf, "cStat")
    n.municipio_incidencia = _txt(inf, "xLocIncid")
    dps = _achar(inf, "infDPS")
    if dps is None:
        return None
    n.emissao = _txt(dps, "dhEmi")[:10]
    n.competencia = _txt(dps, "dCompet")[:7]
    prest, toma = _achar(dps, "prest"), _achar(dps, "toma")
    emit = _achar(inf, "emit")
    if prest is not None:
        n.prestador_doc = _txt(prest, "CNPJ") or _txt(prest, "CPF")
    n.prestador_nome = (_txt(emit, "xNome") if emit is not None else "") or (_txt(prest, "xNome") if prest is not None else "")
    if not n.prestador_doc and emit is not None:
        n.prestador_doc = _txt(emit, "CNPJ") or _txt(emit, "CPF")
    if toma is not None:
        n.tomador_doc = _txt(toma, "CNPJ") or _txt(toma, "CPF") or _txt(toma, "NIF")
        n.tomador_nome = _txt(toma, "xNome")
    n.servico_codigo = _txt(dps, "cTribNac")
    n.servico_descricao = _txt(dps, "xDescServ")
    n.valor_servico = _num(dps, "vServ")

    trib_mun = _achar(dps, "tribMun")
    tp_ret_iss = _txt(trib_mun, "tpRetISSQN") if trib_mun is not None else ""
    valores_nota = _achar(inf, "valores")  # valores calculados pelo portal (infNFSe/valores)
    n.valor_iss = _num(valores_nota, "vISSQN") if valores_nota is not None else 0.0
    n.aliquota_iss = (_num(valores_nota, "pAliqAplic") if valores_nota is not None else 0.0) or \
        (_num(trib_mun, "pAliq") if trib_mun is not None else 0.0)
    n.iss_retido = tp_ret_iss in ("2", "3")
    n.ret_iss = n.valor_iss if n.iss_retido else 0.0

    trib_fed = _achar(dps, "tribFed")
    if trib_fed is not None:
        n.ret_irrf = _num(trib_fed, "vRetIRRF")
        n.ret_csll = _num(trib_fed, "vRetCSLL")
        n.ret_inss = _num(trib_fed, "vRetCP")
        pc = _achar(trib_fed, "piscofins")
        if pc is not None:
            tipo = _txt(pc, "tpRetPisCofins")
            n.ret_pis = _num(pc, "vPis") if tipo in _RET_PIS else 0.0
            n.ret_cofins = _num(pc, "vCofins") if tipo in _RET_COFINS else 0.0

    calculado = round(n.ret_iss + n.retencoes_federais, 2)
    informado = _num(valores_nota, "vTotalRet") if valores_nota is not None else 0.0
    n.total_retido = informado or calculado
    if informado and abs(informado - calculado) > 0.01:
        n.avisos.append(f"total retido informado na nota ({informado:.2f}) difere da soma das retenções ({calculado:.2f})")
    n.valor_liquido = (_num(valores_nota, "vLiq") if valores_nota is not None else 0.0) or \
        round(n.valor_servico - n.total_retido, 2)
    return n


def chave_do_evento(dados: bytes) -> tuple[str, str]:
    """(chave da nota, código do evento) de um XML de evento; ("", "") se não for evento."""
    try:
        raiz = ET.fromstring(dados)
    except ET.ParseError:
        return "", ""
    ped = _achar(raiz, "infPedReg")
    if ped is None:
        return "", ""
    codigo = next((_local(e.tag) for e in ped if re.fullmatch(r"e\d{6}", _local(e.tag))), "")
    return _txt(ped, "chNFSe"), codigo


EVENTOS_CANCELAMENTO = {"e101101", "e105102", "e105104", "e105105"}  # cancelamento / por substituição / por ofício


# ====================================================================== competência e pastas
@dataclass
class ResultadoNfse:
    emitidas: list[NotaServico] = field(default_factory=list)
    recebidas: list[NotaServico] = field(default_factory=list)
    canceladas: int = 0
    pdfs: int = 0
    pdfs_faltando: int = 0
    pasta: Path | None = None
    relatorio: Path | None = None
    novos_documentos: int = 0


def separar(cache: Cache, cnpj: str, competencia: str):
    """Notas da competência (AAAA-MM) separadas em emitidas e recebidas, sem as canceladas."""
    dono = so_digitos(cnpj)
    canceladas: set[str] = set()
    notas: list[tuple[NotaServico, bytes]] = []
    for _, tipo, xml in cache.xmls():
        if tipo.upper() == "EVENTO":
            chave, codigo = chave_do_evento(xml)
            if chave and codigo in EVENTOS_CANCELAMENTO:
                canceladas.add(chave)
            continue
        nota = ler_nfse(xml)
        if nota is None:
            chave, codigo = chave_do_evento(xml)
            if chave and codigo in EVENTOS_CANCELAMENTO:
                canceladas.add(chave)
            continue
        if nota.competencia == competencia:
            notas.append((nota, xml))
    emitidas, recebidas, n_canc = [], [], 0
    for nota, xml in notas:
        if nota.chave in canceladas:
            n_canc += 1
            continue
        if so_digitos(nota.prestador_doc) == dono:
            emitidas.append((nota, xml))
        elif so_digitos(nota.tomador_doc) == dono:
            recebidas.append((nota, xml))
    ordem = lambda x: (x[0].emissao, x[0].numero.zfill(15))  # noqa: E731
    return sorted(emitidas, key=ordem), sorted(recebidas, key=ordem), n_canc


def nome_do_arquivo(nota: NotaServico) -> str:
    outro = nota.tomador_nome if nota.prestador_doc else ""
    return nome_de_pasta(f"NFS-e {nota.numero} - {outro}".strip(" -"))[:60] + f" - {nota.chave[-8:]}"


def baixar_competencia(cliente: ClienteADN, cnpj: str, competencia: str, destino: str | Path, nome: str,
                       codigo: str = "", pdf: bool = True, cache_raiz: Path = CACHE) -> ResultadoNfse:
    """Atualiza o cache, salva os XML (e o PDF) da competência e gera o relatório de retenções."""
    cache = Cache(cnpj, cache_raiz)
    res = ResultadoNfse(novos_documentos=atualizar_cache(cliente, cache))
    emitidas, recebidas, res.canceladas = separar(cache, cnpj, competencia)
    pasta_mes = pasta_empresa(destino, nome, cnpj, codigo) / competencia
    res.pasta = pasta_mes
    for lista, sub in ((emitidas, PASTA_EMITIDAS), (recebidas, PASTA_RECEBIDAS)):
        if not lista:
            continue
        pasta = pasta_mes / sub
        pasta.mkdir(parents=True, exist_ok=True)
        for nota, xml in lista:
            base = nome_do_arquivo(nota)
            (pasta / f"{base}.xml").write_bytes(xml)
            if pdf:
                arq_pdf = pasta / f"{base}.pdf"
                if arq_pdf.exists():
                    res.pdfs += 1
                    continue
                conteudo = cliente.danfse(nota.chave)
                if conteudo:
                    arq_pdf.write_bytes(conteudo)
                    res.pdfs += 1
                else:
                    res.pdfs_faltando += 1
    res.emitidas = [n for n, _ in emitidas]
    res.recebidas = [n for n, _ in recebidas]
    if res.emitidas or res.recebidas:
        pasta_mes.mkdir(parents=True, exist_ok=True)
        res.relatorio = relatorio_retencoes(res.emitidas, res.recebidas, pasta_mes / f"Retenções NFS-e {competencia}.xlsx",
                                            nome, competencia)
    return res


# ====================================================================== relatório
COLUNAS = [
    ("Número", 10), ("Emissão", 11), ("Competência", 11), ("CNPJ/CPF", 19), ("Nome", 34),
    ("Código do serviço", 12), ("Valor do serviço", 15), ("Alíquota ISS", 10), ("Valor do ISS", 13),
    ("ISS retido?", 10), ("ISS retido", 13), ("IRRF", 12), ("PIS", 12), ("COFINS", 12), ("CSLL", 12),
    ("INSS", 12), ("Total retido", 14), ("Valor líquido", 15), ("Chave de acesso", 52), ("Observação", 30),
]
_MOEDA = '#,##0.00'


def _documento(doc: str) -> str:
    d = so_digitos(doc)
    if len(d) == 14:
        return f"{d[:2]}.{d[2:5]}.{d[5:8]}/{d[8:12]}-{d[12:]}"
    if len(d) == 11:
        return f"{d[:3]}.{d[3:6]}.{d[6:9]}-{d[9:]}"
    return doc


def relatorio_retencoes(emitidas: list[NotaServico], recebidas: list[NotaServico], arquivo: Path,
                        empresa: str = "", competencia: str = "") -> Path:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    negrito = Font(bold=True)
    cabecalho = PatternFill("solid", fgColor="DDE7F0")
    wb = Workbook()
    resumo = wb.active
    resumo.title = "Resumo"

    def aba(titulo: str, notas: list[NotaServico], outro: str):
        ws = wb.create_sheet(titulo)
        nomes = [c for c, _ in COLUNAS]
        nomes[3], nomes[4] = f"CNPJ/CPF do {outro}", f"Nome do {outro}"
        ws.append(nomes)
        for c in ws[1]:
            c.font, c.fill = negrito, cabecalho
            c.alignment = Alignment(wrap_text=True, vertical="center")
        for n in notas:
            doc, nome = (n.tomador_doc, n.tomador_nome) if outro == "tomador" else (n.prestador_doc, n.prestador_nome)
            ws.append([n.numero, n.emissao, n.competencia, _documento(doc), nome, n.servico_codigo, n.valor_servico,
                       n.aliquota_iss / 100 if n.aliquota_iss else None, n.valor_iss, "Sim" if n.iss_retido else "Não",
                       n.ret_iss, n.ret_irrf, n.ret_pis, n.ret_cofins, n.ret_csll, n.ret_inss, n.total_retido,
                       n.valor_liquido, n.chave, "; ".join(n.avisos)])
        fim = ws.max_row
        ws.append(["TOTAL", None, None, None, f"{len(notas)} nota(s)"])
        for i in (7, 9, 11, 12, 13, 14, 15, 16, 17, 18):
            letra = get_column_letter(i)
            ws.cell(row=fim + 1, column=i, value=f"=SUM({letra}2:{letra}{fim})" if fim >= 2 else 0)
        for c in ws[fim + 1]:
            c.font = negrito
        for linha in ws.iter_rows(min_row=2):
            for i in (6, 8, 10, 11, 12, 13, 14, 15, 16, 17):
                linha[i].number_format = _MOEDA
            linha[7].number_format = "0.00%"
        for i, (_, largura) in enumerate(COLUNAS, start=1):
            ws.column_dimensions[get_column_letter(i)].width = largura
        ws.freeze_panes = "A2"
        ws.auto_filter.ref = f"A1:{get_column_letter(len(COLUNAS))}{max(fim, 1)}"

    aba("Emitidas", emitidas, "tomador")
    aba("Recebidas", recebidas, "prestador")

    def soma(notas, campo):
        return round(sum(getattr(n, campo) for n in notas), 2)

    resumo.append([f"Retenções de NFS-e — {empresa}".strip(" —")])
    resumo.append([f"Competência {competencia[5:]}/{competencia[:4]}" if len(competencia) == 7 else competencia])
    resumo.append([])
    resumo.append(["", "Emitidas (retido pelos seus clientes)", "Recebidas (retido por você dos prestadores)"])
    linhas = [("Quantidade de notas", None), ("Valor dos serviços", "valor_servico"), ("ISS retido", "ret_iss"),
              ("IRRF", "ret_irrf"), ("PIS", "ret_pis"), ("COFINS", "ret_cofins"), ("CSLL", "ret_csll"),
              ("INSS", "ret_inss"), ("Total retido", "total_retido"), ("Valor líquido", "valor_liquido")]
    for rotulo, campo in linhas:
        if campo is None:
            resumo.append([rotulo, len(emitidas), len(recebidas)])
        else:
            resumo.append([rotulo, soma(emitidas, campo), soma(recebidas, campo)])
            for c in resumo[resumo.max_row][1:]:
                c.number_format = _MOEDA
    resumo.append([])
    resumo.append(["Emitidas: valores retidos pelos tomadores — a empresa abate no que tem a pagar "
                   "(ISS no município; IRRF, PIS, COFINS e CSLL na apuração federal; INSS na contribuição previdenciária)."])
    resumo.append(["Recebidas: valores que a empresa reteve dos prestadores — ela é responsável pelo recolhimento "
                   "(ISS ao município; IRRF e PIS/COFINS/CSLL por DARF; INSS por DCTFWeb) e pela declaração na EFD-Reinf."])
    resumo["A1"].font = Font(bold=True, size=13)
    for c in resumo[4]:
        c.font, c.fill = negrito, cabecalho
    resumo[f"A{4 + len(linhas)}"].font = negrito
    resumo.column_dimensions["A"].width = 24
    resumo.column_dimensions["B"].width = 36
    resumo.column_dimensions["C"].width = 42
    arquivo.parent.mkdir(parents=True, exist_ok=True)
    wb.save(arquivo)
    return arquivo
