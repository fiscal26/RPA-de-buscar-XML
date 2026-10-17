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

from navegador import CapturadorArquivos, pausa

Aviso = Callable[[str], None]

_ERRO_LOGIN = re.compile(
    r"senha\s+(inv[aá]lida|incorreta|n[aã]o confere|expirada)|usu[aá]rio\s+(inv[aá]lido|n[aã]o encontrado|bloqueado)|"
    r"login\s+(inv[aá]lido|incorreto)|acesso\s+negado|dados\s+de\s+acesso\s+inv[aá]lidos|conta\s+bloqueada|"
    r"usu[aá]rio\s+ou\s+senha\s+(inv[aá]lid|incorret)",
    re.I,
)
_SEM_NOTAS = re.compile(
    r"nenhum(a)?\s+(nota|documento|registro|nf-?c?-?e|arquivo|resultado)|n[aã]o\s+(foram\s+)?encontrad[oa]s?|"
    r"n[aã]o\s+h[aá]\s+(notas|documentos|registros)|sem\s+(notas|documentos|registros)|consulta\s+vazia",
    re.I,
)
_FORA_DO_AR = re.compile(r"servi[cç]o\s+(temporariamente\s+)?indispon[ií]vel|em\s+manuten[cç][aã]o|"
                         r"service unavailable|bad gateway|gateway time-?out", re.I)

_CAMPOS_LOGIN = ['input[name*="login" i]', 'input[id*="login" i]', 'input[name*="usuario" i]',
                 'input[id*="usuario" i]', 'input[name*="user" i]', 'input[name*="cpf" i]']
_BOTOES_ENTRAR = ['button[type="submit"]', 'input[type="submit"]', 'input[type="image"]',
                  'button:has-text("Entrar")', 'button:has-text("Acessar")', 'a:has-text("Entrar")',
                  'input[value*="Entrar" i]', 'input[value*="Acessar" i]', 'input[value*="OK" i]']
_ERRO_CONSULTA = re.compile(r"\berro\b|inv[aá]lid|obrigat[oó]ri|n[aã]o\s+(foi\s+)?(encontrad|localizad|cadastrad)|"
                            r"informe\s+|preencha|n[aã]o\s+permitid|sem\s+permiss", re.I)
_INPUT_TEXTO = "input[not(@type='hidden') and not(@type='checkbox') and not(@type='radio') and not(@type='button') and not(@type='submit')]"
# Anexos dentro de uma mensagem aberta
_SELETOR_ANEXOS = ('a[href*=".zip" i], a[href*=".xml" i], a[href*="anexo" i], a[href*="download" i], '
                   'a[href*="arquivo" i], a[download], a:has-text(".zip"), a:has-text(".xml"), '
                   'a[title*="anexo" i], a[title*="download" i], button[title*="download" i], button:has-text("Download")')

# Lê as linhas de Minhas Mensagens; marca cada uma (data-robo) para poder clicar depois
_JS_MENSAGENS = """() => Array.from(document.querySelectorAll('tr')).map((tr, i) => {
    if (tr.querySelector('tr')) return null;  // tabela de layout com outra dentro
    const celulas = Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim());
    const texto = celulas.join(' | ');
    const codigo = (texto.match(/\\b(FIS|SEG)_\\d+/) || [''])[0];
    if (!codigo) return null;
    const data = (texto.match(/\\d{2}\\/\\d{2}\\/\\d{4}\\s+\\d{2}:\\d{2}:\\d{2}/) || [null])[0];
    tr.setAttribute('data-robo', String(i));
    const anexo = !!tr.querySelector('img[src*="clip" i], img[src*="anexo" i], [class*="clip" i], [title*="anexo" i], [alt*="anexo" i]');
    return {marca: String(i), codigo, data, remetente: celulas.find(c => c.includes(codigo)) || codigo,
            enviada: data || '', anexo, chave: codigo + '|' + (data || texto)};
}).filter(Boolean)"""

# Tipo de XML -> tela e bloco onde vai a inscrição estadual (um bloco por consulta)
TIPO_TELA = {
    "nfe_saida": ("nfe", "Emitente"),
    "nfe_entrada": ("nfe", "Destinatário"),
    "nfce": ("nfce", "Emitente"),
}


class SenhaInvalida(Exception):
    pass


class SiteForaDoAr(Exception):
    pass


class SessaoExpirada(Exception):
    pass


class EtapaNaoConcluida(Exception):
    pass


@dataclass
class Envio:
    """Uma consulta enviada (empresa + tipo). A resposta chega depois, em Minhas Mensagens."""
    ie: str
    tipo: str
    ok: bool = True
    sem_notas: bool = False
    assistido: bool = False
    resposta: str = ""


@dataclass
class Recolha:
    """O que veio de Minhas Mensagens nesta rodada."""
    arquivos: list[tuple[str, bytes]] = field(default_factory=list)
    textos: list[tuple[str, str]] = field(default_factory=list)   # (código FIS, texto da mensagem)
    recebidas: dict[str, int] = field(default_factory=dict)       # código FIS -> mensagens lidas
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
        self._url_tela: dict[str, str] = {}
        self._respostas: list[str] = []
        self._mensagens_lidas: set[str] = set()
        self._diag_mensagem_salvo = False
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

    def _apos_rotulo(self, rotulo: str, alvo: str, ordem: int = 1):
        """Campo que vem depois de um texto da tela (ex.: o 2º input depois de 'Data de Emissão')."""
        xp = f"xpath=//*[{_xpath_texto(rotulo)}][not(self::option)]/following::{alvo}[{ordem}]"
        return self._achar("", [xp])

    def _digitar(self, campo, texto: str):
        campo.click()
        campo.fill("")
        for letra in texto:
            campo.press_sequentially(letra)
            time.sleep(random.uniform(0.04, 0.12))

    def _abrir(self, url: str):
        try:
            self.page.goto(url, wait_until="domcontentloaded", timeout=60_000)
        except Exception as e:
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
    def _tela_aberta(self, tela: dict) -> bool:
        return re.search(re.escape(tela["titulo"]), _texto_da_pagina(self.page), re.I) is not None

    def _clicar_texto(self, texto: str) -> bool:
        alvo = self._achar("", [f"xpath=//a[{_xpath_texto(texto)}]", f"xpath=//*[self::button or self::li or self::span]"
                                                                     f"[{_xpath_texto(texto)}]"])
        if alvo is None:
            return False
        alvo.click()
        pausa(self.page, 0.8, 1.5)
        return True

    def abrir_tela(self, nome: str, recarregar: bool = True):
        """Abre uma tela do ATF: pelo endereço já visitado, pelo botão (sino das mensagens), pelo
        menu lateral ou pelo campo Função do topo."""
        tela = self.atf["telas"][nome]
        if self._senha_na_tela() is not None:
            raise SessaoExpirada("o ATF voltou para a tela de login.")
        url = self._url_tela.get(nome)
        if url and (recarregar or not self._tela_aberta(tela)):
            self._abrir(url)  # recarrega: formulário limpo / lista de mensagens atualizada
            if self._tela_aberta(tela):
                return
        if tela.get("botao") and not self._tela_aberta(tela):
            botao = self._achar("", tela["botao"])
            if botao is not None:
                botao.click()
                pausa(self.page, 1.0, 2.0)
        # menu lateral: volta à raiz (/ MEN), entra no módulo e escolhe a consulta
        if tela.get("menu") and not self._tela_aberta(tela):
            for _ in range(2):
                self._clicar_texto("/ MEN") or self._clicar_texto("MEN")
                if self._clicar_texto(tela["menu"][0]) and self._clicar_texto(tela["menu"][1]):
                    break
                menu = self._achar("", ['button:has-text("☰")', 'button[aria-label*="menu" i]', '.navbar-toggler',
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
        if not self._tela_aberta(tela):
            raise EtapaNaoConcluida(f"não consegui abrir a tela '{tela['titulo']}'")
        self._url_tela[nome] = self.page.url
        self._log(f"Tela aberta: {tela['titulo']}")

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
        envio = Envio(ie=ie, tipo=tipo)
        try:
            if not self.atf["tentar_automatico"]:
                raise EtapaNaoConcluida("modo automático desligado")
            self._preencher_consulta(tipo, ie, inicio, fim)
            resposta = self._esperar_resposta(self.atf["segundos_resposta"])
        except (SiteForaDoAr, SessaoExpirada):
            raise
        except Exception as e:
            self._log(f"{nome_tipo} IE {ie}: automático parou: {e}")
            self.diag.salvar(self.page, f"consulta-{tipo}")
            self.aviso(f"Faça no Chrome a consulta {nome_tipo} da IE {ie} ({inicio:%d/%m/%Y} a {fim:%d/%m/%Y}), "
                       "Tipo de Exibição XML, e clique em Consultar.")
            resposta = self._esperar_resposta(self.segundos_assistido)
            envio.assistido = True
        finally:
            self.ultimo_uso = time.time()
        envio.resposta = resposta[:300]
        if _SEM_NOTAS.search(resposta):
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

    def _preencher_consulta(self, tipo: str, ie: str, inicio: date, fim: date):
        nome_tela, bloco = TIPO_TELA[tipo]
        tela = self.atf["telas"][nome_tela]
        self.abrir_tela(nome_tela)
        limpar = self._achar("", ['button:has-text("Limpar")', 'input[value="Limpar" i]'])
        if limpar is not None:
            limpar.click()
            pausa(self.page, 0.5, 1.0)

        # período: do 1º ao último dia da competência
        rotulos = tela["rotulos_data"]
        if len(rotulos) == 1:
            campos = [self._apos_rotulo(rotulos[0], "input", 1), self._apos_rotulo(rotulos[0], "input", 2)]
        else:
            campos = [self._apos_rotulo(rotulos[0], "input", 1), self._apos_rotulo(rotulos[1], "input", 1)]
        if None in campos:
            raise EtapaNaoConcluida("campos de data não encontrados")
        for campo, data in zip(campos, (inicio, fim)):
            self._digitar(campo, f"{data:%d/%m/%Y}")
            campo.press("Tab")

        # só um bloco preenchido: o outro fica com o Número vazio
        outro = {"Emitente": "Destinatário", "Destinatário": "Emitente"}[bloco]
        numero_outro = self._campo_do_bloco(outro, _INPUT_TEXTO)
        if numero_outro is not None and numero_outro.input_value():
            numero_outro.fill("")

        tipo_id = self._campo_do_bloco(bloco, "select")
        numero = self._campo_do_bloco(bloco, _INPUT_TEXTO)
        if numero is None:
            raise EtapaNaoConcluida(f"campo Número do bloco {bloco} não encontrado")
        if tipo_id is not None:
            self._escolher(tipo_id, r"inscri[cç][aã]o\s+estadual")
        self._digitar(numero, ie)
        numero.press("Tab")

        # "Pesquisar" do bloco: confere a IE e traz o Nome/Razão Social
        pesquisar = self._campo_do_bloco(bloco, f"*[self::button or self::input][{_xpath_texto('Pesquisar')} or "
                                                f"translate(@value,'PESQUISAR','pesquisar')='pesquisar']")
        if pesquisar is not None:
            pesquisar.click()
            nome = self._campo_do_bloco(bloco, _INPUT_TEXTO, 2)
            for _ in range(10):
                pausa(self.page, 0.5, 0.8)
                try:
                    if nome is None or nome.input_value().strip():
                        break
                except Exception:
                    break
            erro = self._avisos_na_tela()
            if erro and _ERRO_CONSULTA.search(erro):
                raise EtapaNaoConcluida(f"ATF não aceitou a IE {ie}: {erro[:150]}")
            self._respostas = []

        # Tipo de Exibição = XML e Consultar
        exibicao = self._apos_rotulo("Tipo de Exibição", "select", 1) or self._apos_rotulo("Tipo de Exibicao", "select", 1)
        if exibicao is None:
            raise EtapaNaoConcluida("campo Tipo de Exibição não encontrado")
        if not self._escolher(exibicao, r"^\s*xml\s*$"):
            raise EtapaNaoConcluida("opção XML não encontrada em Tipo de Exibição")
        consultar = None
        for frame in self.page.frames:
            try:
                consultar = self._primeiro_visivel(frame.get_by_role("button", name=re.compile(r"^\W*consultar\s*$", re.I)))
            except Exception:
                consultar = None
            if consultar is not None:
                break
        consultar = consultar or self._achar("", ['input[value="Consultar" i]', 'button:has-text("Consultar")'])
        if consultar is None:
            raise EtapaNaoConcluida("botão Consultar não encontrado")
        self._log(f"Consultando {bloco} IE {ie}, {inicio:%d/%m/%Y} a {fim:%d/%m/%Y}, exibição XML")
        consultar.click()

    def _campo_do_bloco(self, bloco: str, alvo: str, ordem: int = 1):
        for nome in dict.fromkeys([bloco, bloco.replace("á", "a")]):
            campo = self._apos_rotulo(nome, alvo, ordem)
            if campo is not None:
                return campo
        return None

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

    # ------------------------------------------------------------------ Minhas Mensagens (recebimento)
    def listar_mensagens(self) -> list[dict]:
        """Linhas de Minhas Mensagens: remetente (FIS_...), enviada, se tem anexo. Cada linha recebe
        uma marca (data-robo) para ser aberta depois."""
        self.abrir_tela("mensagens", recarregar=True)
        linhas: list[dict] = []
        for i, frame in enumerate(self.page.frames):
            try:
                linhas.extend(dict(l, quadro=i) for l in frame.evaluate(_JS_MENSAGENS))
            except Exception:
                continue
        return linhas

    def abrir_mensagem(self, linha: dict, capt: CapturadorArquivos) -> str:
        """Abre a mensagem, baixa os anexos (o capturador recolhe) e devolve o texto dela."""
        frame = self.page.frames[linha["quadro"]] if linha["quadro"] < len(self.page.frames) else self.page.main_frame
        tr = frame.locator(f'tr[data-robo="{linha["marca"]}"]')
        link = self._primeiro_visivel(tr.locator("a"))
        (link or tr).click()
        pausa(self.page, 1.5, 2.5)
        antes = len(capt.recebidos)
        clicados = 0
        for frame in self.page.frames:
            try:
                anexos = frame.locator(_SELETOR_ANEXOS)
                for i in range(min(anexos.count(), 20)):
                    a = anexos.nth(i)
                    if a.is_visible():
                        a.click()
                        clicados += 1
                        pausa(self.page, 1.0, 1.5)
            except Exception:
                continue
        limite = time.time() + 40
        while time.time() < limite:
            pausa(self.page, 0.8, 1.2)
            capt.verificar()
            if len(capt.recebidos) > antes and capt.parado(4):
                break
            if not clicados and time.time() > limite - 30:
                break
        texto = _texto_da_pagina(self.page)
        if len(capt.recebidos) == antes and not self._diag_mensagem_salvo:
            self._diag_mensagem_salvo = True  # uma vez por rodada: para calibrar a tela da mensagem
            self.diag.salvar(self.page, "mensagem-sem-anexo")
        self._log(f"Mensagem {linha['remetente'][:40]} de {linha['enviada']}: {len(capt.recebidos) - antes} arquivo(s)")
        self.ultimo_uso = time.time()
        return texto

    def recolher(self, esperadas: dict[str, int], desde: datetime, minutos: int,
                 relevante: Callable[[list, str], bool] | None = None) -> Recolha:
        """Acompanha Minhas Mensagens até chegarem as respostas esperadas ({código FIS: quantas}),
        enviadas a partir de 'desde' (hora do ATF), ou até o tempo acabar. 'relevante(anexos, texto)'
        diz se a mensagem é resposta desta rodada (uma consulta feita à mão no mesmo login não conta)."""
        recolha = Recolha()
        capt = CapturadorArquivos(self.contexto, self.cfg["chrome"]["pasta_downloads"])
        limite = time.time() + minutos * 60
        try:
            while True:
                if self._senha_na_tela() is not None:
                    raise SessaoExpirada("o ATF voltou para a tela de login.")
                novas = [l for l in self.listar_mensagens()
                         if l["codigo"] in esperadas and l["chave"] not in self._mensagens_lidas
                         and (l["data"] is None or _data_br(l["data"]) >= desde - timedelta(minutes=1))]
                if novas:
                    # uma por vez: ao voltar para a lista as linhas são lidas (e marcadas) de novo
                    linha = novas[0]
                    self._mensagens_lidas.add(linha["chave"])
                    antes = len(capt.recebidos)
                    texto = self.abrir_mensagem(linha, capt)
                    recolha.textos.append((linha["codigo"], texto))
                    if relevante is None or relevante(capt.recebidos[antes:], texto):
                        recolha.recebidas[linha["codigo"]] = recolha.recebidas.get(linha["codigo"], 0) + 1
                    else:
                        self._log("Mensagem de outra consulta (empresa fora da rodada): não conta")
                    continue
                if all(recolha.recebidas.get(c, 0) >= n for c, n in esperadas.items()):
                    break
                if time.time() >= limite:
                    recolha.tempo_esgotado = True
                    self._log(f"Tempo esgotado esperando mensagens: {recolha.recebidas} de {esperadas}")
                    break
                faltam = {c: n - recolha.recebidas.get(c, 0) for c, n in esperadas.items()}
                self.aviso(f"Aguardando o ATF entregar os XML em Minhas Mensagens ({faltam})...")
                pausa(self.page, self.atf["segundos_entre_verificacoes"], self.atf["segundos_entre_verificacoes"] + 5)
        finally:
            capt.verificar()
            capt.encerrar()
            recolha.arquivos = list(capt.recebidos)
        return recolha

    # ------------------------------------------------------------------ saída
    def sair(self, silencioso: bool = False):
        """Encerra a sessão antes de trocar de login (um login nunca herda a sessão do outro)."""
        try:
            link = self._achar("", ['a:has-text("Sair")', 'button:has-text("Sair")', '[title*="Sair" i]',
                                    '[aria-label*="Sair" i]', 'a[href*="logout" i]', 'a[href*="sair" i]'])
            if link is not None:
                link.click()
                pausa(self.page, 0.8, 1.5)
        except Exception:
            pass
        try:
            self.contexto.clear_cookies(domain=re.compile(r"sefaz\.pb\.gov\.br$"))
        except Exception as e:
            if not silencioso:
                self._log(f"Não limpei os cookies do ATF: {e}")
        self.login_atual = ""
        self._url_tela.clear()
