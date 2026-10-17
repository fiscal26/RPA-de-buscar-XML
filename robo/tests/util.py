"""XML de teste no formato da NF-e (só os campos que o robô lê)."""

IE_EMPRESA = "160123453"
IE_OUTRA = "160987652"


def chave(cnpj_emit: str, aamm: str = "2609", modelo: str = "55", numero: int = 1) -> str:
    base = f"25{aamm}{cnpj_emit}{modelo}001{numero:09d}1{numero:08d}"
    return base + "0"  # dígito verificador não é conferido pelo robô


def nfe(cnpj_emit: str, cnpj_dest: str, numero: int = 1, data: str = "2026-09-15", modelo: str = "55",
        ie_emit: str = "", ie_dest: str = "") -> bytes:
    ch = chave(cnpj_emit, data[2:4] + data[5:7], modelo, numero)
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe{ch}" versao="4.00">
<ide><cUF>25</cUF><mod>{modelo}</mod><nNF>{numero}</nNF><dhEmi>{data}T10:00:00-03:00</dhEmi></ide>
<emit><CNPJ>{cnpj_emit}</CNPJ><xNome>EMITENTE</xNome><IE>{ie_emit}</IE></emit>
<dest><CNPJ>{cnpj_dest}</CNPJ><xNome>DESTINATARIO</xNome><IE>{ie_dest}</IE></dest>
</infNFe></NFe><protNFe><infProt><chNFe>{ch}</chNFe></infProt></protNFe></nfeProc>""".encode()


def evento(cnpj_autor: str, ch: str) -> bytes:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><evento><infEvento Id="ID110111{ch}01">
<cOrgao>25</cOrgao><CNPJ>{cnpj_autor}</CNPJ><chNFe>{ch}</chNFe><dhEvento>2026-09-20T09:00:00-03:00</dhEvento>
<tpEvento>110111</tpEvento></infEvento></evento></procEventoNFe>""".encode()
