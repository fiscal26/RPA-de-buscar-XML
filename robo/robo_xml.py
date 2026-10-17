"""Robô de XML da SEFAZ-PB (portal LotiVisse XML).

Roda no seu PC (com o Chrome aberto pelo abrir_chrome.bat), pega os agendamentos feitos no
portal, entra no ATF de cada empresa, baixa os XML e salva em pastas.destino:
    <destino>/<Apelido> - <CNPJ>/<AAAA-MM>/<NF-e Emitidas | NF-e Recebidas | NFC-e Emitidas>/

Uso:
    python robo_xml.py                     liga o robô do portal (deixe a janela aberta)
    python robo_xml.py --gerar-chaves      cria as chaves das senhas (uma vez só; veja o README)
    python robo_xml.py --modelo PASTA      salva a planilha modelo
    python robo_xml.py --local empresas.xlsx --inicio 01/09/2026 --fim 30/09/2026 [--tipos nfe_emitidas,nfe_recebidas]
                                           roda direto da planilha, sem o portal (para testar)
"""
from __future__ import annotations

import argparse
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
from atf_pb import AtfPB, Diagnostico, EtapaNaoConcluida, SenhaInvalida, SiteForaDoAr
from navegador import ChromeIndisponivel, conectar

VERSAO = "0.1-piloto"
FALHA_NO_RETORNO = "O ATF não devolveu os XML. Tente agendar novamente mais tarde."

log = logging.getLogger("robo")


@dataclass
class Resultado:
    status: str                      # concluido | sem_notas | senha_invalida | erro | fora_do_ar
    mensagem: str
    qtd_xml: int = 0
    detalhes: dict = field(default_factory=dict)
    pasta: str = ""


def executar_empresa(cfg: dict, cnpj: str, apelido: str, login: str, senha: str, tipos: list[str],
                     inicio: date, fim: date, segundos_assistido: int | None = None) -> Resultado:
    """Uma empresa, todos os tipos pedidos, numa sessão só do ATF."""
    diag = Diagnostico(cfg["pastas"]["diagnostico"], cnpj)
    total = arquivos.Resumo()
    detalhes: dict = {}
    assistido = False

    def aviso(msg: str):
        log.info("   %s", msg)
        diag.log(msg)

    with conectar(cfg["chrome"]["porta"], cfg["chrome"]["fechar_abas"]) as contexto:
        atf = AtfPB(contexto, cfg, aviso, diag, segundos_assistido)
        try:
            atf.entrar(login, senha)
            for tipo in tipos:
                nome = arquivos.TIPOS.get(tipo, tipo)
                d = atf.baixar(tipo, inicio, fim, nome)
                assistido |= d.assistido
                xmls = [x for nome_arq, dados in d.arquivos for x in arquivos.extrair(dados, nome_arq)]
                r = arquivos.salvar(xmls, cfg["pastas"]["destino"], apelido, cnpj, tipo)
                total.somar(r)
                detalhes[tipo] = {"salvos": r.salvos, "repetidos": r.repetidos, "conferir": r.conferir,
                                  "sem_notas": d.sem_notas and not xmls}
                log.info("   %s: %d novo(s), %d repetido(s), %d para conferir", nome, r.salvos, r.repetidos, r.conferir)
        finally:
            atf.sair()

    pasta = arquivos.pasta_empresa(cfg["pastas"]["destino"], apelido, cnpj).name
    if total.total == 0 and total.conferir == 0:
        if all(d.get("sem_notas") for d in detalhes.values()):
            return Resultado("sem_notas", "Nenhuma nota no período.", 0, detalhes, pasta)
        return Resultado("erro", FALHA_NO_RETORNO, 0, detalhes, pasta)
    partes = [f"{arquivos.TIPOS.get(t, t)}: {d['salvos'] + d['repetidos']}" for t, d in detalhes.items()]
    msg = "XML salvos. " + "; ".join(partes) + "."
    if total.conferir:
        msg += f" {total.conferir} XML de outro CNPJ separado(s) em _conferir."
    if assistido:
        msg += " (concluído no modo assistido)"
    return Resultado("concluido", msg, total.total, detalhes, pasta)


def executar_com_tratamento(cfg, *args, **kw) -> Resultado:
    try:
        return executar_empresa(cfg, *args, **kw)
    except SenhaInvalida as e:
        return Resultado("senha_invalida", f"Login recusado pelo ATF: {e}")
    except SiteForaDoAr as e:
        return Resultado("fora_do_ar", f"ATF fora do ar: {e} Agende de novo mais tarde.")
    except EtapaNaoConcluida as e:
        log.info("   motivo: %s", e)
        return Resultado("erro", FALHA_NO_RETORNO)


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

    def pegar_tarefa(self, robo: str):
        dados = self._r("POST", "/rest/v1/rpc/xml_pegar_tarefa", json={"p_robo": robo}).json()
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
                tarefa = self.portal.pegar_tarefa(self.nome)
            except Exception as e:
                log.warning("Sem contato com o portal: %s", e)
                time.sleep(30)
                continue
            if not tarefa:
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
        log.info("Tarefa %s: %s (%s) %s a %s — %s", t["id"][:8], t["apelido"], planilha.formatar_cnpj(t["cnpj"]),
                 t["data_inicio"], t["data_fim"], ", ".join(t["tipos"]))
        try:
            senha = cripto.decifrar(t["senha_cifrada"], self.privada)
        except cripto.SenhaIlegivel as e:
            self._finalizar(t, Resultado("senha_invalida", f"Senha não pôde ser lida: {e}"))
            return
        r = executar_com_tratamento(
            self.cfg, t["cnpj"], t["apelido"], t["login_atf"] or t["cnpj"], senha, t["tipos"],
            date.fromisoformat(t["data_inicio"]), date.fromisoformat(t["data_fim"]),
            segundos_assistido=self.cfg["portal"]["segundos_assistido"])
        del senha
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
        sys.exit(0)


# ====================================================================== modo local
def data_br(texto: str) -> date:
    return datetime.strptime(texto.strip(), "%d/%m/%Y").date()


def mes_anterior() -> tuple[date, date]:
    fim = date.today().replace(day=1) - timedelta(days=1)
    return fim.replace(day=1), fim


def rodar_local(cfg: dict, arquivo: str, inicio: date, fim: date, tipos: list[str]):
    leitura = planilha.ler(arquivo)
    for e in leitura.erros + leitura.avisos:
        log.warning(e)
    if not leitura.empresas:
        sys.exit("Nenhuma empresa válida na planilha.")
    log.info("%d empresa(s), período %s a %s, tipos: %s", len(leitura.empresas), f"{inicio:%d/%m/%Y}",
             f"{fim:%d/%m/%Y}", ", ".join(tipos))
    resultados = []
    for emp in leitura.empresas:
        if not emp.senha:
            resultados.append((emp, Resultado("senha_invalida", "Senha ATF em branco na planilha.")))
            continue
        log.info("%s (%s)", emp.apelido, planilha.formatar_cnpj(emp.cnpj))
        try:
            r = executar_com_tratamento(cfg, emp.cnpj, emp.apelido, emp.login_atf, emp.senha, tipos, inicio, fim)
        except ChromeIndisponivel as e:
            sys.exit(str(e))
        log.info("   -> %s: %s", r.status, r.mensagem)
        resultados.append((emp, r))
    relatorio = salvar_relatorio(cfg, resultados, inicio, fim)
    log.info("Relatório: %s", relatorio)


def salvar_relatorio(cfg, resultados, inicio: date, fim: date) -> Path:
    from openpyxl import Workbook
    from openpyxl.styles import Font

    wb = Workbook()
    ws = wb.active
    ws.title = "Resultado"
    ws.append(["CNPJ", "Apelido", "Status", "XML", "Mensagem", "Pasta"])
    for c in ws[1]:
        c.font = Font(bold=True)
    for emp, r in resultados:
        ws.append([planilha.formatar_cnpj(emp.cnpj), emp.apelido, r.status, r.qtd_xml, r.mensagem, r.pasta])
    for col, w in zip("ABCDEF", (22, 28, 16, 8, 70, 40)):
        ws.column_dimensions[col].width = w
    pasta = Path(cfg["pastas"]["destino"]) / "_relatorios"
    pasta.mkdir(parents=True, exist_ok=True)
    destino = pasta / f"xml_{inicio:%Y%m%d}-{fim:%Y%m%d}_{datetime.now():%Y%m%d_%H%M%S}.xlsx"
    wb.save(destino)
    return destino


# ====================================================================== entrada
def main():
    ap = argparse.ArgumentParser(description="Robô de XML da SEFAZ-PB")
    ap.add_argument("--gerar-chaves", action="store_true", help="cria o par de chaves das senhas do ATF")
    ap.add_argument("--mostrar-chave-publica", action="store_true", help="mostra de novo a chave pública")
    ap.add_argument("--modelo", metavar="PASTA", help="salva a planilha modelo na pasta")
    ap.add_argument("--local", metavar="PLANILHA", help="roda direto da planilha, sem o portal")
    ap.add_argument("--inicio", help="dd/mm/aaaa (padrão: 1º dia do mês anterior)")
    ap.add_argument("--fim", help="dd/mm/aaaa (padrão: último dia do mês anterior)")
    ap.add_argument("--tipos", default="nfe_emitidas,nfe_recebidas", help=f"separados por vírgula: {', '.join(arquivos.TIPOS)}")
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
        print(planilha.gerar_modelo(Path(args.modelo) / "modelo_empresas_xml.xlsx"))
        return
    if args.local:
        tipos = [t.strip() for t in args.tipos.split(",") if t.strip()]
        invalidos = [t for t in tipos if t not in arquivos.TIPOS]
        if invalidos:
            sys.exit(f"Tipo(s) desconhecido(s): {', '.join(invalidos)}. Use: {', '.join(arquivos.TIPOS)}")
        ini_p, fim_p = mes_anterior()
        inicio = data_br(args.inicio) if args.inicio else ini_p
        fim = data_br(args.fim) if args.fim else fim_p
        if fim < inicio:
            sys.exit("A data final é anterior à inicial.")
        rodar_local(cfg, args.local, inicio, fim, tipos)
        return

    robo = Robo(cfg)
    signal.signal(signal.SIGINT, robo.encerrar)
    signal.signal(signal.SIGTERM, robo.encerrar)
    robo.rodar()


if __name__ == "__main__":
    main()
