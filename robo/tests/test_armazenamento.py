import json
import os
import stat
import subprocess
import sys
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import pytest

import armazenamento
import config
from armazenamento import (
    PASTA_CONTEXTOS, ArmazenamentoOcupado, ContextoArmazenamento,
    IdentidadeArmazenamentoInvalida, abrir_empresa,
)


ORG_A = "7b245ed0-a8a0-4242-bcf0-24c8eb2895c6"
ORG_B = "6d12ae21-e996-4f5d-925a-d844a32399e4"
EMPRESA = ContextoArmazenamento("portal", ORG_A, "sefaz_pb", "ie", "160123453",
                               "Empresa/A", "007", "Escritório A")


@pytest.fixture
def destino(tmp_path_factory):
    return tmp_path_factory.mktemp("v2")


def test_identidades_separadas_e_legado_preservado(destino):
    legado = destino / "Arquivos baixados" / "007-Empresa_A"
    legado.mkdir(parents=True)
    (legado / "original.xml").write_bytes(b"legado")
    contextos = [
        EMPRESA, replace(EMPRESA, documento="000000019", nome="Empresa:A"),
        replace(EMPRESA, contexto_id=ORG_B), replace(EMPRESA, tipo_contexto="local"),
        replace(EMPRESA, origem="nfse_nacional", tipo_documento="cnpj", documento="11222333000181"),
        replace(EMPRESA, origem="nfse_nacional", tipo_documento="cnpj", documento="11222333000262"),
    ]
    caminhos = []
    for contexto in contextos:
        with abrir_empresa(destino, contexto) as pasta:
            caminhos.append(pasta)
            assert pasta.is_relative_to(destino / PASTA_CONTEXTOS)
            assert pasta.name.startswith(f"{contexto.tipo_documento}_{contexto.documento}")
    assert len(set(caminhos)) == len(contextos)
    assert list(legado.iterdir()) == [legado / "original.xml"]
    assert (legado / "original.xml").read_bytes() == b"legado"


def test_renomeacao_preserva_pasta_e_metadados_iniciais(destino):
    with abrir_empresa(destino, EMPRESA) as inicial:
        prefixo, _, rotulo = inicial.name.partition("--")
        assert prefixo == "ie_160123453"
        assert "007-Empresa_A".startswith(rotulo)
        dados_iniciais = json.loads((inicial / "empresa.json").read_text(encoding="utf-8"))
    atual = replace(EMPRESA, nome="Outro nome", codigo="", nome_contexto="Escritório renomeado")
    with abrir_empresa(destino, atual) as pasta:
        assert pasta == inicial
        dados = json.loads((pasta / "empresa.json").read_text(encoding="utf-8"))
        assert dados["identidade"] == EMPRESA.identidade
        assert dados["rotulos_atuais"] == atual.rotulos
        assert dados["rotulos_iniciais"] == EMPRESA.rotulos
        assert dados["criado_em"] == dados_iniciais["criado_em"]


def test_rotulos_longos_e_prefixo_parecido_nao_alteram_identidade(destino):
    contexto = replace(EMPRESA, nome="Á" * 200 + "/A", nome_contexto="É" * 200)
    with abrir_empresa(destino, contexto) as pasta:
        (pasta.parent / "ie_1601234530--outro").mkdir()
    with abrir_empresa(destino, replace(contexto, nome="Á" * 200 + ":B")) as existente:
        assert existente == pasta
    outro = replace(contexto, documento="000000019")
    with abrir_empresa(destino, outro) as distinta:
        assert distinta != pasta
        assert distinta.name.startswith("ie_000000019")
        tamanho = len(str(distinta).encode("utf-16-le")) // 2
        assert tamanho + armazenamento.RESERVA_ARQUIVOS <= armazenamento.LIMITE_CAMINHO


@pytest.mark.parametrize("nfse_primeiro", [False, True])
def test_pasta_compartilhada_reserva_espaco_independente_da_ordem(destino, monkeypatch, nfse_primeiro):
    raiz = destino / ("a" * max(1, 56 - armazenamento._unidades_windows(str(destino))))
    if armazenamento._unidades_windows(str(raiz)) != 57:
        # Reproduz o orçamento de uma raiz de 57 caracteres quando o pytest usa uma raiz mais longa.
        monkeypatch.setattr(armazenamento, "LIMITE_CAMINHO",
                            259 + armazenamento._unidades_windows(str(raiz)) - 57)
    atf = replace(EMPRESA, nome_contexto="Escritório com nome longo")
    nfse = replace(atf, origem="nfse_nacional", tipo_documento="cnpj", documento="11222333000181")
    contextos = (nfse, atf) if nfse_primeiro else (atf, nfse)
    pastas = {}
    for contexto in contextos:
        with abrir_empresa(raiz, contexto) as pasta:
            pastas[contexto.origem] = pasta

    assert pastas["sefaz_pb"].parent.parent == pastas["nfse_nacional"].parent.parent
    with abrir_empresa(raiz, atf) as pasta:
        pdf = armazenamento.criar_subpasta_validada(pasta, "092026", "CT-e Destinatario - R$ 12.345,67", "PDF")
        arquivo = armazenamento.arquivo_validado(pdf, "0" * 44 + ".pdf")
        arquivo.write_bytes(b"%PDF-1.4 exemplo")
        assert arquivo.is_file()


@pytest.mark.parametrize("folga_atf", [3, -3])
def test_escritorio_preexistente_da_nfse_preserva_identidade_e_historico(destino, monkeypatch, folga_atf):
    nfse = replace(EMPRESA, origem="nfse_nacional", tipo_documento="cnpj", documento="11222333000181",
                   nome="", codigo="")
    escritorio = destino / PASTA_CONTEXTOS / "portal" / f"org_{ORG_A}--Nome_anterior_da_NFSe"
    escritorio.mkdir(parents=True)
    with abrir_empresa(destino, nfse) as pasta_nfse:
        assert pasta_nfse.parent.parent == escritorio
        metadados = (pasta_nfse / "empresa.json").read_bytes()
        historico = pasta_nfse / "historico.xml"
        historico.write_bytes(b"<historico/>")

    caminho_atf = escritorio / "sefaz_pb" / f"ie_{EMPRESA.documento}"
    limite = armazenamento._unidades_windows(str(caminho_atf)) + armazenamento.RESERVA_ARQUIVOS_ATF + folga_atf
    monkeypatch.setattr(armazenamento, "LIMITE_CAMINHO", limite)
    if folga_atf > 0:
        with abrir_empresa(destino, EMPRESA) as pasta_atf:
            assert pasta_atf.parent.parent == escritorio
    else:
        with pytest.raises(IdentidadeArmazenamentoInvalida, match="longo demais"):
            with abrir_empresa(destino, EMPRESA):
                pass
    with abrir_empresa(destino, nfse, somente_leitura=True) as reaberta:
        assert reaberta == pasta_nfse
        assert (reaberta / "empresa.json").read_bytes() == metadados
        assert historico.read_bytes() == b"<historico/>"
    assert [p.name for p in escritorio.parent.iterdir()] == [escritorio.name]


@pytest.mark.parametrize("mudanca", [
    {"contexto_id": ""}, {"contexto_id": "00000000-0000-0000-0000-000000000000"},
    {"documento": "16012345A"}, {"documento": "160123450"}, {"documento": 160123453},
    {"origem": "nfse_nacional"}, {"tipo_contexto": "../portal"},
    {"origem": "nfse_nacional", "tipo_documento": "cnpj", "documento": "11ABC333000181"},
])
def test_rejeita_identidade_invalida(mudanca):
    with pytest.raises(IdentidadeArmazenamentoInvalida):
        replace(EMPRESA, **mudanca)


@pytest.mark.parametrize("estado", ["ausente", "malformado", "versao", "identidade", "duplicado"])
def test_conflito_ou_metadado_invalido_bloqueia_sem_reparar(destino, estado):
    with abrir_empresa(destino, EMPRESA) as pasta:
        metadados = pasta / "empresa.json"
    if estado == "duplicado":
        (pasta.parent / "ie_160123453--duplicada").mkdir()
    elif estado == "ausente":
        metadados.unlink()
    elif estado == "malformado":
        metadados.write_bytes(b"{")
    else:
        dados = json.loads(metadados.read_text(encoding="utf-8"))
        if estado == "versao":
            dados["versao"] = 1
        else:
            dados["identidade"]["documento"] = "000000019"
        metadados.write_text(json.dumps(dados), encoding="utf-8")
    anterior = metadados.read_bytes() if metadados.exists() else None
    with pytest.raises(IdentidadeArmazenamentoInvalida):
        with abrir_empresa(destino, EMPRESA):
            pytest.fail("A empresa ficou disponível com metadados ambíguos ou inválidos.")
    assert (metadados.read_bytes() if metadados.exists() else None) == anterior


def test_trava_entre_processos_e_liberacao_apos_erro(destino):
    script = """
import sys
from armazenamento import ArmazenamentoOcupado, ContextoArmazenamento, abrir_empresa
ctx = ContextoArmazenamento("portal", sys.argv[2], "sefaz_pb", "ie", "160123453", "Outro nome")
try:
    with abrir_empresa(sys.argv[1], ctx):
        sys.exit(2)
except ArmazenamentoOcupado:
    sys.exit(0)
"""
    with pytest.raises(RuntimeError, match="interrompido"):
        with abrir_empresa(destino, EMPRESA):
            processo = subprocess.run(
                [sys.executable, "-B", "-c", script, str(destino), ORG_A],
                cwd=Path(armazenamento.__file__).parent, timeout=10, check=False,
            )
            assert processo.returncode == 0
            raise RuntimeError("interrompido")
    with abrir_empresa(destino, EMPRESA) as pasta:
        assert pasta.is_dir()


@pytest.mark.parametrize("alvo", ["escritorio", "empresa"])
def test_reabre_empresa_apos_queda_do_processo_com_trava(destino, alvo):
    with abrir_empresa(destino, EMPRESA):
        pass
    nome = f"org_{ORG_A}"
    if alvo == "empresa":
        nome += f"-{EMPRESA.origem}-{EMPRESA.tipo_documento}_{EMPRESA.documento}"
    trava = destino / PASTA_CONTEXTOS / "_travas" / f"{nome}.lock"
    script = """
import os
import sys
from pathlib import Path
from armazenamento import trava_exclusiva
with trava_exclusiva(Path(sys.argv[1])):
    os._exit(7)
"""
    processo = subprocess.run(
        [sys.executable, "-B", "-c", script, str(trava)],
        cwd=Path(armazenamento.__file__).parent, timeout=10, check=False,
    )
    assert processo.returncode == 7
    assert trava.is_file()
    with abrir_empresa(destino, EMPRESA) as pasta:
        assert pasta.is_dir()


def test_reabre_empresa_apos_queda_na_primeira_publicacao(destino):
    script = """
import os
import sys
import armazenamento

def interromper(*args):
    os._exit(7)

armazenamento.gravar_json_atomico = interromper
contexto = armazenamento.ContextoArmazenamento("portal", sys.argv[2], "sefaz_pb", "ie", "160123453", "Empresa")
with armazenamento.abrir_empresa(sys.argv[1], contexto):
    sys.exit(2)
"""
    processo = subprocess.run(
        [sys.executable, "-B", "-c", script, str(destino), ORG_A],
        cwd=Path(armazenamento.__file__).parent, timeout=10, check=False,
    )
    assert processo.returncode == 7
    with abrir_empresa(destino, EMPRESA) as pasta:
        metadados = json.loads((pasta / "empresa.json").read_text(encoding="utf-8"))
    assert metadados["identidade"] == EMPRESA.identidade
    assert [entrada for entrada in pasta.parent.iterdir() if entrada.name.startswith("ie_160123453")] == [pasta]


def test_falha_ao_atualizar_metadados_preserva_versao_anterior(destino, monkeypatch):
    with abrir_empresa(destino, EMPRESA) as pasta:
        metadados = pasta / "empresa.json"
        anterior = metadados.read_bytes()

    def falhar(*args):
        raise OSError("falha simulada antes da publicação")

    monkeypatch.setattr(Path, "replace", falhar)
    with pytest.raises(OSError, match="falha simulada"):
        with abrir_empresa(destino, replace(EMPRESA, nome="Novo")):
            pytest.fail("Metadados não publicados.")
    assert metadados.read_bytes() == anterior
    assert list(pasta.iterdir()) == [metadados]


def test_raiz_longa_falha_antes_de_criar_pastas(destino):
    longa = destino / ("x" * 120)
    with pytest.raises(IdentidadeArmazenamentoInvalida, match="longo demais"):
        with abrir_empresa(longa, EMPRESA):
            pytest.fail("Caminho incompatível aceito.")
    assert not longa.exists()


def test_v2_recusa_redirecionamento_para_o_legado(destino):
    legado = destino / "Arquivos baixados"
    legado.mkdir()
    redirecionamento = destino / PASTA_CONTEXTOS
    if os.name == "nt":
        subprocess.run(["cmd", "/c", "mklink", "/J", str(redirecionamento), str(legado)],
                       check=True, capture_output=True, timeout=10)
    else:
        redirecionamento.symlink_to(legado, target_is_directory=True)
    with pytest.raises(IdentidadeArmazenamentoInvalida):
        with abrir_empresa(destino, EMPRESA):
            pytest.fail("Redirecionamento aceito.")
    assert not list(legado.iterdir())


@pytest.mark.parametrize("tag", [0x9000001A, 0x9000F01A])
def test_reabre_pasta_e_metadados_com_tags_cloud_files(destino, monkeypatch, tag):
    with abrir_empresa(destino, EMPRESA) as pasta:
        entradas_cloud = {pasta, pasta / "empresa.json"}

    lstat_real = Path.lstat

    def lstat_cloud(caminho):
        dados = lstat_real(caminho)
        if caminho in entradas_cloud:
            return SimpleNamespace(st_mode=dados.st_mode, st_reparse_tag=tag,
                                   st_file_attributes=stat.FILE_ATTRIBUTE_REPARSE_POINT)
        return dados

    monkeypatch.setattr(Path, "lstat", lstat_cloud)
    with abrir_empresa(destino, replace(EMPRESA, nome="Nome atualizado")) as existente:
        assert existente == pasta
        dados = json.loads((existente / "empresa.json").read_text(encoding="utf-8"))
        assert dados["rotulos_atuais"]["nome"] == "Nome atualizado"


@pytest.mark.parametrize("tag, modo", [
    (0xA000000C, stat.S_IFDIR),  # link simbólico com tipo aparentemente válido
    (0xA0000003, stat.S_IFDIR),  # junction
    (0x9000001C, stat.S_IFDIR),  # outra tag Microsoft sem redirecionamento
    (0, stat.S_IFDIR),           # tag não informada
    (0x9000001A, stat.S_IFREG),  # Cloud Files com tipo errado
])
def test_recusa_outras_tags_e_cloud_files_com_tipo_errado(destino, monkeypatch, tag, modo):
    dados = SimpleNamespace(st_mode=modo, st_reparse_tag=tag,
                            st_file_attributes=stat.FILE_ATTRIBUTE_REPARSE_POINT)
    monkeypatch.setattr(Path, "lstat", lambda caminho: dados)
    with pytest.raises(IdentidadeArmazenamentoInvalida):
        armazenamento._validar_entrada(destino, stat.S_ISDIR)


def test_contexto_local_exige_confirmacao_e_persiste(tmp_path, monkeypatch):
    arquivo = tmp_path / "config.json"
    monkeypatch.setattr(config, "ARQUIVO_CONFIG", arquivo)
    original = '{"pastas": {"destino": "D:/XML"}, "armazenamento": {"local_nome": "Local A"}}'
    arquivo.write_text(original, encoding="utf-8-sig")
    anterior = arquivo.read_bytes()
    with pytest.raises(config.ConfigInvalida, match="Confirme"):
        config.carregar_contexto_local()
    assert arquivo.read_bytes() == anterior
    identificador, nome = config.carregar_contexto_local(confirmar_criacao=True)
    dados = json.loads(arquivo.read_text(encoding="utf-8"))
    assert dados["pastas"] == {"destino": "D:/XML"}
    assert dados["armazenamento"] == {"local_id": identificador, "local_nome": "Local A"}
    assert config.carregar_contexto_local() == (identificador, nome)


def test_contexto_local_invalido_ou_sem_gravacao_nao_e_aceito(tmp_path, monkeypatch):
    arquivo = tmp_path / "config.json"
    monkeypatch.setattr(config, "ARQUIVO_CONFIG", arquivo)
    invalido = b'{"armazenamento": {"local_id": "invalido"}}'
    arquivo.write_bytes(invalido)
    with pytest.raises(config.ConfigInvalida, match="UUID"):
        config.carregar_contexto_local(confirmar_criacao=True)
    assert arquivo.read_bytes() == invalido

    def falhar(*args):
        raise PermissionError("somente leitura")

    arquivo.write_bytes(b"{}")
    monkeypatch.setattr(config, "gravar_json_atomico", falhar)
    with pytest.raises(config.ConfigInvalida, match="somente leitura"):
        config.carregar_contexto_local(confirmar_criacao=True)
    assert arquivo.read_bytes() == b"{}"
    with armazenamento.trava_exclusiva(arquivo.with_suffix(".local-id.lock")):
        pass



@pytest.mark.parametrize("apos_publicar", [False, True])
def test_interrupcao_da_reserva_remove_so_o_marcador_proprio(destino, monkeypatch, apos_publicar):
    outro = armazenamento.reservar_caixa_atf(destino, "outro-login", ORG_B)
    dados_outro = outro.read_bytes()
    if apos_publicar:
        if os.name == "nt":
            publicar = Path.rename

            def interromper(temporario, marcador):
                publicar(temporario, marcador)
                raise KeyboardInterrupt

            alvo, nome = Path, "rename"
        else:
            publicar = os.link

            def interromper(temporario, marcador):
                publicar(temporario, marcador)
                raise KeyboardInterrupt

            alvo, nome = os, "link"
    else:
        abrir_temporario = armazenamento.NamedTemporaryFile

        def interromper(*args, **kwargs):
            arquivo = abrir_temporario(*args, **kwargs)

            def escrever(_):
                raise KeyboardInterrupt

            arquivo.write = escrever
            return arquivo

        alvo, nome = armazenamento, "NamedTemporaryFile"
    with monkeypatch.context() as m:
        m.setattr(alvo, nome, interromper)
        with pytest.raises(KeyboardInterrupt):
            armazenamento.reservar_caixa_atf(destino, "mesmo-login", ORG_A)

    assert list(outro.parent.iterdir()) == [outro]
    assert outro.read_bytes() == dados_outro
    marcador = armazenamento.reservar_caixa_atf(destino, "mesmo-login", ORG_A)
    assert marcador.read_text(encoding="ascii") == f"execucao={ORG_A}\n"
