"""XML de teste no formato da NF-e (só os campos que o robô lê)."""

IE_EMPRESA = "160123453"
IE_OUTRA = "160987652"


def chave(cnpj_emit: str, aamm: str = "2609", modelo: str = "55", numero: int = 1) -> str:
    base = f"25{aamm}{cnpj_emit}{modelo}001{numero:09d}1{numero:08d}"
    return base + "0"  # dígito verificador não é conferido pelo robô


def nfe(cnpj_emit: str, cnpj_dest: str, numero: int = 1, data: str = "2026-09-15", modelo: str = "55",
        ie_emit: str = "", ie_dest: str = "", valor: float = 100.0) -> bytes:
    ch = chave(cnpj_emit, data[2:4] + data[5:7], modelo, numero)
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe{ch}" versao="4.00">
<ide><cUF>25</cUF><mod>{modelo}</mod><nNF>{numero}</nNF><dhEmi>{data}T10:00:00-03:00</dhEmi></ide>
<emit><CNPJ>{cnpj_emit}</CNPJ><xNome>EMITENTE</xNome><IE>{ie_emit}</IE></emit>
<dest><CNPJ>{cnpj_dest}</CNPJ><xNome>DESTINATARIO</xNome><IE>{ie_dest}</IE></dest>
<total><ICMSTot><vProd>{valor:.2f}</vProd><vNF>{valor:.2f}</vNF></ICMSTot></total>
</infNFe></NFe><protNFe><infProt><chNFe>{ch}</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>""".encode()


def evento(cnpj_autor: str, ch: str) -> bytes:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><evento><infEvento Id="ID110111{ch}01">
<cOrgao>25</cOrgao><CNPJ>{cnpj_autor}</CNPJ><chNFe>{ch}</chNFe><dhEvento>2026-09-20T09:00:00-03:00</dhEvento>
<tpEvento>110111</tpEvento></infEvento></evento></procEventoNFe>""".encode()


def cte(cnpj_emit: str, cnpj_dest: str, numero: int = 1, data: str = "2026-09-15", ie_dest: str = "",
        valor: float = 50.0, cnpj_rem: str = "", ie_rem: str = "") -> bytes:
    ch = chave(cnpj_emit, data[2:4] + data[5:7], "57", numero)
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<cteProc xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00"><CTe><infCte Id="CTe{ch}" versao="4.00">
<ide><cUF>25</cUF><mod>57</mod><nCT>{numero}</nCT><dhEmi>{data}T10:00:00-03:00</dhEmi><toma3><toma>3</toma></toma3></ide>
<emit><CNPJ>{cnpj_emit}</CNPJ><IE>123</IE><xNome>TRANSPORTADORA</xNome></emit>
<rem><CNPJ>{cnpj_rem}</CNPJ><IE>{ie_rem}</IE><xNome>REMETENTE</xNome></rem>
<dest><CNPJ>{cnpj_dest}</CNPJ><IE>{ie_dest}</IE><xNome>DESTINATARIO</xNome></dest>
<vPrest><vTPrest>{valor:.2f}</vTPrest><vRec>{valor:.2f}</vRec></vPrest>
</infCte></CTe><protCTe versao="4.00"><infProt><chCTe>{ch}</chCTe><cStat>100</cStat></infProt></protCTe></cteProc>""".encode()


def evento_cte(cnpj_autor: str, ch: str, tipo: str = "110111") -> bytes:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<procEventoCTe xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00"><eventoCTe><infEvento Id="ID{tipo}{ch}01">
<cOrgao>25</cOrgao><CNPJ>{cnpj_autor}</CNPJ><chCTe>{ch}</chCTe><dhEvento>2026-09-20T09:00:00-03:00</dhEvento>
<tpEvento>{tipo}</tpEvento></infEvento></eventoCTe></procEventoCTe>""".encode()
