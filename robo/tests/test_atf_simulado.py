"""Ponta a ponta contra um ATF de mentira que copia a estrutura do ATF real (gravação de out/2026):

- /atf/seg/SEGf_Login.jsp: edtNoLogin (#login), edtDsSenha (#senha), botão btnAvancar;
- /atf/ em quadros: cabeçalho (botão "Mensagens"), menu e conteúdo;
- NF-e: fis/FISf_ConsultarNFeXml2.do?limparSessao=true com edtDtInicial/edtDtFinal, cmbTpDoccmpEmit/Dest,
  e o Número + Pesquisar + Nome de cada bloco num quadro próprio (componentes/CodDescLstBS.jsp?id=..._cmpEmit).
  O Pesquisar guarda a IE no servidor (como o ATF): sem ele, o Consultar não sabe a empresa. O ATF recusa
  Emitente e Destinatário juntos. cmbTpExibicao (HTML/TXT/XML) e #btnConsulta; resposta "O resultado será
  enviado para sua caixa de mensagens do ATF";
- NFC-e: "Consulta por Emitente" com a mesma estrutura de blocos;
- seg/SEGf_MinhasMensagens.do: uma mensagem mãe por consulta ("(3 Mensagens )",
  javascript:abrirFilhas('id',3)) que abre 3 filhas; a final ("Tarefa executada com sucesso") tem o
  anexo javascript:mostrarArquivo(0) com o ZIP; sem dados = final sem anexo; a caixa só pode ser lida de
  tempos em tempos (no ATF real, 1 minuto); mensagens de outra competência e consulta manual no meio.
- serviços com PDF na hora (gravações de 18/10/2026), abertos pelo campo "Função" do topo, com o
  Número/Pesquisar/Nome em componentes/CodDescLst.jsp?id=<função>_<componente>:
  faturas (ARR_278: Avançar, lista de lançamentos com DIFERIDO - VALOR MINIMO que o ATF recusa, Emitir
  abre o PDF numa janela nova), extrato (ARR_087: período, Consultar, PDF depois de um redirecionamento),
  omissão (COB_187: Consultar, PDF no quadro de conteúdo) e certidão (DIA_061: Submeter, o PDF toma a aba inteira).
Precisa do Chromium (CHROME_TESTE ou o do Playwright).
"""
import copy
import io
import json
import os
import re
import shutil
import socket
import subprocess
import threading
import time
import urllib.request
import zipfile
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest

import config
import robo_xml
from util import IE_EMPRESA, IE_OUTRA, chave, cte, evento_cte, nfe

EMPRESA = "11222333000181"
FORNECEDOR = "45723174000110"
IE_ESTRANHA = "161112226"  # empresa fora da rodada (consulta feita à mão no mesmo login)
IE_INEXISTENTE = "160555558"  # o Pesquisar do ATF não traz nome
INTERVALO_CAIXA = 3  # segundos entre leituras da caixa de mensagens (no ATF real: 60)
CHROME = os.environ.get("CHROME_TESTE") or next(
    (str(p) for p in Path("/opt/pw-browsers").glob("chromium-*/chrome-linux/chrome")), shutil.which("chromium") or "")

ESTADO = {"logins": [], "consultas": [], "mensagens": [], "recusas": [], "ultima_lista": 0.0, "lista_cedo": 0,
          "blocos": {}, "abertas": [], "caixa_fora": 0, "servicos": [], "telas_servico": [], "faturas_emitidas": [],
          "cartao": [], "dossies": [], "docs_periodos": []}


def _zip(itens: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for nome, dados in itens.items():
            z.writestr(nome, dados)
    return buf.getvalue()


def _agora() -> str:
    return datetime.now().strftime("%d/%m/%Y %H:%M:%S")


def sessao():
    return (f'<div class="sessao">Login: mar00134 Função: FIS_1322 Sessão expira em: 14 min '
            f'{_agora()} Produção</div>')


def _nova_mensagem(codigo: str, assunto: str, atraso: float, anexo: bytes | None, texto: str,
                   periodo: str = "01/09/2026 a 30/09/2026"):
    """Como o ATF: uma mãe ("3 Mensagens") com 3 filhas; só a final tem o anexo."""
    pronta = (datetime.now() + timedelta(seconds=atraso)).replace(microsecond=0)
    mae = {"id": str(104505000 + len(ESTADO["mensagens"]) * 10), "codigo": codigo, "assunto": assunto,
           "pronta": pronta, "filhas": []}
    final = (f"{texto}<br>NFe: Consulta Genérica<br>Período solicitado: {periodo}<br><br>Tarefa executada com sucesso."
             "<br>Abra o arquivo em anexo para ver o relatório gerado.<br>Observação: A não existência de arquivo "
             "em anexo significa que não existem dados para o período consultado.") if anexo else (
        f"{texto}<br>NFe: Consulta Genérica<br>Período solicitado: {periodo}<br><br>"
        "Mensagem: Nenhum registro satisfaz a pesquisa.")
    filhas = (("Tarefa recebida.", None), (final, anexo), ("Tarefa em processamento.", None))
    if codigo == "FIS_1192":  # CT-e: 4 filhas; a do anexo diz "Arquivo disponível para download."
        filtro = f"Filtro pesquisa:<br>Data emissão: {periodo.replace(' a ', ' à ')}<br>{texto}"
        filhas = (("CTe: Consulta Genérica", None), ("CTe: Consulta Genérica", None),
                  (f"Arquivo disponível para download.<br><br>{filtro}" if anexo else
                   f"Mensagem: Nenhum registro satisfaz a pesquisa.<br>{filtro}", anexo),
                  ("CTe: Consulta Genérica", None))
    for i, (txt, arq) in enumerate(filhas):
        mae["filhas"].append({"id": str(int(mae["id"]) + i + 1), "texto": txt, "anexo": arq})
    ESTADO["mensagens"].append(mae)


def _filha(fid: str):
    for m in ESTADO["mensagens"]:
        for f in m["filhas"]:
            if f["id"] == fid:
                return m, f
    raise KeyError(fid)


def _responder(tela: str, campos: dict) -> str:
    """O que o ATF faz com a consulta: gera (com atraso) a mensagem com o ZIP."""
    emit, dest = ESTADO["blocos"].get(f"{tela}_cmpEmit", ""), ESTADO["blocos"].get(f"{tela}_cmpDest", "")
    q = {"tela": tela, "emit": emit, "dest": dest, "ini": campos.get("edtDtInicial", ""),
         "fim": campos.get("edtDtFinal", ""), "exib": campos.get("cmbTpExibicao", "")}
    ESTADO["consultas"].append(q)
    if emit and dest:
        ESTADO["recusas"].append(q)
        return "Erro: informe apenas o Emitente ou o Destinatário."
    assert (q["ini"], q["fim"], q["exib"]) == ("01/09/2026", "30/09/2026", "4" if tela == "cte" else "3"), q
    assert campos.get("cmbTpDoccmpEmit") == "IE" and campos.get("cmbTpDoccmpDest", "IE") == "IE", campos
    ie = emit or dest or ESTADO["blocos"].get(f"{tela}_cmpReme", "")
    assert ie, "Pesquisar do bloco não foi clicado (o ATF não sabe a empresa)"
    if ESTADO.pop("agosto", False):
        _nova_mensagem("FIS_1322", "NFe: Consulta Genérica (Ano 2026)", 0,
                       _zip({"agosto.xml": nfe(EMPRESA, FORNECEDOR, 98, "2026-08-10", ie_emit=ie)}),
                       "outra competência", periodo="01/08/2026 a 31/08/2026")
    if ESTADO.pop("manual", False):
        _nova_mensagem("FIS_1322", "NFe: Consulta Genérica (Ano 2026)", 0,
                       _zip({"x.xml": nfe(FORNECEDOR, "", 7, ie_emit=IE_ESTRANHA)}), "consulta manual")
    if tela == "cte":  # CT-e: o ATF entrega um ZIP com os CT-e e os eventos de cada um
        rem = ESTADO["blocos"].get("cte_cmpReme", "")
        assert bool(dest) != bool(rem) and not emit, q  # um bloco por consulta: Remetente OU Destinatário
        q["rem"] = rem
        if dest == IE_EMPRESA:
            anexo = _zip({"CTe_1.xml": cte(FORNECEDOR, EMPRESA, 1, ie_dest=dest, valor=150.0),
                          "1.Evento do CTe_1.xml": evento_cte(FORNECEDOR, chave(FORNECEDOR, "2609", "57", 1), "310610")})
        elif rem == IE_EMPRESA:
            anexo = _zip({"CTe_2.xml": cte(FORNECEDOR, "", 2, cnpj_rem=EMPRESA, ie_rem=rem, valor=70.0)})
        else:
            anexo = None
        ie = dest or rem
        _nova_mensagem("FIS_1192", "CTe: Arquivo Zipado com as CTe", 2, anexo,
                       f"IE {'Destinatário' if dest else 'Remetente'}: {ie[:2]}.{ie[2:5]}.{ie[5:8]}-{ie[8]}")
        return "O resultado será enviado para sua caixa de mensagens do ATF"
    if tela == "nfce":
        _nova_mensagem("FIS_1484", "NFCe: Consulta Genérica da NFC-e", 2,
                       _zip({"c1.xml": nfe(EMPRESA, "", 5, modelo="65", ie_emit=ie)}), f"emitente {ie}")
    elif emit:
        _nova_mensagem("FIS_1322", "NFe: Consulta Genérica (Ano 2026)", 4 + ESTADO.pop("atraso", 0),
                       _zip({"s1.xml": nfe(EMPRESA, FORNECEDOR, 1, ie_emit=ie, ie_dest=IE_OUTRA),
                             "s2.xml": nfe(EMPRESA, FORNECEDOR, 2, ie_emit=ie)}), f"emitente {ie}")
    elif ie == IE_OUTRA:  # a Mercado comprou da Padaria (nota s1)
        _nova_mensagem("FIS_1322", "NFe: Consulta Genérica (Ano 2026)", 1,
                       _zip({"e1.xml": nfe(EMPRESA, FORNECEDOR, 1, ie_emit=IE_EMPRESA, ie_dest=IE_OUTRA)}),
                       f"destinatário {ie}")
    else:
        _nova_mensagem("FIS_1322", "NFe: Consulta Genérica (Ano 2026)", 1, None, f"destinatário {ie}")
    return "O resultado será enviado para sua caixa de mensagens do ATF"


def _pdf(texto: str) -> bytes:
    return f"%PDF-1.4\n% {texto}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n".encode()


FUNCOES = {"ARR_278": "/atf/arr/ARRf_LancamentoEmitirDarContribuinte.do?limparSessao=true",
           "ARR_087": "/atf/arr/ARRf_ConsultarExtrPgtoCont.do?limparSessao=true",
           "COB_187": "/atf/cob/COBf_OmiGeralConsGenericaContribuinte.do?limparSessao=true",
           "DIA_061": "/atf/dia/DIAf_EmitirCertidaoDebitoIntranet.do?limparSessao=true"}
# outras funções que o campo "Função" do topo abre (CT-e e Dossiê do Contribuinte)
ATALHOS = {"FIS_1192": "/atf/fis/FISf_ConsultarCTeGenerica.do?limparSessao=true",
           "DEC_381": "/atf/dec/DECf_DossierContribuinte.do?limparSessao=true"}


def _dossie(ie: str, datas: tuple[str, str] | None = None) -> str:
    """DEC_382 (Apresentar Dossiê): abas; "Docs fiscais" mostra o período e, depois do Consultar, o
    "- Cartão:" que abre a janela das administradoras (só a IE_EMPRESA tem operações com cartão)."""
    abas = "".join(f'<a href="#">{a}</a> ' for a in ("Identificação", "Contatos", "Omissão", "Faturamento", "CFOP"))
    resultado = ""
    if datas:  # "Totais docs fiscais eletrônicos", como no ATF (print de 20/10/2026)
        url = f"/atf/fis/FISf_DetalharAdministradorasECFTEF.do?sqHumanoInst=7549548&refIni=09/2026&refFim=09/2026&ie={ie}"
        mes = datas[0][3:5]
        com = ie == IE_EMPRESA and mes == "09"   # setembro com movimento; agosto só uma nota e cartão; o resto zerado
        agosto = ie == IE_EMPRESA and mes == "08"
        linhas = [("NFEs", "2", "1.000,00", "3", "3.000,50") if com else
                  ("NFEs", "0", "0,00", "1", "500,00") if agosto else ("NFEs", "0", "0,00", "0", "0,00"),
                  ("NFAEs", "0", "0,00", "0", "0,00"), ("NFCEs", "---", "---", "9" if com else "0", "1.200,00" if com else "0,00"),
                  ("NF Avulsa ATF", "0", "0,00", "0", "0,00"), ("BPe", "---", "---", "0", "0,00")]
        total_s = "4.200,50" if com else "500,00" if agosto else "0,00"
        cartao_q, cartao_v = ("4", "13.585,00") if com else ("2", "300,00") if agosto else ("0", "0,00")
        resultado = ('<table><tr><td colspan="5">Totais docs fiscais eletrônicos</td></tr>'
                     '<tr><th>Tipos de docs eletrônicos</th><th>Qte. Entradas</th><th>Entradas</th><th>Qte. Saídas</th>'
                     '<th>Saídas</th></tr>'
                     + "".join(f'<tr><td><a href="#">- {t}:</a></td><td>{a}</td><td>{b}</td><td>{c}</td><td>{d}</td></tr>'
                               for t, a, b, c, d in linhas)
                     + f'<tr><td colspan="2">TOTAIS</td><td>{"1.000,00" if com else "0,00"}</td><td></td>'
                       f'<td>{total_s}</td></tr>'
                     f'<tr><td><a href="#" onclick="window.open(\'{url}\', \'cartao\', \'width=900,height=600\'); '
                     f'return false">- Cartão:</a></td><td>---</td><td>---</td><td>{cartao_q}</td>'
                     f'<td>{cartao_v}</td></tr></table>')
    simei = "SIM" if ie == IE_EMPRESA else "NÃO"
    identificacao = ("" if datas else  # como no ATF: a Identificação é a aba aberta depois do Consultar
                     f'<table><tr><td>- Inscrição Estadual:</td><td>{ie}</td></tr>'
                     f'<tr><td>- Início atividade:</td><td>{"10/03/2026" if ie == IE_EMPRESA else "14/05/2010"}</td></tr>'
                     f'<tr><td>- Optante SIMEI:</td><td>{simei}</td></tr></table>')
    return (sessao() + f'<b>Dossiê do Contribuinte</b><br>{abas}{identificacao}<div id="docsEletronicos"><form>'
            '<a href="#" onclick="document.getElementById(\'docs\').style.display=\'block\'; return false">Docs fiscais</a>'
            f'</form></div><div id="docs" style="display:{"block" if datas else "none"}">'
            '<form method="post" action="/atf/dec/DECf_ApresentarDossierContribuinte.do">- Período: '
            '<input name="edtDtInicial"> a <input name="edtDtFinal">'
            f'<input type="submit" name="btnConsultar" value="Consultar"></form>{resultado}</div>')


# Lançamentos de cada IE na tela de faturas: (id, operação)
LANCAMENTOS = {IE_EMPRESA: [("34988404", "DIFERIDO - VALOR MINIMO"), ("60700321", ""), ("61128022", "")]}


def _identificacao(funcao: str, comp: str) -> str:
    # como no ATF real: a tela principal tem campos OCULTOS com os mesmos nomes do quadro do componente
    ocultos = "".join(f'<input type="hidden" name="{n}{comp}">' for n in (
        "hidTsAtualizacao", "hidNrDocumento", "hidNoHumanoInst", "hidNrATF", "hidCNPJ", "hidNrInscrEstadual"))
    return (ocultos + '<tr><td>- Tipo de Identificação:</td><td><select name="cmbTpDoc{0}" class="caixas"><option value="IE">'
            'Inscrição Estadual</option><option value="CNPJ">CNPJ</option></select></td></tr>'
            '<tr><td colspan=2><iframe src="/atf/componentes/CodDescLst.jsp?id={1}_{0}" height="70"></iframe></td></tr>'
            ).format(comp, funcao)


def form_servico(nome: str) -> str:
    if nome == "faturas":
        return (sessao() + '<b>Emitir DAR/FC/PIX</b><form method="post" action="/atf/arr/ARRf_LancamentoEmitirDarContribuinte2.do">'
                '<table>' + _identificacao("ARRf_LancamentoEmitirDarContribuinte", "cmpContribuinte") + '</table>'
                '<input type="submit" name="btnSubmeter" value="Avançar" class="botoes"></form>')
    if nome == "extrato":
        return (sessao() + '<b>Extratos de Pagamento por Contribuinte</b><form method="post" action="/atf/arr/ARRf_ConsultarExtrPgtoCont.do">'
                '- Período de Pagamento: <input name="edtDataInicial"> a <input name="edtDataFinal">'
                + "".join(f'<input type="radio" name="rdbGrpReceita" value="{v}"{" checked" if v == "T" else ""}>{v}'
                          for v in ("ICMS", "IPVA", "ITCD", "TAXAS", "T"))
                + '<table>' + _identificacao("ARRf_ConsultarExtrPgtoCont", "cmpContribuinte") + '</table>'
                '<input type="submit" name="Submit" value="Consultar" class="botoes"></form>')
    if nome == "omissao":
        return (sessao() + '<b>Consulta de Omissos/Inadimplentes - Internet</b><form method="post" '
                'action="/atf/cob/COBf_OmiGeralConsGenericaContribuinte.do"><table>'
                + _identificacao("COBf_OmiGeralConsGenericaContribuinte", "cmpHumanoInst") + '</table>'
                '<input type="submit" name="btnConsultar" value="Consultar"><input type="button" name="btnLimpar" value="Limpar">'
                '<input type="button" name="btnGerarArquivo" value="Gerar Arquivo"></form>')
    return (sessao() + '<b>Emitir Certidão de Débito</b><form name="f" method="post" target="_top" '
            'action="/atf/dia/DIAf_EmitirCertidaoDebitoIntranet.do"><table>'
            + _identificacao("DIAf_EmitirCertidaoDebitoIntranet", "Contribuinte") + '</table>'
            '<input type="button" name="btnEmitirCertidao" value="Submeter" onclick="document.f.submit()">'
            '<input type="button" name="btnLimpar" value="Limpar"></form>')


def form_consulta(tela: str, aviso: str = "") -> str:
    titulo = {"nfe": "Consulta NF-e por Emitentes/Destinatários", "nfce": "Consulta Genérica da NFC-e",
              "cte": "Consulta Genérica de Conhecimentos de Transporte Eletrônicos"}[tela]
    datas = ('<label>Data de Emissão</label><input name="edtDtInicial" class="form-control"> - '
             '<input name="edtDtFinal" class="form-control">') if tela == "nfe" else (
        '<label>Data inicial</label><input name="edtDtInicial" class="form-control"><label>Data final</label>'
        '<input name="edtDtFinal" class="form-control">') if tela == "cte" else (
        '<label>Data Emissão Inicial</label><input name="edtDtInicial"><label>Data Emissão Final</label>'
        '<input name="edtDtFinal">')
    bloco = lambda nome, suf: (  # noqa: E731
        f'<div class="card-header">{nome}</div><select name="cmbTpDoccmp{suf}" id="cmbTpDoccmp{suf}" class="form-select">'
        '<option value="IE">Inscrição Estadual</option><option value="CNPJ">CNPJ</option><option value="CPF">CPF</option>'
        f'</select><iframe src="/atf/componentes/CodDescLstBS.jsp?id={tela}_cmp{suf}" height="120"></iframe>'
        f'<label>UF</label><select name="cmbUF{suf}"><option>---</option></select>')
    alerta = f'<div class="alert alert-success">{aviso}</div>' if aviso else ""
    return (sessao() + f'<h5>{titulo}</h5>{alerta}<form method="post" action="/atf/fis/consultar_{tela}.do">{datas}'
            '<label>Situação</label><select name="cmbSituacao"><option>---</option></select>'
            + bloco("Emitente", "Emit")
            + (bloco("Tomador", "Toma") + bloco("Remetente", "Reme") if tela == "cte" else "")
            + bloco("Destinatário", "Dest")
            + ('<label>Formato:</label><select name="cmbTpExibicao"><option value="1">HTML</option><option value="2">TXT'
               '</option><option value="3">TXT Personalizado</option><option value="4">XML</option></select>' if tela == "cte"
               else '<label>Tipo de Exibição</label><select name="cmbTpExibicao"><option value="1">HTML</option>'
                    '<option value="2">TXT</option><option value="3">XML</option></select>')
            + '<button type="submit" name="btnConsultar" id="btnConsulta" class="g-recaptcha btn">Consultar</button>'
              '<button type="submit" class="btn btn-light">Limpar</button></form>')


class AtfFalso(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _html(self, corpo: str, cookie: str = "", status: int = 200, local: str = ""):
        dados = f"<html><head><meta charset='utf-8'></head><body>{corpo}</body></html>".encode()
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        if local:
            self.send_header("Location", local)
        self.end_headers()
        self.wfile.write(dados)

    def _campos(self) -> dict:
        tamanho = int(self.headers.get("Content-Length") or 0)
        self._corpo = self.rfile.read(tamanho).decode()
        return {k: v[0] for k, v in parse_qs(self._corpo, keep_blank_values=True).items()}

    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query, keep_blank_values=True).items()}
        logado = "sessao=ok" in (self.headers.get("Cookie") or "")
        p = u.path
        if p == "/atf/":
            if not logado:
                self._html("", status=302, local="/atf/seg/SEGf_Login.jsp")
                return
            self._html('<iframe name="cab" src="/atf/cabecalho.htm" height="60" width="900"></iframe>'
                       '<iframe name="menu" src="/atf/seg/SEGf_Menu.jsp" height="400" width="300"></iframe>'
                       '<iframe name="conteudo" src="/atf/seg/SEGf_PrincipalSistema.jsp" height="900" width="1000"></iframe>')
        elif p == "/atf/seg/SEGf_Login.jsp":
            self._html('<form id="loginForm" method="post" action="/atf/seg/SEGf_Login.jsp"><b>Login</b> SEFAZ-PB'
                       '<label for="login">Usuário</label><input type="text" id="login" name="edtNoLogin" class="form-control">'
                       '<label for="senha">Senha</label><input type="password" id="senha" name="edtDsSenha">'
                       '<button type="submit" name="btnAvancar" class="btn btn-primary">Avançar</button>'
                       '<a href="#">Acesse via Certificado Digital</a></form>')
        elif not logado:
            self._html("Sessão expirada. Faça login.")
        elif p == "/atf/cabecalho.htm":
            self._html('<header>Sistema ATF <input placeholder="Função" onkeydown="if (event.key === \'Enter\' && FUNCOES[this.value]) '
                       'parent.frames[\'conteudo\'].location = FUNCOES[this.value]"><script>const FUNCOES = '
                       + json.dumps({**FUNCOES, **ATALHOS}) + '</script><button id="toggleMenuHeader" aria-label="Menu">☰</button>'
                       '<button type="button" aria-label="Mensagens" onclick="parent.frames[\'conteudo\'].location='
                       '\'/atf/seg/SEGf_MinhasMensagens.do?limparSessao=true\'">🔔</button>'
                       '<button aria-label="Encerrar Sessão" onclick="top.location=\'/atf/sair\'">⎋</button></header>')
        elif p == "/atf/seg/SEGf_Menu.jsp":
            if q.get("caminho") == "nfe":
                self._html('<div id="sidebar"><a href="/atf/seg/SEGf_Menu.jsp">/ MEN</a><ul><li>NF-E ↲</li></ul><ul>'
                           '<li><a href="#">Consulta Completa</a></li>'
                           '<li><a href="../fis/FISf_ConsultarNFeXml2.do?limparSessao=true" target="conteudo">'
                           'Consulta NF-e por<br>Emitentes/Destinatários</a></li><li><a href="#">Gerar XML NF-e</a></li></ul></div>')
            elif q.get("caminho") == "nfce":
                self._html('<div id="sidebar"><a href="/atf/seg/SEGf_Menu.jsp">/ MEN</a><ul><li>NFC-E ↲</li></ul><ul>'
                           '<li><a href="#">Consulta por CPF</a></li>'
                           '<li><a href="../fis/FISf_ConsultarNFCe.do?limparSessao=true" target="conteudo">Consulta por Emitente</a></li>'
                           '</ul></div>')
            else:
                self._html('<div id="sidebar"><a href="/atf/seg/SEGf_Menu.jsp">/ MEN</a><ul>'
                           '<li><a href="/atf/seg/SEGf_Menu.jsp?caminho=nfe">NF-e</a></li>'
                           '<li><a href="/atf/seg/SEGf_Menu.jsp?caminho=nfce">NFC-e</a></li></ul></div>')
        elif p == "/atf/seg/SEGf_PrincipalSistema.jsp":
            self._html(sessao() + "Bem-vindo ao ATF")
        elif p in ("/atf/fis/FISf_ConsultarNFeXml2.do", "/atf/fis/FISf_ConsultarNFCe.do", "/atf/fis/FISf_ConsultarCTeGenerica.do"):
            tela = "nfe" if "NFeXml2" in p else "cte" if "CTe" in p else "nfce"
            if q.get("limparSessao") == "true":
                for suf in ("Emit", "Dest", "Reme", "Toma"):
                    ESTADO["blocos"].pop(f"{tela}_cmp{suf}", None)
            self._html(form_consulta(tela))
        elif p == "/atf/componentes/CodDescLstBS.jsp":
            self._html(self._componente(q["id"], ESTADO["blocos"].get(q["id"], "")))
        elif p == "/atf/componentes/CodDescLst.jsp":
            self._html(self._componente_simples(q["id"], ESTADO["blocos"].get(q["id"], "")))
        elif p == "/atf/dec/DECf_DossierContribuinte.do":
            self._html(sessao() + '<b>Dossiê do Contribuinte</b><form name="f" method="post" '
                       'action="/atf/dec/DECf_ApresentarDossierContribuinte.do">- Inscrição Estadual: '
                       '<input type="text" name="edtnrInscrEstadual" class="caixas">'
                       '<input type="button" name="btnConsultar" value="Consultar" onclick="document.f.submit()"></form>')
        elif p == "/atf/fis/FISf_DetalharAdministradorasECFTEF.do":
            ESTADO["cartao"].append(q)
            self._html('<b>Detalhamento por Administradora</b><br>- Inscrição Estadual: ' + q["ie"]
                       + '<br>Lista de Operadoras<br>1. 09/2026<br>PAGSEGURO INTERNET SA - Operações de crédito: R$ 4.695,00'
                       '<br>- Total do Periodo: R$ 6.380,00')
        elif p in [u.split("?")[0] for u in FUNCOES.values()]:
            nome = {"ARRf_Lanc": "faturas", "ARRf_Cons": "extrato", "COBf_OmiG": "omissao"}.get(p.rsplit("/", 1)[1][:9], "certidao")
            if q.get("limparSessao") == "true":
                for k in [k for k in ESTADO["blocos"] if k.startswith(p.rsplit("/", 1)[1].split(".")[0] + "_")]:
                    ESTADO["blocos"].pop(k)
            ESTADO["telas_servico"].append(nome)
            self._html(form_servico(nome))
        elif p == "/atf/servicos/EmitirPdf":
            self._pdf_resposta(ESTADO.pop("pdf_extrato"))
        elif p == "/atf/seg/SEGf_MinhasMensagens.do":
            self._mensagens(q)
        elif p == "/atf/seg/SEGf_LerMensagem.do":
            mae, f = _filha(q["hidsqMensagem"])
            ESTADO["abertas"].append((mae["id"], f["id"]))
            anexo = ('<img src="/clip.png"> 1 Anexo(s):<br><a href="javascript:mostrarArquivo(0)">Dados referentes ao '
                     f'ano de 2026</a><script>function mostrarArquivo(i) {{ location = "/atf/seg/arquivo?id={f["id"]}"; }}'
                     '</script>' if f["anexo"] else "")
            self._html(sessao() + f'<b>Ler Mensagem</b><h5>{mae["assunto"]}</h5>- De: {mae["codigo"]} - Consulta<br>'
                       f'- Enviada: {mae["pronta"]:%d/%m/%Y %H:%M:%S}<br>{anexo}<p>{f["texto"]}</p>'
                       '<button name="btnVoltar" class="g-recaptcha">Voltar</button>'
                       + ('<script>setTimeout(() => mostrarArquivo(0), 1500)</script>' if q.get("auto") else ""))
        elif p == "/atf/seg/arquivo":
            dados = _filha(q["id"])[1]["anexo"]
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Disposition", 'attachment; filename="xml.zip"')
            self.end_headers()
            self.wfile.write(dados)
        elif p == "/atf/sair":
            self._html("Sessão encerrada", cookie="sessao=; Max-Age=0; Path=/")
        else:
            self._html(sessao() + "Página")

    def _componente(self, cid: str, ie: str) -> str:
        suf = cid.rsplit("_cmp", 1)[1]
        nome = "" if not ie or ie == IE_INEXISTENTE else f"EMPRESA {ie}"
        return (f'<form method="post" action="/atf/componentes/CodDescLstBS.jsp"><input type="hidden" name="id" value="{cid}">'
                f'<div class="form-floating"><input type="text" name="hidNrDocumentocmp{suf}" id="hidNrDocumentocmp{suf}" '
                f'class="form-control" value="{ie}"><label>Número</label></div>'
                '<button type="submit" name="btnPesquisar" class="btn btn-primary">Pesquisar</button>'
                f'<div class="form-floating"><input type="text" name="hidNoHumanoInstcmp{suf}" id="hidNoHumanoInstcmp{suf}" '
                f'class="form-control" value="{nome}"><label>Nome/Razão Social</label></div></form>')

    def _componente_simples(self, cid: str, ie: str) -> str:
        """componentes/CodDescLst.jsp (sem o BS) das telas de faturas, extrato, omissão e certidão."""
        comp = cid.rsplit("_", 1)[1]
        nome = "" if not ie or ie == IE_INEXISTENTE else f"EMPRESA {ie}"
        return (f'<form method="post" action="/atf/componentes/CodDescLst.jsp"><input type="hidden" name="id" value="{cid}">'
                f'- Número: <input type="text" name="hidNrDocumento{comp}" class="caixas" value="{ie}">'
                '<input type="submit" name="btnPesquisar" value="Pesquisar" class="botoes">'
                f'- Nome/Razão Social: <input type="text" name="hidNoHumanoInst{comp}" class="caixas" value="{nome}"></form>')

    def _pdf_resposta(self, dados: bytes):
        self.send_response(200)
        self.send_header("Content-Type", "application/pdf")
        self.send_header("Content-Disposition", 'inline; filename="Saida.pdf"')
        self.send_header("Content-Length", str(len(dados)))
        self.end_headers()
        self.wfile.write(dados)

    def _servico(self, p: str, campos: dict):
        """Resposta das telas de serviço: o ATF sabe a empresa pelo Pesquisar (guardado no servidor)."""
        funcao = p.rsplit("/", 1)[1].split(".")[0]
        ie = ESTADO["ultima_ie_faturas"] if funcao == "emitir" else \
            next((v for k, v in ESTADO["blocos"].items() if k.startswith(funcao.rstrip("2") + "_")), "")
        assert ie, f"Pesquisar não foi clicado em {funcao}"
        assert campos.get(next(k for k in campos if k.startswith("cmbTpDoc")) if any(k.startswith("cmbTpDoc") for k in campos)
                          else "x", "IE") == "IE", campos
        ESTADO["servicos"].append((funcao, ie, {k: v for k, v in campos.items() if k.startswith("edtData")}))
        if funcao == "ARRf_LancamentoEmitirDarContribuinte2":
            lancs = LANCAMENTOS.get(ie, [])
            if not lancs:
                # como no ATF real: tela vazia com o aviso (alert) do navegador
                self._html("<script>alert('Não existem ocorrências de lançamentos para a consulta.')</script>")
                return
            linhas = "".join(f'<tr><td><input type="checkbox" name="chbChavePrimaria" value="{i}"></td><td>30{i}</td>'
                             f'<td>08/2026</td><td>{"NOTA FISCAL ELETRONICA - NFE" if op else "FATURA"}</td><td>{op}</td>'
                             f'<td><input name="edtDtVencimentoPag{i}" value="30/10/2026"></td></tr>' for i, op in lancs)
            self._html(sessao() + '<b>Lançamentos para Emissão de DAR/FC/PIX</b><form name="f" method="post" target="_blank" '
                       'action="/atf/arr/emitir.do"><input type="radio" name="rdbTipoEmissao" id="rdbDAR" value="D">DAR'
                       '<input type="radio" name="rdbTipoEmissao" id="rdbPIX" value="P" checked>PIX<table>'
                       f'<tr><th>Nosso Número</th><th>Referência</th><th>Nome Origem</th><th>Operação</th></tr>{linhas}</table>'
                       '<input type="checkbox" name="chbSelecionarTodas">Selecionar todos lançamentos.'
                       f'<br>{len(lancs)} Registros Encontrados<br>'
                       '<input type="button" name="btnEmitir" value="Emitir" onclick="document.f.submit()"></form>')
        elif funcao == "emitir":
            escolhidos = parse_qs(self._corpo).get("chbChavePrimaria", [])
            ESTADO["faturas_emitidas"].append(escolhidos)
            diferidos = {i for i, op in LANCAMENTOS.get(ESTADO["ultima_ie_faturas"], []) if op}
            if set(escolhidos) & diferidos or not escolhidos:
                self._html("Não é permitida a emissão do DAR/FC de um lançamento que esteja com a operação de "
                           "DIFERIDO - VALOR MINIMO")
                return
            self._pdf_resposta(_pdf("fatura " + ",".join(escolhidos)))
        elif funcao == "ARRf_ConsultarExtrPgtoCont":
            ESTADO["pdf_extrato"] = _pdf(f"extrato {ie} {campos.get('edtDataInicial')} {campos.get('edtDataFinal')}")
            self._html("", status=302, local="/atf/servicos/EmitirPdf")
        elif funcao == "COBf_OmiGeralConsGenericaContribuinte":
            self._pdf_resposta(_pdf(f"omissos {ie} pagina 1 pagina 2"))
        else:
            self._pdf_resposta(_pdf(f"certidao {ie}"))

    def _mensagens(self, q: dict):
        agora = datetime.now()
        if ESTADO["caixa_fora"] > 0 and q.get("limparSessao") == "true":  # ATF lento: a caixa não abre
            ESTADO["caixa_fora"] -= 1
            self._html("Aguarde...")
            return
        if q.get("limparSessao") == "true":
            if time.time() - ESTADO["ultima_lista"] < INTERVALO_CAIXA:
                ESTADO["lista_cedo"] += 1
                self._html(sessao() + '<b>Minhas Mensagens</b><br><b>ATENÇÃO: Você poderá consultar sua caixa de '
                           'mensagens em 1 minuto. AGUARDE!</b>')
                return
            ESTADO["ultima_lista"] = time.time()
            linhas = "".join(
                f'<tr><td><input type="checkbox" name="chbSqMensagems"></td>'
                f'<td><a href="javascript:abrirFilhas(\'{m["id"]}\',{len(m["filhas"])})"><img src="env.png"></a></td>'
                + (f'<td><a href="javascript:abrirFilhas(\'{m["id"]}\',{len(m["filhas"])})"><img src="clip.gif"></a></td>'
                   if any(f["anexo"] for f in m["filhas"]) else '<td></td>')
                + f'<td><a href="javascript:abrirFilhas(\'{m["id"]}\',{len(m["filhas"])})">{m["codigo"]} - Consulta Genérica ({len(m["filhas"])} Mensagens )</a></td>'
                f'<td><a href="javascript:abrirFilhas(\'{m["id"]}\',{len(m["filhas"])})">{m["assunto"]}</a></td>'
                f'<td><a href="javascript:abrirFilhas(\'{m["id"]}\',{len(m["filhas"])})">{m["pronta"]:%d/%m/%Y %H:%M:%S}</a></td></tr>'
                for m in sorted(ESTADO["mensagens"], key=lambda m: m["pronta"], reverse=True) if m["pronta"] <= agora)
        else:
            mae = next(m for m in ESTADO["mensagens"] if m["id"] == q["hidsqMensagem"])
            linhas = "".join(
                f'<tr><td><input type="checkbox"></td><td><a href="javascript:abrirFilhas(\'{f["id"]}\',0)"><img src="env.png"></a></td>'
                + (f'<td><a href="javascript:abrirFilhas(\'{f["id"]}\',0)"><img src="clip.gif"></a></td>' if f["anexo"] else '<td></td>')
                + f'<td><a href="javascript:abrirFilhas(\'{f["id"]}\',0)">'
                f'{mae["codigo"]} - Consulta Genérica</a></td><td><a href="javascript:abrirFilhas(\'{f["id"]}\',0)">'
                f'{mae["pronta"]:%d/%m/%Y %H:%M:%S}</a></td></tr>' for f in mae["filhas"])
        self._html(sessao() + '<b>Minhas Mensagens</b><form><table>' + linhas + '</table>'
                   '<button name="btnVoltar" class="g-recaptcha">Voltar</button>'
                   '<button name="btnNaoVisualizar" class="g-recaptcha">Retirar</button></form>'
                   "<script>function abrirFilhas(id, n) { location = n > 0 ? 'SEGf_MinhasMensagens.do?hidsqMensagem=' + id"
                   " : 'SEGf_LerMensagem.do?hidsqMensagem=' + id; }</script>")

    def do_POST(self):
        campos = self._campos()
        p = urlparse(self.path).path
        if p == "/atf/seg/SEGf_Login.jsp":
            ESTADO["logins"].append(campos.get("edtNoLogin", ""))
            if campos.get("edtNoLogin") == "mar00134" and campos.get("edtDsSenha") == "certa":
                self._html("", cookie="sessao=ok; Path=/", status=302, local="/atf/")
            else:
                self._html("Usuário ou senha inválidos.")
        elif p == "/atf/componentes/CodDescLstBS.jsp":  # Pesquisar do bloco: guarda a IE no servidor
            cid = campos["id"]
            suf = cid.rsplit("_cmp", 1)[1]
            ESTADO["blocos"][cid] = campos.get(f"hidNrDocumentocmp{suf}", "")
            self._html(self._componente(cid, ESTADO["blocos"][cid]))
        elif p == "/atf/dec/DECf_ApresentarDossierContribuinte.do":
            if "edtnrInscrEstadual" in campos:
                ESTADO["dossie_ie"] = re.sub(r"\D", "", campos["edtnrInscrEstadual"])
                ESTADO["dossies"].append(ESTADO["dossie_ie"])
                self._html(_dossie(ESTADO["dossie_ie"]))
            else:
                datas = (campos.get("edtDtInicial"), campos.get("edtDtFinal"))
                assert re.fullmatch(r"01/(\d\d)/2026", datas[0]) and datas[1][3:] == datas[0][3:], datas  # um mês
                ESTADO["docs_periodos"].append((ESTADO["dossie_ie"], datas[0][3:5]))
                self._html(_dossie(ESTADO["dossie_ie"], datas))
        elif p == "/atf/componentes/CodDescLst.jsp":
            cid = campos["id"]
            ESTADO["blocos"][cid] = campos.get(f"hidNrDocumento{cid.rsplit('_', 1)[1]}", "")
            self._html(self._componente_simples(cid, ESTADO["blocos"][cid]))
        elif p == "/atf/arr/ARRf_LancamentoEmitirDarContribuinte2.do":
            ESTADO["ultima_ie_faturas"] = ESTADO["blocos"].get(
                "ARRf_LancamentoEmitirDarContribuinte_cmpContribuinte", "")
            self._servico(p, campos)
        elif p == "/atf/arr/emitir.do":
            if "sessao=ok" not in (self.headers.get("Cookie") or ""):
                self._html("Sessão expirada. Faça login.")
                return
            self._servico(p, campos)
        elif p in [u.split("?")[0] for u in FUNCOES.values()]:
            if "sessao=ok" not in (self.headers.get("Cookie") or ""):
                self._html("Sessão expirada. Faça login.")  # a rota do robô tem de levar o cookie
                return
            self._servico(p, campos)
        elif p.startswith("/atf/fis/consultar_"):
            tela = p.rsplit("_", 1)[1].split(".")[0]
            self._html(form_consulta(tela, _responder(tela, campos)))
        else:
            self._html("?")


def _porta_livre() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def ambiente(tmp_path_factory):
    if not CHROME or not Path(CHROME).exists():
        pytest.skip("Chromium não encontrado")
    pasta = tmp_path_factory.mktemp("atf")
    servidor = ThreadingHTTPServer(("127.0.0.1", 0), AtfFalso)
    threading.Thread(target=servidor.serve_forever, daemon=True).start()
    porta_cdp = _porta_livre()
    chrome = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={porta_cdp}", "--no-sandbox",
                               f"--user-data-dir={pasta / 'perfil'}", "--no-first-run", "about:blank"],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{porta_cdp}/json/version", timeout=1)
            break
        except Exception:
            time.sleep(0.2)
    cfg = copy.deepcopy(config.PADRAO)
    cfg["chrome"].update(porta=porta_cdp, pasta_downloads=str(pasta / "downloads"))
    cfg["pastas"].update(destino=str(pasta / "xml"), diagnostico=str(pasta / "diag"))
    cfg["atf"].update(url_login=f"http://127.0.0.1:{servidor.server_port}/atf/", segundos_login=15,
                      segundos_resposta=5, segundos_assistido=2, minutos_espera_mensagens=1,
                      segundos_entre_verificacoes=INTERVALO_CAIXA + 1, segundos_carregar=3,
                      segundos_nova_tentativa_mensagens=1)
    yield cfg, pasta
    chrome.terminate()
    servidor.shutdown()


def _trabalho(ie, nome, tipos, senha="certa", codigo="", cnpj=""):
    return robo_xml.Trabalho(ie=ie, nome=nome, login="mar00134", senha=senha, tipos=tipos,
                             inicio=date(2026, 9, 1), fim=date(2026, 9, 30), cnpj=cnpj, codigo=codigo)


def test_rodada_um_login_xml_pelas_mensagens(ambiente):
    cfg, pasta = ambiente
    ESTADO["logins"].clear()
    # mensagem antiga (de antes da rodada) e uma de outra competência: não podem atrapalhar
    _nova_mensagem("FIS_1322", "NFe: Consulta Genérica (Ano 2026)", -3600,
                   _zip({"velha.xml": nfe(EMPRESA, FORNECEDOR, 99, ie_emit=IE_EMPRESA)}), "antiga")
    executor = robo_xml.Executor(cfg)
    try:
        ESTADO["manual"] = True  # alguém consulta outra empresa à mão no mesmo login, durante a rodada
        ESTADO["agosto"] = True  # resposta de outra competência chega no meio da rodada
        r1, r2, r3 = executor.executar_rodada([
            _trabalho(IE_EMPRESA, "Padaria", ["nfe_saida", "nfe_entrada"], codigo="015"),
            _trabalho(IE_OUTRA, "Mercado", ["nfe_entrada", "nfce"], codigo="016"),
            _trabalho(IE_INEXISTENTE, "IE errada", ["nfe_saida"], codigo="017"),
        ])
    finally:
        executor.fechar()

    assert ESTADO["logins"] == ["mar00134"]  # uma sessão só para a rodada
    assert not ESTADO["recusas"]  # nunca Emitente e Destinatário juntos
    blocos = [("E" if c["emit"] else "D", c["emit"] or c["dest"], c["tela"]) for c in ESTADO["consultas"][-4:]]
    assert blocos == [("E", IE_EMPRESA, "nfe"), ("D", IE_EMPRESA, "nfe"), ("D", IE_OUTRA, "nfe"), ("E", IE_OUTRA, "nfce")]

    assert r1.status == "concluido", r1
    assert r1.detalhes["nfe_saida"]["notas"] == 2 and r1.detalhes["nfe_entrada"]["sem_notas"], r1
    assert r2.status == "concluido", r2
    assert r2.detalhes["nfe_entrada"]["notas"] == 1 and r2.detalhes["nfce"]["notas"] == 1, r2
    assert r3.status == "erro" and "não encontrou a IE" in r3.mensagem, r3
    base = pasta / "xml"
    # o ZIP do ATF guardado como veio, na pasta com o total (2 notas de R$ 100,00); a antiga (nº 99) não entrou
    (zip_saida,) = list(base.glob("Arquivos baixados/015-Padaria/2026-09/NF-e Saida - R$ 200,00/*.zip"))
    assert zip_saida.read_bytes()[:2] == b"PK" and len(zipfile.ZipFile(zip_saida).namelist()) == 2
    assert not list(base.glob("Arquivos baixados/015-Padaria/2026-08"))  # resposta de outra competência não entrou
    assert len(list(base.glob("Arquivos baixados/016-Mercado/2026-09/NF-e Entrada - R$ 100,00/*.zip"))) == 1
    assert len(list(base.glob("Arquivos baixados/016-Mercado/2026-09/NFC-e - R$ 100,00/*.zip"))) == 1
    assert len(list(base.glob("Arquivos baixados/_sem_empresa/*"))) == 2  # a consulta manual e a de agosto
    assert ESTADO["lista_cedo"] == 0  # respeitou o intervalo da caixa de mensagens
    # só abre o necessário: com anexo, só a filha do clipe; sem anexo, para no "Nenhum registro satisfaz"
    por_mae: dict = {}
    for mae_id, filha_id in ESTADO["abertas"]:
        por_mae.setdefault(mae_id, []).append(filha_id)
    for m in ESTADO["mensagens"]:
        abertas = por_mae.get(m["id"], [])
        if not abertas:
            continue
        if any(f["anexo"] for f in m["filhas"]):
            assert abertas == [m["filhas"][1]["id"]], (m["id"], abertas)
        else:
            assert len(abertas) == 2 and m["filhas"][2]["id"] not in abertas, (m["id"], abertas)


def test_senha_errada_nao_insiste(ambiente):
    cfg, _ = ambiente
    ESTADO["logins"].clear()
    executor = robo_xml.Executor(cfg)
    try:
        r1 = executor.executar_rodada([_trabalho(IE_EMPRESA, "Padaria", ["nfe_saida"], senha="errada")])
        r2 = executor.executar_rodada([_trabalho(IE_OUTRA, "Mercado", ["nfe_saida"], senha="errada")])
    finally:
        executor.fechar()
    assert r1[0].status == r2[0].status == "senha_invalida", (r1, r2)
    assert ESTADO["logins"] == ["mar00134"]  # a segunda rodada não tentou de novo


def test_caixa_lenta_tenta_de_novo(ambiente):
    """Minhas Mensagens não abre 2 vezes: o robô espera e na 3ª tentativa consegue."""
    cfg, pasta = ambiente
    ESTADO["caixa_fora"] = 2
    executor = robo_xml.Executor(cfg)
    try:
        (r,) = executor.executar_rodada([_trabalho(IE_EMPRESA, "Lenta", ["nfe_saida"], codigo="020")])
    finally:
        executor.fechar()
    assert ESTADO["caixa_fora"] == 0
    assert r.status == "concluido", r
    assert list((pasta / "xml" / "Arquivos baixados" / "020-Lenta").glob("2026-09/NF-e Saida - R$ */*.zip"))


def test_caixa_nao_abre_e_o_robo_para(ambiente):
    """3 tentativas sem abrir Minhas Mensagens: o robô anuncia o erro e para (exceção sobe)."""
    cfg, _ = ambiente
    ESTADO["caixa_fora"] = 99
    executor = robo_xml.Executor(cfg)
    try:
        with pytest.raises(robo_xml.MensagensIndisponiveis, match="3 tentativas"):
            executor.executar_rodada([_trabalho(IE_EMPRESA, "Parada", ["nfe_saida"], codigo="021")])
    finally:
        executor.fechar()
        ESTADO["caixa_fora"] = 0


def test_faturas_extrato_omissao_certidao(ambiente):
    """Os 4 serviços com PDF na hora, junto com um XML na mesma rodada (o PDF sai enquanto o ATF prepara o XML)."""
    cfg, pasta = ambiente
    ESTADO["servicos"].clear()
    ESTADO["logins"].clear()
    executor = robo_xml.Executor(cfg)
    servicos = ["faturas", "extrato", "omissao", "certidao"]
    try:
        r1, r2 = executor.executar_rodada([
            _trabalho(IE_EMPRESA, "Padaria", ["nfe_saida"] + servicos, codigo="030"),
            _trabalho(IE_OUTRA, "Mercado", ["faturas", "certidao"], codigo="031"),
        ])
    finally:
        if executor.atf:
            print("\n".join(executor.atf.diag.linhas))  # aparece se o teste falhar
        executor.fechar()

    assert ESTADO["logins"] == ["mar00134"]
    assert set(ESTADO["telas_servico"]) >= {"faturas", "extrato", "omissao", "certidao"}
    # extrato com o período da competência
    extrato = next(c for f, ie, c in ESTADO["servicos"] if f == "ARRf_ConsultarExtrPgtoCont")
    assert extrato == {"edtDataInicial": "01/09/2026", "edtDataFinal": "30/09/2026"}, extrato
    # faturas: só os lançamentos que o ATF emite (o DIFERIDO - VALOR MINIMO fica de fora)
    assert ESTADO["faturas_emitidas"] == [["60700321", "61128022"]], ESTADO["faturas_emitidas"]

    assert r1.status == "concluido", r1
    for s in servicos:
        assert r1.detalhes[s]["arquivos"] == 1, (s, r1)
    assert r1.detalhes["nfe_saida"]["notas"] == 2, r1
    base = pasta / "xml" / "Arquivos baixados"
    pdfs = {s: list((base / "030-Padaria" / "2026-09" / arquivos_nome(s)).glob("*.pdf")) for s in servicos}
    for s, achados in pdfs.items():
        assert len(achados) == 1 and achados[0].read_bytes()[:5] == b"%PDF-", (s, achados)
        assert achados[0].name == f"{arquivos_nome(s)} 2026-09.pdf"
    assert b"omissos" in pdfs["omissao"][0].read_bytes()
    assert list((base / "030-Padaria" / "2026-09").glob("NF-e Saida - R$ 200,00/*.zip"))

    assert r2.status == "concluido", r2
    assert r2.detalhes["faturas"]["sem_notas"] and r2.detalhes["faturas"]["arquivos"] == 0, r2
    assert "Faturas: não existem débitos em aberto" in r2.mensagem, r2
    assert (base / "031-Mercado" / "2026-09" / "Certidão de Débitos" / "Certidão de Débitos 2026-09.pdf").exists()


def arquivos_nome(tipo: str) -> str:
    import arquivos
    return arquivos.TIPOS[tipo]


def test_mensagem_atrasada_fica_para_o_final(ambiente):
    """O XML não chega nas 3 leituras da caixa: o robô segue para a próxima rodada e, no final, lê a caixa
    mais uma vez e salva o XML na empresa certa."""
    cfg, pasta = ambiente
    cfg = copy.deepcopy(cfg)
    cfg["atf"]["empresas_por_rodada"] = 1
    ESTADO["atraso"] = 20  # a resposta da Padaria demora mais que 3 leituras (a cada 4 s)
    executor = robo_xml.Executor(cfg)
    try:
        (r1,) = executor.executar_rodada([_trabalho(IE_EMPRESA, "Atrasada", ["nfe_saida"], codigo="040")])
        assert r1.pendente and "aguardando" in r1.mensagem, r1
        (r2,) = executor.executar_rodada([_trabalho(IE_OUTRA, "Seguinte", ["nfce"], codigo="041")])
        assert r2.status == "concluido", r2  # a próxima tarefa não esperou a anterior
        time.sleep(12)
        repescados, tudo = executor.repescar()
    finally:
        if executor.atf:
            print("\n".join(executor.atf.diag.linhas))  # aparece se o teste falhar
        executor.fechar()
    assert tudo, repescados
    ((_, (r,)),) = repescados
    assert r.status == "concluido" and not r.pendente and r.detalhes["nfe_saida"]["notas"] == 2, r
    assert list((pasta / "xml" / "Arquivos baixados" / "040-Atrasada").glob("2026-09/NF-e Saida - R$ 200,00/*.zip"))


def test_mensagem_que_nunca_chega_para_de_vez(ambiente):
    """Nem a leitura do final traz o XML: o resultado fica com erro e o robô deve parar (tudo=False)."""
    cfg, _ = ambiente
    ESTADO["atraso"] = 3600
    executor = robo_xml.Executor(cfg)
    try:
        (r1,) = executor.executar_rodada([_trabalho(IE_EMPRESA, "Nunca", ["nfe_saida", "certidao"], codigo="042")])
        assert r1.pendente, r1
        repescados, tudo = executor.repescar()
    finally:
        executor.fechar()
    assert not tudo
    ((_, (r,)),) = repescados
    assert not r.pendente and "não entregou NF-e Saida" in r.mensagem, r
    assert r.detalhes["certidao"]["arquivos"] == 1  # o que funcionou ficou salvo


def test_cte_e_conferencia_de_cartao(ambiente):
    """CT-e (FIS_1192, IE no Destinatário, ZIP em Minhas Mensagens com 4 filhas) e conferência de cartão
    (Dossiê > Docs fiscais > Cartão: a janela que abre vira PDF)."""
    cfg, pasta = ambiente
    executor = robo_xml.Executor(cfg)
    andamento = []  # o que o portal recebe, tarefa a tarefa
    executor.ao_progresso = lambda t, tipo, situacao, msg: andamento.append((t.ie, tipo, situacao))
    try:
        r1, r2 = executor.executar_rodada([
            _trabalho(IE_EMPRESA, "Transporte", ["cte", "cartao", "mei"], codigo="050"),
            _trabalho(IE_OUTRA, "SemCartao", ["cte", "cartao", "mei"], codigo="051"),
        ])
    finally:
        if executor.atf:
            print("\n".join(executor.atf.diag.linhas))  # aparece se o teste falhar
        executor.fechar()
    consultas = [c for c in ESTADO["consultas"] if c["tela"] == "cte"]
    assert [(c["rem"], c["dest"]) for c in consultas[-4:]] == [
        (IE_EMPRESA, ""), ("", IE_EMPRESA), (IE_OUTRA, ""), ("", IE_OUTRA)]  # remetente e destinatário
    assert r1.status == "concluido", r1
    assert r1.detalhes["cte_dest"]["notas"] == 1 and r1.detalhes["cte_rem"]["notas"] == 1, r1
    assert r1.detalhes["cartao"]["arquivos"] == 1, r1
    base = pasta / "xml" / "Arquivos baixados"
    (zip_cte,) = list(base.glob("050-Transporte/2026-09/CT-e Destinatario - R$ 150,00/*.zip"))
    assert zip_cte.read_bytes()[:2] == b"PK"
    assert list(base.glob("050-Transporte/2026-09/CT-e Remetente - R$ 70,00/*.zip"))
    (pdf,) = list(base.glob("050-Transporte/2026-09/Conferência Cartão de Crédito/*.pdf"))
    assert pdf.read_bytes()[:5] == b"%PDF-" and pdf.name == "Conferência Cartão de Crédito 2026-09.pdf"
    assert ESTADO["cartao"][-1]["refIni"] == "09/2026" and ESTADO["cartao"][-1]["ie"] == IE_EMPRESA
    assert all(c["ie"] == IE_EMPRESA for c in ESTADO["cartao"])  # "- Cartão: 0 / 0,00" não abre a janela
    # Dossiê MEI: entradas e saídas do mês (da mesma consulta do cartão); quem não é SIMEI fica de fora
    assert (r1.detalhes["mei"]["saidas"], r1.detalhes["mei"]["entradas"], r1.detalhes["mei"]["cartao"]) == (
        4200.5, 1000.0, 13585.0), r1
    # MEI que chega sem acompanhamento: do início da atividade (03/2026) até setembro, na mesma tela
    meses = [m for ie, m in ESTADO["docs_periodos"] if ie == IE_EMPRESA]
    assert meses == ["09", "03", "04", "05", "06", "07", "08"], meses
    mei = r1.detalhes["mei"]
    assert mei["meses"] == [f"2026-{m:02d}" for m in range(3, 10)] and mei["limite_ano"] == 67500.0  # março a dezembro: 10 x 6.750
    assert (mei["notas_acumulado"], mei["cartao_acumulado"]) == (4700.5, 13885.0), mei  # notas e cartão separados
    assert len([c for c in ESTADO["dossies"] if c == IE_EMPRESA]) == 1  # o dossiê foi consultado uma vez só
    dados = json.loads((base / "050-Transporte/Dossiê MEI/Faturamento MEI 2026.json").read_text(encoding="utf-8"))
    assert dados["meses"]["2026-09"]["saidas"] == 4200.5
    assert (base / "050-Transporte/Dossiê MEI/Faturamento MEI 2026.xlsx").exists()
    assert r2.detalhes["mei"]["sem_notas"] and "não é MEI" in r2.mensagem, r2
    assert r2.detalhes["cte_dest"]["sem_notas"] and r2.detalhes["cte_rem"]["sem_notas"], r2
    # andamento um a um: cada serviço avisa quando começa e quando termina
    da_empresa = [(tipo, sit) for ie, tipo, sit in andamento if ie == IE_EMPRESA]
    assert da_empresa[:2] == [("cte_rem", "andamento"), ("cte_rem", "aguardando")], da_empresa
    assert ("cartao", "andamento") in da_empresa and ("cartao", "concluido") in da_empresa, da_empresa
    assert ("cartao", "sem_movimento") in [(tipo, sit) for ie, tipo, sit in andamento if ie == IE_OUTRA]
    assert {k: v["situacao"] for k, v in r1.detalhes.items()} == {
        "cte_rem": "concluido", "cte_dest": "concluido", "cartao": "concluido", "mei": "concluido"}, r1.detalhes
    assert r2.detalhes["cte_dest"]["situacao"] == "sem_movimento" and r2.detalhes["mei"]["situacao"] == "sem_movimento"
    assert r2.detalhes["cartao"]["sem_notas"] and "não existem operações com cartão" in r2.mensagem, r2


def test_mei_segunda_vez_so_a_competencia(ambiente):
    """Com o ano já acompanhado, a próxima rodada consulta só a competência; com refazer_ano, o ano todo."""
    cfg, _ = ambiente
    cfg = copy.deepcopy(cfg)
    for refazer, esperado in ((False, ["09"]), (True, ["09", "03", "04", "05", "06", "07", "08"])):
        cfg["mei"]["refazer_ano"] = refazer
        ESTADO["docs_periodos"].clear()
        executor = robo_xml.Executor(cfg)
        enviados = []
        executor.ao_mei = lambda t, resumo: enviados.append((t.ie, resumo))
        try:
            (r,) = executor.executar_rodada([_trabalho(IE_EMPRESA, "Transporte", ["mei"], codigo="050")])
        finally:
            executor.fechar()
        assert [m for _, m in ESTADO["docs_periodos"]] == esperado, (refazer, ESTADO["docs_periodos"])
        # o painel recebe o ano inteiro (também os meses buscados em rodadas anteriores), sem a tabela bruta
        ((ie, resumo),) = enviados
        assert ie == IE_EMPRESA and resumo["inicio_atividade"] == "2026-03-10"
        assert sorted(resumo["historico"]) == [f"2026-{m:02d}" for m in range(3, 10)]
        assert all("linhas" not in m for m in resumo["historico"].values())
        assert r.detalhes["mei"]["notas_acumulado"] == 4700.5, r
