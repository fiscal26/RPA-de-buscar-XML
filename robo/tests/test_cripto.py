import base64
import shutil
import subprocess

import pytest

import cripto


@pytest.fixture(scope="module")
def chaves(tmp_path_factory):
    arq = tmp_path_factory.mktemp("k") / "privada.pem"
    publica = cripto.gerar_chaves(arq)
    return publica, cripto.carregar_privada(arq), arq


def test_ida_e_volta(chaves):
    publica, privada, _ = chaves
    assert cripto.decifrar(cripto.cifrar("Senh@ çom acento", publica), privada) == "Senh@ çom acento"


def test_nao_sobrescreve_chave(chaves):
    with pytest.raises(FileExistsError):
        cripto.gerar_chaves(chaves[2])


def test_formato_invalido(chaves):
    with pytest.raises(cripto.SenhaIlegivel):
        cripto.decifrar("texto-puro", chaves[1])


@pytest.mark.skipif(not shutil.which("node"), reason="Node não instalado")
def test_cifrado_pelo_portal_node(chaves):
    """O mesmo código de web/lib/cripto.ts (crypto.publicEncrypt, OAEP SHA-256)."""
    publica, privada, _ = chaves
    js = ("const c=require('crypto');const pem=Buffer.from(process.argv[1],'base64').toString();"
          "process.stdout.write('v1:'+c.publicEncrypt({key:pem,padding:c.constants.RSA_PKCS1_OAEP_PADDING,"
          "oaepHash:'sha256'},Buffer.from(process.argv[2],'utf8')).toString('base64'))")
    saida = subprocess.run(["node", "-e", js, publica, "senha-do-portal"], capture_output=True, text=True, check=True)
    assert cripto.decifrar(saida.stdout, privada) == "senha-do-portal"
    assert base64.b64decode(publica).startswith(b"-----BEGIN PUBLIC KEY-----")
