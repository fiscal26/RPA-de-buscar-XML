"""Robô de XML da SEFAZ-PB (portal LotiVisse XML).

Roda no seu PC (com o Chrome aberto pelo abrir_chrome.bat), pega os agendamentos feitos no
portal, entra no ATF com o login do contador, pesquisa as notas de cada empresa pela inscrição
estadual e salva os XML em pastas.destino:
    <destino>/Arquivos baixados/<ID>-<Nome>/<AAAA-MM>/<NF-e Saida | NF-e Entrada | NFC-e> - R$ <total>/
(o ZIP baixado do ATF é guardado como veio, sem descompactar)
Faturas, extrato de pagamentos, omissão e inadimplência e certidão de débitos saem na hora, em PDF:
    <destino>/Arquivos baixados/<ID>-<Nome>/<AAAA-MM>/<Serviço>/<Serviço> <AAAA-MM>.pdf

O ATF não entrega o XML na hora: a consulta (Tipo de Exibição XML) gera uma mensagem com o anexo em
"Minhas Mensagens". Por isso o robô trabalha em rodadas de um login: envia as consultas de todas as
empresas, recolhe as mensagens e distribui cada XML pela IE de dentro dele.
Se o ATF recusar um login, o robô não tenta de novo com a mesma senha (evita bloquear o acesso do
contador por tentativas repetidas).

Uso:
    python robo_xml.py                     liga o robô do portal (deixe a janela aberta)
    python robo_xml.py --gerar-chaves      cria as chaves das senhas (uma vez só; veja o README)
    python robo_xml.py --modelo PASTA      copia a planilha modelo para a pasta
    python robo_xml.py --local empresas.xlsx [--competencia 09/2026]
    python robo_xml.py --gravar faturas    grava os passos que você faz no Chrome (para ajustar o robô)
                                           roda direto da planilha, sem o portal (para testar)
"""
from __future__ import annotations

import argparse
import calendar
import hashlib
import logging
import re
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
from atf_pb import (SERVICOS, TIPO_TELA, MensagensIndisponiveis, AtfPB, Diagnostico, EtapaNaoConcluida, Recolha,
                    SenhaInvalida, SessaoExpirada, SiteForaDoAr)
from navegador import Chrome, ChromeIndisponivel

VERSAO = "0.4-piloto"
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
    """Mantém o Chrome e a sessão do ATF abertos e processa rodadas: um login, várias empresas.

    1. envia todas as consultas da rodada (cada empresa × cada XML marcado; Tipo de Exibição XML);
    2. acompanha Minhas Mensagens até o ATF entregar as respostas e baixa os anexos;
    3. distribui cada XML pela IE/CNPJ de dentro dele e salva nas pastas das empresas."""

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
        self.atf = AtfPB(contexto, self.cfg, self._aviso, diag, self.segundos_assistido)

    def _aviso(self, msg: str):
        log.info("   %s", msg)
        if self.atf:
            self.atf.diag.log(msg)

    def executar_rodada(self, trabalhos: list[Trabalho]) -> list[Resultado]:
        """Todos os trabalhos com o MESMO login. Devolve um resultado por trabalho, na mesma ordem."""
        if not trabalhos:
            return []
        login, senha = trabalhos[0].login, trabalhos[0].senha
        if self._impressao(login, senha) in self.recusados:
            return [Resultado("senha_invalida", f"O ATF já recusou o login {login} nesta rodada; não tentei de novo "
                                                "para não bloquear o acesso. Atualize a senha e agende de novo.")] * len(trabalhos)
        diag = Diagnostico(self.cfg["pastas"]["diagnostico"], login)
        try:
            self._garantir_chrome(diag)
            return self._rodada(trabalhos)
        except SenhaInvalida as e:
            self.recusados.add(self._impressao(login, senha))
            return [Resultado("senha_invalida", f"Login {login} recusado pelo ATF: {e}")] * len(trabalhos)
        except SiteForaDoAr as e:
            return [Resultado("fora_do_ar", f"ATF fora do ar: {e} Agende de novo mais tarde.")] * len(trabalhos)
        except EtapaNaoConcluida as e:
            log.info("   motivo: %s", e)
            return [Resultado("erro", FALHA_NO_RETORNO)] * len(trabalhos)
        except (ChromeIndisponivel, MensagensIndisponiveis):
            raise
        except Exception:
            log.exception("   falha inesperada")
            self.fechar()  # conexão com o Chrome pode ter caído: recomeça na próxima
            return [Resultado("erro", FALHA_NO_RETORNO)] * len(trabalhos)

    def _entrar(self, t: Trabalho):
        if not self.atf.sessao_valida(t.login):
            self.atf.entrar(t.login, t.senha)

    def _rodada(self, trabalhos: list[Trabalho]) -> list[Resultado]:
        atf = self.atf
        t0 = trabalhos[0]
        self._entrar(t0)

        def com_sessao(funcao, *args):
            for tentativa in (1, 2):
                try:
                    return funcao(*args)
                except SessaoExpirada:
                    log.info("   sessão do ATF expirou; entrando de novo")
                    atf.login_atual = ""
                    self._entrar(t0)
                    if tentativa == 2:
                        raise EtapaNaoConcluida("a sessão do ATF expirou duas vezes")

        # 1) envia as consultas de XML (uma por empresa e tipo; Emitente OU Destinatário)
        envios: dict[tuple[str, str], object] = {}
        for t in trabalhos:
            log.info("%s — %s", t.rotulo, ", ".join(arquivos.TIPOS.get(x, x) for x in t.tipos))
            for tipo in t.tipos:
                if tipo in TIPO_TELA:
                    envios[(t.ie, tipo)] = com_sessao(atf.solicitar, tipo, t.ie, t.inicio, t.fim, arquivos.TIPOS.get(tipo, tipo))

        # 1b) enquanto o ATF prepara os XML: faturas, extrato, omissão e certidão (o PDF vem na hora)
        emissoes: dict[tuple[str, str], object] = {}
        for t in trabalhos:
            for tipo in t.tipos:
                if tipo in SERVICOS:
                    nome = arquivos.TIPOS.get(tipo, tipo)
                    e = emissoes[(t.ie, tipo)] = com_sessao(atf.emitir, tipo, t.ie, t.inicio, t.fim, nome)
                    if e.arquivos:
                        arquivos.salvar_documentos(e.arquivos, self.cfg["pastas"]["destino"], t.nome, t.ie, tipo,
                                                   f"{t.inicio:%Y-%m}", t.codigo)

        # 2) recolhe as respostas em Minhas Mensagens
        esperadas: dict[str, int] = {}
        for (ie, tipo), envio in envios.items():
            if envio.ok and not envio.sem_notas:
                codigo = atf.atf["telas"][TIPO_TELA[tipo][0]]["funcao"]
                esperadas[codigo] = esperadas.get(codigo, 0) + 1
        alvos = [arquivos.Alvo(t.ie, t.cnpj, t.tipos) for t in trabalhos]

        periodo = (f"{t0.inicio:%d/%m/%Y}", f"{t0.fim:%d/%m/%Y}")

        def relevante(anexos: list, texto: str) -> bool:
            # "Período solicitado: 01/09/2026 a 30/09/2026": resposta de outra competência não conta
            m = re.search(r"per[ií]odo\s+solicitado:?\s*(\d{2}/\d{2}/\d{4})\s*a\s*(\d{2}/\d{2}/\d{4})", texto, re.I)
            if m and (m.group(1), m.group(2)) != periodo:
                return False
            xmls = [x for nome, dados in anexos for x in arquivos.extrair(dados, nome)]
            if xmls:
                return bool(arquivos.distribuir(xmls, alvos)[0])
            return True  # sem anexo: "não existem dados para o período consultado"

        # as respostas chegam depois do clique em Consultar (hora do próprio ATF)
        horas = [e.hora for e in envios.values() if e.hora]
        desde = min(horas) if horas else datetime.now() - timedelta(minutes=1)
        recolha = Recolha()
        if esperadas:
            for tentativa in (1, 2):
                try:
                    recolha = atf.recolher(esperadas, desde, self.cfg["atf"]["minutos_espera_mensagens"], relevante)
                    break
                except MensagensIndisponiveis as e:
                    if e.recolha is not None:  # salva o que já foi baixado antes de parar
                        self._salvar_recolha(trabalhos, alvos, e.recolha)
                    raise
                except SessaoExpirada:
                    atf.login_atual = ""
                    self._entrar(t0)
                    if tentativa == 2:
                        raise EtapaNaoConcluida("a sessão do ATF expirou duas vezes")

        # 3) distribui os XML pelo conteúdo e salva
        por_destino = self._salvar_recolha(trabalhos, alvos, recolha, salvar_empresas=False)
        completas = not recolha.tempo_esgotado
        return [self._resultado(t, envios, por_destino, recolha, completas, emissoes) for t in trabalhos]

    def _salvar_recolha(self, trabalhos: list[Trabalho], alvos, recolha: Recolha, salvar_empresas: bool = True):
        """Distribui os arquivos baixados pelo conteúdo, cada um INTEIRO (o ZIP continua ZIP). Nada se
        perde: arquivo de empresa fora da rodada vai para _sem_empresa e o que não é XML/ZIP vai para
        _nao_identificados."""
        destino = self.cfg["pastas"]["destino"]
        por_destino, sem_empresa, brutos = arquivos.distribuir_arquivos(recolha.arquivos, alvos)
        if brutos:
            for caminho, (nome, dados) in zip(arquivos.salvar_nao_identificados(brutos, destino), brutos):
                log.warning("   ATENÇÃO: o arquivo baixado '%s' (%s, %d bytes) não é XML nem ZIP de XML; guardado em %s",
                            nome, arquivos.tipo_de_arquivo(dados), len(dados), caminho)
        sem_empresa = sem_empresa + list(recolha.ignorados)
        if sem_empresa:
            n = arquivos.salvar_sem_empresa(sem_empresa, destino)
            log.info("   %d arquivo(s) de empresas fora desta rodada salvos em %s/_sem_empresa", n, arquivos.PASTA_BAIXADOS)
        if salvar_empresas:
            for t in trabalhos:
                for tipo in t.tipos:
                    if por_destino.get((t.ie, tipo)):
                        arquivos.salvar_originais(por_destino[(t.ie, tipo)], destino, t.nome, t.ie, tipo,
                                                  f"{t.inicio:%Y-%m}", t.codigo)
        return por_destino

    def _resultado(self, t: Trabalho, envios, por_destino, recolha: Recolha, completas: bool,
                   emissoes: dict | None = None) -> Resultado:
        detalhes: dict = {}
        sem_notas, faltando, falhas, partes = [], [], [], []
        total_notas = 0
        for tipo in t.tipos:
            nome = arquivos.TIPOS.get(tipo, tipo)
            if tipo in SERVICOS:
                e = (emissoes or {}).get((t.ie, tipo))
                if e is None:
                    continue
                n = len(e.arquivos)
                detalhes[tipo] = {"arquivos": n, "repetidos": 0, "notas": 0, "valor": 0.0, "sem_notas": e.sem_dados}
                if n:
                    partes.append(f"{nome}: {n} arquivo(s)")
                    log.info("   %s %s: %d arquivo(s)", t.nome, nome, n)
                elif e.sem_dados:
                    partes.append(f"{nome}: {e.resposta or 'nada a emitir'}")
                    log.info("   %s %s: %s", t.nome, nome, e.resposta or "nada a emitir")
                else:
                    falhas.append(f"{nome}: {e.resposta or 'o ATF não devolveu o arquivo'}")
                continue
            envio = envios.get((t.ie, tipo))
            baixados = por_destino.get((t.ie, tipo), [])
            r = arquivos.salvar_originais(baixados, self.cfg["pastas"]["destino"], t.nome, t.ie, tipo,
                                          f"{t.inicio:%Y-%m}", t.codigo) if baixados else None
            vazio = r is None
            # todas as respostas chegaram e nenhuma trouxe arquivo desta empresa/tipo: sem notas no período
            sem = vazio and envio.ok and (envio.sem_notas or completas)
            detalhes[tipo] = {"arquivos": r["novos"] if r else 0, "repetidos": r["repetidos"] if r else 0,
                              "notas": r["notas"] if r else 0, "valor": r["valor"] if r else 0.0, "sem_notas": bool(sem)}
            if r:
                total_notas += r["notas"]
                partes.append(f"{nome}: {r['notas']} nota(s), {arquivos.reais(r['valor'])}")
                log.info("   %s %s: %d arquivo(s) novo(s), %d nota(s), %s — %s", t.nome, nome, r["novos"], r["notas"],
                         arquivos.reais(r["valor"]), r["pasta"])
            elif not envio.ok:
                falhas.append(f"{nome}: {envio.resposta or 'consulta não aceita'}")
            elif sem:
                sem_notas.append(nome)
                log.info("   %s %s: sem notas", t.nome, nome)
            else:
                faltando.append(nome)

        pasta = arquivos.pasta_empresa(self.cfg["pastas"]["destino"], t.nome, t.ie, t.codigo).name
        if sem_notas:
            partes.append("sem notas em " + ", ".join(sem_notas))
        if faltando:
            partes.append(f"o ATF não entregou {', '.join(faltando)} em {self.cfg['atf']['minutos_espera_mensagens']} min")
        if falhas:
            partes.append("; ".join(falhas))
        msg = "; ".join(partes) + "."
        if any(d["arquivos"] or d["repetidos"] for d in detalhes.values()):
            status = "concluido"
        elif faltando or falhas:
            status = "erro"
        else:
            status = "sem_notas"
        return Resultado(status, msg[:1].upper() + msg[1:], total_notas, detalhes, pasta)

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


def rodadas(trabalhos: list, tamanho: int, chave=lambda t: t.login):
    """Agrupa por login, em rodadas de até 'tamanho' empresas."""
    grupos: dict[str, list] = {}
    for t in trabalhos:
        grupos.setdefault(chave(t).lower(), []).append(t)
    for grupo in grupos.values():
        for i in range(0, len(grupo), max(1, tamanho)):
            yield grupo[i:i + tamanho]


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

    def pegar_lote(self, robo: str, login_aberto: str, maximo: int) -> list[dict]:
        """Tarefas liberadas de UM login (de preferência o que já está aberto no ATF)."""
        return self._r("POST", "/rest/v1/rpc/xml_pegar_lote",
                       json={"p_robo": robo, "p_login": login_aberto, "p_max": maximo}).json() or []

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
        self.tarefas_atuais: list[dict] = []
        self.ultimo_sinal = 0.0
        self.chrome_ok = True
        self.parar = False

    def rodar(self):
        log.info("Robô '%s' conectado a %s. XML em: %s", self.nome, self.portal.url, self.cfg["pastas"]["destino"])
        self.portal.devolver_tarefas(self.nome)
        while not self.parar:
            try:
                self._sinal()
                lote = self.portal.pegar_lote(self.nome, self.executor.login_aberto, self.cfg["atf"]["empresas_por_rodada"])
            except Exception as e:
                log.warning("Sem contato com o portal: %s", e)
                time.sleep(30)
                continue
            if not lote:
                self.executor.encerrar_sessao_ociosa()
                time.sleep(self.cfg["portal"]["intervalo_segundos"])
                continue
            self.tarefas_atuais = lote
            try:
                self.processar(lote)
            except MensagensIndisponiveis as e:
                log.error("ERRO: %s O robô vai parar; as tarefas voltam para a fila.", e)
                for t in lote:
                    self.portal.atualizar_tarefa(t["id"], {"status": "pendente", "iniciado_em": None, "robo": None})
                self.tarefas_atuais = []
                self.executor.fechar()
                sys.exit(f"ERRO: {e} Confira o ATF no Chrome e ligue o robô de novo.")
            except ChromeIndisponivel as e:
                self.chrome_ok = False
                log.error("%s — as tarefas voltam para a fila; nova tentativa em 60 s.", e)
                for t in lote:
                    self.portal.atualizar_tarefa(t["id"], {"status": "pendente", "iniciado_em": None, "robo": None})
                self._sinal(forcar=True)
                time.sleep(60)
            except Exception:
                log.exception("Erro inesperado no lote de %s", lote[0].get("login_atf"))
                for t in lote:
                    self._finalizar(t, Resultado("erro", FALHA_NO_RETORNO))
            self.tarefas_atuais = []

    def _sinal(self, forcar=False):
        if forcar or time.time() - self.ultimo_sinal > 30:
            self.portal.sinal(self.nome, {"chrome": self.chrome_ok, "tarefas": [t["id"] for t in self.tarefas_atuais]})
            self.ultimo_sinal = time.time()

    def processar(self, lote: list[dict]):
        login = lote[0]["login_atf"]
        log.info("Rodada do login %s: %d empresa(s)", login, len(lote))
        try:
            senha = cripto.decifrar(lote[0]["senha_cifrada"], self.privada)
        except cripto.SenhaIlegivel as e:
            for t in lote:
                self._finalizar(t, Resultado("senha_invalida", f"Senha não pôde ser lida: {e}"))
            return
        trabalhos = [Trabalho(ie=t["ie"], nome=t["nome"], login=login, senha=senha, tipos=t["tipos"],
                              inicio=date.fromisoformat(t["data_inicio"]), fim=date.fromisoformat(t["data_fim"]),
                              cnpj=t.get("cnpj") or "", codigo=t.get("codigo") or "") for t in lote]
        del senha
        # mesma competência na rodada (o banco pode juntar agendamentos diferentes do mesmo login)
        resultados = []
        for grupo in rodadas(trabalhos, len(trabalhos), chave=lambda t: f"{t.inicio}"):
            resultados.extend(zip(grupo, self.executor.executar_rodada(grupo)))
        por_ie_periodo = {(t.ie, t.inicio): r for t, r in resultados}
        for t in trabalhos:
            t.senha = ""
        self.chrome_ok = True
        for t in lote:
            r = por_ie_periodo[(t["ie"], date.fromisoformat(t["data_inicio"]))]
            self._finalizar(t, r)
            log.info("   %s -> %s: %s", t["nome"], r.status, r.mensagem)

    def _finalizar(self, t, r: Resultado):
        self.portal.atualizar_tarefa(t["id"], {
            "status": r.status, "mensagem": r.mensagem[:500], "qtd_xml": r.qtd_xml,
            "detalhes": r.detalhes, "pasta": r.pasta, "concluido_em": agora(),
        })

    def encerrar(self, *_):
        log.info("Encerrando...")
        self.parar = True
        for t in self.tarefas_atuais:  # as tarefas em andamento voltam para a fila
            try:
                self.portal.atualizar_tarefa(t["id"], {"status": "pendente", "iniciado_em": None, "robo": None})
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
    # a senha do login é a primeira preenchida na planilha (as outras linhas do login podem vir em branco)
    senhas: dict[str, str] = {}
    for emp in leitura.empresas:
        if emp.senha:
            senhas.setdefault(emp.login.lower(), emp.senha)
    executor = Executor(cfg)
    resultados = []
    parada = ""
    try:
        prontos = []
        for emp in leitura.empresas:
            senha = senhas.get(emp.login.lower())
            if not senha:
                resultados.append((emp, Resultado("senha_invalida", f"SENHA do login {emp.login} em branco na planilha.")))
                continue
            prontos.append((emp, Trabalho(ie=emp.ie, nome=emp.nome, login=emp.login, senha=senha, tipos=emp.tipos,
                                          inicio=inicio, fim=fim, cnpj=emp.cnpj, codigo=emp.codigo)))
        for grupo in rodadas(prontos, cfg["atf"]["empresas_por_rodada"], chave=lambda p: p[1].login):
            log.info("Rodada do login %s: %d empresa(s)", grupo[0][1].login, len(grupo))
            try:
                rs = executor.executar_rodada([t for _, t in grupo])
            except ChromeIndisponivel as e:
                sys.exit(str(e))
            except MensagensIndisponiveis as e:
                parada = str(e)
                for emp, _ in grupo:
                    resultados.append((emp, Resultado("erro", f"Parado: {e}")))
                break
            for (emp, _), r in zip(grupo, rs):
                log.info("   %s -> %s: %s", emp.nome, r.status, r.mensagem)
                resultados.append((emp, r))
    finally:
        executor.fechar()
    log.info("Relatório: %s", salvar_relatorio(cfg, resultados, inicio))
    if parada:
        log.error("ERRO: %s O robô parou. O que já tinha sido baixado foi salvo; rode de novo mais tarde.", parada)
        sys.exit(1)


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
    ap.add_argument("--gravar", nargs="?", const="", metavar="SERVICO",
                    help="grava os passos que você faz no Chrome do robô (ex.: --gravar faturas)")
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
    if args.gravar is not None:
        from gravador import Gravador
        try:
            Gravador(cfg, args.gravar).gravar()
        except ChromeIndisponivel as e:
            sys.exit(str(e))
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
