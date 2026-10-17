"""Conexão com o Chrome do usuário (porta de depuração) e captura dos XML/ZIP baixados.

Mesmo método do emissor de CND: Playwright conectado por CDP ao Chrome já aberto pelo
abrir_chrome.bat, sem chromedriver. Cliques e digitação chegam como entrada real do navegador.
"""
from __future__ import annotations

import random
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Optional

EXTENSOES = (".xml", ".zip")


class ChromeIndisponivel(Exception):
    pass


@contextmanager
def conectar(porta: int, fechar_abas: bool = True):
    """Entrega o contexto (perfil) do Chrome aberto. Ao sair, fecha as abas abertas durante a
    tarefa e desconecta: o Chrome continua aberto para a próxima."""
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        try:
            browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{porta}")
        except Exception as e:
            raise ChromeIndisponivel(
                f"Não consegui conectar ao Chrome na porta {porta}. "
                "Abra o Chrome pelo 'abrir_chrome.bat' e tente de novo."
            ) from e
        contexto = browser.contexts[0] if browser.contexts else browser.new_context()
        antes = set(contexto.pages)
        try:
            yield contexto
        finally:
            if fechar_abas:
                fechar_abas_novas(contexto, antes)


def fechar_abas_novas(contexto, antes: set):
    """Fecha as abas que não existiam antes. Se seriam fechadas todas, deixa uma em branco:
    sem abas o Chrome fecha a janela."""
    try:
        abertas = [p for p in contexto.pages if not p.is_closed()]
        novas = [p for p in abertas if p not in antes]
        if novas and len(novas) == len(abertas):
            contexto.new_page()
        for p in novas:
            try:
                p.close()
            except Exception:
                pass
    except Exception:
        pass


def pausa(page, minimo: float, maximo: float):
    """Espera um tempo aleatório, como uma pessoa faria. Mantém os eventos do Playwright rodando."""
    page.wait_for_timeout(random.uniform(minimo, maximo) * 1000)


def eh_xml_ou_zip(dados: bytes) -> bool:
    if not dados:
        return False
    if dados[:4] == b"PK\x03\x04":
        return True
    inicio = dados[:300].lstrip(b"\xef\xbb\xbf \r\n\t")
    return inicio.startswith(b"<?xml") or inicio.startswith(b"<nfeProc") or inicio.startswith(b"<NFe") \
        or inicio.startswith(b"<procEvento")


class CapturadorArquivos:
    """Junta tudo o que chegar como XML ou ZIP enquanto estiver ligado:

    - download disparado pela página (evento do Playwright), em qualquer aba;
    - resposta do site com XML/ZIP (quando o ATF mostra o arquivo em vez de baixar);
    - arquivo .xml/.zip novo na pasta Downloads do Chrome (caso você baixe à mão).
    """

    def __init__(self, contexto, pasta_downloads: str):
        self.contexto = contexto
        self.pasta = Path(pasta_downloads)
        self.inicio = time.time()
        self.recebidos: list[tuple[str, bytes]] = []
        self._downloads = []
        self._respostas = []
        self._vistos: set[Path] = set()
        self._assinaturas: set[int] = set()

        for page in contexto.pages:
            page.on("download", self._novo_download)
        contexto.on("page", self._nova_aba)
        contexto.on("response", self._nova_resposta)

    def _nova_aba(self, page):
        page.on("download", self._novo_download)

    def _novo_download(self, download):
        self._downloads.append(download)

    def _nova_resposta(self, resposta):
        try:
            tipo = resposta.headers.get("content-type", "").lower()
            disp = resposta.headers.get("content-disposition", "").lower()
            if "zip" in tipo or "octet-stream" in tipo or "attachment" in disp or \
                    ("xml" in tipo and "html" not in tipo):
                self._respostas.append(resposta)
        except Exception:
            pass

    def encerrar(self):
        try:
            self.contexto.remove_listener("page", self._nova_aba)
            self.contexto.remove_listener("response", self._nova_resposta)
            for page in self.contexto.pages:
                page.remove_listener("download", self._novo_download)
        except Exception:
            pass

    def _guardar(self, nome: str, dados: Optional[bytes]) -> bool:
        if not dados or not eh_xml_ou_zip(dados):
            return False
        assinatura = hash(dados)
        if assinatura in self._assinaturas:
            return False  # o mesmo arquivo pode chegar como download e como resposta
        self._assinaturas.add(assinatura)
        self.recebidos.append((nome, dados))
        return True

    def verificar(self) -> int:
        """Recolhe o que chegou desde a última chamada. Devolve quantos arquivos novos."""
        novos = 0
        while self._downloads:
            d = self._downloads.pop(0)
            novos += self._guardar(d.suggested_filename or "download", self._ler_download(d))
        while self._respostas:
            r = self._respostas.pop(0)
            try:
                novos += self._guardar(r.url.rsplit("/", 1)[-1][:80], r.body())
            except Exception:
                continue
        novos += self._verificar_pasta()
        return novos

    @staticmethod
    def _ler_download(download) -> Optional[bytes]:
        try:
            caminho = download.path()
            if caminho:
                return Path(caminho).read_bytes()
        except Exception:
            pass
        try:
            destino = Path(tempfile.gettempdir()) / f"xml_{int(time.time() * 1000)}"
            download.save_as(str(destino))
            dados = destino.read_bytes()
            destino.unlink(missing_ok=True)
            return dados
        except Exception:
            return None

    def _verificar_pasta(self) -> int:
        if not self.pasta.is_dir():
            return 0
        novos = 0
        for arq in self.pasta.iterdir():
            if arq.suffix.lower() not in EXTENSOES or arq in self._vistos:
                continue
            try:
                mtime = arq.stat().st_mtime
            except OSError:
                continue
            if mtime < self.inicio - 2:
                self._vistos.add(arq)  # já existia antes de começar
                continue
            if time.time() - mtime < 1:
                continue  # ainda sendo gravado
            self._vistos.add(arq)
            try:
                novos += self._guardar(arq.name, arq.read_bytes())
            except OSError:
                continue
        return novos
