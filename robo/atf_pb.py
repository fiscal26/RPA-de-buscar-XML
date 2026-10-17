"""ATF da SEFAZ-PB: login do contador, consulta das notas pela inscrição estadual e download dos XML.

Roteiro (telas do ATF em produção, out/2026):
- Login com o LOGIN e a SENHA do contador (planilha). Um login atende várias empresas: o robô
  entra uma vez e percorre todas as empresas daquele login.
- NF-e Saída e NF-e Entrada: menu "NF-e" > "Consulta NF-e por Emitentes/Destinatários" (FIS_1322).
  Preenche "Data de Emissão" (do 1º ao último dia da competência) e a inscrição estadual no bloco
  "Emitente" (saída) ou "Destinatário" (entrada); o "Tipo de Identificação" já vem em
  "Inscrição Estadual".
- NFC-e: menu "NFC-e" > "Consulta por Emitente" (FIS_1484, "Consulta Genérica da NFC-e").
  "Data Emissão Inicial", "Data Emissão Final" e a inscrição estadual no bloco "Emitente".

Se o menu não responder, o robô abre a tela pelo campo "Função" do topo (código FIS_...).
Toda etapa não reconhecida gera um pacote de diagnóstico (tela.png, campos.txt, texto.txt, log.txt)
e passa para o modo assistido: você conclui no Chrome e o robô captura o XML/ZIP baixado.
Senhas nunca entram no diagnóstico.
"""
from __future__ import annotations

import random
import re
import time
from dataclasses import dataclass, field
from datetime import date, datetime
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
# Depois da pesquisa: marcar todas as notas e baixar
_MARCAR_TODOS = ['th input[type="checkbox"]', 'input[type="checkbox"][id*="todos" i]',
                 'input[type="checkbox"][name*="todos" i]', 'input[type="checkbox"][title*="todos" i]']
_BAIXAR = re.compile(r"^\s*(download|baixar|gerar\s+xml|exportar\s+xml|xml|download\s+xml|baixar\s+xml|"
                     r"download\s+(dos\s+)?xmls?|baixar\s+(todos\s+)?(os\s+)?xmls?)\s*$", re.I)

# Tipo de XML -> tela e bloco onde vai a inscrição estadual
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
class Download:
    arquivos: list[tuple[str, bytes]] = field(default_factory=list)
    sem_notas: bool = False
    assistido: bool = False
    mensagem: str = ""


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

    def abrir_tela(self, nome: str):
        """Abre a tela de consulta: pelo endereço já visitado, pelo menu ou pelo campo Função."""
        tela = self.atf["telas"][nome]
        if self._senha_na_tela() is not None:
            raise SessaoExpirada("o ATF voltou para a tela de login.")
        url = self._url_tela.get(nome)
        if url:
            self._abrir(url)  # recarrega: formulário limpo para a próxima empresa
            if self._tela_aberta(tela):
                return
        # menu lateral: volta à raiz (/ MEN), entra no módulo e escolhe a consulta
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

    # ------------------------------------------------------------------ consulta e download
    def baixar(self, tipo: str, ie: str, inicio: date, fim: date, nome_tipo: str) -> Download:
        periodo = f"{inicio:%d/%m/%Y} a {fim:%d/%m/%Y}"
        capt = CapturadorArquivos(self.contexto, self.cfg["chrome"]["pasta_downloads"])
        resultado = Download()
        try:
            if self.atf["tentar_automatico"]:
                try:
                    self._consultar(tipo, ie, inicio, fim)
                    resultado = self._esperar(capt, self.atf["segundos_automatico"], baixar=True)
                except (SiteForaDoAr, SessaoExpirada):
                    raise
                except Exception as e:
                    self._log(f"{nome_tipo}: automático parou: {e}")
            if not resultado.arquivos and not resultado.sem_notas:
                self.diag.salvar(self.page, f"download-{tipo}")
                self.aviso(f"Aguardando você baixar no Chrome: {nome_tipo} da IE {ie}, período {periodo}.")
                resultado = self._esperar(capt, self.segundos_assistido, baixar=False)
                resultado.assistido = True
        finally:
            capt.encerrar()
            self.ultimo_uso = time.time()
        self._log(f"{nome_tipo}: {len(resultado.arquivos)} arquivo(s)" + (" — sem notas no período" if resultado.sem_notas else ""))
        return resultado

    def _consultar(self, tipo: str, ie: str, inicio: date, fim: date):
        nome_tela, bloco = TIPO_TELA[tipo]
        tela = self.atf["telas"][nome_tela]
        self.abrir_tela(nome_tela)

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

        # bloco Emitente/Destinatário: Tipo de Identificação = Inscrição Estadual, Número = IE
        nomes_bloco = [bloco, bloco.replace("á", "a")]
        tipo_id = numero = None
        for nb in nomes_bloco:
            tipo_id = tipo_id or self._apos_rotulo(nb, "select", 1)
            numero = numero or self._apos_rotulo(nb, "input[not(@type='hidden') and not(@type='checkbox') and not(@type='radio')]", 1)
        if numero is None:
            raise EtapaNaoConcluida(f"campo Número do bloco {bloco} não encontrado")
        if tipo_id is not None:
            try:
                opcoes = tipo_id.locator("option").all_inner_texts()
                ie_op = next((o for o in opcoes if re.search(r"inscri[cç][aã]o\s+estadual", o, re.I)), None)
                if ie_op and not re.search(r"inscri", tipo_id.evaluate("s => s.options[s.selectedIndex].text"), re.I):
                    tipo_id.select_option(label=ie_op)
                    pausa(self.page, 0.3, 0.6)
            except Exception as e:
                self._log(f"Tipo de Identificação: {e}")
        self._digitar(numero, ie)
        self._log(f"Período {inicio:%d/%m/%Y} a {fim:%d/%m/%Y}, {bloco} IE {ie}")

        botao = None
        for nb in nomes_bloco:
            botao = botao or self._apos_rotulo(nb, f"*[self::button or self::input][{_xpath_texto('Pesquisar')} or "
                                                   f"translate(@value,'PESQUISAR','pesquisar')='pesquisar']", 1)
        botao = botao or self._achar("", ['button:has-text("Pesquisar")', 'button:has-text("Consultar")'])
        if botao is None:
            raise EtapaNaoConcluida("botão Pesquisar não encontrado")
        botao.click()

    def _resultado_na_tela(self) -> bool:
        return self._achar("", ["table tbody tr td", ".table tbody tr"]) is not None

    def _tentar_baixar(self) -> bool:
        """Na lista de notas: marca todas (se houver a caixa) e clica no botão de download."""
        marcar = self._achar("", _MARCAR_TODOS)
        if marcar is not None:
            try:
                if not marcar.is_checked():
                    marcar.check()
            except Exception:
                pass
        for frame in self.page.frames:
            for papel in ("button", "link"):
                try:
                    alvo = self._primeiro_visivel(frame.get_by_role(papel, name=_BAIXAR))
                except Exception:
                    alvo = None
                if alvo is not None:
                    self._log(f"Clicando em '{(alvo.inner_text() or '').strip()[:40]}'")
                    alvo.click()
                    return True
        alvo = self._achar("", ['a[href*=".zip" i]', 'a[href*="download" i]', 'a[href*="xml" i]',
                                'input[value*="Download" i]', 'input[value*="XML" i]', '[title*="download" i]',
                                '[title*="XML" i]'])
        if alvo is not None:
            alvo.click()
            return True
        return False

    def _esperar(self, capt: CapturadorArquivos, segundos: int, baixar: bool) -> Download:
        r = Download()
        limite = time.time() + segundos
        ultimo_novo = 0.0
        clicou = False
        while time.time() < limite:
            pausa(self.page, 0.8, 1.2)
            if capt.verificar():
                ultimo_novo = time.time()
            if capt.recebidos:
                if time.time() - ultimo_novo > 6:
                    break  # parou de chegar arquivo
                continue
            texto = _texto_da_pagina(self.page)
            if _SEM_NOTAS.search(texto):
                r.sem_notas = True
                r.mensagem = "nenhuma nota no período"
                break
            if _FORA_DO_AR.search(texto[:3000]):
                raise SiteForaDoAr("o ATF informou que o serviço está indisponível.")
            if baixar and not clicou and self._resultado_na_tela():
                clicou = self._tentar_baixar()
                if clicou:
                    limite = max(limite, time.time() + 60)  # o ZIP pode demorar a ser gerado
        capt.verificar()
        r.arquivos = list(capt.recebidos)
        return r

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
