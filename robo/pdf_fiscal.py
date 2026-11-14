"""PDF das notas a partir do XML (a SEFAZ entrega só o XML): DANFE (NF-e, modelo 55), DANFC-e (NFC-e, modelo 65)
e DACTE (CT-e, modelo 57), no leiaute oficial dos manuais (MOC), com a biblioteca BrazilFiscalReport."""
from __future__ import annotations

import logging
import re

log = logging.getLogger("robo")


def modelo_do_xml(xml: bytes) -> str:
    """55, 65 ou 57 (pela tag <mod>); vazio se não for nota nem CT-e (ex.: evento)."""
    inicio = xml[:4000]
    if b"<infEvento" in inicio or b"procEvento" in inicio:
        return ""
    m = re.search(rb"<(?:\w+:)?mod>(\d{2})</", xml[:20000])
    if m:
        return m.group(1).decode()
    return "57" if b"<infCte" in inicio else ""


def gerar(xml: bytes, modelo: str | None = None) -> bytes | None:
    """PDF da nota (bytes) ou None: modelo sem PDF, biblioteca ausente ou XML com algo que ela não desenha."""
    modelo = modelo or modelo_do_xml(xml)
    try:
        if modelo == "55":
            from brazilfiscalreport.danfe import Danfe as Classe
        elif modelo == "65":
            from brazilfiscalreport.danfce import Danfce as Classe
        elif modelo == "57":
            from brazilfiscalreport.dacte import Dacte as Classe
        else:
            return None
    except ImportError:
        return None
    try:
        pdf = Classe(xml=xml.decode("utf-8", errors="replace")).output()  # sem nome de arquivo: devolve os bytes
    except Exception as e:  # campo que a biblioteca não conhece: fica só o XML
        log.warning("   PDF da nota (modelo %s) não gerado: %s", modelo, e)
        return None
    return bytes(pdf) if pdf else None
