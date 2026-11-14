"""Monitor Fiscal: NF-e destinadas à empresa, pelo Ambiente Nacional da NF-e, com o certificado A1 dela.

- NFeDistribuicaoDFe (distNSU): tudo o que é novo para o CNPJ desde o último NSU (notas de qualquer estado em que
  a empresa é a destinatária ou foi autorizada a baixar o XML, e os eventos delas, como o cancelamento);
- para a nota que vem só em resumo, manifesta a "Ciência da Operação" (evento 210210, assinado com o A1) e busca o
  XML completo pela chave (consChNFe);
- salva o XML e o DANFE em PDF em <empresa>/<MMAAAA>/NF-e Recebidas/ (o mês é o da emissão);
- respeita a regra do Ambiente Nacional: sem documento novo (ultNSU = maxNSU) ou "consumo indevido" (656), só
  depois de 1 hora.

Endereços e regras: veja NFE.md.
"""
from __future__ import annotations

import base64
import gzip
import hashlib
import logging
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

from arquivos import pasta_competencia, pasta_empresa

log = logging.getLogger("robo_xml")

NS = "http://www.portalfiscal.inf.br/nfe"
_DSIG = "http://www.w3.org/2000/09/xmldsig#"
DISTRIBUICAO = {"1": "https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx",
                "2": "https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx"}
EVENTO = {"1": "https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx",
          "2": "https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx"}
_ACAO_DIST = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse"
_ACAO_EVENTO = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento"
PASTA_RECEBIDAS = "NF-e Recebidas"
CANCELAMENTO = "110111"
CIENCIA = "210210"
_FUSO = timezone(timedelta(hours=-3))


class ErroSefaz(Exception):
    pass


# ====================================================================== XML
def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _achar(no, nome: str):
    for e in no.iter():
        if _local(e.tag) == nome:
            return e
    return None


def _txt(no, nome: str) -> str:
    e = _achar(no, nome) if no is not None else None
    return (e.text or "").strip() if e is not None and e.text else ""


def _num(no, nome: str):
    try:
        return round(float(_txt(no, nome)), 2)
    except ValueError:
        return None


def _so_digitos(texto: str) -> str:
    return re.sub(r"\D", "", texto or "")


@dataclass
class Documento:
    nsu: int
    esquema: str      # resNFe_v1.01.xsd, procNFe_v4.00.xsd, resEvento_v1.01.xsd, procEventoNFe_v1.00.xsd
    xml: bytes


@dataclass
class Retorno:
    cstat: str = ""
    motivo: str = ""
    ult_nsu: int = 0
    max_nsu: int = 0
    documentos: list[Documento] = field(default_factory=list)


@dataclass
class Nota:
    chave: str
    numero: str = ""
    serie: str = ""
    emitente_cnpj: str = ""
    emitente_nome: str = ""
    emitente_uf: str = ""
    valor: float | None = None
    emissao: str = ""          # ISO com fuso
    situacao: str = "autorizada"
    completa: bool = False
    manifestada: bool = False
    pdf: bool = False

    def para_portal(self) -> dict:
        d = {k: getattr(self, k) for k in ("chave", "numero", "serie", "emitente_cnpj", "emitente_nome", "emitente_uf",
                                           "valor", "situacao", "completa", "manifestada", "pdf")}
        d["emissao"] = self.emissao or None
        return d


def _uf_da_chave(chave: str) -> str:
    return _UF.get(chave[:2], "")


_UF = {"11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO", "21": "MA", "22": "PI",
       "23": "CE", "24": "RN", "25": "PB", "26": "PE", "27": "AL", "28": "SE", "29": "BA", "31": "MG", "32": "ES",
       "33": "RJ", "35": "SP", "41": "PR", "42": "SC", "43": "RS", "50": "MS", "51": "MT", "52": "GO", "53": "DF"}


def ler_retorno(conteudo: bytes) -> Retorno:
    """retDistDFeInt (dentro do envelope SOAP): situação, NSUs e os documentos (base64 + gzip)."""
    import xml.etree.ElementTree as ET
    try:
        raiz = ET.fromstring(conteudo)
    except ET.ParseError as e:
        raise ErroSefaz(f"resposta ilegível do Ambiente Nacional: {e}") from e
    ret = _achar(raiz, "retDistDFeInt")
    if ret is None:
        falha = _txt(raiz, "Text") or _txt(raiz, "faultstring")
        raise ErroSefaz(f"o Ambiente Nacional não respondeu à consulta{': ' + falha if falha else ''}")
    r = Retorno(cstat=_txt(ret, "cStat"), motivo=_txt(ret, "xMotivo"))
    r.ult_nsu = int(_txt(ret, "ultNSU") or 0)
    r.max_nsu = int(_txt(ret, "maxNSU") or 0)
    for doc in ret.iter():
        if _local(doc.tag) != "docZip":
            continue
        try:
            xml = gzip.decompress(base64.b64decode(doc.text or ""))
        except (ValueError, OSError):
            continue
        r.documentos.append(Documento(int(doc.get("NSU") or 0), doc.get("schema") or "", xml))
    return r


def ler_resumo(xml: bytes) -> Nota | None:
    """resNFe: o resumo da nota destinada (antes da manifestação)."""
    import xml.etree.ElementTree as ET
    raiz = ET.fromstring(xml)
    chave = _txt(raiz, "chNFe")
    if len(chave) != 44:
        return None
    sit = _txt(raiz, "cSitNFe")
    return Nota(chave=chave, numero=str(int(chave[25:34])), serie=str(int(chave[22:25])),
                emitente_cnpj=_txt(raiz, "CNPJ") or _txt(raiz, "CPF"), emitente_nome=_txt(raiz, "xNome"),
                emitente_uf=_uf_da_chave(chave), valor=_num(raiz, "vNF"), emissao=_txt(raiz, "dhEmi"),
                situacao={"2": "denegada", "3": "cancelada"}.get(sit, "autorizada"))


def ler_nota(xml: bytes) -> Nota | None:
    """procNFe (ou NFe): a nota completa."""
    import xml.etree.ElementTree as ET
    raiz = ET.fromstring(xml)
    inf = _achar(raiz, "infNFe")
    if inf is None:
        return None
    chave = (inf.get("Id") or "").removeprefix("NFe") or _txt(raiz, "chNFe")
    if len(chave) != 44:
        return None
    ide, emit, total = _achar(inf, "ide"), _achar(inf, "emit"), _achar(inf, "ICMSTot")
    cstat = _txt(_achar(raiz, "protNFe"), "cStat") if _achar(raiz, "protNFe") is not None else ""
    return Nota(chave=chave, numero=_txt(ide, "nNF"), serie=_txt(ide, "serie"),
                emitente_cnpj=(_txt(emit, "CNPJ") or _txt(emit, "CPF")) if emit is not None else "",
                emitente_nome=_txt(emit, "xNome") if emit is not None else "",
                emitente_uf=_txt(_achar(emit, "enderEmit"), "UF") if emit is not None and _achar(emit, "enderEmit") is not None
                else _uf_da_chave(chave),
                valor=_num(total, "vNF") if total is not None else None,
                emissao=_txt(ide, "dhEmi") or _txt(ide, "dEmi"),
                situacao="denegada" if cstat in ("110", "301", "302", "303") else "autorizada", completa=True)


def ler_evento(xml: bytes) -> tuple[str, str]:
    """resEvento / procEventoNFe: (chave, tpEvento)."""
    import xml.etree.ElementTree as ET
    raiz = ET.fromstring(xml)
    return _txt(raiz, "chNFe"), _txt(raiz, "tpEvento")


# ====================================================================== assinatura (XMLDSig do evento)
def assinar(evento_xml: bytes, chave_privada, certificado) -> bytes:
    """Assina o infEvento como o manual da NF-e pede: enveloped, C14N, RSA-SHA1, com o certificado em KeyInfo."""
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.hazmat.primitives.serialization import Encoding
    from lxml import etree

    raiz = etree.fromstring(evento_xml)
    inf = raiz.find(f"{{{NS}}}infEvento")
    if inf is None:
        raise ErroSefaz("evento sem infEvento")
    digest = base64.b64encode(hashlib.sha1(etree.tostring(inf, method="c14n")).digest()).decode()
    c14n = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315"
    assinatura = etree.SubElement(raiz, f"{{{_DSIG}}}Signature", nsmap={None: _DSIG})
    info = etree.SubElement(assinatura, f"{{{_DSIG}}}SignedInfo")
    etree.SubElement(info, f"{{{_DSIG}}}CanonicalizationMethod", Algorithm=c14n)
    etree.SubElement(info, f"{{{_DSIG}}}SignatureMethod", Algorithm=f"{_DSIG}rsa-sha1")
    ref = etree.SubElement(info, f"{{{_DSIG}}}Reference", URI="#" + inf.get("Id"))
    trans = etree.SubElement(ref, f"{{{_DSIG}}}Transforms")
    etree.SubElement(trans, f"{{{_DSIG}}}Transform", Algorithm=f"{_DSIG}enveloped-signature")
    etree.SubElement(trans, f"{{{_DSIG}}}Transform", Algorithm=c14n)
    etree.SubElement(ref, f"{{{_DSIG}}}DigestMethod", Algorithm=f"{_DSIG}sha1")
    etree.SubElement(ref, f"{{{_DSIG}}}DigestValue").text = digest
    valor = chave_privada.sign(etree.tostring(info, method="c14n"), padding.PKCS1v15(), hashes.SHA1())
    etree.SubElement(assinatura, f"{{{_DSIG}}}SignatureValue").text = base64.b64encode(valor).decode()
    x509 = etree.SubElement(etree.SubElement(etree.SubElement(assinatura, f"{{{_DSIG}}}KeyInfo"), f"{{{_DSIG}}}X509Data"),
                            f"{{{_DSIG}}}X509Certificate")
    x509.text = base64.b64encode(certificado.public_bytes(Encoding.DER)).decode()
    return etree.tostring(raiz)


def evento_ciencia(cnpj: str, chave: str, ambiente: str = "1", agora: datetime | None = None) -> bytes:
    agora = (agora or datetime.now(_FUSO)).astimezone(_FUSO).replace(microsecond=0)
    return (f'<evento xmlns="{NS}" versao="1.00"><infEvento Id="ID{CIENCIA}{chave}01"><cOrgao>91</cOrgao>'
            f"<tpAmb>{ambiente}</tpAmb><CNPJ>{cnpj}</CNPJ><chNFe>{chave}</chNFe><dhEvento>{agora.isoformat()}</dhEvento>"
            f"<tpEvento>{CIENCIA}</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento>"
            '<detEvento versao="1.00"><descEvento>Ciencia da Operacao</descEvento></detEvento></infEvento></evento>').encode()


# ====================================================================== cliente (SOAP 1.2 com o A1)
def _envelope(corpo: str) -> bytes:
    return ('<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">'
            f"<soap12:Body>{corpo}</soap12:Body></soap12:Envelope>").encode()


class ClienteNfe:
    """Fala com o Ambiente Nacional da NF-e. `sessao` é um requests.Session com o A1 (nfse.sessao_com_certificado)."""

    def __init__(self, sessao, cnpj: str, uf: str = "25", ambiente: str = "1", dormir=time.sleep, assinador=None):
        self.sessao = sessao
        self.cnpj = _so_digitos(cnpj)
        self.uf = uf
        self.ambiente = ambiente
        self.dormir = dormir
        self.assinador = assinador  # função(xml) -> xml assinado (o A1 só vive na memória)

    def _post(self, url: str, acao: str, corpo: str) -> bytes:
        cab = {"Content-Type": f'application/soap+xml; charset=utf-8; action="{acao}"'}
        for tentativa in range(3):
            try:
                r = self.sessao.post(url, data=_envelope(corpo), headers=cab, timeout=90)
            except Exception as e:  # rede, TLS
                if tentativa == 2:
                    raise ErroSefaz(f"sem contato com o Ambiente Nacional da NF-e: {e}") from e
                self.dormir(5 * (tentativa + 1))
                continue
            if r.status_code >= 500 and tentativa < 2 and b"retDistDFeInt" not in r.content and b"retEnvEvento" not in r.content:
                self.dormir(5 * (tentativa + 1))
                continue
            if r.status_code == 403:
                raise ErroSefaz("o Ambiente Nacional recusou o certificado (403): confira se o A1 é da empresa ou da matriz")
            return r.content
        raise ErroSefaz("o Ambiente Nacional da NF-e não respondeu")

    def _dist(self, pedido: str) -> Retorno:
        corpo = (f'<nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDadosMsg>'
                 f'<distDFeInt xmlns="{NS}" versao="1.01"><tpAmb>{self.ambiente}</tpAmb><cUFAutor>{self.uf}</cUFAutor>'
                 f"<CNPJ>{self.cnpj}</CNPJ>{pedido}</distDFeInt></nfeDadosMsg></nfeDistDFeInteresse>")
        return ler_retorno(self._post(DISTRIBUICAO[self.ambiente], _ACAO_DIST, corpo))

    def distribuicao(self, ult_nsu: int) -> Retorno:
        return self._dist(f"<distNSU><ultNSU>{ult_nsu:015d}</ultNSU></distNSU>")

    def por_chave(self, chave: str) -> Retorno:
        return self._dist(f"<consChNFe><chNFe>{chave}</chNFe></consChNFe>")

    def ciencia(self, chaves: list[str]) -> dict[str, str]:
        """Ciência da Operação (até 20 por lote). Devolve chave -> cStat (135/136 registrado, 573 já existia)."""
        import xml.etree.ElementTree as ET
        if self.assinador is None:
            raise ErroSefaz("sem o certificado para assinar a manifestação")
        eventos = "".join(self.assinador(evento_ciencia(self.cnpj, c, self.ambiente)).decode() for c in chaves)
        corpo = (f'<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">'
                 f'<envEvento xmlns="{NS}" versao="1.00"><idLote>{int(time.time())}</idLote>{eventos}</envEvento></nfeDadosMsg>')
        raiz = ET.fromstring(self._post(EVENTO[self.ambiente], _ACAO_EVENTO, corpo))
        saida = {}
        self.motivos_ciencia = {}
        for ret in raiz.iter():
            if _local(ret.tag) == "retEvento":
                saida[_txt(ret, "chNFe")] = _txt(ret, "cStat")
                self.motivos_ciencia[_txt(ret, "chNFe")] = _txt(ret, "xMotivo")
        if not saida:
            lote = _achar(raiz, "retEnvEvento")
            raise ErroSefaz("manifestação não aceita: " + (f"{_txt(lote, 'cStat')} {_txt(lote, 'xMotivo')}" if lote is not None
                                                            else "resposta sem retorno"))
        return saida


def assinador_do_pfx(pfx: bytes, senha: str):
    """Função que assina o evento com o A1 (a chave fica só na memória, dentro da função)."""
    from cryptography.hazmat.primitives.serialization import pkcs12
    chave, cert, _ = pkcs12.load_key_and_certificates(pfx, senha.encode() if senha else None)
    if chave is None or cert is None:
        raise ErroSefaz("o arquivo .pfx não tem a chave do certificado")
    return lambda xml: assinar(xml, chave, cert)


# ====================================================================== confiança (ICP-Brasil)
ICP_BRASIL = "http://acraiz.icpbrasil.gov.br/credenciadas/CertificadosAC-ICP-Brasil/ACcompactado.zip"


def cadeia_icp_brasil(pasta: Path, dias: int = 30, baixar=None) -> Path | None:
    """Os servidores da SEFAZ usam certificados da ICP-Brasil, que não vêm no sistema: baixa o pacote oficial do
    ITI (as ACs credenciadas) e guarda em <pasta>/icp-brasil.pem, renovando a cada `dias`. None se não conseguir."""
    import io
    import zipfile

    from cryptography import x509
    from cryptography.hazmat.primitives.serialization import Encoding

    arquivo = Path(pasta) / "icp-brasil.pem"
    if arquivo.exists() and time.time() - arquivo.stat().st_mtime < dias * 86400:
        return arquivo
    try:
        if baixar is None:
            import requests
            conteudo = requests.get(ICP_BRASIL, timeout=60).content
        else:
            conteudo = baixar(ICP_BRASIL)
        pems = []
        with zipfile.ZipFile(io.BytesIO(conteudo)) as z:
            for nome in z.namelist():
                dados = z.read(nome)
                for carregar in (x509.load_pem_x509_certificate, x509.load_der_x509_certificate):
                    try:
                        pems.append(carregar(dados).public_bytes(Encoding.PEM))
                        break
                    except ValueError:
                        continue
        if not pems:
            raise ValueError("pacote sem certificados")
        arquivo.parent.mkdir(parents=True, exist_ok=True)
        arquivo.write_bytes(b"".join(pems))
        return arquivo
    except Exception as e:
        log.warning("Cadeia ICP-Brasil não baixada (%s); a conexão com a SEFAZ pode ser recusada.", e)
        return arquivo if arquivo.exists() else None


# ====================================================================== arquivos
def danfe(xml: bytes) -> bytes | None:
    """DANFE em PDF a partir do XML (a SEFAZ não entrega o PDF). None se a biblioteca não estiver instalada."""
    import pdf_fiscal
    return pdf_fiscal.gerar(xml, "55")


def _pasta_da_nota(destino, nome: str, cnpj: str, codigo: str, nota: Nota) -> Path:
    mes = (nota.emissao or datetime.now(_FUSO).isoformat())[:7]
    return pasta_empresa(destino, nome, cnpj, codigo) / pasta_competencia(mes) / PASTA_RECEBIDAS


def salvar_nota(destino, nome: str, cnpj: str, codigo: str, nota: Nota, xml: bytes, pdf: bool = True) -> Path:
    pasta = _pasta_da_nota(destino, nome, cnpj, codigo, nota)
    pasta.mkdir(parents=True, exist_ok=True)
    arquivo = pasta / f"{nota.chave}.xml"
    arquivo.write_bytes(xml)
    if pdf:
        arq_pdf = pasta / f"{nota.chave}.pdf"
        if not arq_pdf.exists():
            conteudo = danfe(xml)
            if conteudo:
                arq_pdf.write_bytes(conteudo)
        nota.pdf = arq_pdf.exists()
    return arquivo


def salvar_evento(destino, nome: str, cnpj: str, codigo: str, chave: str, tipo: str, xml: bytes, emissao: str = ""):
    nota = Nota(chave=chave, emissao=emissao or f"20{chave[2:4]}-{chave[4:6]}-01")
    pasta = _pasta_da_nota(destino, nome, cnpj, codigo, nota) / "Eventos"
    pasta.mkdir(parents=True, exist_ok=True)
    (pasta / f"{chave}-{tipo}.xml").write_bytes(xml)


# ====================================================================== monitoramento de uma empresa
# retornos da Ciência da Operação que deixam o XML completo liberado: 135/136 registrado, 573 já registrado antes,
# 655 a empresa já tinha feito a manifestação final (confirmação) por outro sistema
CIENCIA_ACEITA = ("135", "136", "573", "655")


@dataclass
class ResultadoMonitor:
    notas: dict[str, Nota] = field(default_factory=dict)
    ult_nsu: int = 0
    max_nsu: int = 0
    novas_completas: int = 0
    resumos: int = 0
    canceladas: int = 0
    manifestadas: int = 0
    espera_minutos: int = 0
    aviso: str = ""

    def nota(self, chave: str) -> Nota:
        return self.notas.setdefault(chave, Nota(chave=chave))


def monitorar(cliente: ClienteNfe, ult_nsu: int, destino, nome: str, codigo: str = "", ciencia: bool = True,
              pendentes: list[dict] | None = None, pdf: bool = True, max_consultas: int = 60,
              max_por_chave: int = 50) -> ResultadoMonitor:
    """Uma rodada do Monitor Fiscal para uma empresa: baixa tudo o que é novo desde ult_nsu, manifesta a ciência
    nas notas que vieram só em resumo e busca o XML completo delas (as que ficaram para depois chegam na próxima)."""
    cnpj = cliente.cnpj
    res = ResultadoMonitor(ult_nsu=ult_nsu)
    resumos: dict[str, Nota] = {}
    for _ in range(max_consultas):
        r = cliente.distribuicao(res.ult_nsu)
        if r.cstat == "656":  # consumo indevido: o Ambiente Nacional bloqueia por 1 hora
            res.espera_minutos = 61
            res.aviso = f"o Ambiente Nacional pediu para esperar 1 hora ({r.motivo})"
            break
        if r.cstat not in ("137", "138"):
            raise ErroSefaz(f"{r.cstat} {r.motivo}".strip() or "resposta sem situação")
        res.max_nsu = max(res.max_nsu, r.max_nsu)
        res.ult_nsu = max(res.ult_nsu, r.ult_nsu)
        for doc in r.documentos:
            _guardar_documento(doc, res, resumos, destino, nome, cnpj, codigo, pdf)
        if r.cstat == "137" or res.ult_nsu >= res.max_nsu:
            res.espera_minutos = res.espera_minutos or 0
            break
    # notas que só vieram em resumo (nesta rodada ou antes): ciência e XML completo pela chave
    pendentes = pendentes or []
    a_manifestar = [c for c, n in resumos.items() if n.situacao == "autorizada"]
    a_manifestar += [p["chave"] for p in pendentes if not p.get("manifestada") and p["chave"] not in resumos]
    ja_manifestadas = [p["chave"] for p in pendentes if p.get("manifestada")]
    recusadas: dict[str, str] = {}
    if not ciencia and a_manifestar:
        res.aviso = (f"ciência automática desligada: {len(a_manifestar)} nota(s) ficam só no resumo "
                     "(ligue a ciência no histórico da empresa para baixar o XML)")
    if ciencia and a_manifestar:
        for i in range(0, len(a_manifestar), 20):
            lote = a_manifestar[i:i + 20]
            try:
                retorno = cliente.ciencia(lote)
            except ErroSefaz as e:
                res.aviso = f"ciência da operação não registrada: {e}"
                break
            motivos = getattr(cliente, "motivos_ciencia", {}) or {}
            for chave, cstat in retorno.items():
                if cstat in CIENCIA_ACEITA:
                    res.nota(chave).manifestada = True
                    res.manifestadas += 1
                    ja_manifestadas.append(chave)
                else:  # a SEFAZ recusou: o motivo vai para a mensagem do Monitor (antes ficava em silêncio)
                    recusadas[chave] = f"{cstat} {motivos.get(chave, '')}".strip()
        if recusadas:
            exemplo = next(iter(recusadas.values()))
            res.aviso = res.aviso or f"ciência recusada pela SEFAZ em {len(recusadas)} nota(s): {exemplo}"
        if res.manifestadas:
            cliente.dormir(3)  # o XML completo fica disponível logo depois da ciência
    for chave in ja_manifestadas[:max_por_chave]:
        if res.notas.get(chave) and res.notas[chave].completa:
            continue
        try:
            r = cliente.por_chave(chave)
        except ErroSefaz as e:
            res.aviso = res.aviso or f"XML completo fica para a próxima consulta: {e}"
            break
        if r.cstat == "656":
            res.espera_minutos = 61
            break
        for doc in r.documentos:
            _guardar_documento(doc, res, resumos, destino, nome, cnpj, codigo, pdf)
    sem_xml = {c for c, n in res.notas.items() if not n.completa and n.situacao == "autorizada"}
    sem_xml |= {p["chave"] for p in pendentes if not (res.notas.get(p["chave"]) and res.notas[p["chave"]].completa)}
    res.resumos = len(sem_xml)
    # ciência registrada agora e o XML ainda não liberado: a SEFAZ costuma soltar em minutos; tenta de novo em 1 hora
    # (só depois de uma ciência nova, para não ficar consultando de hora em hora uma nota que não sai)
    if res.manifestadas and any(not n.completa for n in res.notas.values() if n.manifestada) and not res.espera_minutos:
        res.espera_minutos = 61
    return res


def _guardar_documento(doc: Documento, res: ResultadoMonitor, resumos: dict, destino, nome, cnpj, codigo, pdf):
    esquema = doc.esquema.lower()
    try:
        if esquema.startswith("resnfe"):
            nota = ler_resumo(doc.xml)
            if nota:
                atual = res.notas.get(nota.chave)
                if atual is None or not atual.completa:
                    nota.manifestada = bool(atual and atual.manifestada)
                    res.notas[nota.chave] = nota
                    resumos[nota.chave] = nota
        elif esquema.startswith("procnfe") or esquema.startswith("nfe"):
            nota = ler_nota(doc.xml)
            if nota:
                anterior = res.notas.get(nota.chave)
                if anterior is not None:
                    nota.manifestada = anterior.manifestada
                    if anterior.situacao == "cancelada":
                        nota.situacao = "cancelada"
                salvar_nota(destino, nome, cnpj, codigo, nota, doc.xml, pdf)
                res.notas[nota.chave] = nota
                resumos.pop(nota.chave, None)
                res.novas_completas += 1
        elif esquema.startswith("resevento") or esquema.startswith("proceventonfe"):
            chave, tipo = ler_evento(doc.xml)
            if len(chave) == 44 and tipo == CANCELAMENTO:
                res.nota(chave).situacao = "cancelada"
                res.canceladas += 1
                resumos.pop(chave, None)
            if len(chave) == 44 and esquema.startswith("proceventonfe"):
                salvar_evento(destino, nome, cnpj, codigo, chave, tipo, doc.xml,
                              res.notas[chave].emissao if chave in res.notas else "")
    except Exception as e:  # um documento estranho não para o resto
        log.warning("   documento NSU %s (%s) ignorado: %s", doc.nsu, doc.esquema, e)
