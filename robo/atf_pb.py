"""ATF da SEFAZ-PB: login do contribuinte, download dos XML e saída.

Como funciona (o mesmo jeito do emissor de CND):
1. Automático: o robô abre o ATF, acha os campos de login e senha (inclusive dentro de quadros),
   digita tecla por tecla e entra. Se a função de download estiver configurada em
   atf.url_download, abre a tela, preenche o período, marca o tipo e clica em consultar/baixar.
2. Assistido: se alguma etapa não for reconhecida (tela mudou, captcha, função não configurada),
   o robô espera você concluir no Chrome e captura sozinho o XML/ZIP que você baixar.

Toda falha gera um pacote de diagnóstico (tela.png, campos.txt, texto.txt, log.txt) em
pastas.diagnostico, para ajustarmos os seletores. Senhas nunca entram no diagnóstico.
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
    r"login\s+(inv[aá]lido|incorreto)|acesso\s+negado|dados\s+de\s+acesso\s+inv[aá]lidos|conta\s+bloqueada",
    re.I,
)
_SEM_NOTAS = re.compile(
    r"nenhum(a)?\s+(nota|documento|registro|nf-?e|arquivo)|n[aã]o\s+(foram\s+)?encontrad[oa]s?|"
    r"n[aã]o\s+h[aá]\s+(notas|documentos|registros)|sem\s+(notas|documentos|registros)",
    re.I,
)
_FORA_DO_AR = re.compile(r"servi[cç]o\s+(temporariamente\s+)?indispon[ií]vel|em\s+manuten[cç][aã]o|"
                         r"service unavailable|bad gateway|gateway time-?out", re.I)

# Campos do login, do mais para o menos específico
_CAMPOS_LOGIN = ['input[name*="login" i]', 'input[id*="login" i]', 'input[name*="usuario" i]',
                 'input[id*="usuario" i]', 'input[name*="cnpj" i]', 'input[name*="cpf" i]', 'input[name*="user" i]']
_BOTOES_ENTRAR = ['button[type="submit"]', 'input[type="submit"]', 'input[type="image"]',
                  'button:has-text("Entrar")', 'button:has-text("Acessar")', 'a:has-text("Entrar")',
                  'input[value*="Entrar" i]', 'input[value*="Acessar" i]', 'input[value*="OK" i]']
_BOTOES_CONSULTAR = ['button:has-text("Consultar")', 'input[value*="Consultar" i]', 'button:has-text("Pesquisar")',
                     'input[value*="Pesquisar" i]', 'button:has-text("Download")', 'input[value*="Download" i]',
                     'button:has-text("Baixar")', 'input[value*="Baixar" i]', 'button:has-text("Gerar")',
                     'input[value*="Gerar" i]', 'button:has-text("Submeter")', 'input[value*="Submeter" i]']
_LINKS_BAIXAR = ['a:has-text("Download")', 'a:has-text("Baixar")', 'a:has-text("XML")', 'a[href*=".zip" i]',
                 'a[href*="download" i]', 'input[value*="Download" i]', 'button:has-text("Download")']
_TEXTO_TIPO = {
    "nfe_emitidas": r"emitid|emiss[aã]o\s+pr[oó]pria|sa[ií]da",
    "nfe_recebidas": r"recebid|destinad|entrada",
    "nfce_emitidas": r"nfc-?e|consumidor",
}


class SenhaInvalida(Exception):
    pass


class SiteForaDoAr(Exception):
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

    def __init__(self, pasta_base: str, cnpj: str):
        self.pasta_base = Path(pasta_base)
        self.cnpj = cnpj
        self.linhas: list[str] = []

    def log(self, texto: str):
        self.linhas.append(f"{datetime.now():%H:%M:%S} {texto}")

    def salvar(self, page, motivo: str) -> Path | None:
        pasta = self.pasta_base / f"{datetime.now():%Y-%m-%d_%H%M%S}_{self.cnpj}_{re.sub(r'[^a-z0-9]+', '-', motivo.lower())[:30]}"
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


# Lista campos, botões e links sem o VALOR dos campos (não vaza senha)
_JS_CAMPOS = """() => Array.from(document.querySelectorAll('input, select, textarea, button, a')).slice(0, 400).map(e => {
    const r = e.getBoundingClientRect();
    const vis = r.width > 0 && r.height > 0 ? 'visível' : 'oculto';
    const rot = (e.labels && e.labels[0] ? e.labels[0].innerText : '') || e.getAttribute('aria-label') || e.placeholder || '';
    const txt = e.tagName === 'A' || e.tagName === 'BUTTON' ? (e.innerText || '').trim().slice(0, 60) : '';
    const val = e.type === 'submit' || e.type === 'button' ? (e.value || '') : '';
    return [e.tagName.toLowerCase(), e.type || '', 'name=' + (e.name || ''), 'id=' + (e.id || ''),
            rot ? 'rótulo=' + rot.trim().slice(0, 60) : '', txt ? 'texto=' + txt : '', val ? 'valor=' + val : '',
            e.tagName === 'A' ? 'href=' + (e.getAttribute('href') || '').slice(0, 120) : '', vis].filter(Boolean).join(' | ');
})"""


def _visivel(loc) -> bool:
    try:
        return loc.count() > 0 and loc.first.is_visible()
    except Exception:
        return False


def _texto_da_pagina(page) -> str:
    partes = []
    for frame in page.frames:
        try:
            partes.append(frame.evaluate("() => document.body ? document.body.innerText : ''"))
        except Exception:
            continue
    return "\n".join(partes)


class AtfPB:
    def __init__(self, contexto, cfg: dict, aviso: Aviso, diagnostico: Diagnostico, segundos_assistido: int | None = None):
        self.contexto = contexto
        self.cfg = cfg
        self.atf = cfg["atf"]
        self.aviso = aviso
        self.diag = diagnostico
        self.segundos_assistido = segundos_assistido or self.atf["segundos_assistido"]
        self.page = contexto.new_page()

    # ------------------------------------------------------------------ utilidades
    def _log(self, texto: str):
        self.diag.log(texto)

    def _achar(self, fixo: str, candidatos: list[str], dentro=None):
        """Primeiro elemento visível: o seletor do config.json, se houver, ou os candidatos,
        procurando em todos os quadros da página (o ATF usa quadros)."""
        seletores = [fixo] if fixo else candidatos
        quadros = [dentro] if dentro is not None else self.page.frames
        for frame in quadros:
            for sel in seletores:
                try:
                    loc = frame.locator(sel)
                    for i in range(min(loc.count(), 5)):
                        if loc.nth(i).is_visible():
                            return loc.nth(i)
                except Exception:
                    continue
        return None

    def _digitar(self, campo, texto: str):
        campo.click()
        campo.fill("")
        for letra in texto:
            campo.press_sequentially(letra)
            time.sleep(random.uniform(0.05, 0.14))

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

    # ------------------------------------------------------------------ login
    def entrar(self, login: str, senha: str):
        sel = self.atf["seletores"]
        self._log(f"Abrindo {self.atf['url_login']}")
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
                self._log("Digitando login e senha")
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
            self.aviso("Não reconheci a tela de login do ATF: entre no Chrome com o login da empresa.")
            self.diag.salvar(self.page, "login-nao-reconhecido")

        limite = time.time() + (self.atf["segundos_login"] if automatico else self.segundos_assistido)
        while time.time() < limite:
            pausa(self.page, 0.8, 1.2)
            texto = _texto_da_pagina(self.page)
            erro = _ERRO_LOGIN.search(texto)
            if erro:
                self._log(f"ATF recusou o login: {erro.group(0)}")
                raise SenhaInvalida(f"o ATF recusou o acesso ({erro.group(0).lower()}). Confira login e senha.")
            if self._senha_na_tela() is None and texto.strip():
                self._log("Login aceito")
                return
            if automatico and re.search(r"captcha", texto, re.I) and limite - time.time() < self.atf["segundos_login"] - 5:
                self.aviso("O ATF pediu captcha: resolva no Chrome e clique em entrar.")
                limite = time.time() + self.segundos_assistido
                automatico = False
        pasta = self.diag.salvar(self.page, "login-sem-resposta")
        raise EtapaNaoConcluida("o ATF não confirmou o login a tempo." + (f" Diagnóstico: {pasta}" if pasta else ""))

    def _quadro_de(self, loc):
        try:
            return loc.element_handle().owner_frame()
        except Exception:
            return None

    # ------------------------------------------------------------------ download
    def baixar(self, tipo: str, inicio: date, fim: date, nome_tipo: str) -> Download:
        periodo = f"{inicio:%d/%m/%Y} a {fim:%d/%m/%Y}"
        url = self.atf["url_download"].get(tipo, "")
        capt = CapturadorArquivos(self.contexto, self.cfg["chrome"]["pasta_downloads"])
        resultado = Download()
        try:
            if url and self.atf["tentar_automatico"]:
                self._log(f"{nome_tipo}: abrindo {url}")
                try:
                    self._abrir(url)
                    self._preencher_consulta(tipo, inicio, fim)
                    resultado = self._esperar(capt, self.atf["segundos_automatico"], clicar_links=True)
                except SiteForaDoAr:
                    raise
                except Exception as e:
                    self._log(f"{nome_tipo}: automático falhou: {e}")
            if not resultado.arquivos and not resultado.sem_notas:
                self.diag.salvar(self.page, f"download-{tipo}")
                self.aviso(f"Aguardando você baixar no Chrome: {nome_tipo}, período {periodo}.")
                resultado = self._esperar(capt, self.segundos_assistido, clicar_links=False)
                resultado.assistido = True
        finally:
            capt.encerrar()
        self._log(f"{nome_tipo}: {len(resultado.arquivos)} arquivo(s) recebido(s)"
                  + (" — sem notas no período" if resultado.sem_notas else ""))
        return resultado

    def _preencher_consulta(self, tipo: str, inicio: date, fim: date):
        sel = self.atf["seletores"]
        campo_ini = self._achar(sel["data_inicio"], ['input[name*="ini" i]', 'input[id*="ini" i]',
                                                     'input[name*="dtde" i]', 'input[name*="datade" i]'])
        campo_fim = self._achar(sel["data_fim"], ['input[name*="fim" i]', 'input[id*="fim" i]', 'input[name*="final" i]',
                                                  'input[name*="ate" i]', 'input[name*="dtate" i]'])
        if campo_ini is None or campo_fim is None:
            raise EtapaNaoConcluida("campos de período não encontrados")
        self._digitar(campo_ini, f"{inicio:%d/%m/%Y}")
        self._digitar(campo_fim, f"{fim:%d/%m/%Y}")
        self._marcar_tipo(tipo)
        botao = self._achar(sel["consultar"], _BOTOES_CONSULTAR)
        if botao is None:
            raise EtapaNaoConcluida("botão de consultar/baixar não encontrado")
        botao.click()

    def _marcar_tipo(self, tipo: str):
        padrao = re.compile(_TEXTO_TIPO.get(tipo, r"$^"), re.I)
        for frame in self.page.frames:
            try:
                for i in range(frame.locator("label").count()):
                    rotulo = frame.locator("label").nth(i)
                    if padrao.search(rotulo.inner_text() or "") and rotulo.is_visible():
                        rotulo.click()
                        return
                selects = frame.locator("select")
                for i in range(selects.count()):
                    s = selects.nth(i)
                    for op in s.locator("option").all_inner_texts():
                        if padrao.search(op):
                            s.select_option(label=op)
                            return
            except Exception:
                continue

    def _esperar(self, capt: CapturadorArquivos, segundos: int, clicar_links: bool) -> Download:
        r = Download()
        limite = time.time() + segundos
        ultimo_novo = 0.0
        clicou = False
        while time.time() < limite:
            pausa(self.page, 0.8, 1.2)
            if capt.verificar():
                ultimo_novo = time.time()
            if capt.recebidos and time.time() - ultimo_novo > 6:
                break  # parou de chegar arquivo
            if capt.recebidos:
                continue
            texto = _texto_da_pagina(self.page)
            if _SEM_NOTAS.search(texto):
                r.sem_notas = True
                r.mensagem = "nenhuma nota no período"
                break
            if _FORA_DO_AR.search(texto[:3000]):
                raise SiteForaDoAr("o ATF informou que o serviço está indisponível.")
            if clicar_links and not clicou and time.time() > limite - segundos + 5:
                link = self._achar("", _LINKS_BAIXAR)
                if link is not None:
                    self._log("Clicando no link de download")
                    link.click()
                    clicou = True
        capt.verificar()
        r.arquivos = list(capt.recebidos)
        return r

    # ------------------------------------------------------------------ saída
    def sair(self, silencioso: bool = False):
        """Encerra a sessão da empresa antes da próxima (uma empresa nunca herda o login da outra)."""
        try:
            link = self._achar("", ['a:has-text("Sair")', 'input[value="Sair" i]', 'button:has-text("Sair")',
                                    'a:has-text("Encerrar")', 'a[href*="logout" i]', 'a[href*="sair" i]'])
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
