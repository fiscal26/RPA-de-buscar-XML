"""Histórico do MEI por identidade de armazenamento e ano."""
import json
import logging
import math
import re
from datetime import date, datetime, timezone
from pathlib import Path

from arquivos import limite_mei, meses_mei_para_painel, meses_pendentes_mei, montar_planilha_mei
from armazenamento import (
    PASTA_CONTEXTOS, VERSAO, ArmazenamentoOcupado, ContextoArmazenamento,
    IdentidadeArmazenamentoInvalida, abrir_empresa, arquivo_validado,
    criar_subpasta_validada, gravar_json_atomico, publicar_arquivo,
    subpasta_existente_validada,
)

log = logging.getLogger("robo")
PASTA_DOSSIE = "Dossiê MEI"
PLANILHA_PENDENTE = "Dados salvos, planilha pendente."
_ARQUIVO = re.compile(r"Faturamento MEI ([0-9]{4})\.json")
_INSTANTE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}"
                       r"(?:\.[0-9]{1,6})?(?:Z|[+-](?:0[0-9]|1[0-5]):[0-5][0-9])")
_CAMPOS_MES = ("saidas", "entradas", "qtd_saidas", "qtd_entradas", "cartao", "sem_movimento", "simei")


def _instante(valor: str) -> datetime:
    if not isinstance(valor, str) or not _INSTANTE.fullmatch(valor):
        raise ValueError("Data da coleta sem fuso explícito.")
    return datetime.fromisoformat(valor)


def _validar_competencia(mes: str, ano: int):
    if not isinstance(mes, str) or not re.fullmatch(rf"{ano:04d}-(0[1-9]|1[0-2])", mes):
        raise ValueError("Competência incompatível com o ano.")


def _validar_inicio(inicio):
    if inicio is not None and date.fromisoformat(inicio).isoformat() != inicio:
        raise ValueError("Início de atividade inválido.")


def _validar_contexto(contexto: ContextoArmazenamento):
    if (contexto.origem, contexto.tipo_documento) != ("sefaz_pb", "ie"):
        raise IdentidadeArmazenamentoInvalida("O dossiê MEI exige uma inscrição estadual da Paraíba.")


def _numeros_validos(valores):
    return all(valor is None or (type(valor) in (int, float) and math.isfinite(valor)) for valor in valores)


def _validar_mes(mes: str, dados: dict, ano: int):
    _validar_competencia(mes, ano)
    if not isinstance(dados, dict):
        raise ValueError("Dados mensais inválidos.")
    _instante(dados.get("consultado_em"))
    if any(dados.get(k) is None for k in _CAMPOS_MES[:4]) or not _numeros_validos(
        dados.get(k) for k in _CAMPOS_MES[:4]
    ):
        raise ValueError("Valores mensais inválidos.")
    if type(dados.get("sem_movimento")) is not bool or (
        dados.get("simei") is not None and type(dados["simei"]) is not bool
    ):
        raise ValueError("Situação do MEI inválida.")
    cartao = dados.get("cartao")
    if cartao is not None and (not isinstance(cartao, dict) or not _numeros_validos(
        cartao.get(k) for k in ("qtd", "valor")
    )):
        raise ValueError("Dados de cartão inválidos.")
    if not isinstance(dados.get("itens"), list) or any(
        not isinstance(item, dict) or not isinstance(item.get("tipo"), str)
        or not _numeros_validos(item.get(k) for k in _CAMPOS_MES[:4]) for item in dados["itens"]
    ):
        raise ValueError("Itens mensais inválidos.")
    if not isinstance(dados.get("linhas"), list) or any(
        not isinstance(linha, list) or any(not isinstance(celula, str) for celula in linha)
        for linha in dados["linhas"]
    ):
        raise ValueError("Linhas do dossiê inválidas.")


def _ler(arquivo: Path, contexto: ContextoArmazenamento, ano: int) -> dict | None:
    try:
        historico = json.loads(arquivo.read_text(encoding="utf-8"))
        if (type(historico["versao"]) is not int or historico["versao"] != VERSAO
                or historico["identidade"] != contexto.identidade or type(historico["ano"]) is not int
                or historico["ano"] != ano or not 1 <= ano <= 9999
                or type(historico["planilha_pendente"]) is not bool):
            raise ValueError("Versão, identidade ou ano incompatíveis.")
        empresa = historico["empresa"]
        _validar_inicio(empresa.get("inicio_atividade"))
        if (empresa["ie"] != contexto.documento
                or empresa["limite_ano"] != limite_mei(ano, empresa.get("inicio_atividade"))):
            raise ValueError("Metadados da empresa incompatíveis.")
        if not isinstance(historico["meses"], dict) or not historico["meses"]:
            raise ValueError("Histórico sem meses válidos.")
        for mes, dados in historico["meses"].items():
            _validar_mes(mes, dados, ano)
        return historico
    except FileNotFoundError:
        return None
    except (OSError, ValueError, KeyError, AttributeError, TypeError, OverflowError) as erro:
        raise IdentidadeArmazenamentoInvalida(f"Histórico MEI inválido em {arquivo}: {erro}") from erro


def _arquivo(pasta: Path, ano: int) -> Path:
    return arquivo_validado(pasta, f"Faturamento MEI {ano:04d}.json")


def _planilha(arquivo: Path, historico: dict, competencia: str) -> dict:
    wb, resumo = montar_planilha_mei(historico, competencia)
    try:
        # O JSON já está salvo. Uma planilha aberta deve preservar a versão anterior.
        xlsx = arquivo_validado(arquivo.parent, arquivo.with_suffix(".xlsx").name)
        publicar_arquivo(xlsx, wb.save)
        if historico["planilha_pendente"]:
            gravar_json_atomico(arquivo, {**historico, "planilha_pendente": False})
        pendente = False
    except (OSError, IdentidadeArmazenamentoInvalida) as erro:
        log.warning("%s %s: %s", PLANILHA_PENDENTE, arquivo, erro)
        pendente = True
    finally:
        wb.close()
    return {"pasta": str(arquivo.parent), "planilha_pendente": pendente, **resumo}


def periodos(destino, contexto: ContextoArmazenamento, inicio: date, refazer_ano: bool = False) -> list:
    _validar_contexto(contexto)
    with abrir_empresa(destino, contexto) as empresa:
        try:
            pasta = subpasta_existente_validada(empresa, PASTA_DOSSIE)
        except FileNotFoundError:
            return meses_pendentes_mei(inicio, {}, refazer_ano)
        arquivo = _arquivo(pasta, inicio.year)
        historico = _ler(arquivo, contexto, inicio.year)
        if historico is None:
            return meses_pendentes_mei(inicio, {}, refazer_ano)
        if historico["planilha_pendente"]:
            _planilha(arquivo, historico, max(historico["meses"]))
        return meses_pendentes_mei(inicio, historico["meses"], refazer_ano)


def salvar(destino, contexto: ContextoArmazenamento, competencia: str, dados: dict, consultado_em: str | None = None) -> dict:
    _validar_contexto(contexto)
    instante = consultado_em if consultado_em is not None else datetime.now(timezone.utc).isoformat()
    ano = date.fromisoformat(f"{competencia}-01").year
    inicio = dados.get("inicio_atividade")
    _validar_inicio(inicio)
    coletados = {}
    for mes, coleta in {**dados.get("outros_meses", {}), competencia: dados}.items():
        registro = {k: coleta.get(k) for k in _CAMPOS_MES} | {
            "itens": coleta.get("itens", []), "linhas": coleta.get("linhas", []),
            "consultado_em": coleta.get("consultado_em", instante),
        }
        _validar_mes(mes, registro, ano)
        coletados[mes] = registro

    with abrir_empresa(destino, contexto) as pasta_empresa:
        pasta = criar_subpasta_validada(pasta_empresa, PASTA_DOSSIE)
        arquivo = _arquivo(pasta, ano)
        historico = _ler(arquivo, contexto, ano)
        if historico is None:
            historico = {"versao": VERSAO, "identidade": contexto.identidade, "ano": ano,
                         "empresa": {"ie": contexto.documento}, "meses": {}, "planilha_pendente": True}
        empresa, meses = historico["empresa"], historico["meses"]
        novos = {mes: registro for mes, registro in coletados.items()
                 if mes not in meses or _instante(registro["consultado_em"]) > _instante(meses[mes]["consultado_em"])}
        if novos:
            meses.update(novos)
            empresa.update(nome=contexto.nome, codigo=contexto.codigo)
            if inicio:
                empresa["inicio_atividade"] = inicio
            empresa["limite_ano"] = limite_mei(ano, empresa.get("inicio_atividade"))
            historico["planilha_pendente"] = True
            gravar_json_atomico(arquivo, historico)
        elif not historico["planilha_pendente"]:
            try:
                existe = arquivo_validado(pasta, arquivo.with_suffix(".xlsx").name).is_file()
            except IdentidadeArmazenamentoInvalida:
                existe = False
            if existe:
                wb, resumo = montar_planilha_mei(historico, competencia)
                wb.close()
                return {"pasta": str(pasta), "planilha_pendente": False, **resumo}
            historico["planilha_pendente"] = True
            gravar_json_atomico(arquivo, historico)
        return _planilha(arquivo, historico, competencia)


def _historicos_da_empresa(destino, contexto):
    saida = []
    with abrir_empresa(destino, contexto, somente_leitura=True) as empresa:
        try:
            pasta = subpasta_existente_validada(empresa, PASTA_DOSSIE)
        except FileNotFoundError:
            return saida
        for candidato in sorted(pasta.iterdir()):
            nome = _ARQUIVO.fullmatch(candidato.name)
            if not nome:
                continue
            try:
                arquivo = arquivo_validado(pasta, candidato.name)
                h = _ler(arquivo, contexto, int(nome[1]))
                if h:
                    saida.append({"org_id": contexto.contexto_id, "ie": contexto.documento,
                                  "inicio_atividade": h["empresa"].get("inicio_atividade"),
                                  "meses": meses_mei_para_painel(h["meses"])})
            except (OSError, IdentidadeArmazenamentoInvalida) as erro:
                log.warning("Histórico MEI ignorado em %s: %s", candidato, erro)
    return saida


def historicos_portal(destino):
    """Enumera históricos somente do portal, com a identidade conferida antes do reenvio."""
    try:
        portal = subpasta_existente_validada(Path(destino).resolve(), PASTA_CONTEXTOS, "portal")
    except FileNotFoundError:
        return
    except (OSError, IdentidadeArmazenamentoInvalida) as erro:
        log.warning("Não foi possível ler os históricos MEI do portal: %s", erro)
        return
    for org in sorted(portal.glob("org_*")):
        org_id = org.name.partition("--")[0].removeprefix("org_")
        try:
            sefaz = subpasta_existente_validada(portal, org.name, "sefaz_pb")
        except FileNotFoundError:
            continue
        except (OSError, IdentidadeArmazenamentoInvalida) as erro:
            log.warning("Escritório %s ignorado no reenvio MEI: %s", org.name, erro)
            continue
        for empresa in sorted(sefaz.glob("ie_*")):
            ie = empresa.name.partition("--")[0].removeprefix("ie_")
            try:
                contexto = ContextoArmazenamento("portal", org_id, "sefaz_pb", "ie", ie, "")
                yield from _historicos_da_empresa(destino, contexto)
            except (OSError, ArmazenamentoOcupado, IdentidadeArmazenamentoInvalida) as erro:
                log.warning("Histórico MEI ignorado para escritório %s, IE %s: %s", org_id, ie, erro)
