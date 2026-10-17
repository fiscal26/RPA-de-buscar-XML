"""Configuração do robô de XML.

Os valores padrão ficam aqui. Para mudar algo, crie um `config.json` na pasta do robô
(use `config.exemplo.json` como modelo) contendo só as chaves que quer alterar.
O `config.json` fica fora do Git porque guarda credenciais.
"""
import copy
import json
import os
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
ARQUIVO_CONFIG = RAIZ / "config.json"

PADRAO = {
    "chrome": {
        "porta": 9222,
        # Pasta onde o Chrome salva downloads (usada para achar o XML/ZIP baixado à mão)
        "pasta_downloads": str(Path.home() / "Downloads"),
        "fechar_abas": True,
    },
    "pastas": {
        # Onde os XML ficam: <destino>/<ID> - <Nome fantasia>/<AAAA-MM>/<NF-e Saida | NF-e Entrada | NFC-e>/
        "destino": str(Path.home() / "Documents" / "XML SEFAZ-PB"),
        "diagnostico": str(Path.home() / "Documents" / "XML SEFAZ-PB" / "_diagnostico"),
    },
    "chaves": {
        # Chave privada que abre as senhas do ATF cifradas pelo portal (gerada com --gerar-chaves)
        "privada": str(RAIZ / "chaves" / "robo_privada.pem"),
    },
    "atf": {
        "url_login": "https://www4.sefaz.pb.gov.br/atf/",
        # Telas de consulta: caminho no menu, código da função (campo "Função" do topo) e título
        "telas": {
            "nfe": {
                "menu": ["NF-e", "Consulta NF-e por Emitentes/Destinatários"],
                "funcao": "FIS_1322",
                "titulo": "Consulta NF-e por Emitentes/Destinat",
                "rotulos_data": ["Data de Emissão"],
            },
            "nfce": {
                "menu": ["NFC-e", "Consulta por Emitente"],
                "funcao": "FIS_1484",
                "titulo": "Consulta Genérica da NFC-e",
                "rotulos_data": ["Data Emissão Inicial", "Data Emissão Final"],
            },
        },
        # Seletores CSS fixos da tela de login, caso a detecção automática não acerte. Vazio = automático.
        "seletores": {
            "login": "",
            "senha": "",
            "entrar": "",
        },
        "tentar_automatico": True,
        "segundos_login": 60,
        "segundos_automatico": 90,
        # Tempo que o modo assistido espera você concluir no Chrome.
        "segundos_assistido": 300,
        # O ATF encerra a sessão com 15 min sem uso: depois disso o robô entra de novo.
        "minutos_sessao": 12,
    },
    "portal": {
        # Robô do portal LotiVisse XML. Veja web/IMPLANTACAO.md.
        "supabase_url": "",
        "chave_service_role": "",
        "nome_robo": "",
        "intervalo_segundos": 10,
        # Sem ninguém olhando o Chrome: quanto o modo assistido espera antes de desistir.
        "segundos_assistido": 120,
    },
}


def _mesclar(base: dict, extra: dict) -> dict:
    for chave, valor in extra.items():
        if chave.startswith("_"):
            continue  # chaves de comentário
        if isinstance(valor, dict) and isinstance(base.get(chave), dict):
            _mesclar(base[chave], valor)
        else:
            base[chave] = valor
    return base


class ConfigInvalida(Exception):
    pass


def carregar() -> dict:
    cfg = copy.deepcopy(PADRAO)
    if ARQUIVO_CONFIG.exists():
        # utf-8-sig: aceita o arquivo salvo pelo Bloco de Notas (que grava um BOM no início)
        with open(ARQUIVO_CONFIG, encoding="utf-8-sig") as f:
            try:
                dados = json.load(f)
            except json.JSONDecodeError as e:
                raise ConfigInvalida(
                    f"O arquivo config.json tem um erro na linha {e.lineno}, coluna {e.colno}: {e.msg}.\n\n"
                    "Confira aspas, vírgulas e chaves { }. Arquivo: " + str(ARQUIVO_CONFIG)
                ) from e
        _mesclar(cfg, dados)

    portal = cfg["portal"]
    portal["supabase_url"] = os.environ.get("SUPABASE_URL", portal["supabase_url"])
    portal["chave_service_role"] = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", portal["chave_service_role"])
    return cfg
