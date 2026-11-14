"""XML completos (todos os campos que o DANFE/DANFCe/DACTE desenham), para testar a geração do PDF."""

NS_NFE = "http://www.portalfiscal.inf.br/nfe"
NS_CTE = "http://www.portalfiscal.inf.br/cte"


def chave(modelo: str = "55", numero: int = 1, cnpj: str = "11222333000181", aamm: str = "2611") -> str:
    base = f"25{aamm}{cnpj}{modelo}001{numero:09d}1{numero:08d}"
    pesos, soma = [2, 3, 4, 5, 6, 7, 8, 9], 0
    for i, d in enumerate(reversed(base)):
        soma += int(d) * pesos[i % 8]
    dv = 11 - soma % 11
    return base + str(0 if dv >= 10 else dv)


def _item(n: int, valor: float) -> str:
    return f"""<det nItem="{n}"><prod><cProd>{n:04d}</cProd><cEAN>SEM GTIN</cEAN><xProd>PRODUTO DE TESTE {n}</xProd>
<NCM>39269090</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>1.0000</qCom><vUnCom>{valor:.2f}</vUnCom><vProd>{valor:.2f}</vProd>
<cEANTrib>SEM GTIN</cEANTrib><uTrib>UN</uTrib><qTrib>1.0000</qTrib><vUnTrib>{valor:.2f}</vUnTrib><indTot>1</indTot></prod>
<imposto><vTotTrib>0.00</vTotTrib><ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS>
<PIS><PISOutr><CST>99</CST><vBC>0.00</vBC><pPIS>0.0000</pPIS><vPIS>0.00</vPIS></PISOutr></PIS>
<COFINS><COFINSOutr><CST>99</CST><vBC>0.00</vBC><pCOFINS>0.0000</pCOFINS><vCOFINS>0.00</vCOFINS></COFINSOutr></COFINS></imposto></det>"""


def nfe(modelo: str = "55", numero: int = 1, valor: float = 150.0, itens: int = 2) -> bytes:
    ch = chave(modelo, numero)
    total = round(valor * itens, 2)
    dest = "" if modelo == "65" else """<dest><CNPJ>99888777000166</CNPJ><xNome>DESTINATARIO TESTE LTDA</xNome>
<enderDest><xLgr>RUA B</xLgr><nro>20</nro><xBairro>BAIRRO</xBairro><cMun>2507507</cMun><xMun>JOAO PESSOA</xMun><UF>PB</UF>
<CEP>58000000</CEP><cPais>1058</cPais><xPais>BRASIL</xPais></enderDest><indIEDest>1</indIEDest><IE>160123453</IE></dest>"""
    supl = "" if modelo == "55" else (f"<infNFeSupl><qrCode><![CDATA[https://www.sefaz.pb.gov.br/nfce?p={ch}|2|1|1|ABC]]>"
                                       "</qrCode><urlChave>www.sefaz.pb.gov.br/nfce/consulta</urlChave></infNFeSupl>")
    pag = f"<pag><detPag><tPag>01</tPag><vPag>{total:.2f}</vPag></detPag></pag>"
    transp = "<transp><modFrete>9</modFrete></transp>"
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="{NS_NFE}" versao="4.00"><NFe xmlns="{NS_NFE}"><infNFe Id="NFe{ch}" versao="4.00">
<ide><cUF>25</cUF><cNF>{numero:08d}</cNF><natOp>VENDA</natOp><mod>{modelo}</mod><serie>1</serie><nNF>{numero}</nNF>
<dhEmi>2026-11-10T10:00:00-03:00</dhEmi><dhSaiEnt>2026-11-10T10:00:00-03:00</dhSaiEnt><tpNF>1</tpNF><idDest>1</idDest>
<cMunFG>2507507</cMunFG><tpImp>{4 if modelo == "65" else 1}</tpImp><tpEmis>1</tpEmis><cDV>{ch[-1]}</cDV><tpAmb>1</tpAmb>
<finNFe>1</finNFe><indFinal>1</indFinal><indPres>1</indPres><procEmi>0</procEmi><verProc>1.0</verProc></ide>
<emit><CNPJ>11222333000181</CNPJ><xNome>EMITENTE TESTE LTDA</xNome><xFant>EMITENTE</xFant>
<enderEmit><xLgr>RUA A</xLgr><nro>10</nro><xBairro>CENTRO</xBairro><cMun>2507507</cMun><xMun>JOAO PESSOA</xMun><UF>PB</UF>
<CEP>58000000</CEP><cPais>1058</cPais><xPais>BRASIL</xPais><fone>8332220000</fone></enderEmit><IE>160987652</IE><CRT>1</CRT></emit>
{dest}{"".join(_item(i + 1, valor) for i in range(itens))}
<total><ICMSTot><vBC>0.00</vBC><vICMS>0.00</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP><vBCST>0.00</vBCST>
<vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet><vProd>{total:.2f}</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg>
<vDesc>0.00</vDesc><vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS>
<vOutro>0.00</vOutro><vNF>{total:.2f}</vNF><vTotTrib>0.00</vTotTrib></ICMSTot></total>{transp}{pag}
<infAdic><infCpl>DOCUMENTO DE TESTE</infCpl></infAdic></infNFe>{supl}</NFe>
<protNFe versao="4.00"><infProt><tpAmb>1</tpAmb><verAplic>PB1</verAplic><chNFe>{ch}</chNFe>
<dhRecbto>2026-11-10T10:00:05-03:00</dhRecbto><nProt>325260000000001</nProt><digVal>abc=</digVal><cStat>100</cStat>
<xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe></nfeProc>""".encode()


def cte(numero: int = 1, valor: float = 80.0) -> bytes:
    ch = chave("57", numero)
    end = ("<xLgr>RUA C</xLgr><nro>1</nro><xBairro>CENTRO</xBairro><cMun>2507507</cMun><xMun>JOAO PESSOA</xMun>"
           "<CEP>58000000</CEP><UF>PB</UF>")
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<cteProc xmlns="{NS_CTE}" versao="4.00"><CTe xmlns="{NS_CTE}"><infCte Id="CTe{ch}" versao="4.00">
<ide><cUF>25</cUF><cCT>{numero:08d}</cCT><CFOP>5353</CFOP><natOp>PRESTACAO DE SERVICO DE TRANSPORTE</natOp><mod>57</mod>
<serie>1</serie><nCT>{numero}</nCT><dhEmi>2026-11-10T10:00:00-03:00</dhEmi><tpImp>1</tpImp><tpEmis>1</tpEmis><cDV>{ch[-1]}</cDV>
<tpAmb>1</tpAmb><tpCTe>0</tpCTe><procEmi>0</procEmi><verProc>1.0</verProc><cMunEnv>2507507</cMunEnv><xMunEnv>JOAO PESSOA</xMunEnv>
<UFEnv>PB</UFEnv><modal>01</modal><tpServ>0</tpServ><cMunIni>2507507</cMunIni><xMunIni>JOAO PESSOA</xMunIni><UFIni>PB</UFIni>
<cMunFim>2504009</cMunFim><xMunFim>CAMPINA GRANDE</xMunFim><UFFim>PB</UFFim><retira>1</retira><indIEToma>1</indIEToma>
<toma3><toma>0</toma></toma3></ide>
<emit><CNPJ>11222333000181</CNPJ><IE>160987652</IE><xNome>TRANSPORTADORA TESTE LTDA</xNome><enderEmit>{end.replace("<UF>PB</UF>", "<UF>PB</UF>")}</enderEmit><CRT>1</CRT></emit>
<rem><CNPJ>99888777000166</CNPJ><IE>160123453</IE><xNome>REMETENTE TESTE</xNome><enderReme>{end}<cPais>1058</cPais><xPais>BRASIL</xPais></enderReme></rem>
<dest><CNPJ>55444333000122</CNPJ><IE>ISENTO</IE><xNome>DESTINATARIO TESTE</xNome><enderDest>{end}<cPais>1058</cPais><xPais>BRASIL</xPais></enderDest></dest>
<vPrest><vTPrest>{valor:.2f}</vTPrest><vRec>{valor:.2f}</vRec><Comp><xNome>FRETE</xNome><vComp>{valor:.2f}</vComp></Comp></vPrest>
<imp><ICMS><ICMSSN><CST>90</CST><indSN>1</indSN></ICMSSN></ICMS></imp>
<infCTeNorm><infCarga><vCarga>1000.00</vCarga><proPred>MERCADORIAS</proPred><infQ><cUnid>01</cUnid><tpMed>PESO BRUTO</tpMed>
<qCarga>100.0000</qCarga></infQ></infCarga><infDoc><infNFe><chave>{chave("55", 7)}</chave></infNFe></infDoc>
<infModal versaoModal="4.00"><rodo><RNTRC>12345678</RNTRC></rodo></infModal></infCTeNorm></infCte></CTe>
<protCTe versao="4.00"><infProt><tpAmb>1</tpAmb><verAplic>PB1</verAplic><chCTe>{ch}</chCTe>
<dhRecbto>2026-11-10T10:00:05-03:00</dhRecbto><nProt>325260000000002</nProt><digVal>abc=</digVal><cStat>100</cStat>
<xMotivo>Autorizado o uso do CT-e</xMotivo></infProt></protCTe></cteProc>""".encode()
