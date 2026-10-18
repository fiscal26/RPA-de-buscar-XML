"""ATF da SEFAZ-PB: login do contador, consulta das notas pela inscrição estadual e recebimento
dos XML em "Minhas Mensagens".

Roteiro (telas do ATF em produção, out/2026):
- Login com o LOGIN e a SENHA do contador (planilha). Um login atende várias empresas: o robô
  entra uma vez e faz todas as empresas daquele login.
- NF-e Saída e NF-e Entrada: menu "NF-e" > "Consulta NF-e por Emitentes/Destinatários" (FIS_1322).
  "Data de Emissão" do 1º ao último dia da competência; a inscrição estadual vai no bloco
  "Emitente" (saída) OU no "Destinatário" (entrada), nunca nos dois; "Pesquisar" do bloco confere a
  IE e traz o nome; "Tipo de Exibição" = XML; "Consultar".
- NFC-e: menu "NFC-e" > "Consulta por Emitente" (FIS_1484): "Data Emissão Inicial/Final", IE no
  bloco "Emitente", Tipo de Exibição XML, Consultar.
- O ATF processa e entrega o XML como anexo em "Minhas Mensagens" (sino do topo; SEG_064), numa
  mensagem do remetente "FIS_1322 - Consulta Genérica NF-e" ou "FIS_1484 - Consulta de NFC-e por
  Emitente". O robô envia todas as consultas do login, depois acompanha as mensagens novas e baixa
  os anexos. Quem diz de qual empresa é cada XML é o próprio XML (arquivos.distribuir).

Serviços que o ATF responde na hora com um PDF (gravações de 18/10/2026), sem Minhas Mensagens:
- Faturas (ARR_278, "Emissão de DAR > Lançamentos Espontâneos"): IE, Pesquisar, Avançar; marca todos os
  lançamentos menos os "DIFERIDO - VALOR MINIMO" (o ATF não emite esses) e clica em Emitir.
- Extrato de Pagamentos (ARR_087): período de pagamento do 1º ao último dia da competência, IE,
  Pesquisar, Consultar.
- Omissão e Inadimplência (COB_187): IE, Pesquisar, Consultar (o PDF completo).
- Certidão de Débitos (DIA_061): IE, Pesquisar, Submeter (com o login, como em todo o robô).

Se o menu não responder, o robô abre a tela pelo campo "Função" do topo (código FIS_/SEG_).
Etapa não reconhecida gera um pacote de diagnóstico (tela.png, campos.txt, texto.txt, log.txt) e
passa para o modo assistido. Senhas nunca entram no diagnóstico.
"""
from __future__ import annotations

import random
import re
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Callable
from urllib.parse import urlparse

from navegador import CapturadorArquivos, pausa

Aviso = Callable[[str], None]

_ERRO_LOGIN = re.compile(
    r"senha\s+(inv[aá]lida|incorreta|n[aã]o confere|expirada)|usu[aá]rio\s+(inv[aá]lido|n[aã]o encontrado|bloqueado)|"
    r"login\s+(inv[aá]lido|incorreto)|acesso\s+negado|dados\s+de\s+acesso\s+inv[aá]lidos|conta\s+bloqueada|"
    r"usu[aá]rio\s+ou\s+senha\s+(inv[aá]lid|incorret)",
    re.I,
)
_SEM_NOTAS = re.compile(
    r"nenhum\s+registro\s+satisfaz|nenhum(a)?\s+(nota|documento|registro|nf-?c?-?e|arquivo|resultado)|n[aã]o\s+(foram\s+)?encontrad[oa]s?|"
    r"n[aã]o\s+h[aá]\s+(notas|documentos|registros)|sem\s+(notas|documentos|registros)|consulta\s+vazia",
    re.I,
)
_FORA_DO_AR = re.compile(r"servi[cç]o\s+(temporariamente\s+)?indispon[ií]vel|em\s+manuten[cç][aã]o|"
                         r"service unavailable|bad gateway|gateway time-?out", re.I)

_CAMPOS_LOGIN = ['input[name="edtNoLogin"]', '#login', 'input[name*="usuario" i]', 'input[id*="usuario" i]', 'input[name*="login" i]', 'input[id*="login" i]', 'input[name*="usuario" i]',
                 'input[id*="usuario" i]', 'input[name*="user" i]', 'input[name*="cpf" i]']
_BOTOES_ENTRAR = ['button[name="btnAvancar"]', 'button:has-text("Avançar")', 'input[value*="Avançar" i]', 'button[type="submit"]', 'input[type="submit"]', 'input[type="image"]',
                  'button:has-text("Entrar")', 'button:has-text("Acessar")', 'a:has-text("Entrar")',
                  'input[value*="Entrar" i]', 'input[value*="Acessar" i]', 'input[value*="OK" i]']
_ERRO_CONSULTA = re.compile(r"\berro\b|inv[aá]lid|obrigat[oó]ri|n[aã]o\s+(foi\s+)?(encontrad|localizad|cadastrad)|"
                            r"informe\s+|preencha|n[aã]o\s+permitid|sem\s+permiss", re.I)
# Tela da consulta, depois de clicar em Consultar
_CONFIRMADA = re.compile(r"resultado\s+ser[aá]\s+enviado|caixa\s+de\s+mensagens", re.I)
# Mensagem final de uma consulta (as outras 2 mensagens da mesma consulta são de andamento)
_MENSAGEM_FINAL = re.compile(r"tarefa\s+executada|executada\s+com\s+sucesso|n[aã]o\s+existem\s+dados|relat[oó]rio\s+gerado|"
                             r"nenhum\s+registro\s+satisfaz", re.I)
_PERIODO = re.compile(r"per[ií]odo\s+solicitado:?\s*(\d{2}/\d{2}/\d{4})\s*a\s*(\d{2}/\d{2}/\d{4})", re.I)
_INPUT_TEXTO = "input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit])"
_BOTAO = "button, input[type=button], input[type=submit], a.btn"
# sufixo dos campos de cada bloco no ATF (hidNrDocumentocmpEmit, cmbTpDoccmpDest...)
_SUFIXO_BLOCO = {"Emitente": "Emit", "Destinatário": "Dest"}

# Acha o campo que vem depois de um texto da tela e marca com data-robo-alvo
_JS_APOS_ROTULO = """([rotulo, css, ordem, texto, marca]) => {
    const norm = s => (s || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')
        .replace(/[\\s\\u00a0]+/g, ' ').trim().toLowerCase();
    const vis = e => { const r = e.getBoundingClientRect(); const st = getComputedStyle(e);
        return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none'; };
    const alvo = norm(rotulo);
    const todos = Array.from(document.body ? document.body.querySelectorAll('*') : []);
    const ignorar = ['OPTION', 'SCRIPT', 'STYLE', 'SELECT', 'TEXTAREA', 'INPUT', 'NOSCRIPT'];
    const txt = e => norm(e.innerText !== undefined ? e.innerText : e.textContent);
    const rotulos = todos.filter(e => !ignorar.includes(e.tagName) && vis(e) && txt(e) === alvo
        && !Array.from(e.children).some(c => txt(c) === alvo));
    for (const r of rotulos) {
        let n = 0;
        for (const e of todos) {
            if (r.contains(e) || !(r.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
            if (!e.matches(css) || !vis(e)) continue;
            if (texto && norm(e.innerText || e.value) !== norm(texto)) continue;
            if (++n === ordem) { e.setAttribute('data-robo-alvo', marca); return true; }
        }
    }
    return false;
}"""
# Anexos dentro de uma mensagem aberta
_SELETOR_ANEXOS = ('a:has-text("Dados referentes"), a[href*=".zip" i], a[href*=".xml" i], a[href*="anexo" i], a[href*="download" i], '
                   'a[href*="arquivo" i], a[download], a:has-text(".zip"), a:has-text(".xml"), '
                   'a[title*="anexo" i], a[title*="download" i], button[title*="download" i], button:has-text("Download")')

# Minhas Mensagens: cada linha tem links "javascript:abrirFilhas('<id>',<n filhas>)". Agrupa por id:
# código do remetente (FIS_1322...), data de envio e quantas filhas (a consulta gera uma mãe com 3).
_JS_MENSAGENS = """() => {
    const m = new Map();
    for (const a of document.querySelectorAll('a[href*="abrirFilhas"]')) {
        const r = /abrirFilhas\\(\\s*'?(\\d+)'?\\s*,\\s*(\\d+)\\s*\\)/.exec(a.getAttribute('href') || '');
        if (!r) continue;
        if (!m.has(r[1])) m.set(r[1], {id: r[1], filhas: +r[2], codigo: '', data: null, remetente: '', anexo: false, icones: 0});
        const o = m.get(r[1]);
        const t = (a.innerText || '').replace(/\\s+/g, ' ').trim();
        if (!t) o.icones += 1;  // links de ícone: envelope sempre; clipe só quando há anexo
        const linha = a.closest('tr');
        const imgs = Array.from((linha || a).querySelectorAll('img, i, span'));
        if (imgs.some(i => /clip|anex|attach/i.test((i.getAttribute('src') || '') + ' ' + (i.getAttribute('alt') || '')
                + ' ' + (i.getAttribute('title') || '') + ' ' + (i.className || '')))) o.anexo = true;
        const c = /\\b(FIS|SEG)_\\d+/.exec(t);
        if (c && !o.codigo) { o.codigo = c[0]; o.remetente = t; }
        const d = /\\d{2}\\/\\d{2}\\/\\d{4}\\s+\\d{2}:\\d{2}:\\d{2}/.exec(t);
        if (d && !o.data) o.data = d[0];
    }
    return Array.from(m.values()).map(o => Object.assign(o, {anexo: o.anexo || o.icones >= 2}));
}"""

# Tipo de XML -> tela e bloco onde vai a inscrição estadual (um bloco por consulta)
TIPO_TELA = {
    "nfe_saida": ("nfe", "Emitente"),
    "nfe_entrada": ("nfe", "Destinatário"),
    "nfce": ("nfce", "Emitente"),
}


# Serviços com resposta na hora (PDF): tipo -> tela em config.atf.telas
SERVICOS = ("faturas", "extrato", "omissao", "certidao")
_NAO_EMITE = re.compile(r"diferido\s*-\s*valor\s+m[ií]nimo", re.I)
_SEM_DOCUMENTO = re.compile(r"nenhum(a)?\s+(registro|lan[cç]amento|pagamento|d[eé]bito|resultado)|n[aã]o\s+(foram\s+)?encontrad|"
                            r"n[aã]o\s+(h[aá]|existe[mn]?)\s+(registro|lan[cç]amento|pagamento|d[eé]bito|dado)|"
                            r"0\s+registros?\s+encontrad", re.I)
_ERRO_DOCUMENTO = re.compile(r"n[aã]o\s+[eé]\s+permitid|\berro\b|inv[aá]lid|obrigat[oó]ri|informe\s+|n[aã]o\s+foi\s+poss[ií]vel", re.I)


class SenhaInvalida(Exception):
    pass


class SiteForaDoAr(Exception):
    pass


class SessaoExpirada(Exception):
    pass


class EtapaNaoConcluida(Exception):
    pass


class IeNaoEncontrada(Exception):
    pass


class MensagensIndisponiveis(Exception):
    """Minhas Mensagens não abriu depois de todas as tentativas: o robô para."""

    def __init__(self, texto: str, recolha=None):
        super().__init__(texto)
        self.recolha = recolha  # o que já tinha sido baixado antes (é salvo antes de parar)


@dataclass
class Envio:
    """Uma consulta enviada (empresa + tipo). A resposta chega depois, em Minhas Mensagens."""
    ie: str
    tipo: str
    ok: bool = True
    sem_notas: bool = False
    assistido: bool = False
    resposta: str = ""
    hora: datetime | None = None   # hora do ATF ao clicar em Consultar (as mensagens chegam depois dela)


@dataclass
class Emissao:
    """Um serviço com resposta na hora (faturas, extrato, omissão, certidão) de uma empresa."""
    ie: str
    tipo: str
    arquivos: list[tuple[str, bytes]] = field(default_factory=list)
    ok: bool = True
    sem_dados: bool = False
    resposta: str = ""


@dataclass
class Recolha:
    """O que veio de Minhas Mensagens nesta rodada."""
    arquivos: list[tuple[str, bytes]] = field(default_factory=list)
    textos: list[tuple[str, str]] = field(default_factory=list)   # (código FIS, texto da mensagem)
    recebidas: dict[str, int] = field(default_factory=dict)       # código FIS -> mensagens lidas
    ignorados: list[tuple[str, bytes]] = field(default_factory=list)  # anexos de outra competência/empresa
    tempo_esgotado: bool = False


class Diagnostico:
    """Pacote para entender uma falha: o que o robô viu na tela, sem senhas."""

    def __init__(self, pasta_base: str, rotulo: str):
        self.pasta_base = Path(pasta_base)
        self.rotulo = re.sub(r"[^A-Za-z0-9]+", "", rotulo)[:20]
        self.linhas: list[str] = []

    def log(self, texto: str):
        self.linhas.append(f"{datetime.now():%H:%M:%S} {texto}")

    def salvar(self, page, motivo: str) -> Path | None:
        pasta = self.pasta_base / f"{datetime.now():%Y-%m-%d_%H%M%S}_{self.rotulo}_{re.sub(r'[^a-z0-9]+', '-', motivo.lower())[:30]}"
        try:
            pasta.mkdir(parents=True, exist_ok=True)
            (pasta / "log.txt").write_text("\n".join(self.linhas + [f"MOTIVO: {motivo}"]), encoding="utf-8")
            if page is None or page.is_closed():
                return pasta
            try:
                page.screenshot(path=str(pasta / "tela.png"), full_page=True)
            except Exception:
                pass
            campos, textos = [f"URL: {page.url}"], []
            for i, frame in enumerate(page.frames):
                campos.append(f"\n=== quadro {i}: {frame.name or '-'} {frame.url}")
                try:
                    campos.extend(frame.evaluate(_JS_CAMPOS))
                    textos.append(f"=== quadro {i} ({frame.url})\n" + frame.evaluate("() => document.body ? document.body.innerText : ''")[:20000])
                except Exception as e:
                    campos.append(f"(não li o quadro: {e})")
            (pasta / "campos.txt").write_text("\n".join(campos), encoding="utf-8")
            (pasta / "texto.txt").write_text("\n\n".join(textos), encoding="utf-8")
        except Exception:
            return None
        return pasta


# Lista campos, botões e links sem o VALOR dos campos de texto (não vaza senha)
_JS_CAMPOS = """() => Array.from(document.querySelectorAll('input, select, textarea, button, a')).slice(0, 500).map(e => {
    const r = e.getBoundingClientRect();
    const vis = r.width > 0 && r.height > 0 ? 'visível' : 'oculto';
    const rot = (e.labels && e.labels[0] ? e.labels[0].innerText : '') || e.getAttribute('aria-label') || e.placeholder || e.title || '';
    const txt = e.tagName === 'A' || e.tagName === 'BUTTON' ? (e.innerText || '').trim().slice(0, 60) : '';
    const val = e.type === 'submit' || e.type === 'button' ? (e.value || '') : '';
    const sel = e.tagName === 'SELECT' ? 'opções=' + Array.from(e.options).map(o => o.text.trim()).slice(0, 15).join(' / ') : '';
    return [e.tagName.toLowerCase(), e.type || '', 'name=' + (e.name || ''), 'id=' + (e.id || ''),
            'class=' + String(e.className || '').slice(0, 60),
            rot ? 'rótulo=' + rot.trim().slice(0, 60) : '', txt ? 'texto=' + txt : '', val ? 'valor=' + val : '', sel,
            e.tagName === 'A' ? 'href=' + (e.getAttribute('href') || '').slice(0, 120) : '', vis].filter(Boolean).join(' | ');
})"""


def _texto_da_pagina(page) -> str:
    partes = []
    for frame in page.frames:
        try:
            partes.append(frame.evaluate("() => document.body ? document.body.innerText : ''"))
        except Exception:
            continue
    return "\n".join(partes)


def _data_br(texto: str) -> datetime:
    return datetime.strptime(texto, "%d/%m/%Y %H:%M:%S")


def _xpath_texto(texto: str) -> str:
    """Condição XPath: texto exato do elemento, sem diferenciar maiúsculas nem acentos."""
    de, para = "ABCDEFGHIJKLMNOPQRSTUVWXYZÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç", "abcdefghijklmnopqrstuvwxyzaaaaeeiooouc" + "aaaaeeiooouc"
    alvo = texto.lower().translate(str.maketrans("áàâãéêíóôõúç", "aaaaeeiooouc"))
    return f"translate(normalize-space(.), '{de}', '{para}')='{alvo}'"


class AtfPB:
    def __init__(self, contexto, cfg: dict, aviso: Aviso, diagnostico: Diagnostico, segundos_assistido: int | None = None):
        self.contexto = contexto
        self.cfg = cfg
        self.atf = cfg["atf"]
        self.aviso = aviso
        self.diag = diagnostico
        self.segundos_assistido = segundos_assistido or self.atf["segundos_assistido"]
        self.page = contexto.new_page()
        self.login_atual = ""
        self.ultimo_uso = 0.0
        self._url_tela: dict[str, tuple] = {}  # tela -> (quadro, endereço)
        self._respostas: list[str] = []
        self._mensagens_lidas: set[str] = set()   # consultas (mensagens mãe) já concluídas
        self._filhas_lidas: set[str] = set()
        self._diag_mensagem_salvo = False
        self._hora_consulta: datetime | None = None
        self._marcas = 0
        self._ultima_lista = 0.0
        self.page.on("dialog", self._dialogo)

    # ------------------------------------------------------------------ utilidades
    def _log(self, texto: str):
        self.diag.log(texto)

    def _primeiro_visivel(self, loc):
        try:
            for i in range(min(loc.count(), 8)):
                if loc.nth(i).is_visible():
                    return loc.nth(i)
        except Exception:
            pass
        return None

    def _achar(self, fixo: str, candidatos: list[str], dentro=None):
        """Primeiro elemento visível: o seletor do config.json, se houver, ou os candidatos,
        procurando em todos os quadros da página."""
        seletores = [fixo] if fixo else candidatos
        quadros = [dentro] if dentro is not None else self.page.frames
        for frame in quadros:
            for sel in seletores:
                try:
                    achado = self._primeiro_visivel(frame.locator(sel))
                except Exception:
                    achado = None
                if achado is not None:
                    return achado
        return None

    def _apos_rotulo(self, rotulo: str, css: str, ordem: int = 1, texto: str = ""):
        """Campo visível que vem depois de um texto da tela (ex.: o 2º input depois de 'Data de Emissão',
        o 1º input depois do título 'Emitente'). Compara sem acento, sem maiúscula e ignorando espaços
        invisíveis (&nbsp;). 'texto' filtra pelo texto do próprio campo (ex.: botão 'Pesquisar')."""
        self._marcas += 1
        marca = f"r{self._marcas}"
        for frame in self.page.frames:
            try:
                if frame.evaluate(_JS_APOS_ROTULO, [rotulo, css, ordem, texto, marca]):
                    return frame.locator(f'[data-robo-alvo="{marca}"]').first
            except Exception:
                continue
        return None

    def _digitar(self, campo, texto: str):
        try:
            campo.scroll_into_view_if_needed(timeout=3000)
            campo.click(timeout=5000)
        except Exception:
            campo.focus()  # algo por cima do campo (calendário, rótulo flutuante): só foca
        campo.fill("")
        for letra in texto:
            campo.press_sequentially(letra)
            time.sleep(random.uniform(0.04, 0.12))

    def _abrir(self, url: str):
        try:
            self.page.goto(url, wait_until="domcontentloaded", timeout=60_000)
        except Exception as e:
            self._log(f"Não abri {url[:100]}: {str(e).splitlines()[0][:150]}")
            if "net::ERR" in str(e) or "Timeout" in type(e).__name__:
                raise SiteForaDoAr(f"não consegui abrir o ATF ({e.__class__.__name__}).") from e
            raise
        pausa(self.page, 1.0, 2.0)
        if _FORA_DO_AR.search(_texto_da_pagina(self.page)[:3000]):
            raise SiteForaDoAr("o ATF informou que o serviço está indisponível.")

    def _senha_na_tela(self):
        return self._achar(self.atf["seletores"]["senha"], ['input[type="password"]'])

    def _quadro_de(self, loc):
        try:
            return loc.element_handle().owner_frame()
        except Exception:
            return None

    def sessao_valida(self, login: str) -> bool:
        """A sessão aberta serve para este login? (o ATF expira em 15 min sem uso)"""
        minutos = self.atf["minutos_sessao"]
        return (self.login_atual == login and time.time() - self.ultimo_uso < minutos * 60
                and not self.page.is_closed() and self._senha_na_tela() is None)

    # ------------------------------------------------------------------ login
    def entrar(self, login: str, senha: str):
        sel = self.atf["seletores"]
        if self.login_atual:
            self.sair(silencioso=True)
        self._log(f"Abrindo {self.atf['url_login']} (login {login})")
        self._abrir(self.atf["url_login"])
        campo_senha = self._senha_na_tela()
        if campo_senha is None:
            # pode haver uma sessão aberta de antes: sai e recarrega
            self.sair(silencioso=True)
            self._abrir(self.atf["url_login"])
            campo_senha = self._senha_na_tela()
        automatico = self.atf["tentar_automatico"] and campo_senha is not None
        if automatico:
            frame = self._quadro_de(campo_senha)
            campo_login = self._achar(sel["login"], _CAMPOS_LOGIN, frame) or \
                self._achar("", ['input[type="text"]', 'input:not([type])'], frame)
            if campo_login is None:
                self._log("Campo de login não encontrado")
                automatico = False
            else:
                self._digitar(campo_login, login)
                pausa(self.page, 0.3, 0.8)
                self._digitar(campo_senha, senha)
                pausa(self.page, 0.3, 0.8)
                botao = self._achar(sel["entrar"], _BOTOES_ENTRAR, frame)
                if botao is not None:
                    botao.click()
                else:
                    campo_senha.press("Enter")
        if not automatico:
            self.diag.salvar(self.page, "login-nao-reconhecido")
            self.aviso(f"Não reconheci a tela de login do ATF: entre no Chrome com o login {login}.")

        limite = time.time() + (self.atf["segundos_login"] if automatico else self.segundos_assistido)
        avisou_captcha = False
        while time.time() < limite:
            pausa(self.page, 0.8, 1.2)
            texto = _texto_da_pagina(self.page)
            erro = _ERRO_LOGIN.search(texto)
            if erro:
                self._log(f"ATF recusou o login: {erro.group(0)}")
                raise SenhaInvalida(f"o ATF recusou o acesso ({erro.group(0).lower()}). Confira login e senha.")
            if self._senha_na_tela() is None and texto.strip():
                # o topo do ATF mostra "Login: mar00134": tem de ser o login pedido
                aberto = re.search(r"login:\s*([\w.@-]+)", texto, re.I)
                if aberto and aberto.group(1).lower() != login.lower():
                    self.sair(silencioso=True)
                    raise EtapaNaoConcluida(f"o ATF abriu a sessão de outro login ({aberto.group(1)})")
                self._log("Login aceito")
                self.login_atual = login
                self.ultimo_uso = time.time()
                return
            if automatico and not avisou_captcha and re.search(r"captcha|n[aã]o sou um rob", texto, re.I):
                avisou_captcha = True
                self.aviso("O ATF pediu captcha: resolva no Chrome e clique em entrar.")
                limite = time.time() + self.segundos_assistido
        pasta = self.diag.salvar(self.page, "login-sem-resposta")
        raise EtapaNaoConcluida("o ATF não confirmou o login a tempo." + (f" Diagnóstico: {pasta}" if pasta else ""))

    # ------------------------------------------------------------------ navegação
    def _quadro_da_tela(self, tela: dict):
        """Quadro (frame) onde a tela está aberta. O ATF é dividido em quadros: cabeçalho, menu e conteúdo."""
        if tela.get("pagina"):
            for frame in self.page.frames:
                if tela["pagina"].lower() in (frame.url or "").lower():
                    # o endereço certo não basta: o ATF lento mostra a página ainda vazia ("Aguarde...")
                    try:
                        if not tela.get("pronta") or frame.locator(tela["pronta"]).count():
                            return frame
                    except Exception:
                        continue
        for frame in self.page.frames:
            try:
                if re.search(re.escape(tela["titulo"]), frame.evaluate("() => document.body ? document.body.innerText : ''"), re.I):
                    return frame
            except Exception:
                continue
        return None

    def _tela_aberta(self, tela: dict) -> bool:
        return self._quadro_da_tela(tela) is not None

    def _clicar_texto(self, texto: str) -> bool:
        alvo = self._achar("", [f"xpath=//a[{_xpath_texto(texto)}]", f"xpath=//*[self::button or self::li or self::span]"
                                                                     f"[{_xpath_texto(texto)}]"])
        if alvo is None:
            return False
        alvo.click()
        pausa(self.page, 0.8, 1.5)
        return True

    def _ir(self, frame, url: str):
        try:
            frame.goto(url, wait_until="domcontentloaded", timeout=60_000)
        except Exception as e:
            self._log(f"Não abri {url[:100]}: {str(e).splitlines()[0][:150]}")
            if "net::ERR" in str(e) or "Timeout" in type(e).__name__:
                raise SiteForaDoAr(f"não consegui abrir o ATF ({e.__class__.__name__}).") from e
            raise
        pausa(self.page, 1.0, 1.8)

    def _esperar_tela(self, tela: dict) -> bool:
        """O ATF às vezes demora: espera a tela aparecer por até 'segundos_carregar'."""
        limite = time.time() + self.atf["segundos_carregar"]
        while time.time() < limite:
            pausa(self.page, 0.8, 1.2)
            if self._tela_aberta(tela):
                return True
        return False

    def abrir_tela(self, nome: str, recarregar: bool = True):
        """Abre uma tela do ATF: pelo endereço já visitado (no mesmo quadro), pelo link do menu, pelo
        botão (sino das mensagens), pelo texto do menu ou pelo campo Função do topo."""
        tela = self.atf["telas"][nome]
        if self._senha_na_tela() is not None:
            raise SessaoExpirada("o ATF voltou para a tela de login.")
        guardado = self._url_tela.get(nome)
        if guardado and (recarregar or not self._tela_aberta(tela)):
            frame, url = guardado
            try:
                if not frame.is_detached():
                    self._ir(frame, url)  # formulário limpo / lista de mensagens atualizada
                    if self._tela_aberta(tela):
                        return
            except SiteForaDoAr:
                raise
            except Exception:
                pass
        if not self._tela_aberta(tela) and tela.get("pagina"):
            link = self._achar("", [f'a[href*="{tela["pagina"]}"]'])
            if link is not None:
                link.click()
                self._esperar_tela(tela)
        if tela.get("botao") and not self._tela_aberta(tela):
            botao = self._achar("", tela["botao"])
            if botao is not None:
                botao.click()
                self._esperar_tela(tela)
        # menu lateral: volta à raiz (/ MEN), entra no módulo e escolhe a consulta
        if tela.get("menu") and not self._tela_aberta(tela):
            for _ in range(2):
                self._clicar_texto("/ MEN") or self._clicar_texto("MEN")
                if self._clicar_texto(tela["menu"][0]):
                    link = self._achar("", [f'a[href*="{tela["pagina"]}"]']) if tela.get("pagina") else None
                    if link is not None:
                        link.click()
                        pausa(self.page, 1.5, 2.5)
                        break
                    if self._clicar_texto(tela["menu"][1]):
                        break
                menu = self._achar("", ['#toggleMenuHeader', 'button[aria-label*="menu" i]', '.navbar-toggler',
                                        'button[title*="menu" i]'])
                if menu is not None:
                    menu.click()
                    pausa(self.page, 0.5, 1.0)
        if not self._tela_aberta(tela):
            # campo "Função" do topo, com o código da tela
            campo = self._achar("", ['input[placeholder="Função" i]', 'input[placeholder*="Fun" i]'])
            if campo is not None:
                self._log(f"Abrindo pela Função {tela['funcao']}")
                self._digitar(campo, tela["funcao"])
                campo.press("Enter")
                pausa(self.page, 1.5, 2.5)
                sugestao = self._achar("", [f'li:has-text("{tela["funcao"]}")', f'a:has-text("{tela["funcao"]}")'])
                if sugestao is not None and not self._tela_aberta(tela):
                    sugestao.click()
                    pausa(self.page, 1.5, 2.5)
        if not self._tela_aberta(tela) and tela.get("endereco"):
            conteudo = self._quadro_conteudo()
            if conteudo is not None:
                self._log(f"Abrindo pelo endereço {tela['endereco']}")
                self._ir(conteudo, self._endereco(tela))
                self._esperar_tela(tela)
        frame = self._quadro_da_tela(tela)
        if frame is None:
            raise EtapaNaoConcluida(f"não consegui abrir a tela '{tela['titulo']}'")
        url = frame.url
        if nome == "mensagens":  # sempre a lista principal, não a de uma mensagem aberta
            url = url.split("SEGf_")[0] + "SEGf_MinhasMensagens.do?limparSessao=true"
        elif tela.get("endereco"):  # formulário limpo (não a tela de resultado)
            url = self._endereco(tela)
        self._url_tela[nome] = (frame, url)
        self._log(f"Tela aberta: {tela['titulo']} ({frame.url[:90]})")

    def _endereco(self, tela: dict) -> str:
        return self.atf["url_login"].split("/atf/")[0] + "/atf/" + tela["endereco"]

    def _quadro_conteudo(self):
        """Quadro de conteúdo do ATF (nem o cabeçalho, nem o menu, nem um componente). None quando a aba
        não está mais no ATF (ex.: o PDF da certidão tomou a aba inteira)."""
        if not any("cabecalho" in (f.url or "") or "SEGf_Menu" in (f.url or "") for f in self.page.frames):
            return None
        candidatos = []
        for frame in self.page.frames:
            url = frame.url or ""
            if frame == self.page.main_frame or not url.startswith("http"):
                continue
            if any(x in url for x in ("cabecalho", "SEGf_Menu", "componentes/", "recaptcha", "google")):
                continue
            candidatos.append(frame)
        # de preferência o quadro do primeiro nível (não um quadro dentro de uma tela)
        return next((f for f in candidatos if f.parent_frame == self.page.main_frame), candidatos[0] if candidatos else None)

    # ------------------------------------------------------------------ consulta (envio)
    def _dialogo(self, dialogo):
        self._respostas.append(dialogo.message)
        try:
            dialogo.accept()
        except Exception:
            pass

    def _avisos_na_tela(self) -> str:
        """Textos de alerta/modal/toast visíveis (a resposta do ATF ao clicar em Consultar)."""
        partes = list(self._respostas)
        for frame in self.page.frames:
            try:
                partes.extend(frame.evaluate("""() => Array.from(document.querySelectorAll(
                    '.alert, .toast, .modal.show, .modal[style*="block"], [role=alert], .swal2-popup, .notification, .msg, .mensagem'))
                    .filter(e => e.offsetParent !== null).map(e => e.innerText.trim()).filter(Boolean)"""))
            except Exception:
                continue
        return "\n".join(partes)

    def hora_servidor(self) -> datetime | None:
        """Data e hora do ATF (quadro da sessão no topo): base para reconhecer as mensagens novas."""
        m = re.search(r"(\d{2}/\d{2}/\d{4})\s+(\d{2}:\d{2}:\d{2})", _texto_da_pagina(self.page))
        if not m:
            return None
        try:
            return datetime.strptime(f"{m.group(1)} {m.group(2)}", "%d/%m/%Y %H:%M:%S")
        except ValueError:
            return None

    def solicitar(self, tipo: str, ie: str, inicio: date, fim: date, nome_tipo: str) -> Envio:
        """Preenche a consulta de UMA empresa e UM bloco (Emitente ou Destinatário, nunca os dois),
        escolhe Tipo de Exibição = XML e clica em Consultar. O ATF entrega o XML depois, em
        Minhas Mensagens."""
        self._respostas = []
        self._hora_consulta = None
        envio = Envio(ie=ie, tipo=tipo)
        try:
            if not self.atf["tentar_automatico"]:
                raise EtapaNaoConcluida("modo automático desligado")
            self._preencher_consulta(tipo, ie, inicio, fim)
            resposta = self._esperar_resposta(self.atf["segundos_resposta"])
        except (SiteForaDoAr, SessaoExpirada):
            raise
        except IeNaoEncontrada as e:
            self._log(f"{nome_tipo} IE {ie}: {e}")
            envio.ok = False
            envio.resposta = str(e)
            return envio
        except Exception as e:
            self._log(f"{nome_tipo} IE {ie}: automático parou: {e}")
            self.diag.salvar(self.page, f"consulta-{tipo}")
            self.aviso(f"Não consegui seguir sozinho ({e}). Faça no Chrome a consulta {nome_tipo} da IE {ie} "
                       f"({inicio:%d/%m/%Y} a {fim:%d/%m/%Y}), Tipo de Exibição XML, e clique em Consultar.")
            resposta = self._esperar_resposta(self.segundos_assistido)
            envio.assistido = True
        finally:
            self.ultimo_uso = time.time()
        envio.resposta = resposta[:300]
        envio.hora = self._hora_consulta
        if _CONFIRMADA.search(resposta):
            pass  # "O resultado será enviado para sua caixa de mensagens do ATF"
        elif _SEM_NOTAS.search(resposta):
            envio.sem_notas = True
        elif _ERRO_CONSULTA.search(resposta):
            envio.ok = False
        self._log(f"{nome_tipo} IE {ie}: consulta enviada" + (f" — ATF: {resposta[:120]}" if resposta else ""))
        return envio

    def _esperar_resposta(self, segundos: int) -> str:
        limite = time.time() + segundos
        while time.time() < limite:
            pausa(self.page, 0.8, 1.2)
            texto = self._avisos_na_tela()
            if texto:
                pausa(self.page, 0.5, 1.0)
                botao = self._achar("", ['.modal.show button:has-text("OK")', '.modal.show button:has-text("Fechar")',
                                         '.swal2-confirm', '[role=dialog] button:has-text("OK")'])
                if botao is not None:
                    botao.click()
                return texto
        return ""

    def _no_quadro(self, frame, css: str):
        """Primeiro elemento visível do seletor dentro de um quadro (ou None)."""
        if frame is None:
            return None
        try:
            return self._primeiro_visivel(frame.locator(css))
        except Exception:
            return None

    def _quadro_do_bloco(self, bloco: str):
        """O Número, o Pesquisar e o Nome/Razão Social de cada bloco ficam num quadro próprio do ATF
        (componentes/CodDescLstBS.jsp?id=..._cmpEmit / _cmpDest)."""
        suf = _SUFIXO_BLOCO[bloco]
        for frame in self.page.frames:
            try:
                if frame.locator(f'input[id^="hidNrDocumento"][id$="{suf}"]').count():
                    return frame
            except Exception:
                continue
        return None

    def _preencher_consulta(self, tipo: str, ie: str, inicio: date, fim: date):
        nome_tela, bloco = TIPO_TELA[tipo]
        tela = self.atf["telas"][nome_tela]
        self.abrir_tela(nome_tela)  # abre com limparSessao=true: formulário limpo
        tela_frame = self._quadro_da_tela(tela)
        suf = _SUFIXO_BLOCO[bloco]

        # período: do 1º ao último dia da competência (edtDtInicial / edtDtFinal)
        campos = [self._no_quadro(tela_frame, 'input[name="edtDtInicial"]'),
                  self._no_quadro(tela_frame, 'input[name="edtDtFinal"]')]
        if None in campos:  # outra tela: pelos rótulos
            rotulos = tela["rotulos_data"]
            if len(rotulos) == 1:
                campos = [self._apos_rotulo(rotulos[0], _INPUT_TEXTO, 1), self._apos_rotulo(rotulos[0], _INPUT_TEXTO, 2)]
            else:
                campos = [self._apos_rotulo(rotulos[0], _INPUT_TEXTO, 1), self._apos_rotulo(rotulos[1], _INPUT_TEXTO, 1)]
        if None in campos:
            raise EtapaNaoConcluida("campos de data não encontrados")
        for campo, data in zip(campos, (inicio, fim)):
            self._digitar(campo, f"{data:%d/%m/%Y}")
            campo.press("Tab")
        self.page.keyboard.press("Escape")  # fecha o calendário, se abriu
        self._log(f"Período preenchido: {inicio:%d/%m/%Y} a {fim:%d/%m/%Y}")

        # Tipo de Identificação = Inscrição Estadual (já vem assim; confere)
        tipo_id = self._no_quadro(tela_frame, f'select[id^="cmbTpDoc"][id$="{suf}"]') or self._campo_do_bloco(bloco, "select")
        if tipo_id is not None:
            self._escolher(tipo_id, r"inscri[cç][aã]o\s+estadual")

        # só um bloco preenchido: o Número do outro fica vazio
        outro = {"Emitente": "Destinatário", "Destinatário": "Emitente"}[bloco]
        q_outro = self._quadro_do_bloco(outro)
        numero_outro = self._no_quadro(q_outro, f'input[id^="hidNrDocumento"][id$="{_SUFIXO_BLOCO[outro]}"]')
        if numero_outro is not None and numero_outro.input_value():
            numero_outro.fill("")

        # IE no Número do bloco e "Pesquisar" (confere a IE e traz o Nome/Razão Social)
        quadro = self._quadro_do_bloco(bloco)
        sel_numero = f'input[id^="hidNrDocumento"][id$="{suf}"]'
        sel_nome = f'input[id^="hidNoHumanoInst"][id$="{suf}"]'
        if quadro is not None:
            numero = self._no_quadro(quadro, sel_numero)
            pesquisar = self._no_quadro(quadro, 'button[name="btnPesquisar"], input[name="btnPesquisar"]')
        else:  # outra tela: pelo título do bloco
            numero = self._campo_do_bloco(bloco, _INPUT_TEXTO)
            pesquisar = self._campo_do_bloco(bloco, _BOTAO, texto="Pesquisar")
        if numero is None:
            raise EtapaNaoConcluida(f"campo Número do bloco {bloco} não encontrado")
        self._digitar(numero, ie)
        self._log(f"IE {ie} no bloco {bloco}")
        if pesquisar is not None:
            pesquisar.click()
            achou = False
            for _ in range(20):
                pausa(self.page, 0.5, 0.8)
                try:
                    q = self._quadro_do_bloco(bloco)  # o quadro recarrega depois do Pesquisar
                    nome = self._no_quadro(q, sel_nome) if q is not None else self._campo_do_bloco(bloco, _INPUT_TEXTO, 2)
                    if nome is None or nome.input_value().strip():
                        achou = True
                        if nome is not None:
                            self._log(f"Pesquisar: {nome.input_value().strip()[:60]}")
                        break
                except Exception:
                    continue
            erro = self._avisos_na_tela()
            if erro and _ERRO_CONSULTA.search(erro):
                raise IeNaoEncontrada(f"o ATF não aceitou a IE {ie}: {erro[:150]}")
            if not achou:
                raise IeNaoEncontrada(f"o ATF não encontrou a IE {ie} (Pesquisar não trouxe o nome)")
            self._respostas = []

        # Tipo de Exibição = XML e Consultar
        tela_frame = self._quadro_da_tela(tela) or tela_frame
        exibicao = self._no_quadro(tela_frame, 'select[name="cmbTpExibicao"]') or self._apos_rotulo("Tipo de Exibição", "select", 1)
        if exibicao is None:
            raise EtapaNaoConcluida("campo Tipo de Exibição não encontrado")
        if not self._escolher(exibicao, r"^\s*xml\s*$"):
            raise EtapaNaoConcluida("opção XML não encontrada em Tipo de Exibição")
        consultar = self._no_quadro(tela_frame, '#btnConsulta, button[name="btnConsultar"], input[name="btnConsultar"]')
        if consultar is None:
            for frame in self.page.frames:
                try:
                    consultar = self._primeiro_visivel(frame.get_by_role("button", name=re.compile(r"^\W*consultar\s*$", re.I)))
                except Exception:
                    consultar = None
                if consultar is not None:
                    break
        if consultar is None:
            raise EtapaNaoConcluida("botão Consultar não encontrado")
        self._log(f"Consultando {bloco} IE {ie}, {inicio:%d/%m/%Y} a {fim:%d/%m/%Y}, exibição XML")
        self._hora_consulta = self.hora_servidor() or datetime.now()
        consultar.click()

    def _campo_do_bloco(self, bloco: str, css: str, ordem: int = 1, texto: str = ""):
        """Campo dentro do bloco Emitente/Destinatário (o que vem depois do título do bloco)."""
        return self._apos_rotulo(bloco, css, ordem, texto)

    def _escolher(self, select, padrao: str) -> bool:
        try:
            opcoes = select.locator("option").all_inner_texts()
            alvo = next((o for o in opcoes if re.search(padrao, o, re.I)), None)
            if alvo is None:
                return False
            atual = select.evaluate("s => s.selectedIndex >= 0 ? s.options[s.selectedIndex].text : ''")
            if not re.search(padrao, atual or "", re.I):
                select.select_option(label=alvo)
                pausa(self.page, 0.3, 0.6)
            return True
        except Exception as e:
            self._log(f"Não escolhi '{padrao}': {e}")
            return False

    # ------------------------------------------------------------------ serviços com PDF na hora
    def _quadro_componente(self, comp: str):
        """Quadro do Número / Pesquisar / Nome (componentes/CodDescLst.jsp?id=<função>_<componente>)."""
        for frame in self.page.frames:
            try:
                if frame.locator(f'input[name="hidNrDocumento{comp}"], input[id="hidNrDocumento{comp}"]').count():
                    return frame
            except Exception:
                continue
        return None

    def _pesquisar_contribuinte(self, comp: str, ie: str):
        """IE no Número do componente e Pesquisar: o nome tem de aparecer (senão a IE não existe no ATF)."""
        quadro = self._quadro_componente(comp)
        if quadro is None:
            for _ in range(10):  # o quadro do componente carrega depois da tela
                pausa(self.page, 0.5, 0.8)
                quadro = self._quadro_componente(comp)
                if quadro is not None:
                    break
        if quadro is None:
            raise EtapaNaoConcluida("campo Número do contribuinte não encontrado")
        tipo_id = self._no_quadro(quadro, 'select[name^="cmbTpDoc"]')
        if tipo_id is not None:
            self._escolher(tipo_id, r"inscri[cç][aã]o\s+estadual")
        numero = self._no_quadro(quadro, f'input[name="hidNrDocumento{comp}"]')
        if numero is None:
            raise EtapaNaoConcluida("campo Número do contribuinte não encontrado")
        self._digitar(numero, ie)
        pesquisar = self._no_quadro(quadro, 'input[name="btnPesquisar"], button[name="btnPesquisar"]')
        if pesquisar is None:
            raise EtapaNaoConcluida("botão Pesquisar não encontrado")
        self._respostas = []
        pesquisar.click()
        for _ in range(20):
            pausa(self.page, 0.5, 0.8)
            q = self._quadro_componente(comp)
            nome = self._no_quadro(q, f'input[name="hidNoHumanoInst{comp}"]')
            try:
                if nome is not None and nome.input_value().strip():
                    self._log(f"Pesquisar: {nome.input_value().strip()[:60]}")
                    self._respostas = []
                    return
            except Exception:
                continue
        erro = self._avisos_na_tela()
        raise IeNaoEncontrada(f"o ATF não encontrou a IE {ie}" + (f": {erro[:150]}" if erro else " (Pesquisar não trouxe o nome)"))

    def _clicar(self, frame, css: str, nome: str):
        botao = self._no_quadro(frame, css)
        if botao is None:
            raise EtapaNaoConcluida(f"botão {nome} não encontrado")
        botao.click()

    def emitir(self, tipo: str, ie: str, inicio: date, fim: date, nome_tipo: str) -> Emissao:
        """Faturas, extrato, omissão ou certidão de UMA empresa: preenche, clica e captura o PDF (ou ZIP)
        que o ATF devolve na hora."""
        tela = self.atf["telas"][tipo]
        emissao = Emissao(ie=ie, tipo=tipo)
        self._respostas = []
        antes = set(self.contexto.pages)
        capt = None
        try:
            self.abrir_tela(tipo)
            frame = self._quadro_da_tela(tela)
            if tipo == "extrato":  # Período de Pagamento: do 1º ao último dia da competência
                for css, data in (('input[name="edtDataInicial"]', inicio), ('input[name="edtDataFinal"]', fim)):
                    campo = self._no_quadro(frame, css)
                    if campo is None:
                        raise EtapaNaoConcluida("campos do período não encontrados")
                    self._digitar(campo, f"{data:%d/%m/%Y}")
                    campo.press("Tab")
                self._log(f"Período preenchido: {inicio:%d/%m/%Y} a {fim:%d/%m/%Y}")
            tipo_id = self._no_quadro(frame, 'select[name^="cmbTpDoc"]')
            if tipo_id is not None:
                self._escolher(tipo_id, r"inscri[cç][aã]o\s+estadual")
            self._pesquisar_contribuinte(tela["componente"], ie)
            frame = self._quadro_da_tela(tela) or frame
            if tipo == "faturas":
                self._clicar(frame, tela["enviar"], "Avançar")
                if not self._selecionar_faturas(emissao):
                    return emissao
                capt = CapturadorArquivos(self.contexto, self.cfg["chrome"]["pasta_downloads"], log=self.aviso, documentos=True)
                self._clicar(self._quadro_da_tela(tela), 'input[name="btnEmitir"], button[name="btnEmitir"]', "Emitir")
            else:
                capt = CapturadorArquivos(self.contexto, self.cfg["chrome"]["pasta_downloads"], log=self.aviso, documentos=True)
                self._clicar(frame, tela["enviar"], "Consultar")
            self._log(f"{nome_tipo} IE {ie}: pedido enviado")
            self._esperar_documento(capt, emissao)
        except (SiteForaDoAr, SessaoExpirada):
            raise
        except IeNaoEncontrada as e:
            emissao.ok, emissao.resposta = False, str(e)
        except EtapaNaoConcluida as e:
            self._log(f"{nome_tipo} IE {ie}: {e}")
            pasta = self.diag.salvar(self.page, f"{tipo}-parou")
            emissao.ok, emissao.resposta = False, f"{e}" + (f" (diagnóstico: {pasta.name})" if pasta else "")
        finally:
            if capt is not None:
                capt.verificar()
                capt.encerrar()
                emissao.arquivos = list(capt.recebidos)
            self._fechar_abas(antes)
            self.ultimo_uso = time.time()
            if self._quadro_conteudo() is None and not self.page.is_closed():
                # o PDF tomou a aba inteira: volta para o ATF (a sessão continua aberta)
                self._url_tela.clear()
                try:
                    self._abrir(self.atf["url_login"])
                except Exception as e:
                    self._log(f"Não voltei ao ATF depois do PDF: {e}")
        if emissao.arquivos:
            emissao.ok, emissao.sem_dados = True, False
        self._log(f"{nome_tipo} IE {ie}: {len(emissao.arquivos)} arquivo(s)" + (f" — {emissao.resposta[:150]}" if emissao.resposta else ""))
        return emissao

    def _selecionar_faturas(self, emissao: Emissao) -> bool:
        """Tela dos lançamentos: marca todos, menos os "DIFERIDO - VALOR MINIMO" (o ATF não emite).
        Devolve False quando não há o que emitir."""
        limite = time.time() + self.atf["segundos_carregar"]
        frame = None
        sem_lancamento = ""
        while time.time() < limite and frame is None and not sem_lancamento:
            pausa(self.page, 0.8, 1.2)
            for f in self.page.frames:  # a tela da lista (ARRf_LancamentoEmitirDarContribuinte2.do)
                if "componentes/" in (f.url or "") or "SEGf_Menu" in (f.url or ""):
                    continue
                try:
                    if f.locator('input[name="chbChavePrimaria"]').count():
                        frame = f
                        break
                except Exception:
                    continue
                m = _SEM_DOCUMENTO.search(self._texto_quadro(f))
                if m:
                    sem_lancamento = m.group(0)
            if not sem_lancamento and frame is None:
                m = _SEM_DOCUMENTO.search(self._avisos_na_tela())
                sem_lancamento = m.group(0) if m else ""
        if frame is None and sem_lancamento:
            emissao.sem_dados = True
            emissao.resposta = "nenhum lançamento em aberto"
            return False
        if frame is None:
            raise EtapaNaoConcluida("a lista de lançamentos não abriu")
        caixas = frame.locator('input[name="chbChavePrimaria"]')
        marcadas = diferidas = 0
        for i in range(caixas.count()):
            caixa = caixas.nth(i)
            linha = caixa.evaluate("e => (e.closest('tr') || e.parentElement).innerText")
            quer = not _NAO_EMITE.search(linha or "")
            diferidas += not quer
            try:
                if caixa.is_checked() != quer:
                    caixa.click()
                    pausa(self.page, 0.2, 0.5)
                marcadas += quer
            except Exception as e:
                self._log(f"Não marquei o lançamento {i + 1}: {e}")
        self._log(f"Faturas: {marcadas} lançamento(s) marcado(s), {diferidas} diferido(s) - valor mínimo deixado(s) de fora")
        if not marcadas:
            emissao.sem_dados = True
            emissao.resposta = ("só há lançamentos DIFERIDO - VALOR MINIMO, que o ATF não emite" if diferidas
                                else "nenhum lançamento em aberto")
            return False
        return True

    def _texto_quadro(self, frame) -> str:
        try:
            return frame.evaluate("() => document.body ? document.body.innerText : ''")
        except Exception:
            return ""

    def _esperar_documento(self, capt: CapturadorArquivos, emissao: Emissao):
        """Espera o PDF chegar (download, resposta ou visualizador do Chrome) ou o ATF dizer que não há dados."""
        limite = time.time() + self.atf["segundos_documento"]
        while time.time() < limite:
            pausa(self.page, 0.8, 1.2)
            capt.verificar()
            if capt.recebidos and capt.parado(3):
                return
            if capt.recebidos:
                continue
            texto = self._avisos_na_tela()
            for pagina in self.contexto.pages:
                if pagina.is_closed():
                    continue
                for frame in pagina.frames:
                    if "componentes/" in (frame.url or "") or "SEGf_Menu" in (frame.url or ""):
                        continue
                    texto += "\n" + self._texto_quadro(frame)
            if _SEM_DOCUMENTO.search(texto):
                emissao.sem_dados = True
                emissao.resposta = _SEM_DOCUMENTO.search(texto).group(0)
                return
            m = re.search(r"[^\n]*n[aã]o\s+[eé]\s+permitid[^\n]*", texto, re.I)
            if m:
                emissao.ok, emissao.resposta = False, m.group(0).strip()[:300]
                return
        emissao.ok = False
        emissao.resposta = f"o ATF não devolveu o arquivo em {self.atf['segundos_documento']} s"
        self.diag.salvar(self.page, f"{emissao.tipo}-sem-arquivo")

    def _fechar_abas(self, antes: set):
        """Fecha as abas abertas pelo ATF durante o serviço (o PDF pode abrir numa janela nova)."""
        for pagina in list(self.contexto.pages):
            if pagina not in antes and pagina is not self.page and not pagina.is_closed():
                try:
                    pagina.close()
                except Exception:
                    pass

    # ------------------------------------------------------------------ Minhas Mensagens (recebimento)
    def listar_mensagens(self) -> list[dict]:
        """Recarrega Minhas Mensagens e lê as mensagens "mãe" (uma por consulta).
        O ATF só deixa consultar a caixa de 1 em 1 minuto: respeita esse intervalo."""
        espera = self.atf["segundos_entre_verificacoes"] - (time.time() - self._ultima_lista)
        if espera > 0:
            pausa(self.page, espera, espera + 2)
        self._abrir_mensagens()
        self._ultima_lista = time.time()
        quadro = self._quadro_da_tela(self.atf["telas"]["mensagens"])
        try:
            return quadro.evaluate(_JS_MENSAGENS) if quadro is not None else []
        except Exception:
            return []

    def _abrir_mensagens(self):
        """Abre Minhas Mensagens. O ATF é lento às vezes: se não abrir, espera 30 s e tenta de novo;
        depois de 3 tentativas, desiste e o robô para (MensagensIndisponiveis)."""
        tentativas = self.atf["tentativas_mensagens"]
        for tentativa in range(1, tentativas + 1):
            try:
                self.abrir_tela("mensagens", recarregar=True)
                return
            except SessaoExpirada:
                raise
            except Exception as e:
                motivo = str(e) or e.__class__.__name__
                if tentativa == tentativas:
                    self.diag.salvar(self.page, "mensagens-nao-abriu")
                    raise MensagensIndisponiveis(
                        f"Minhas Mensagens não abriu depois de {tentativas} tentativas ({motivo}).") from e
                espera = self.atf["segundos_nova_tentativa_mensagens"]
                self.aviso(f"Minhas Mensagens não abriu ({motivo}). Tentativa {tentativa} de {tentativas}: "
                           f"nova tentativa em {espera} s.")
                self._url_tela.pop("mensagens", None)  # na próxima, abre do zero (sino)
                pausa(self.page, espera, espera + 1)

    def _quadro_mensagens(self):
        """O quadro de conteúdo onde Minhas Mensagens foi aberta (continua sendo ele ao abrir as mensagens)."""
        guardado = self._url_tela.get("mensagens")
        if guardado and not guardado[0].is_detached():
            return guardado[0]
        quadro = self._quadro_da_tela(self.atf["telas"]["mensagens"])
        if quadro is None:
            raise EtapaNaoConcluida("Minhas Mensagens não está aberta")
        return quadro

    def _base_seg(self, quadro) -> str:
        return quadro.url.split("SEGf_")[0]

    def _ler_mensagem(self, quadro, filha: str, mae: str, capt: CapturadorArquivos) -> tuple[str, int]:
        """Abre uma mensagem (SEGf_LerMensagem) e baixa o anexo ("Dados referentes ao ano de ...",
        javascript:mostrarArquivo). Devolve (texto, arquivos baixados)."""
        self._ir(quadro, f"{self._base_seg(quadro)}SEGf_LerMensagem.do?hidsqMensagem={filha}&sqMensagemPai={mae}")
        texto = quadro.evaluate("() => document.body ? document.body.innerText : ''")
        antes = len(capt.recebidos)
        anexos = quadro.locator(f'a[href*="mostrarArquivo"], {_SELETOR_ANEXOS}')
        clicados = 0
        for i in range(min(anexos.count(), 10)):
            try:
                if anexos.nth(i).is_visible():
                    anexos.nth(i).click()
                    clicados += 1
                    pausa(self.page, 1.0, 1.5)
            except Exception:
                continue
        if clicados:
            limite = time.time() + 60
            while time.time() < limite:
                pausa(self.page, 0.8, 1.2)
                capt.verificar()
                if len(capt.recebidos) > antes and capt.parado(4):
                    break
            if len(capt.recebidos) == antes and not self._diag_mensagem_salvo:
                self._diag_mensagem_salvo = True  # uma vez por rodada: para ajustar o roteiro
                self.diag.salvar(self.page, "anexo-nao-baixado")
        return texto, len(capt.recebidos) - antes

    def ler_consulta(self, mae: dict, capt: CapturadorArquivos) -> tuple[str, list, bool]:
        """Lê as mensagens de uma consulta: abre a mãe (abrirFilhas) e cada filha ainda não lida.
        Devolve (textos, anexos baixados, achou a mensagem final)."""
        quadro = self._quadro_mensagens()
        filhas = [mae]
        if mae.get("filhas", 0) > 0:
            self._ir(quadro, f"{self._base_seg(quadro)}SEGf_MinhasMensagens.do?hidsqMensagem={mae['id']}")
            filhas = [f for f in quadro.evaluate(_JS_MENSAGENS) if f["id"] != mae["id"]] or [mae]
        textos, antes, final = [], len(capt.recebidos), False
        # abre primeiro a filha com clipe (anexo) e para na mensagem final: as de andamento
        # ("tarefa recebida", "em processamento") só são abertas se nenhuma tiver anexo
        pendentes = sorted((f for f in filhas if f["id"] not in self._filhas_lidas), key=lambda f: not f.get("anexo"))
        for f in pendentes:
            texto, n = self._ler_mensagem(quadro, f["id"], mae["id"], capt)
            self._filhas_lidas.add(f["id"])
            self._log(f"Mensagem {f['id']} ({mae.get('remetente', '')[:30]}): {n} arquivo(s)")
            textos.append(texto)
            if n or _MENSAGEM_FINAL.search(texto):
                final = True
                break
        self.ultimo_uso = time.time()
        return "\n".join(textos), capt.recebidos[antes:], final

    def recolher(self, esperadas: dict[str, int], desde: datetime, minutos: int,
                 relevante: Callable[[list, str], bool] | None = None) -> Recolha:
        """Acompanha Minhas Mensagens até chegarem as respostas finais esperadas ({código FIS: quantas})
        das consultas feitas a partir de 'desde' (hora do ATF ao clicar em Consultar), ou até o tempo
        acabar. Cada consulta gera uma mensagem mãe com 3 filhas; a final ("Tarefa executada...") traz o
        anexo, ou vem sem anexo quando não há dados. Só conta se 'relevante(anexos, texto)' disser que é
        desta rodada (outra competência ou outra empresa não contam)."""
        recolha = Recolha()
        capt = CapturadorArquivos(self.contexto, self.cfg["chrome"]["pasta_downloads"], log=self.aviso)
        limite = time.time() + minutos * 60
        try:
            while True:
                if self._senha_na_tela() is not None:
                    raise SessaoExpirada("o ATF voltou para a tela de login.")
                maes = [m for m in self.listar_mensagens()
                        if m["codigo"] in esperadas and m["id"] not in self._mensagens_lidas
                        and (not m["data"] or _data_br(m["data"]) >= desde - timedelta(seconds=5))]
                for mae in maes:
                    textos, anexos, final = self.ler_consulta(mae, capt)
                    recolha.textos.append((mae["codigo"], textos))
                    if not final:
                        continue  # ainda processando: volta nela na próxima leitura da caixa
                    self._mensagens_lidas.add(mae["id"])
                    if relevante is None or relevante(anexos, textos):
                        recolha.recebidas[mae["codigo"]] = recolha.recebidas.get(mae["codigo"], 0) + 1
                    else:
                        self._log("Consulta de outra empresa ou competência: não conta")
                        # o anexo não vai para a pasta de nenhuma empresa da rodada (fica em _sem_empresa)
                        recolha.ignorados.extend(anexos)
                        for anexo in anexos:
                            if anexo in capt.recebidos:
                                capt.recebidos.remove(anexo)
                if all(recolha.recebidas.get(c, 0) >= n for c, n in esperadas.items()):
                    break
                if time.time() >= limite:
                    recolha.tempo_esgotado = True
                    self._log(f"Tempo esgotado esperando mensagens: {recolha.recebidas} de {esperadas}")
                    break
                faltam = {c: n - recolha.recebidas.get(c, 0) for c, n in esperadas.items()}
                self.aviso(f"Aguardando o ATF entregar os XML em Minhas Mensagens (faltam {faltam})...")
        except MensagensIndisponiveis as e:
            capt.verificar()
            recolha.arquivos = list(capt.recebidos)
            e.recolha = recolha  # o que já foi baixado é salvo antes de parar
            raise
        finally:
            capt.verificar()
            capt.encerrar()
            recolha.arquivos = list(capt.recebidos)
        return recolha

    # ------------------------------------------------------------------ saída
    def sair(self, silencioso: bool = False):
        """Encerra a sessão antes de trocar de login (um login nunca herda a sessão do outro)."""
        try:
            link = self._achar("", ['[aria-label="Encerrar Sessão" i]', '[aria-label*="Encerrar" i]', '[title*="Encerrar" i]',
                                    'a:has-text("Sair")', 'button:has-text("Sair")', '[title*="Sair" i]',
                                    '[aria-label*="Sair" i]', 'a[href*="logout" i]', 'a[href*="sair" i]'])
            if link is not None:
                link.click()
                pausa(self.page, 0.8, 1.5)
        except Exception:
            pass
        try:
            # www4.sefaz.pb.gov.br -> sefaz.pb.gov.br (pega também os cookies de ".sefaz.pb.gov.br")
            partes = (urlparse(self.atf["url_login"]).hostname or "sefaz.pb.gov.br").split(".")
            dominio = ".".join(partes[-4:]) if len(partes) > 4 else ".".join(partes)
            self.contexto.clear_cookies(domain=re.compile(re.escape(dominio) + "$"))
        except Exception as e:
            if not silencioso:
                self._log(f"Não limpei os cookies do ATF: {e}")
        self.login_atual = ""
        self._url_tela.clear()
