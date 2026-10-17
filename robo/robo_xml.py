"""Robô de XML da SEFAZ-PB (portal LotiVisse XML).

Roda no seu PC (com o Chrome aberto pelo abrir_chrome.bat), pega os agendamentos feitos no
portal, entra no ATF com o login do contador, pesquisa as notas de cada empresa pela inscrição
estadual e salva os XML em pastas.destino:
    <destino>/<ID> - <Nome fantasia>/<AAAA-MM>/<NF-e Saida | NF-e Entrada | NFC-e>/

Empresas do mesmo login usam a mesma sessão do ATF. Se o ATF recusar um login, o robô não tenta
de novo com a mesma senha (evita bloquear o acesso do contador por tentativas repetidas).

Uso:
    python robo_xml.py                     liga o robô do portal (deixe a janela aberta)
    python robo_xml.py --gerar-chaves      cria as chaves das senhas (uma vez só; veja o README)
    python robo_xml.py --modelo PASTA      copia a planilha modelo para a pasta
    python robo_xml.py --local empresas.xlsx [--competencia 09/2026]
                                           roda direto da planilha, sem o portal (para testar)
"""
from __future__ import annotations

import argparse
import calendar
import hashlib
import logging
import signal
import socket
import sys
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

import arquivos
import config
import cripto
import planilha
from atf_pb import AtfPB, Diagnostico, EtapaNaoConcluida, SenhaInvalida, SessaoExpirada, SiteForaDoAr
from navegador import Chrome, ChromeIndisponivel

VERSAO = "0.2-piloto"
FALHA_NO_RETORNO = "O ATF não devolveu os XML. Tente agendar novamente mais tarde."

log = logging.getLogger("robo")


@dataclass
class Resultado:
    status: str                      # concluido | sem_notas | senha_invalida | erro | fora_do_ar
    mensagem: str
    qtd_xml: int = 0
    detalhes: dict = field(default_factory=dict)
    pasta: str = ""


@dataclass
class Trabalho:
    """Uma empresa a processar (vinda do portal ou da planilha local)."""
    ie: str
    nome: str
    login: str
    senha: str
    tipos: list[str]
    inicio: date
    fim: date
    cnpj: str = ""
    codigo: str = ""

    @property
    def rotulo(self) -> str:
        return f"{self.nome} (IE {planilha.formatar_ie(self.ie)})"


class Executor:
    """Mantém o Chrome e a sessão do ATF abertos entre as empresas do mesmo login."""

    def __init__(self, cfg: dict, segundos_assistido: int | None = None):
        self.cfg = cfg
        self.segundos_assistido = segundos_assistido
        self.chrome: Chrome | None = None
        self.atf: AtfPB | None = None
        self.recusados: set[tuple[str, str]] = set()  # (login, impressão da senha) recusados nesta execução

    @staticmethod
    def _impressao(login: str, senha: str) -> tuple[str, str]:
        return login.lower(), hashlib.sha256(senha.encode()).hexdigest()

    def _garantir_chrome(self, diag: Diagnostico):
        if self.atf is not None and not self.atf.page.is_closed():
            self.atf.diag = diag
            return
        self.fechar()
        self.chrome = Chrome(self.cfg["chrome"]["porta"], self.cfg["chrome"]["fechar_abas"])
        contexto = self.chrome.abrir()  # ChromeIndisponivel sobe para quem chamou
        self.atf = AtfPB(contexto, self.cfg, lambda m: self._aviso(m), diag, self.segundos_assistido)

    def _aviso(self, msg: str):
        log.info("   %s", msg)
        if self.atf:
            self.atf.diag.log(msg)

    def executar(self, t: Trabalho) -> Resultado:
        if self._impressao(t.login, t.senha) in self.recusados:
            return Resultado("senha_invalida", f"O ATF já recusou o login {t.login} nesta rodada; não tentei de novo "
                                               "para não bloquear o acesso. Atualize a senha e agende de novo.")
        diag = Diagnostico(self.cfg["pastas"]["diagnostico"], t.ie)
        try:
            self._garantir_chrome(diag)
            return self._executar(t)
        except SenhaInvalida as e:
            self.recusados.add(self._impressao(t.login, t.senha))
            return Resultado("senha_invalida", f"Login {t.login} recusado pelo ATF: {e}")
        except SiteForaDoAr as e:
            return Resultado("fora_do_ar", f"ATF fora do ar: {e} Agende de novo mais tarde.")
        except EtapaNaoConcluida as e:
            log.info("   motivo: %s", e)
            return Resultado("erro", FALHA_NO_RETORNO)
        except ChromeIndisponivel:
            raise
        except Exception:
            log.exception("   falha inesperada")
            self.fechar()  # conexão com o Chrome pode ter caído: recomeça na próxima
            return Resultado("erro", FALHA_NO_RETORNO)

    def _executar(self, t: Trabalho) -> Resultado:
        atf = self.atf
        total = arquivos.Resumo()
        detalhes: dict = {}
        assistido = False
        for tentativa in (1, 2):
            try:
                if not atf.sessao_valida(t.login):
                    atf.entrar(t.login, t.senha)
                for tipo in t.tipos:
                    if tipo in detalhes:
                        continue  # já feito antes da sessão expirar
                    nome = arquivos.TIPOS.get(tipo, tipo)
                    d = atf.baixar(tipo, t.ie, t.inicio, t.fim, nome)
                    assistido |= d.assistido
                    xmls = [x for nome_arq, dados in d.arquivos for x in arquivos.extrair(dados, nome_arq)]
                    r = arquivos.salvar(xmls, self.cfg["pastas"]["destino"], t.nome, t.ie, t.cnpj, tipo, t.codigo)
                    total.somar(r)
                    detalhes[tipo] = {"salvos": r.salvos, "repetidos": r.repetidos, "conferir": r.conferir,
                                      "sem_notas": d.sem_notas and not xmls}
                    log.info("   %s: %d novo(s), %d repetido(s), %d para conferir", nome, r.salvos, r.repetidos, r.conferir)
                break
            except SessaoExpirada:
                log.info("   sessão do ATF expirou; entrando de novo")
                atf.login_atual = ""
                if tentativa == 2:
                    raise EtapaNaoConcluida("a sessão do ATF expirou duas vezes")

        pasta = arquivos.pasta_empresa(self.cfg["pastas"]["destino"], t.nome, t.ie, t.codigo).name
        if total.total == 0 and total.conferir == 0:
            if all(d.get("sem_notas") for d in detalhes.values()):
                return Resultado("sem_notas", "Nenhuma nota na competência.", 0, detalhes, pasta)
            return Resultado("erro", FALHA_NO_RETORNO, 0, detalhes, pasta)
        partes = [f"{arquivos.TIPOS.get(k, k)}: {d['salvos'] + d['repetidos']}" for k, d in detalhes.items()]
        msg = "XML salvos. " + "; ".join(partes) + "."
        if total.conferir:
            msg += f" {total.conferir} XML de outra empresa separado(s) em _conferir."
        if assistido:
            msg += " (concluído no modo assistido)"
        return Resultado("concluido", msg, total.total, detalhes, pasta)

    @property
    def login_aberto(self) -> str:
        return self.atf.login_atual if self.atf else ""

    def encerrar_sessao_ociosa(self):
        if self.atf and self.atf.login_atual and not self.atf.sessao_valida(self.atf.login_atual):
            self.atf.sair(silencioso=True)

    def fechar(self):
        if self.atf is not None:
            try:
                self.atf.sair(silencioso=True)
            except Exception:
                pass
        if self.chrome is not None:
            self.chrome.fechar()
        self.atf = None
        self.chrome = None


def competencia(texto: str | None) -> tuple[date, date]:
    """'09/2026' -> 01/09/2026 a 30/09/2026. Sem texto: o mês anterior."""
    if texto:
        mes, ano = (int(x) for x in texto.replace("-", "/").split("/"))
        if ano < 100:
            ano += 2000
    else:
        ref = date.today().replace(day=1) - timedelta(days=1)
        mes, ano = ref.month, ref.year
    return date(ano, mes, 1), date(ano, mes, calendar.monthrange(ano, mes)[1])


# ====================================================================== portal (Supabase)
class Portal:
    """Conversa com o Supabase usando a chave service_role (só neste computador)."""

    def __init__(self, url: str, chave: str, timeout: int = 60):
        self.url = url.rstrip("/")
        self.timeout = timeout
        self.cabecalhos = {"apikey": chave}
        if not chave.startswith("sb_"):  # chaves antigas (JWT) vão também no Authorization
            self.cabecalhos["Authorization"] = f"Bearer {chave}"

    def _r(self, metodo, caminho, **kw):
        cab = {**self.cabecalhos, **kw.pop("headers", {})}
        r = requests.request(metodo, f"{self.url}{caminho}", headers=cab, timeout=self.timeout, **kw)
        if r.status_code >= 400:
            raise RuntimeError(f"{metodo} {caminho} -> {r.status_code}: {r.text[:300]}")
        return r

    def pegar_tarefa(self, robo: str, login_aberto: str):
        dados = self._r("POST", "/rest/v1/rpc/xml_pegar_tarefa", json={"p_robo": robo, "p_login": login_aberto}).json()
        return dados[0] if dados else None

    def atualizar_tarefa(self, tid: str, campos: dict):
        self._r("PATCH", f"/rest/v1/xml_tarefas?id=eq.{tid}", json=campos, headers={"Prefer": "return=minimal"})

    def devolver_tarefas(self, robo: str):
        """Tarefas que ficaram 'processando' com este robô (ex.: o PC desligou) voltam para a fila."""
        self._r("PATCH", f"/rest/v1/xml_tarefas?status=eq.processando&robo=eq.{requests.utils.quote(robo)}",
                json={"status": "pendente", "iniciado_em": None, "robo": None}, headers={"Prefer": "return=minimal"})

    def sinal(self, robo: str, info: dict):
        self._r("POST", "/rest/v1/xml_robos", json={"id": robo, "ultimo_sinal": agora(), "versao": VERSAO, "info": info},
                headers={"Prefer": "resolution=merge-duplicates,return=minimal"})


def agora() -> str:
    return datetime.now(timezone.utc).isoformat()


class Robo:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        p = cfg["portal"]
        if not p["supabase_url"] or not p["chave_service_role"]:
            sys.exit("Configure 'portal.supabase_url' e 'portal.chave_service_role' no config.json "
                     "(veja web/IMPLANTACAO.md).")
        self.portal = Portal(p["supabase_url"], p["chave_service_role"])
        self.privada = cripto.carregar_privada(cfg["chaves"]["privada"])
        self.nome = p["nome_robo"] or socket.gethostname()
        self.executor = Executor(cfg, p["segundos_assistido"])
        self.tarefa_atual: dict | None = None
        self.ultimo_sinal = 0.0
        self.chrome_ok = True
        self.parar = False

    def rodar(self):
        log.info("Robô '%s' conectado a %s. XML em: %s", self.nome, self.portal.url, self.cfg["pastas"]["destino"])
        self.portal.devolver_tarefas(self.nome)
        while not self.parar:
            try:
                self._sinal()
                tarefa = self.portal.pegar_tarefa(self.nome, self.executor.login_aberto)
            except Exception as e:
                log.warning("Sem contato com o portal: %s", e)
                time.sleep(30)
                continue
            if not tarefa:
                self.executor.encerrar_sessao_ociosa()
                time.sleep(self.cfg["portal"]["intervalo_segundos"])
                continue
            self.tarefa_atual = tarefa
            try:
                self.processar(tarefa)
            except ChromeIndisponivel as e:
                self.chrome_ok = False
                log.error("%s — a tarefa volta para a fila; nova tentativa em 60 s.", e)
                self.portal.atualizar_tarefa(tarefa["id"], {"status": "pendente", "iniciado_em": None, "robo": None})
                self._sinal(forcar=True)
                time.sleep(60)
            except Exception:
                log.exception("Erro inesperado na tarefa %s", tarefa["id"])
                self._finalizar(tarefa, Resultado("erro", FALHA_NO_RETORNO))
            self.tarefa_atual = None

    def _sinal(self, forcar=False):
        if forcar or time.time() - self.ultimo_sinal > 30:
            self.portal.sinal(self.nome, {"chrome": self.chrome_ok, "tarefa": (self.tarefa_atual or {}).get("id")})
            self.ultimo_sinal = time.time()

    def processar(self, t: dict):
        log.info("Tarefa %s: %s (IE %s) %s a %s — %s", t["id"][:8], t["nome"], planilha.formatar_ie(t["ie"]),
                 t["data_inicio"], t["data_fim"], ", ".join(t["tipos"]))
        try:
            senha = cripto.decifrar(t["senha_cifrada"], self.privada)
        except cripto.SenhaIlegivel as e:
            self._finalizar(t, Resultado("senha_invalida", f"Senha não pôde ser lida: {e}"))
            return
        trabalho = Trabalho(ie=t["ie"], nome=t["nome"], login=t["login_atf"], senha=senha, tipos=t["tipos"],
                            inicio=date.fromisoformat(t["data_inicio"]), fim=date.fromisoformat(t["data_fim"]),
                            cnpj=t.get("cnpj") or "", codigo=t.get("codigo") or "")
        del senha
        r = self.executor.executar(trabalho)
        trabalho.senha = ""
        self.chrome_ok = True
        self._finalizar(t, r)
        log.info("   -> %s: %s", r.status, r.mensagem)

    def _finalizar(self, t, r: Resultado):
        self.portal.atualizar_tarefa(t["id"], {
            "status": r.status, "mensagem": r.mensagem[:500], "qtd_xml": r.qtd_xml,
            "detalhes": r.detalhes, "pasta": r.pasta, "concluido_em": agora(),
        })

    def encerrar(self, *_):
        log.info("Encerrando...")
        self.parar = True
        if self.tarefa_atual:
            try:  # a tarefa em andamento volta para a fila
                self.portal.atualizar_tarefa(self.tarefa_atual["id"], {"status": "pendente", "iniciado_em": None, "robo": None})
            except Exception:
                pass
        self.executor.fechar()
        sys.exit(0)


# ====================================================================== modo local
def rodar_local(cfg: dict, arquivo: str, inicio: date, fim: date):
    leitura = planilha.ler(arquivo)
    for e in leitura.erros + leitura.avisos:
        log.warning(e)
    if not leitura.empresas:
        sys.exit("Nenhuma empresa válida na planilha.")
    log.info("%d empresa(s), competência %s a %s", len(leitura.empresas), f"{inicio:%d/%m/%Y}", f"{fim:%d/%m/%Y}")
    executor = Executor(cfg)
    resultados = []
    try:
        # mesmo login em sequência: uma sessão do ATF para todas as empresas dele
        for emp in sorted(leitura.empresas, key=lambda e: e.login.lower()):
            if not emp.senha:
                resultados.append((emp, Resultado("senha_invalida", "SENHA em branco na planilha.")))
                continue
            log.info("%s (IE %s) — %s", emp.nome, planilha.formatar_ie(emp.ie), ", ".join(emp.tipos))
            trabalho = Trabalho(ie=emp.ie, nome=emp.nome, login=emp.login, senha=emp.senha, tipos=emp.tipos,
                                inicio=inicio, fim=fim, cnpj=emp.cnpj, codigo=emp.codigo)
            try:
                r = executor.executar(trabalho)
            except ChromeIndisponivel as e:
                sys.exit(str(e))
            log.info("   -> %s: %s", r.status, r.mensagem)
            resultados.append((emp, r))
    finally:
        executor.fechar()
    log.info("Relatório: %s", salvar_relatorio(cfg, resultados, inicio))


def salvar_relatorio(cfg, resultados, inicio: date) -> Path:
    from openpyxl import Workbook
    from openpyxl.styles import Font

    wb = Workbook()
    ws = wb.active
    ws.title = "Resultado"
    ws.append(["ID", "Nome fantasia", "Inscrição estadual", "Status", "XML", "Mensagem", "Pasta"])
    for c in ws[1]:
        c.font = Font(bold=True)
    for emp, r in resultados:
        ws.append([emp.codigo, emp.nome, planilha.formatar_ie(emp.ie), r.status, r.qtd_xml, r.mensagem, r.pasta])
    for col, w in zip("ABCDEFG", (10, 32, 16, 16, 8, 70, 40)):
        ws.column_dimensions[col].width = w
    pasta = Path(cfg["pastas"]["destino"]) / "_relatorios"
    pasta.mkdir(parents=True, exist_ok=True)
    destino = pasta / f"xml_{inicio:%Y-%m}_{datetime.now():%Y%m%d_%H%M%S}.xlsx"
    wb.save(destino)
    return destino


# ====================================================================== entrada
def main():
    ap = argparse.ArgumentParser(description="Robô de XML da SEFAZ-PB")
    ap.add_argument("--gerar-chaves", action="store_true", help="cria o par de chaves das senhas do ATF")
    ap.add_argument("--mostrar-chave-publica", action="store_true", help="mostra de novo a chave pública")
    ap.add_argument("--modelo", metavar="PASTA", help="copia a planilha modelo para a pasta")
    ap.add_argument("--local", metavar="PLANILHA", help="roda direto da planilha, sem o portal")
    ap.add_argument("--competencia", help="MM/AAAA (padrão: mês anterior)")
    args = ap.parse_args()

    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%d/%m %H:%M:%S",
        handlers=[logging.StreamHandler(), logging.FileHandler(config.RAIZ / "robo_xml.log", encoding="utf-8")],
    )
    try:
        cfg = config.carregar()
    except config.ConfigInvalida as e:
        sys.exit(str(e))

    if args.gerar_chaves:
        publica = cripto.gerar_chaves(Path(cfg["chaves"]["privada"]))
        print("\nChave privada salva em:", cfg["chaves"]["privada"])
        print("Faça uma cópia de segurança dela (pendrive/cofre). Sem ela, as senhas cadastradas não abrem.\n")
        print("Cole este valor na variável XML_CHAVE_PUBLICA da Vercel:\n")
        print(publica)
        return
    if args.mostrar_chave_publica:
        print(cripto.publica_de(cripto.carregar_privada(cfg["chaves"]["privada"])))
        return
    if args.modelo:
        print(planilha.copiar_modelo(args.modelo))
        return
    if args.local:
        try:
            inicio, fim = competencia(args.competencia)
        except ValueError:
            sys.exit("Competência inválida: use MM/AAAA, por exemplo 09/2026.")
        rodar_local(cfg, args.local, inicio, fim)
        return

    robo = Robo(cfg)
    signal.signal(signal.SIGINT, robo.encerrar)
    signal.signal(signal.SIGTERM, robo.encerrar)
    robo.rodar()


if __name__ == "__main__":
    main()
