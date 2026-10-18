"""Gravador de passos: registra o que VOCÊ faz no Chrome do robô, para o robô repetir igual.

Uso:  abra o Chrome pelo abrir_chrome.bat, rode  py robo_xml.py --gravar faturas  (ou gravar_passos.bat),
faça o caminho no ATF normalmente e, no fim, volte ao PowerShell e aperte Ctrl+C.

Tudo vai num arquivo só, robo/gravacoes/gravacao_<serviço>_<data>.zip, com:
- cada clique, campo alterado, opção escolhida e tecla Enter/Tab, com os dados do elemento
  (id, name, classe, rótulo, texto, caminho CSS e XPath, título da seção onde está);
- a lista de campos e botões de cada tela visitada (sem valores digitados);
- um print de cada tela visitada (pasta telas/);
- os arquivos baixados durante a gravação (pasta baixados/).
A SENHA NUNCA É GRAVADA: campos de senha aparecem como "***".
Arquivos baixados durante a gravação (o XML) são guardados na mesma pasta: com o Chrome ligado ao
robô, o download vai para uma pasta temporária e sumiria ao terminar.
"""
from __future__ import annotations

import json
import re
import time
from datetime import datetime
from pathlib import Path

from atf_pb import _JS_CAMPOS
from navegador import Chrome

PASTA = Path(__file__).resolve().parent / "gravacoes"

# Injetado em todas as páginas e quadros: avisa o Python a cada ação do usuário
JS_GRAVADOR = r"""(() => {
  if (window.__roboGravando) return;
  window.__roboGravando = true;
  const norm = s => (s || '').replace(/[\s ]+/g, ' ').trim();
  const css = e => {
    const partes = [];
    for (let n = e; n && n.nodeType === 1 && partes.length < 8; n = n.parentElement) {
      if (n.id) { partes.unshift('#' + CSS.escape(n.id)); break; }
      let p = n.tagName.toLowerCase();
      const irmaos = n.parentElement ? Array.from(n.parentElement.children).filter(c => c.tagName === n.tagName) : [];
      if (irmaos.length > 1) p += ':nth-of-type(' + (irmaos.indexOf(n) + 1) + ')';
      partes.unshift(p);
    }
    return partes.join(' > ');
  };
  const xpath = e => {
    const partes = [];
    for (let n = e; n && n.nodeType === 1; n = n.parentElement) {
      const irmaos = n.parentElement ? Array.from(n.parentElement.children).filter(c => c.tagName === n.tagName) : [];
      partes.unshift(n.tagName.toLowerCase() + (irmaos.length > 1 ? '[' + (irmaos.indexOf(n) + 1) + ']' : ''));
    }
    return '/' + partes.join('/');
  };
  const rotulo = e => norm((e.labels && e.labels[0] && e.labels[0].innerText)
      || (e.closest && e.closest('.form-floating') && e.closest('.form-floating').querySelector('label')
          && e.closest('.form-floating').querySelector('label').innerText)
      || e.getAttribute('aria-label') || e.placeholder || e.title || '').slice(0, 80);
  // título da seção: o texto curto mais próximo ANTES do elemento (ex.: "Emitente", "Destinatário")
  const secao = e => {
    const todos = Array.from(document.body.querySelectorAll('*'));
    for (let i = todos.indexOf(e) - 1; i >= 0; i--) {
      const t = todos[i];
      if (['INPUT', 'SELECT', 'OPTION', 'SCRIPT', 'STYLE', 'LABEL', 'BUTTON', 'TEXTAREA'].includes(t.tagName)) continue;
      if (t.contains(e) || t.children.length) continue;
      const txt = norm(t.innerText || t.textContent);
      if (txt.length >= 3 && txt.length <= 40) return txt;
    }
    return '';
  };
  const dados = e => ({
    tag: e.tagName.toLowerCase(), id: e.id || '', name: e.name || '', tipo_campo: e.type || '',
    classe: String(e.className || '').slice(0, 80), rotulo: rotulo(e),
    texto: ['A', 'BUTTON', 'TD', 'SPAN', 'DIV', 'LI', 'LABEL'].includes(e.tagName) ? norm(e.innerText).slice(0, 80) : '',
    valor: e.type === 'password' ? '***' : String(e.value === undefined ? '' : e.value).slice(0, 80),
    href: e.getAttribute && e.getAttribute('href') ? e.getAttribute('href').slice(0, 200) : '',
    css: css(e), xpath: xpath(e), secao: secao(e),
  });
  const enviar = (acao, e, extra) => {
    try { window.__roboEvento && window.__roboEvento(JSON.stringify(Object.assign(
      {acao, url: location.href, titulo_pagina: document.title}, dados(e), extra || {}))); } catch (x) {}
  };
  document.addEventListener('click', ev => {
    const alvo = ev.target.closest('a, button, input, select, label, td, li') || ev.target;
    enviar('clique', alvo);
  }, true);
  document.addEventListener('change', ev => {
    const e = ev.target;
    enviar('alterou', e, e.tagName === 'SELECT' ? {opcao: (e.options[e.selectedIndex] || {}).text || ''} : {});
  }, true);
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' || ev.key === 'Tab') enviar('tecla', ev.target, {tecla: ev.key});
  }, true);
})()"""


class Gravador:
    def __init__(self, cfg: dict, servico: str = ""):
        self.cfg = cfg
        self.servico = re.sub(r"[^A-Za-z0-9_-]+", "-", servico).strip("-")[:30]
        self.prints: list[tuple[str, bytes]] = []
        self.baixados: list[Path] = []
        self.eventos: list[dict] = []
        self.telas: list[dict] = []
        self._vistas: set[str] = set()
        self._downloads: list = []
        self._paginas_com_escuta: set = set()
        self.arquivos: list[str] = []

    def _receber(self, origem, dados: str):
        try:
            ev = json.loads(dados)
        except Exception:
            return
        ev["hora"] = datetime.now().strftime("%H:%M:%S")
        try:
            ev["quadro"] = origem["frame"].url
        except Exception:
            pass
        self.eventos.append(ev)
        descricao = ev.get("rotulo") or ev.get("texto") or ev.get("name") or ev.get("id") or ev.get("tag")
        extra = f" = {ev['valor']}" if ev["acao"] == "alterou" and ev.get("valor") else ""
        extra += f" ({ev['opcao']})" if ev.get("opcao") else ""
        print(f"  {ev['hora']} {ev['acao']:7} {descricao[:50]}{extra}  [seção: {ev.get('secao', '')[:25]}]")

    def _escutar_downloads(self, pagina):
        if pagina in self._paginas_com_escuta:
            return
        self._paginas_com_escuta.add(pagina)
        pagina.on("download", lambda d: self._downloads.append(d))

    def _guardar_downloads(self):
        while self._downloads:
            d = self._downloads.pop(0)
            PASTA.mkdir(parents=True, exist_ok=True)
            destino = PASTA / f"{datetime.now():%Y%m%d_%H%M%S}_{d.suggested_filename or 'download'}"
            try:
                d.save_as(str(destino))
                self.arquivos.append(destino.name)
                self.baixados.append(destino)
                print(f"  arquivo baixado guardado em: {destino}")
            except Exception as e:
                print(f"  não consegui guardar o download: {e}")

    def _injetar(self, pagina):
        for frame in pagina.frames:
            try:
                frame.evaluate(JS_GRAVADOR)
            except Exception:
                pass

    def _fotografar(self, pagina):
        """Lista de campos de cada tela nova (para conferir os seletores depois)."""
        for frame in pagina.frames:
            chave = frame.url.split("#")[0]
            if not chave.startswith("http") or chave in self._vistas:
                continue
            try:
                campos = frame.evaluate(_JS_CAMPOS)
            except Exception:
                continue
            self._vistas.add(chave)
            tela = {"url": frame.url, "hora": datetime.now().strftime("%H:%M:%S"), "campos": campos}
            if "google.com/recaptcha" not in chave and len(self.prints) < 80:
                try:  # print da tela inteira (com todos os quadros) quando aparece uma tela nova
                    pagina.wait_for_timeout(600)
                    nome = f"{len(self.prints) + 1:02d}_{tela['hora'].replace(':', '')}_" \
                           f"{re.sub(r'[^A-Za-z0-9]+', '-', chave.split('/')[-1].split('?')[0])[:40]}.png"
                    self.prints.append((nome, pagina.screenshot(full_page=True)))
                    tela["print"] = f"telas/{nome}"
                except Exception:
                    pass
            self.telas.append(tela)

    def gravar(self, segundos: float | None = None) -> Path:
        chrome = Chrome(self.cfg["chrome"]["porta"], fechar_abas=False)
        contexto = chrome.abrir()
        contexto.expose_binding("__roboEvento", self._receber)
        contexto.add_init_script(JS_GRAVADOR)
        contexto.on("page", lambda pagina: self._escutar_downloads(pagina))  # abas novas (o anexo pode abrir uma)
        for pagina in contexto.pages:
            self._injetar(pagina)
        print("\nGRAVANDO. Faça no Chrome o caminho completo no ATF (login, consulta, Pesquisar, Consultar,")
        print("Minhas Mensagens, abrir a mensagem e baixar o anexo). A senha não é gravada.")
        print("Quando terminar, volte aqui e aperte Ctrl+C.\n")
        fim = time.time() + segundos if segundos else None
        try:
            while fim is None or time.time() < fim:
                paginas = [p for p in contexto.pages if not p.is_closed()]
                for pagina in paginas:
                    self._escutar_downloads(pagina)
                    self._injetar(pagina)  # páginas e quadros novos
                    self._fotografar(pagina)
                self._guardar_downloads()
                if paginas:
                    paginas[0].wait_for_timeout(700)
                else:
                    time.sleep(0.7)
        except KeyboardInterrupt:
            pass
        finally:
            self._guardar_downloads()
            arquivo = self.salvar()
            chrome.fechar()
        return arquivo

    def salvar(self) -> Path:
        """Um arquivo só (.zip) com os passos, os prints das telas e os arquivos baixados."""
        import zipfile

        PASTA.mkdir(parents=True, exist_ok=True)
        rotulo = f"_{self.servico}" if self.servico else ""
        arquivo = PASTA / f"gravacao{rotulo}_{datetime.now():%Y%m%d_%H%M%S}.zip"
        dados = {"servico": self.servico, "eventos": self.eventos, "telas": self.telas,
                 "arquivos_baixados": [f"baixados/{a}" for a in self.arquivos]}
        with zipfile.ZipFile(arquivo, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("gravacao.json", json.dumps(dados, ensure_ascii=False, indent=1))
            for nome, png in self.prints:
                z.writestr(f"telas/{nome}", png)
            for caminho in self.baixados:
                if caminho.exists():
                    z.write(caminho, f"baixados/{caminho.name}")
                    caminho.unlink()
        print(f"\n{len(self.eventos)} ação(ões), {len(self.prints)} tela(s) e {len(self.baixados)} arquivo(s) baixado(s)")
        print(f"gravados em: {arquivo}")
        print("Mande esse arquivo para ajustarmos o robô.")
        return arquivo
