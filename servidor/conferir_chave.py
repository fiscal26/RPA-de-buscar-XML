"""Confere, na VPS, se a chave privada do robô abre as senhas e os certificados que o portal guardou.

Pega no Supabase uma senha do ATF e um certificado A1 já cifrados (sem mostrar nada deles) e tenta abrir com a
chave em chaves.privada do config.json. Uso: venv/bin/python servidor/conferir_chave.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "robo"))

import requests  # noqa: E402

import config  # noqa: E402
import cripto  # noqa: E402


def primeiro(cfg: dict, tabela: str, coluna: str) -> str | None:
    p = cfg["portal"]
    cab = {"apikey": p["chave_service_role"]}
    if not p["chave_service_role"].startswith("sb_"):
        cab["Authorization"] = f"Bearer {p['chave_service_role']}"
    r = requests.get(f"{p['supabase_url'].rstrip('/')}/rest/v1/{tabela}", params={"select": coluna, "limit": 1},
                     headers=cab, timeout=30)
    r.raise_for_status()
    linhas = r.json()
    return linhas[0][coluna] if linhas else None


def main() -> int:
    cfg = config.carregar()
    try:
        privada = cripto.carregar_privada(cfg["chaves"]["privada"])
    except cripto.SenhaIlegivel as e:
        print(f"ERRO: {e}")
        return 1
    print("Conferindo a chave privada com o que o portal guardou:")
    ok = True
    try:
        senha = primeiro(cfg, "xml_acessos", "senha_cifrada")
        certificado = primeiro(cfg, "xml_nfse_certificados", "senha_cifrada")
    except Exception as e:
        print(f"ERRO: não consegui ler o portal ({e}). Confira o endereço e a chave do Supabase.")
        return 1
    for nome, cifrada in (("senha do ATF", senha), ("certificado A1", certificado)):
        if not cifrada:
            print(f"   {nome}: nenhuma cadastrada ainda (nada a conferir)")
            continue
        try:
            cripto.decifrar(cifrada, privada)
            print(f"   {nome}: abre com esta chave")
        except cripto.SenhaIlegivel:
            ok = False
            print(f"   {nome}: NÃO abre. Esta não é a chave do computador do escritório.")
    return 0 if ok else 2


if __name__ == "__main__":
    sys.exit(main())
