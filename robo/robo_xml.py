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
    python robo_xml.py --local empresas.xlsx [--competencia 09/2026 | --competencia 01/2026-09/2026] [--mei-ano]
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
    pendente: bool = False           # falta XML: o robô lê a caixa mais uma vez no final da execução


@dataclass
class Pendencia:
    """Rodada cujas mensagens não chegaram nas leituras da caixa: fica para o final da execução."""
    trabalhos: list
    senha: str
    envios: dict
    emissoes: dict
    esperadas: dict
    desde: datetime
    relevante: object
    alvos: list
    recolha: Recolha

    def faltam(self) -> dict[str, int]:
        return {c: n - self.recolha.recebidas.get(c, 0) for c, n in self.esperadas.items()
                if n - self.recolha.recebidas.get(c, 0) > 0}


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

    def __post_init__(self):
        self.tipos = arquivos.expandir_tipos(self.tipos)  # "cte" = CT-e Remetente + CT-e Destinatario

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
        self.pendencias: list[Pendencia] = []  # rodadas à espera de mensagens (lidas de novo no final)
        # avisado a cada tarefa (empresa x serviço) que muda: (trabalho, tipo, situação, mensagem)
        self.ao_progresso = None
        # Dossiê MEI salvo: (trabalho, resumo com o "historico" do ano) vai para o painel
        self.ao_mei = None

    def _progresso(self, t, tipo: str, situacao: str, mensagem: str = ""):
        if self.ao_progresso is not None:
            try:
                self.ao_progresso(t, tipo, situacao, mensagem)
            except Exception as e:  # o andamento é só informação: nunca para a rodada
                log.debug("andamento não enviado: %s", e)

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

        def com_sessao(funcao, *args, **kw):
            for tentativa in (1, 2):
                try:
                    return funcao(*args, **kw)
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
                    self._progresso(t, tipo, "andamento", "consultando no ATF")
                    envio = envios[(t.ie, tipo)] = com_sessao(atf.solicitar, tipo, t.ie, t.inicio, t.fim, arquivos.TIPOS.get(tipo, tipo))
                    if not envio.ok:
                        self._progresso(t, tipo, "erro", envio.resposta or "consulta não aceita")
                    elif envio.sem_notas:
                        self._progresso(t, tipo, "sem_movimento", "sem notas no período")
                    else:
                        self._progresso(t, tipo, "aguardando", "consulta enviada; o ATF entrega em Minhas Mensagens")

        # 1b) enquanto o ATF prepara os XML: faturas, extrato, omissão e certidão (o PDF vem na hora)
        emissoes: dict[tuple[str, str], object] = {}
        for t in trabalhos:
            for tipo in t.tipos:
                if tipo in SERVICOS:
                    nome = arquivos.TIPOS.get(tipo, tipo)
                    extra = {}
                    if tipo == "mei":  # meses do ano que ainda faltam (cliente que chega sem acompanhamento)
                        extra["periodos_extra"] = tuple(arquivos.periodos_mei(
                            self.cfg["pastas"]["destino"], t.nome, t.ie, t.codigo, t.inicio, self.cfg["mei"]["refazer_ano"]))
                    self._progresso(t, tipo, "andamento", "fazendo no ATF")
                    e = emissoes[(t.ie, tipo)] = com_sessao(atf.emitir, tipo, t.ie, t.inicio, t.fim, nome, **extra)
                    if e.arquivos:
                        arquivos.salvar_documentos(e.arquivos, self.cfg["pastas"]["destino"], t.nome, t.ie, tipo,
                                                   f"{t.inicio:%Y-%m}", t.codigo)
                    if e.dados:  # Dossiê MEI: entradas e saídas, notas e cartão acumulados no ano
                        for mes, dados in sorted(e.dados.pop("outros_meses", {}).items()):
                            dados.setdefault("inicio_atividade", e.dados.get("inicio_atividade"))
                            arquivos.salvar_faturamento_mei(self.cfg["pastas"]["destino"], t.nome, t.ie, mes, dados, t.codigo)
                        e.dados["resumo"] = arquivos.salvar_faturamento_mei(
                            self.cfg["pastas"]["destino"], t.nome, t.ie, f"{t.inicio:%Y-%m}", e.dados, t.codigo)
                        if self.ao_mei is not None:
                            try:
                                self.ao_mei(t, e.dados["resumo"])
                            except Exception as erro:  # o arquivo já está salvo no PC: o painel recebe na próxima vez
                                log.warning("   faturamento MEI não enviado ao portal: %s", erro)
                    self._progresso(t, tipo, **situacao_emissao(e))

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
            # (CT-e: "Data emissão: 01/09/2026 à 30/09/2026")
            m = re.search(r"(?:per[ií]odo\s+solicitado|data\s+emiss[aã]o):?\s*(\d{2}/\d{2}/\d{4})\s*[aà]\s*(\d{2}/\d{2}/\d{4})",
                          texto, re.I)
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
                    recolha = atf.recolher(esperadas, desde, self.cfg["atf"]["minutos_espera_mensagens"], relevante,
                                           leituras=self.cfg["atf"]["leituras_mensagens"])
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

        # mensagem atrasada de uma rodada anterior (pendente) chega aqui: vai para a rodada dela
        self._entregar_atrasadas(recolha)

        # 3) distribui os XML pelo conteúdo e salva
        por_destino = self._salvar_recolha(trabalhos, alvos, recolha, salvar_empresas=False)
        completas = not recolha.tempo_esgotado
        resultados = [self._resultado(t, envios, por_destino, recolha, completas, emissoes, final=False)
                      for t in trabalhos]
        if any(r.pendente for r in resultados):
            log.info("   Minhas Mensagens: faltam %s depois de %d leitura(s); segue para as próximas tarefas e "
                     "volta às mensagens no final", {c: n - recolha.recebidas.get(c, 0) for c, n in esperadas.items()
                                                     if n > recolha.recebidas.get(c, 0)},
                     self.cfg["atf"]["leituras_mensagens"])
            recolha.ignorados, recolha.mensagens_ignoradas = [], []  # já salvos em _sem_empresa
            self.pendencias.append(Pendencia(trabalhos, t0.senha, envios, emissoes, esperadas, desde, relevante,
                                             alvos, recolha))
        return resultados

    def _entregar_atrasadas(self, recolha: Recolha, pendencias: list[Pendencia] | None = None):
        """Uma mensagem que não era desta rodada pode ser a que faltava numa rodada pendente (mesmo login):
        o anexo vai para ela, e não para _sem_empresa."""
        for codigo, anexos, texto in list(recolha.mensagens_ignoradas):
            for p in (self.pendencias if pendencias is None else pendencias):
                if p.faltam().get(codigo) and p.relevante(anexos, texto):
                    p.recolha.arquivos.extend(anexos)
                    p.recolha.recebidas[codigo] = p.recolha.recebidas.get(codigo, 0) + 1
                    for anexo in anexos:
                        if anexo in recolha.ignorados:
                            recolha.ignorados.remove(anexo)
                    recolha.mensagens_ignoradas.remove((codigo, anexos, texto))
                    log.info("   resposta atrasada de %s entregue à rodada anterior", p.trabalhos[0].rotulo)
                    break

    def repescar(self, ler: bool = True) -> tuple[list[tuple[list, list[Resultado]]], bool]:
        """Final da execução: lê Minhas Mensagens mais uma vez para cada rodada pendente. Devolve
        ([(trabalhos, resultados)], tudo_chegou). Se ainda faltar, o robô deve parar de vez.
        ler=False só fecha as pendências com o que já chegou (o robô já está parando)."""
        pendencias, self.pendencias = self.pendencias, []
        saida, tudo = [], True
        parou = "" if ler else "parando"
        for i, p in enumerate(pendencias):
            t0 = p.trabalhos[0]
            if p.faltam() and not parou:
                log.info("Última leitura de Minhas Mensagens para o login %s (faltam %s)", t0.login, p.faltam())
                try:
                    self._garantir_chrome(Diagnostico(self.cfg["pastas"]["diagnostico"], t0.login))
                    t0.senha = t0.senha or p.senha
                    self._entrar(t0)
                    nova = self.atf.recolher(p.faltam(), p.desde, self.cfg["atf"]["minutos_espera_mensagens"],
                                             p.relevante, leituras=1)
                    p.recolha.arquivos.extend(nova.arquivos)
                    for c, n in nova.recebidas.items():
                        p.recolha.recebidas[c] = p.recolha.recebidas.get(c, 0) + n
                    self._entregar_atrasadas(nova, pendencias[i + 1:])
                    p.recolha.ignorados = nova.ignorados
                except MensagensIndisponiveis as e:
                    parou = str(e)
                    if e.recolha is not None:
                        p.recolha.arquivos.extend(e.recolha.arquivos)
                except (SenhaInvalida, SiteForaDoAr, EtapaNaoConcluida, SessaoExpirada, ChromeIndisponivel) as e:
                    log.info("   não consegui ler as mensagens de novo: %s", e)
                except Exception:
                    log.exception("   falha inesperada na última leitura das mensagens")
            completa = not p.faltam()
            tudo = tudo and completa
            p.recolha.tempo_esgotado = not completa
            por_destino = self._salvar_recolha(p.trabalhos, p.alvos, p.recolha, salvar_empresas=False)
            saida.append((p.trabalhos, [self._resultado(t, p.envios, por_destino, p.recolha, completa, p.emissoes)
                                        for t in p.trabalhos]))
            p.senha = ""
        return saida, tudo

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
                   emissoes: dict | None = None, final: bool = True) -> Resultado:
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
                if e.dados.get("resumo"):  # Dossiê MEI
                    r = e.dados["resumo"]
                    detalhes[tipo].update(arquivos=1, saidas=r["saidas"], entradas=r["entradas"], cartao=r["cartao"],
                                          sem_movimento=r["sem_movimento"], limite_ano=r["limite"], meses=r["meses"],
                                          notas_acumulado=r["notas_acumulado"], notas_percentual=r["notas_percentual"],
                                          cartao_acumulado=r["cartao_acumulado"], cartao_percentual=r["cartao_percentual"])
                    reais = arquivos.reais
                    partes.append(f"{nome}: " + ("sem movimento no mês" if r["sem_movimento"] else
                                                 f"notas: saídas {reais(r['saidas'] or 0)}, entradas {reais(r['entradas'] or 0)}; "
                                                 f"cartão {reais(r['cartao'] or 0)}")
                                  + f". No ano ({r['meses'][0][5:]} a {r['meses'][-1][5:]}): notas {reais(r['notas_acumulado'])}"
                                  f" ({r['notas_percentual']}% do limite de {reais(r['limite'])}); cartão "
                                  f"{reais(r['cartao_acumulado'])} ({r['cartao_percentual']}%)"
                                  + (f"; {e.resposta}" if e.resposta else ""))
                    detalhes[tipo].update(situacao="sem_movimento" if r["sem_movimento"] else "concluido",
                                          mensagem=partes[-1][len(nome) + 2:])
                    log.info("   %s %s: %s", t.nome, nome, partes[-1])
                    continue
                detalhes[tipo].update(situacao_emissao(e))
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
                detalhes[tipo].update(situacao="concluido", mensagem=f"{r['notas']} nota(s), {arquivos.reais(r['valor'])}")
            elif not envio.ok:
                detalhes[tipo].update(situacao="erro", mensagem=envio.resposta or "consulta não aceita")
            elif sem:
                detalhes[tipo].update(situacao="sem_movimento", mensagem="sem notas no período")
            elif not final:
                detalhes[tipo].update(situacao="aguardando", mensagem="aguardando o ATF; o robô lê as mensagens de novo no final")
            else:
                detalhes[tipo].update(situacao="erro", mensagem="o ATF não entregou em Minhas Mensagens")
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
        if faltando and not final:
            partes.append(f"{', '.join(faltando)}: aguardando o ATF (o robô lê as mensagens de novo no final)")
        elif faltando:
            partes.append(f"o ATF não entregou {', '.join(faltando)} em Minhas Mensagens "
                          f"({self.cfg['atf']['leituras_mensagens']} leituras e mais uma no final)")
        if falhas:
            partes.append("; ".join(falhas))
        msg = "; ".join(partes) + "."
        if any(d["arquivos"] or d["repetidos"] for d in detalhes.values()):
            status = "concluido"
        elif faltando or falhas:
            status = "erro"
        else:
            status = "sem_notas"
        return Resultado(status, msg[:1].upper() + msg[1:], total_notas, detalhes, pasta,
                         pendente=bool(faltando) and not final)

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


def situacao_emissao(e) -> dict:
    """Situação de um serviço feito na hora (faturas, extrato, omissão, certidão, cartão, MEI)."""
    if e.arquivos:
        return {"situacao": "concluido", "mensagem": f"{len(e.arquivos)} arquivo(s)"}
    if e.dados.get("resumo"):
        return {"situacao": "sem_movimento" if e.dados["resumo"].get("sem_movimento") else "concluido",
                "mensagem": "faturamento do mês salvo"}
    if e.sem_dados:
        return {"situacao": "sem_movimento", "mensagem": e.resposta or "nada a emitir"}
    return {"situacao": "erro", "mensagem": e.resposta or "o ATF não devolveu o arquivo"}


def rodadas(trabalhos: list, tamanho: int, chave=lambda t: t.login):
    """Agrupa por login, em rodadas de até 'tamanho' empresas."""
    grupos: dict[str, list] = {}
    for t in trabalhos:
        grupos.setdefault(chave(t).lower(), []).append(t)
    for grupo in grupos.values():
        for i in range(0, len(grupo), max(1, tamanho)):
            yield grupo[i:i + tamanho]


def competencias(texto: str | None) -> list[tuple[date, date]]:
    """'09/2026' -> [setembro]; '01/2026-09/2026' (ou '01/2026 a 09/2026') -> um período por mês."""
    partes = re.split(r"\s*(?:-|\ba\b|até)\s*(?=\d{1,2}/\d{2,4}\s*$)", (texto or "").strip())
    if len(partes) == 1:
        return [competencia(texto)]
    inicio, _ = competencia(partes[0])
    _, fim = competencia(partes[1])
    if fim < inicio:
        raise ValueError("competência final antes da inicial")
    saida, atual = [], inicio
    while atual <= fim:
        saida.append(competencia(f"{atual.month}/{atual.year}"))
        atual = saida[-1][1] + timedelta(days=1)
    return saida


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

    def registrar_mei(self, tarefa: str, meses: dict, inicio_atividade: str | None):
        """Dossiê MEI: grava o ano mês a mês no painel (a empresa e o escritório saem da tarefa)."""
        self._r("POST", "/rest/v1/rpc/xml_mei_registrar",
                json={"p_tarefa": tarefa, "p_meses": meses, "p_inicio_atividade": inicio_atividade})

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
        self.executor.ao_progresso = self._andamento
        self.executor.ao_mei = self._mei
        self.em_curso: dict[int, tuple[str, dict]] = {}  # trabalho -> (id da tarefa, detalhes por serviço)
        self.tarefas_atuais: list[dict] = []
        self.aguardando: dict[int, dict] = {}  # trabalho -> tarefa à espera da última leitura das mensagens
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
            if not lote and self.executor.pendencias:
                self._repescar()  # acabou a fila: última leitura das mensagens que faltaram
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
                self._repescar(ler=False)  # as que esperavam mensagens ficam com o que já chegou
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
        self.em_curso = {id(tr): (t["id"], {}) for tr, t in zip(trabalhos, lote)}
        # mesma competência na rodada (o banco pode juntar agendamentos diferentes do mesmo login)
        resultados = []
        for grupo in rodadas(trabalhos, len(trabalhos), chave=lambda t: f"{t.inicio}"):
            resultados.extend(zip(grupo, self.executor.executar_rodada(grupo)))
        por_ie_periodo = {(t.ie, t.inicio): (t, r) for t, r in resultados}
        for t in trabalhos:
            t.senha = ""
        self.chrome_ok = True
        for t in lote:
            trabalho, r = por_ie_periodo[(t["ie"], date.fromisoformat(t["data_inicio"]))]
            log.info("   %s -> %s: %s", t["nome"], r.status, r.mensagem)
            if r.pendente:  # fica "processando" até a última leitura das mensagens, no final da fila
                self.aguardando[id(trabalho)] = t
                self.portal.atualizar_tarefa(t["id"], {"mensagem": r.mensagem[:500], "detalhes": r.detalhes})
            else:
                self._finalizar(t, r)

    def _repescar(self, ler: bool = True):
        """Fila vazia: lê Minhas Mensagens mais uma vez para as tarefas que esperavam XML. Se ainda faltar,
        finaliza com o que chegou e o robô para de vez."""
        repescados, tudo = self.executor.repescar(ler=ler)
        for trabalhos, rs in repescados:
            for trabalho, r in zip(trabalhos, rs):
                t = self.aguardando.pop(id(trabalho), None)
                if t is not None:
                    self._finalizar(t, r)
                    log.info("   %s -> %s: %s", t["nome"], r.status, r.mensagem)
        if ler and not tudo:
            log.error("ERRO: o ATF não entregou todos os XML em Minhas Mensagens, nem na última leitura. "
                      "O robô parou de vez; o que funcionou foi salvo.")
            self.executor.fechar()
            sys.exit("ERRO: o ATF não entregou todos os XML. Confira o ATF e ligue o robô de novo.")

    def _andamento(self, trabalho, tipo: str, situacao: str, mensagem: str):
        """Cada serviço de cada empresa aparece no portal assim que muda (na fila, fazendo, concluído...)."""
        tarefa = self.em_curso.get(id(trabalho))
        if tarefa is None:
            return
        tid, detalhes = tarefa
        detalhes[tipo] = {"situacao": situacao, "mensagem": mensagem[:200]}
        self.portal.atualizar_tarefa(tid, {"detalhes": detalhes})

    def _mei(self, trabalho, resumo: dict):
        tarefa = self.em_curso.get(id(trabalho))
        if tarefa is not None:
            self.portal.registrar_mei(tarefa[0], resumo.get("historico") or {}, resumo.get("inicio_atividade"))

    def _finalizar(self, t, r: Resultado):
        self.portal.atualizar_tarefa(t["id"], {
            "status": r.status, "mensagem": r.mensagem[:500], "qtd_xml": r.qtd_xml,
            "detalhes": r.detalhes, "pasta": r.pasta, "concluido_em": agora(),
        })

    def encerrar(self, *_):
        log.info("Encerrando...")
        self.parar = True
        for t in self.tarefas_atuais + list(self.aguardando.values()):  # as tarefas em andamento voltam para a fila
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
    posicao: dict[int, int] = {}  # trabalho -> linha em resultados (a leitura final pode trocar o resultado)
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
            for (emp, t), r in zip(grupo, rs):
                log.info("   %s -> %s: %s", emp.nome, r.status, r.mensagem)
                resultados.append((emp, r))
                posicao[id(t)] = len(resultados) - 1
        # no final: mais uma leitura das mensagens para as rodadas que ficaram esperando
        if executor.pendencias:
            repescados, tudo = executor.repescar(ler=not parada)
            for trabalhos, rs in repescados:
                for t, r in zip(trabalhos, rs):
                    emp = resultados[posicao[id(t)]][0]
                    resultados[posicao[id(t)]] = (emp, r)
                    log.info("   %s -> %s: %s", emp.nome, r.status, r.mensagem)
            if not tudo and not parada:
                parada = ("o ATF não entregou todos os XML em Minhas Mensagens, nem na última leitura do final. "
                          "O robô parou de vez.")
    finally:
        executor.fechar()
    log.info("Relatório: %s", salvar_relatorio(cfg, resultados, inicio))
    if parada:
        log.error("ERRO: %s O que já tinha sido baixado foi salvo; rode de novo mais tarde para o que faltou.", parada)
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
    ap.add_argument("--competencia", help="MM/AAAA, ou um intervalo MM/AAAA-MM/AAAA (um mês de cada vez; padrão: mês anterior)")
    ap.add_argument("--mei-ano", action="store_true",
                    help="Dossiê MEI: busca de novo todos os meses do ano até a competência (sem isso, só os que faltam)")
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
    for aviso in cfg.get("_avisos", []):
        log.warning("ATENÇÃO: %s", aviso)
    if not (args.gerar_chaves or args.mostrar_chave_publica or args.modelo or args.gravar is not None):
        log.info("Os arquivos baixados ficam em: %s", Path(cfg["pastas"]["destino"]) / arquivos.PASTA_BAIXADOS)

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
    if args.mei_ano:
        cfg["mei"]["refazer_ano"] = True
    if args.local:
        try:
            periodos = competencias(args.competencia)
        except ValueError:
            sys.exit("Competência inválida: use MM/AAAA (ex.: 09/2026) ou um intervalo (ex.: 01/2026-09/2026).")
        for inicio, fim in periodos:
            if len(periodos) > 1:
                log.info("===== Competência %s =====", f"{inicio:%m/%Y}")
            rodar_local(cfg, args.local, inicio, fim)
            cfg["mei"]["refazer_ano"] = False  # o ano já foi refeito na primeira competência
        return

    robo = Robo(cfg)
    signal.signal(signal.SIGINT, robo.encerrar)
    signal.signal(signal.SIGTERM, robo.encerrar)
    robo.rodar()


if __name__ == "__main__":
    main()
