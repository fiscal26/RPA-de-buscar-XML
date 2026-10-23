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


def pasta_documentos() -> Path:
    """A pasta Documentos de verdade deste computador. No Windows pergunta ao próprio sistema (com o
    OneDrive ligado ela fica em ...\\OneDrive\\Documentos); se não der, usa <usuário>\\Documents."""
    if os.name == "nt":
        try:
            import ctypes
            from ctypes import wintypes
            buf = ctypes.create_unicode_buffer(wintypes.MAX_PATH)
            # CSIDL_PERSONAL = 5 (Documentos), SHGFP_TYPE_CURRENT = 0
            if ctypes.windll.shell32.SHGetFolderPathW(None, 5, None, 0, buf) == 0 and buf.value:
                return Path(buf.value)
        except Exception:
            pass
    documentos = Path.home() / "Documents"
    return documentos if documentos.is_dir() or not (Path.home() / "Documentos").is_dir() else Path.home() / "Documentos"


DESTINO_PADRAO = pasta_documentos() / "XML SEFAZ-PB"


def _pasta_gravavel(pasta: Path) -> bool:
    """Cria a pasta (se faltar) e testa a gravação de um arquivo."""
    try:
        pasta.mkdir(parents=True, exist_ok=True)
        teste = pasta / ".teste_gravacao"
        teste.write_text("ok", encoding="utf-8")
        teste.unlink()
        return True
    except OSError:
        return False


def resolver_pastas(cfg: dict) -> list[str]:
    """Garante uma pasta de destino que existe e aceita gravação NESTE computador. Destino vazio, com o
    exemplo ("SEU-USUARIO") ou que não dá para gravar: usa a pasta Documentos deste computador.
    Devolve avisos para mostrar na tela."""
    avisos = []
    pastas = cfg["pastas"]
    pedido = os.path.expandvars(os.path.expanduser(str(pastas.get("destino") or "").strip()))
    destino = Path(pedido) if pedido else DESTINO_PADRAO
    if pedido and ("SEU-USUARIO" in pedido.upper() or not _pasta_gravavel(destino)):
        avisos.append(f"Não consigo gravar em \"{pedido}\" (pasta de outro computador ou do exemplo). "
                      f"Os arquivos vão para {DESTINO_PADRAO}.")
        destino = DESTINO_PADRAO
    if not _pasta_gravavel(destino):
        raise ConfigInvalida(f"Não consigo criar nem gravar na pasta {destino}. Escolha outra em "
                             f"\"pastas\" > \"destino\" no config.json.")
    pastas["destino"] = str(destino)
    # diagnóstico: dentro do destino, a não ser que o config.json escolha outro lugar gravável
    diag = os.path.expandvars(os.path.expanduser(str(pastas.get("diagnostico") or "").strip()))
    if not diag or not _pasta_gravavel(Path(diag)):
        pastas["diagnostico"] = str(destino / "_diagnostico")
    return avisos

PADRAO = {
    "chrome": {
        "porta": 9222,
        # Pasta onde o Chrome salva downloads (usada para achar o XML/ZIP baixado à mão)
        "pasta_downloads": str(Path.home() / "Downloads"),
        "fechar_abas": True,
    },
    "pastas": {
        # Onde os arquivos ficam. Vazio = pasta Documentos deste computador / XML SEFAZ-PB
        # (a mesma onde o robô roda). Dentro dela: Arquivos baixados/<ID>-<Nome>/<AAAA-MM>/...
        "destino": "",
        # Pacotes de diagnóstico. Vazio = <destino>/_diagnostico
        "diagnostico": "",
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
                "pagina": "FISf_ConsultarNFeXml2.do",
                "pronta": 'input[name="edtDtInicial"]',  # a tela só está pronta com este campo
                "titulo": "Consulta NF-e por Emitentes/Destinat",
                "rotulos_data": ["Data de Emissão"],
            },
            "nfce": {
                "menu": ["NFC-e", "Consulta por Emitente"],
                "funcao": "FIS_1484",
                "pagina": "",
                "titulo": "Consulta Genérica da NFC-e",
                "rotulos_data": ["Data Emissão Inicial", "Data Emissão Final"],
            },
            "cte": {  # Consulta Genérica de CT-e (gravação de 20/10/2026): IE no bloco Destinatário
                "funcao": "FIS_1192",
                "pagina": "FISf_ConsultarCTeGenerica.do",
                "endereco": "fis/FISf_ConsultarCTeGenerica.do?limparSessao=true",
                "pronta": 'input[name="edtDtInicial"]',
                "titulo": "Consulta Genérica de Conhecimentos de Transporte",
                "rotulos_data": ["Data Inicial", "Data Final"],
            },
            # Serviços que o ATF responde na hora com um PDF (gravações de 18/10/2026). Abertos pelo
            # campo "Função" do topo (como na gravação) ou, se não der, pelo endereço direto no quadro de conteúdo.
            "faturas": {  # Emissão de DAR > Lançamentos Espontâneos
                "menu": ["Emissão de DAR", "Lançamentos Espontâneos"],
                "funcao": "ARR_278",
                "pagina": "ARRf_LancamentoEmitirDarContribuinte",
                "endereco": "arr/ARRf_LancamentoEmitirDarContribuinte.do?limparSessao=true",
                "pronta": 'input[name="btnSubmeter"], input[name="btnEmitir"]',
                "titulo": "Emitir DAR/FC/PIX",
                "componente": "cmpContribuinte",
                "enviar": 'input[name="btnSubmeter"]',
            },
            "extrato": {  # Extratos de Pagamento por Contribuinte
                "funcao": "ARR_087",
                "pagina": "ARRf_ConsultarExtrPgtoCont.do",
                "endereco": "arr/ARRf_ConsultarExtrPgtoCont.do?limparSessao=true",
                "pronta": 'input[name="edtDataInicial"]',
                "titulo": "Extratos de Pagamento por Contribuinte",
                "componente": "cmpContribuinte",
                "enviar": 'input[name="Submit"]',
            },
            "omissao": {  # Consultar Omissos/Inadimplentes (Consultar = o PDF completo)
                "funcao": "COB_187",
                "pagina": "COBf_OmiGeralConsGenericaContribuinte.do",
                "endereco": "cob/COBf_OmiGeralConsGenericaContribuinte.do?limparSessao=true",
                "pronta": 'input[name="btnConsultar"]',
                "titulo": "Consulta de Omissos/Inadimplentes",
                "componente": "cmpHumanoInst",
                "enviar": 'input[name="btnConsultar"]',
            },
            "certidao": {  # Emitir Certidão de Débito
                "funcao": "DIA_061",
                "pagina": "DIAf_EmitirCertidaoDebitoIntranet.do",
                "endereco": "dia/DIAf_EmitirCertidaoDebitoIntranet.do?limparSessao=true",
                "pronta": 'input[name="btnEmitirCertidao"]',
                "titulo": "Emitir Certidão de Débito",
                "componente": "Contribuinte",
                "enviar": 'input[name="btnEmitirCertidao"]',
            },
            "cartao": {  # Dossiê do Contribuinte > Docs fiscais > "Cartão" (abre a janela das administradoras)
                "funcao": "DEC_381",
                "pagina": "DECf_DossierContribuinte.do",
                "endereco": "dec/DECf_DossierContribuinte.do?limparSessao=true",
                "pronta": 'input[name="edtnrInscrEstadual"]',
                "titulo": "Dossiê",
            },
            "mei": {  # Dossiê MEI: a mesma tela do cartão (Docs fiscais: entradas e saídas do mês)
                "funcao": "DEC_381",
                "pagina": "DECf_DossierContribuinte.do",
                "endereco": "dec/DECf_DossierContribuinte.do?limparSessao=true",
                "pronta": 'input[name="edtnrInscrEstadual"]',
                "titulo": "Dossiê",
            },
            # onde o ATF entrega os XML (sino do topo)
            "mensagens": {
                "funcao": "SEG_064",
                "pagina": "SEGf_MinhasMensagens.do",
                "pronta": 'a[href*="abrirFilhas"], button[name="btnAtualizarMensagens"], button[name="btnVoltar"]',
                "titulo": "Minhas Mensagens",
                "botao": ['[title*="Mensage" i]', '[aria-label*="Mensage" i]', '[title*="Notifica" i]',
                          '[aria-label*="Notifica" i]', 'button:has(.bi-bell)', 'a:has(.bi-bell)',
                          'button:has(.fa-bell)', 'a:has(.fa-bell)'],
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
        # Depois de clicar em Consultar: quanto esperar a resposta na tela (sem resposta = segue)
        "segundos_resposta": 15,
        # Quanto esperar o ATF entregar os XML em Minhas Mensagens, e de quanto em quanto olhar
        "minutos_espera_mensagens": 30,
        # Quantas vezes a caixa é lida em cada rodada. O que não chegou fica pendente: o robô segue para as
        # próximas empresas e, no final, lê a caixa mais uma vez; se ainda faltar, para e salva o que funcionou.
        "leituras_mensagens": 3,
        # O ATF só deixa consultar a caixa de mensagens de 1 em 1 minuto
        "segundos_entre_verificacoes": 65,
        # O ATF às vezes é lento: quanto esperar uma tela carregar depois de um clique
        "segundos_carregar": 20,
        # Minhas Mensagens não abriu: espera e tenta de novo; depois de N tentativas o robô para
        "tentativas_mensagens": 3,
        "segundos_nova_tentativa_mensagens": 30,
        # Faturas, extrato, omissão e certidão: quanto esperar o PDF depois do clique final
        "segundos_documento": 90,
        # Empresas por rodada (um login): envia todas as consultas e depois recolhe as mensagens
        "empresas_por_rodada": 15,
        # Tempo que o modo assistido espera você concluir no Chrome.
        "segundos_assistido": 300,
        # O ATF encerra a sessão com 15 min sem uso: depois disso o robô entra de novo.
        "minutos_sessao": 12,
    },
    "mei": {
        # Dossiê MEI: na competência, o robô busca também os meses do ano que ainda não estão no
        # acompanhamento (de janeiro em diante). True = busca todos de novo (o mesmo que --mei-ano).
        "refazer_ano": False,
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

    cfg["_avisos"] = resolver_pastas(cfg)
    portal = cfg["portal"]
    portal["supabase_url"] = os.environ.get("SUPABASE_URL", portal["supabase_url"])
    portal["chave_service_role"] = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", portal["chave_service_role"])
    return cfg
