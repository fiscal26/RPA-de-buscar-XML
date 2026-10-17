"""Senhas do ATF: o portal cifra com a chave pública; só este computador, com a privada, abre.

Formato gravado no banco: "v1:<base64>", RSA-OAEP com SHA-256 (o mesmo do Node:
crypto.publicEncrypt com oaepHash "sha256"). Assim a senha nunca fica legível no Supabase,
na Vercel nem nos logs.
"""
from __future__ import annotations

import base64
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

PREFIXO = "v1:"
_OAEP = padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None)


class SenhaIlegivel(Exception):
    pass


def gerar_chaves(arquivo_privada: Path) -> str:
    """Cria o par de chaves. Grava a privada no arquivo e devolve a pública (PEM em base64,
    numa linha só, pronta para colar na variável XML_CHAVE_PUBLICA da Vercel)."""
    arquivo_privada = Path(arquivo_privada)
    if arquivo_privada.exists():
        raise FileExistsError(
            f"Já existe uma chave em {arquivo_privada}. Apagá-la impede abrir as senhas já cadastradas; "
            "se for mesmo trocar, apague o arquivo à mão e cadastre as senhas de novo."
        )
    privada = rsa.generate_private_key(public_exponent=65537, key_size=3072)
    arquivo_privada.parent.mkdir(parents=True, exist_ok=True)
    arquivo_privada.write_bytes(privada.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    return publica_de(privada)


def publica_de(privada) -> str:
    pem = privada.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    return base64.b64encode(pem).decode()


def carregar_privada(arquivo: Path):
    arquivo = Path(arquivo)
    if not arquivo.exists():
        raise SenhaIlegivel(f"Chave privada não encontrada em {arquivo}. Rode 'python robo_xml.py --gerar-chaves'.")
    return serialization.load_pem_private_key(arquivo.read_bytes(), password=None)


def cifrar(senha: str, publica_b64: str) -> str:
    """Usado nos testes e no modo local; no dia a dia quem cifra é o portal."""
    publica = serialization.load_pem_public_key(base64.b64decode(publica_b64))
    return PREFIXO + base64.b64encode(publica.encrypt(senha.encode("utf-8"), _OAEP)).decode()


def decifrar(cifrada: str, privada) -> str:
    if not cifrada or not cifrada.startswith(PREFIXO):
        raise SenhaIlegivel("senha cadastrada em formato desconhecido; cadastre a senha de novo no portal.")
    try:
        return privada.decrypt(base64.b64decode(cifrada[len(PREFIXO):]), _OAEP).decode("utf-8")
    except Exception as e:
        raise SenhaIlegivel("não consegui abrir a senha: ela foi cifrada com outra chave. "
                            "Confira a XML_CHAVE_PUBLICA na Vercel e cadastre a senha de novo.") from e
