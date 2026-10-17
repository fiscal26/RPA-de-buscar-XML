"""Planilha de empresas (modelo em modelos/modelo_empresas_sefaz_pb.xlsx).

As colunas são achadas pelo nome do cabeçalho (linha 1), não pela posição:
    ATIVA                 em branco ou S = ativa; N = ignorada
    ID, ID_FILIAL         códigos internos do escritório (opcionais; o ID entra no nome da pasta)
    CNPJ                  opcional (produtor rural pode ter só IE); usado para conferir os XML
    INSCRICAO ESTADUAL    obrigatória: é por ela que o ATF pesquisa as notas
    NOME FANTASIA         obrigatório: nome da pasta
    LOGIN, SENHA          acesso do contador ao ATF (no portal, senha em branco = usa a já cadastrada)
    NF-e Saida            S = baixar as NF-e em que a empresa é emitente
    NF-e Entrada          S = baixar as NF-e em que a empresa é destinatária
    NFC-e                 S = baixar as NFC-e emitidas
As demais colunas (CT-e, faturas, certidões...) são de outros serviços e ficam de fora deste robô.
"""
from __future__ import annotations

import re
import shutil
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

MODELO = Path(__file__).resolve().parent.parent / "modelos" / "modelo_empresas_sefaz_pb.xlsx"

# coluna da planilha -> tipo de XML do robô
COLUNAS_TIPOS = {"nfe saida": "nfe_saida", "nfe entrada": "nfe_entrada", "nfce": "nfce"}
_SIM = {"s", "sim", "x", "1", "true", "verdadeiro", "v", "ok", "ativa", "ativo", "✓", "✔"}
_NAO = {"n", "nao", "0", "false", "falso", "f", "inativa", "inativo"}


@dataclass
class Empresa:
    ie: str
    nome: str
    login: str
    senha: str
    tipos: list[str]
    cnpj: str = ""
    codigo: str = ""
    filial: str = ""
    linha: int = 0


@dataclass
class Leitura:
    empresas: list[Empresa] = field(default_factory=list)
    erros: list[str] = field(default_factory=list)
    avisos: list[str] = field(default_factory=list)


def so_digitos(s) -> str:
    return re.sub(r"\D", "", str(s or ""))


def _chave(texto) -> str:
    """Cabeçalho comparável: sem acento, sem pontuação, minúsculo ('NF-e Saída' -> 'nfe saida')."""
    texto = unicodedata.normalize("NFKD", str(texto or "")).encode("ascii", "ignore").decode().lower()
    texto = texto.replace("-", "")
    return re.sub(r"[^a-z0-9]+", " ", texto).strip()


def _dv(numeros: str, pesos: list[int]) -> int:
    resto = sum(int(n) * p for n, p in zip(numeros, pesos)) % 11
    return 0 if resto < 2 else 11 - resto


def cnpj_valido(cnpj: str) -> bool:
    if not re.fullmatch(r"\d{14}", cnpj) or len(set(cnpj)) == 1:
        return False
    return cnpj[-2:] == f"{_dv(cnpj[:12], [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])}{_dv(cnpj[:13], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])}"


def cpf_valido(cpf: str) -> bool:
    if not re.fullmatch(r"\d{11}", cpf) or len(set(cpf)) == 1:
        return False
    return cpf[-2:] == f"{_dv(cpf[:9], list(range(10, 1, -1)))}{_dv(cpf[:10], list(range(11, 1, -1)))}"


def ie_pb_valida(ie: str) -> bool:
    """Inscrição estadual da Paraíba: 9 dígitos, módulo 11 com pesos 9 a 2 (resto 0 ou 1 -> dígito 0)."""
    if not re.fullmatch(r"\d{9}", ie) or len(set(ie)) == 1:
        return False
    resto = sum(int(n) * p for n, p in zip(ie[:8], range(9, 1, -1))) % 11
    return int(ie[8]) == (0 if resto < 2 else 11 - resto)


def _numero(valor) -> str:
    if isinstance(valor, float) and valor.is_integer():
        valor = int(valor)
    return so_digitos(valor)


def normalizar_ie(valor) -> tuple[str | None, str | None]:
    digitos = _numero(valor)
    if not digitos:
        return None, "inscrição estadual vazia"
    if len(digitos) > 9:
        return None, f"inscrição estadual '{valor}' tem mais de 9 dígitos"
    ie = digitos.zfill(9)  # zeros à esquerda que o Excel apaga
    if not ie_pb_valida(ie):
        return None, f"inscrição estadual {digitos} inválida para a Paraíba (dígito verificador não confere)"
    return ie, None


def normalizar_documento(valor) -> tuple[str, str | None]:
    """CNPJ (ou CPF de produtor rural) opcional. Vazio é aceito; preenchido precisa ser válido."""
    digitos = _numero(valor)
    if not digitos:
        return "", None
    if len(digitos) <= 11 and cpf_valido(digitos.zfill(11)) and len(digitos) > 8:
        return digitos.zfill(11), None
    if len(digitos) <= 14 and cnpj_valido(digitos.zfill(14)):
        return digitos.zfill(14), None
    return "", f"CNPJ {digitos} inválido (dígito verificador não confere — confira a digitação)"


def formatar_cnpj(doc: str) -> str:
    if len(doc) == 14:
        return f"{doc[:2]}.{doc[2:5]}.{doc[5:8]}/{doc[8:12]}-{doc[12:]}"
    if len(doc) == 11:
        return f"{doc[:3]}.{doc[3:6]}.{doc[6:9]}-{doc[9:]}"
    return doc


def formatar_ie(ie: str) -> str:
    return f"{ie[:2]}.{ie[2:5]}.{ie[5:8]}-{ie[8:]}" if len(ie) == 9 else ie


def marcado(valor) -> bool | None:
    """True = sim, False = não, None = em branco."""
    t = _chave(valor)
    if not t:
        return None
    if t in _SIM or t.startswith("sim"):
        return True
    if t in _NAO or t.startswith("nao"):
        return False
    return None


def _texto(v) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v).strip()


def ler(caminho: str | Path) -> Leitura:
    caminho = Path(caminho)
    linhas = _linhas_excel(caminho) if caminho.suffix.lower() in (".xlsx", ".xlsm") else _linhas_texto(caminho)
    return interpretar(linhas)


def _linhas_excel(caminho: Path):
    from openpyxl import load_workbook

    wb = load_workbook(caminho, read_only=True, data_only=True)
    ws = wb.worksheets[0]
    for n, valores in enumerate(ws.iter_rows(values_only=True), start=1):
        yield n, list(valores)


def _linhas_texto(caminho: Path):
    bruto = caminho.read_bytes()
    try:
        texto = bruto.decode("utf-8-sig")
    except UnicodeDecodeError:
        texto = bruto.decode("cp1252")  # Bloco de Notas / Excel no Windows
    for n, linha in enumerate(texto.splitlines(), start=1):
        if not linha.strip() or linha.lstrip().startswith("#"):
            continue
        sep = next((s for s in (";", "\t", ",") if s in linha), None)
        yield n, [c.strip().strip('"') for c in (linha.split(sep) if sep else [linha])]


def interpretar(linhas) -> Leitura:
    leitura = Leitura()
    linhas = iter(linhas)
    colunas: dict[str, int] = {}
    for n, valores in linhas:  # cabeçalho: primeira linha que tenha "inscricao estadual"
        nomes = [_chave(v) for v in valores]
        if "inscricao estadual" in nomes:
            colunas = {nome: i for i, nome in enumerate(nomes) if nome}
            break
    if not colunas:
        leitura.erros.append("Cabeçalho não encontrado: use a planilha modelo (coluna 'INSCRICAO ESTADUAL').")
        return leitura
    faltando = [c for c in ("nome fantasia", "login", "senha") if c not in colunas]
    if faltando:
        leitura.erros.append("Faltam colunas na planilha: " + ", ".join(c.upper() for c in faltando))
        return leitura

    def campo(valores, nome):
        i = colunas.get(nome)
        return valores[i] if i is not None and i < len(valores) else None

    vistas: set[str] = set()
    for n, valores in linhas:
        if not any(_texto(v) for v in valores):
            continue
        nome = _texto(campo(valores, "nome fantasia"))
        rotulo = nome or f"linha {n}"
        if marcado(campo(valores, "ativa")) is False:
            leitura.avisos.append(f"Linha {n}: {rotulo} está como inativa; ignorada")
            continue
        ie, erro = normalizar_ie(campo(valores, "inscricao estadual"))
        if not ie:
            leitura.erros.append(f"Linha {n}: {rotulo}: {erro}")
            continue
        if not nome:
            leitura.erros.append(f"Linha {n}: informe o NOME FANTASIA da IE {formatar_ie(ie)}")
            continue
        cnpj, erro = normalizar_documento(campo(valores, "cnpj"))
        if erro:
            leitura.erros.append(f"Linha {n}: {nome}: {erro}")
            continue
        login = _texto(campo(valores, "login"))
        if not login:
            leitura.erros.append(f"Linha {n}: {nome}: informe o LOGIN do ATF")
            continue
        tipos = [tipo for col, tipo in COLUNAS_TIPOS.items() if marcado(campo(valores, col))]
        if not tipos:
            leitura.avisos.append(f"Linha {n}: {nome}: nenhum XML marcado (NF-e Saida, NF-e Entrada, NFC-e); ignorada")
            continue
        if ie in vistas:
            leitura.avisos.append(f"Linha {n}: IE {formatar_ie(ie)} repetida; usada só uma vez")
            continue
        vistas.add(ie)
        leitura.empresas.append(Empresa(
            ie=ie, nome=nome[:60], login=login[:60], senha=_texto(campo(valores, "senha"))[:200], tipos=tipos,
            cnpj=cnpj, codigo=_texto(campo(valores, "id"))[:20], filial=_texto(campo(valores, "id filial"))[:20], linha=n,
        ))
    return leitura


def copiar_modelo(pasta: str | Path) -> Path:
    destino = Path(pasta) / MODELO.name
    destino.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(MODELO, destino)
    return destino
