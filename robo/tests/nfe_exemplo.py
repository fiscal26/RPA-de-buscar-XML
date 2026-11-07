"""NF-e de exemplo (leiaute 4.00) para os testes do Monitor Fiscal."""
import base64
import gzip

NS = "http://www.portalfiscal.inf.br/nfe"
DEST = "11222333000181"
EMIT = "44555666000199"


def chave(numero: int, emit: str = EMIT, uf: str = "26", aamm: str = "2611") -> str:
    base = f"{uf}{aamm}{emit}55001{numero:09d}1{numero:08d}"
    pesos, soma = [2, 3, 4, 5, 6, 7, 8, 9], 0
    for i, d in enumerate(reversed(base)):
        soma += int(d) * pesos[i % 8]
    dv = 11 - soma % 11
    return base + str(0 if dv >= 10 else dv)


def proc_nfe(numero: int, valor: float = 150.0, dest: str = DEST, emissao: str = "2026-11-05T10:00:00-03:00") -> bytes:
    ch = chave(numero)
    return f"""<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="{NS}" versao="4.00"><NFe xmlns="{NS}">
<infNFe Id="NFe{ch}" versao="4.00"><ide><cUF>26</cUF><cNF>{numero:08d}</cNF><natOp>VENDA DE MERCADORIA</natOp><mod>55</mod>
<serie>1</serie><nNF>{numero}</nNF><dhEmi>{emissao}</dhEmi><tpNF>1</tpNF><idDest>2</idDest><cMunFG>2611606</cMunFG>
<tpImp>1</tpImp><tpEmis>1</tpEmis><cDV>{ch[-1]}</cDV><tpAmb>1</tpAmb><finNFe>1</finNFe><indFinal>0</indFinal><indPres>9</indPres>
<procEmi>0</procEmi><verProc>1.0</verProc></ide>
<emit><CNPJ>{EMIT}</CNPJ><xNome>DISTRIBUIDORA RECIFE LTDA</xNome><xFant>DISTRIBUIDORA RECIFE</xFant><enderEmit><xLgr>RUA DA AURORA</xLgr>
<nro>100</nro><xBairro>BOA VISTA</xBairro><cMun>2611606</cMun><xMun>RECIFE</xMun><UF>PE</UF><CEP>50050000</CEP><cPais>1058</cPais>
<xPais>BRASIL</xPais><fone>8133334444</fone></enderEmit><IE>0123456789</IE><CRT>3</CRT></emit>
<dest><CNPJ>{dest}</CNPJ><xNome>PADARIA CENTRAL LTDA</xNome><enderDest><xLgr>RUA DAS FLORES</xLgr><nro>10</nro><xBairro>CENTRO</xBairro>
<cMun>2507507</cMun><xMun>JOAO PESSOA</xMun><UF>PB</UF><CEP>58000000</CEP><cPais>1058</cPais><xPais>BRASIL</xPais></enderDest>
<indIEDest>1</indIEDest><IE>160123453</IE></dest>
<det nItem="1"><prod><cProd>001</cProd><cEAN>SEM GTIN</cEAN><xProd>FARINHA DE TRIGO 50KG</xProd><NCM>11010010</NCM><CFOP>6102</CFOP>
<uCom>SC</uCom><qCom>1.0000</qCom><vUnCom>{valor:.4f}</vUnCom><vProd>{valor:.2f}</vProd><cEANTrib>SEM GTIN</cEANTrib><uTrib>SC</uTrib>
<qTrib>1.0000</qTrib><vUnTrib>{valor:.4f}</vUnTrib><indTot>1</indTot></prod><imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC>
<vBC>{valor:.2f}</vBC><pICMS>12.00</pICMS><vICMS>{valor*0.12:.2f}</vICMS></ICMS00></ICMS><PIS><PISNT><CST>07</CST></PISNT></PIS>
<COFINS><COFINSNT><CST>07</CST></COFINSNT></COFINS></imposto></det>
<total><ICMSTot><vBC>{valor:.2f}</vBC><vICMS>{valor*0.12:.2f}</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP><vBCST>0.00</vBCST>
<vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet><vProd>{valor:.2f}</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg>
<vDesc>0.00</vDesc><vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS><vOutro>0.00</vOutro>
<vNF>{valor:.2f}</vNF></ICMSTot></total><transp><modFrete>9</modFrete></transp>
<pag><detPag><tPag>15</tPag><vPag>{valor:.2f}</vPag></detPag></pag><infAdic><infCpl>PEDIDO 1234</infCpl></infAdic></infNFe></NFe>
<protNFe versao="4.00"><infProt><tpAmb>1</tpAmb><verAplic>PE_1.0</verAplic><chNFe>{ch}</chNFe><dhRecbto>{emissao}</dhRecbto>
<nProt>126260000012345</nProt><digVal>AAAA</digVal><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>
</nfeProc>""".encode()


def res_nfe(numero: int, valor: float = 90.0, sit: str = "1") -> bytes:
    ch = chave(numero)
    return f"""<resNFe xmlns="{NS}" versao="1.01"><chNFe>{ch}</chNFe><CNPJ>{EMIT}</CNPJ><xNome>DISTRIBUIDORA RECIFE LTDA</xNome>
<IE>0123456789</IE><dhEmi>2026-11-04T09:00:00-03:00</dhEmi><tpNF>1</tpNF><vNF>{valor:.2f}</vNF><digVal>AAAA</digVal>
<dhRecbto>2026-11-04T09:00:05-03:00</dhRecbto><nProt>126260000011111</nProt><cSitNFe>{sit}</cSitNFe></resNFe>""".encode()


def proc_evento(numero: int, tipo: str = "110111") -> bytes:
    ch = chave(numero)
    return f"""<procEventoNFe xmlns="{NS}" versao="1.00"><evento versao="1.00"><infEvento Id="ID{tipo}{ch}01"><cOrgao>26</cOrgao>
<tpAmb>1</tpAmb><CNPJ>{EMIT}</CNPJ><chNFe>{ch}</chNFe><dhEvento>2026-11-06T10:00:00-03:00</dhEvento><tpEvento>{tipo}</tpEvento>
<nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>Cancelamento</descEvento>
<nProt>126260000012345</nProt><xJust>Erro na emissao da nota</xJust></detEvento></infEvento></evento>
<retEvento versao="1.00"><infEvento><cStat>135</cStat><chNFe>{ch}</chNFe><tpEvento>{tipo}</tpEvento></infEvento></retEvento></procEventoNFe>""".encode()


def doczip(nsu: int, esquema: str, xml: bytes) -> str:
    return f'<docZip NSU="{nsu:015d}" schema="{esquema}">{base64.b64encode(gzip.compress(xml)).decode()}</docZip>'


def ret_dist(cstat: str, ult: int, maximo: int, docs: list[str] = (), motivo: str = "") -> bytes:
    lote = f"<loteDistDFeInt>{''.join(docs)}</loteDistDFeInt>" if docs else ""
    return f"""<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>
<nfeDistDFeInteresseResponse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDistDFeInteresseResult>
<retDistDFeInt xmlns="{NS}" versao="1.01"><tpAmb>1</tpAmb><verAplic>1.0</verAplic><cStat>{cstat}</cStat>
<xMotivo>{motivo or ('Documento(s) localizado(s)' if cstat == '138' else 'Nenhum documento localizado')}</xMotivo>
<dhResp>2026-11-07T11:00:00-03:00</dhResp><ultNSU>{ult:015d}</ultNSU><maxNSU>{maximo:015d}</maxNSU>{lote}</retDistDFeInt>
</nfeDistDFeInteresseResult></nfeDistDFeInteresseResponse></soap:Body></soap:Envelope>""".encode()
