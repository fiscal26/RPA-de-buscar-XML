"""PDF das notas a partir do XML (a SEFAZ entrega só o XML): DANFE (NF-e, modelo 55), DANFC-e (NFC-e, modelo 65)
e DACTE (CT-e, modelo 57), no leiaute oficial dos manuais (MOC), com a biblioteca BrazilFiscalReport."""
from __future__ import annotations

import io
import logging
import re
from functools import lru_cache

log = logging.getLogger("robo")

SITE = "xml.lotivisse.com.br"
# rodapé do DANFE, fora dos quadros do leiaute oficial (o espaço do logotipo é do emitente e fica livre)
RODAPE_MONITOR = f"Esta NF-e foi encontrada pelo Monitor Fiscal da LotiVisse Sistemas  ·  {SITE}"
RODAPE_ATF = f"PDF gerado do XML pela LotiVisse Sistemas  ·  {SITE}"


@lru_cache(maxsize=1)
def simbolo_png() -> bytes:
    """O símbolo da LotiVisse (o mesmo do portal: quadrado azul-marinho com o visto amarelo), desenhado em PNG."""
    from PIL import Image, ImageDraw
    lado, escala = 32, 16
    img = Image.new("RGBA", (lado * escala, lado * escala), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, lado * escala - 1, lado * escala - 1), radius=8 * escala, fill="#13294b")
    pontos = [(x * escala, y * escala) for x, y in ((8.2, 16.4), (13.6, 22), (24.4, 9.6))]
    largura = round(4.4 * escala)
    d.line(pontos, fill="#f6d35b", width=largura, joint="curve")
    for x, y in (pontos[0], pontos[-1]):  # pontas arredondadas
        r = largura / 2
        d.ellipse((x - r, y - r, x + r, y + r), fill="#f6d35b")
    img = img.resize((128, 128), Image.LANCZOS)
    saida = io.BytesIO()
    img.save(saida, "PNG")
    return saida.getvalue()


def modelo_do_xml(xml: bytes) -> str:
    """55, 65 ou 57 (pela tag <mod>); vazio se não for nota nem CT-e (ex.: evento)."""
    inicio = xml[:4000]
    if b"<infEvento" in inicio or b"procEvento" in inicio:
        return ""
    m = re.search(rb"<(?:\w+:)?mod>(\d{2})</", xml[:20000])
    if m:
        return m.group(1).decode()
    return "57" if b"<infCte" in inicio else ""


def _config_danfe(rodape: str):
    from brazilfiscalreport.danfe.config import DanfeConfig, FooterStamp
    return DanfeConfig(footer_stamp=FooterStamp(logo=io.BytesIO(simbolo_png()), text=rodape, height=5, logo_max_width=5))


def gerar(xml: bytes, modelo: str | None = None, rodape: str = RODAPE_ATF) -> bytes | None:
    """PDF da nota (bytes) ou None: modelo sem PDF, biblioteca ausente ou XML com algo que ela não desenha.
    O DANFE leva no rodapé a marca e o endereço da LotiVisse (rodape vazio: sem rodapé)."""
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
        texto = xml.decode("utf-8", errors="replace")
        if modelo == "55" and rodape:
            try:
                documento = Classe(xml=texto, config=_config_danfe(rodape))
            except Exception as e:  # sem a marca, mas com o PDF
                log.warning("   Rodapé da LotiVisse não aplicado: %s", e)
                documento = Classe(xml=texto)
        else:
            documento = Classe(xml=texto)
        pdf = documento.output()  # sem nome de arquivo: devolve os bytes
    except Exception as e:  # campo que a biblioteca não conhece: fica só o XML
        log.warning("   PDF da nota (modelo %s) não gerado: %s", modelo, e)
        return None
    return bytes(pdf) if pdf else None
