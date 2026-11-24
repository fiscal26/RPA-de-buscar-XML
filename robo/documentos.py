"""Validação dos dígitos verificadores de documentos fiscais."""
import re


def _dv(numeros: str, pesos: list[int]) -> int:
    resto = sum(int(n) * p for n, p in zip(numeros, pesos)) % 11
    return 0 if resto < 2 else 11 - resto


def cnpj_valido(cnpj: str) -> bool:
    if not re.fullmatch(r"\d{14}", cnpj) or len(set(cnpj)) == 1:
        return False
    primeiro = _dv(cnpj[:12], [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    segundo = _dv(cnpj[:13], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    return cnpj[-2:] == f"{primeiro}{segundo}"


def cpf_valido(cpf: str) -> bool:
    if not re.fullmatch(r"\d{11}", cpf) or len(set(cpf)) == 1:
        return False
    return cpf[-2:] == f"{_dv(cpf[:9], list(range(10, 1, -1)))}{_dv(cpf[:10], list(range(11, 1, -1)))}"


def ie_pb_valida(ie: str) -> bool:
    """Inscrição estadual da Paraíba: 9 dígitos, módulo 11 com pesos 9 a 2."""
    if not re.fullmatch(r"\d{9}", ie) or len(set(ie)) == 1:
        return False
    resto = sum(int(n) * p for n, p in zip(ie[:8], range(9, 1, -1))) % 11
    return int(ie[8]) == (0 if resto < 2 else 11 - resto)
