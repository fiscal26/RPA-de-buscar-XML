"""Identidade e resolução de pastas do armazenamento v2."""
import errno
import json
import os
import re
import stat
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile
from uuid import UUID

from documentos import cnpj_valido, ie_pb_valida


VERSAO = 2
PASTA_CONTEXTOS = "Arquivos por empresa v2"
# Limite conservador para programas Windows sem suporte a caminhos longos.
LIMITE_CAMINHO = 259
RESERVA_ARQUIVOS = 80  # separadores, competência/serviço e nome do arquivo
# WinNT.h: IO_REPARSE_TAG_CLOUD e variantes _1 a _F nos bits da máscara.
_TAG_CLOUD = 0x9000001A
_MASCARA_VARIANTE_CLOUD = 0x0000F000


class IdentidadeArmazenamentoInvalida(ValueError):
    pass


class ArmazenamentoOcupado(RuntimeError):
    pass


def normalizar_id_contexto(valor: str) -> str:
    if isinstance(valor, str) and re.fullmatch(
        r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}", valor
    ):
        identificador = UUID(valor)
        if identificador.int:
            return str(identificador)
    raise IdentidadeArmazenamentoInvalida("O contexto precisa de um UUID completo e não nulo.")


@dataclass(frozen=True)
class ContextoArmazenamento:
    tipo_contexto: str
    contexto_id: str
    origem: str
    tipo_documento: str
    documento: str
    nome: str
    codigo: str = ""
    nome_contexto: str = ""

    def __post_init__(self):
        object.__setattr__(self, "contexto_id", normalizar_id_contexto(self.contexto_id))
        if self.tipo_contexto not in ("portal", "local"):
            raise IdentidadeArmazenamentoInvalida("Tipo de contexto desconhecido.")
        if not isinstance(self.documento, str) or not re.fullmatch(r"[0-9]+", self.documento):
            raise IdentidadeArmazenamentoInvalida("Use o documento fiscal em dígitos ASCII, sem pontuação.")
        if (self.origem, self.tipo_documento) == ("sefaz_pb", "ie"):
            valido = ie_pb_valida(self.documento)
        elif (self.origem, self.tipo_documento) == ("nfse_nacional", "cnpj"):
            valido = cnpj_valido(self.documento)
        else:
            raise IdentidadeArmazenamentoInvalida("Origem e tipo de documento incompatíveis.")
        if not valido:
            raise IdentidadeArmazenamentoInvalida("Documento fiscal inválido para a origem.")
        if not all(isinstance(rotulo, str) for rotulo in self.rotulos.values()):
            raise IdentidadeArmazenamentoInvalida("Os rótulos do contexto devem ser texto.")

    @property
    def identidade(self) -> dict[str, str]:
        return {
            "tipo_contexto": self.tipo_contexto, "contexto_id": self.contexto_id,
            "origem": self.origem, "tipo_documento": self.tipo_documento, "documento": self.documento,
        }

    @property
    def rotulos(self) -> dict[str, str]:
        return {"nome": self.nome, "codigo": self.codigo, "nome_contexto": self.nome_contexto}


def _validar_entrada(caminho: Path, tipo):
    """Aceita entradas comuns e do Cloud Files com o tipo de arquivo esperado."""
    dados = caminho.lstat()
    reparse = getattr(dados, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT
    tag = getattr(dados, "st_reparse_tag", 0)
    arquivo_em_nuvem = (tag & ~_MASCARA_VARIANTE_CLOUD) == _TAG_CLOUD
    if not tipo(dados.st_mode) or (reparse and not arquivo_em_nuvem):
        raise IdentidadeArmazenamentoInvalida(f"Entrada inválida no armazenamento v2: {caminho}")


def _diretorio(caminho: Path) -> Path:
    try:
        caminho.mkdir()
    except FileExistsError:
        pass
    _validar_entrada(caminho, stat.S_ISDIR)
    return caminho


def _unidades_windows(texto: str) -> int:
    return len(texto.encode("utf-16-le", errors="surrogatepass")) // 2


def _verificar_tamanho(caminho: Path, reserva: int = 0):
    if _unidades_windows(str(caminho)) + reserva > LIMITE_CAMINHO:
        raise IdentidadeArmazenamentoInvalida(
            f"Caminho do armazenamento v2 longo demais. Escolha uma raiz mais curta: {caminho}"
        )


def _componente(pai: Path, nome: str) -> Path:
    if not nome or nome in (".", "..") or nome.endswith((" ", ".")) or re.search(r'[<>:"/\\|?*\x00-\x1f]', nome):
        raise IdentidadeArmazenamentoInvalida(f"Nome inválido no armazenamento v2: {nome!r}")
    caminho = pai / nome
    _verificar_tamanho(caminho)
    return caminho


def criar_subpasta_validada(base: Path, *partes: str) -> Path:
    """Cria e valida cada nível abaixo de uma pasta v2 já conferida."""
    for parte in partes:
        base = _diretorio(_componente(base, parte))
    return base


def subpasta_existente_validada(base: Path, *partes: str) -> Path:
    for parte in partes:
        base = _componente(base, parte)
        _validar_entrada(base, stat.S_ISDIR)
    return base


def arquivo_validado(pasta: Path, nome: str) -> Path:
    caminho = _componente(pasta, nome)
    try:
        _validar_entrada(caminho, stat.S_ISREG)
    except FileNotFoundError:
        pass
    return caminho


def area_do_contexto(destino: str | Path, area: str, tipo: str, contexto_id: str, chave: str) -> Path:
    """Área por contexto e execução ou, para o cache, pelo CNPJ consultado."""
    if tipo not in ("local", "portal"):
        raise IdentidadeArmazenamentoInvalida("Tipo de contexto desconhecido.")
    contexto_id = normalizar_id_contexto(contexto_id)
    if area == "_cache":
        if not re.fullmatch(r"[0-9]{14}", chave) or not cnpj_valido(chave):
            raise IdentidadeArmazenamentoInvalida("O cache exige o CNPJ consultado.")
        partes = (area, "nfse", tipo, contexto_id, chave)
    elif area in ("_sem_empresa", "_nao_identificados", "_relatorios", "_diagnostico"):
        partes = (area, tipo, contexto_id, normalizar_id_contexto(chave))
    else:
        raise IdentidadeArmazenamentoInvalida("Área v2 desconhecida.")
    raiz = Path(destino).resolve()
    raiz.mkdir(parents=True, exist_ok=True)
    return criar_subpasta_validada(raiz, PASTA_CONTEXTOS, *partes)


def publicar_arquivo(caminho: Path, escrever):
    """Substitui o destino só depois de a escrita no arquivo temporário terminar."""
    with NamedTemporaryFile(dir=caminho.parent, prefix=".v2-", suffix=caminho.suffix, delete=False) as arquivo:
        temporario = Path(arquivo.name)
    try:
        escrever(temporario)
        temporario.replace(caminho)
    finally:
        temporario.unlink(missing_ok=True)


def pasta_da_competencia(empresa: Path, competencia: str) -> Path:
    """Reabre o mês existente e cria competências novas no formato MMAAAA."""
    if not isinstance(competencia, str) or not re.fullmatch(r"[0-9]{4}-(0[1-9]|1[0-2])", competencia):
        raise IdentidadeArmazenamentoInvalida("Competência inválida. Use AAAA-MM.")
    nomes = (competencia, competencia[5:7] + competencia[:4])
    existentes = []
    for nome in nomes:
        caminho = _componente(empresa, nome)
        if caminho.exists() or caminho.is_symlink():
            existentes.append(_diretorio(caminho))
    if len(existentes) > 1:
        raise IdentidadeArmazenamentoInvalida("Dois diretórios para a mesma competência. Confira os arquivos antes de continuar.")
    return existentes[0] if existentes else criar_subpasta_validada(empresa, nomes[1])


def _nome_pasta(pai: Path, prefixo: str, rotulo: str, limite: int, reserva: int) -> Path:
    base = pai / prefixo
    _verificar_tamanho(base, reserva)
    texto = re.sub(r"[^\w .-]+", "_", rotulo).strip(" .")[:limite].rstrip(" .")
    while texto and _unidades_windows(str(base)) + 2 + _unidades_windows(texto) + reserva > LIMITE_CAMINHO:
        texto = texto[:-1].rstrip(" .")
    return pai / f"{prefixo}--{texto}" if texto else base


def _buscar_pasta(pai: Path, prefixo: str) -> Path | None:
    candidatas = [
        entrada for entrada in pai.iterdir()
        if entrada.name.casefold() == prefixo or entrada.name.casefold().startswith(f"{prefixo}--")
    ]
    if len(candidatas) > 1:
        raise IdentidadeArmazenamentoInvalida(f"Mais de uma pasta para {prefixo} em {pai}.")
    if candidatas:
        _validar_entrada(candidatas[0], stat.S_ISDIR)
        return candidatas[0]
    return None


@contextmanager
def trava_exclusiva(caminho: Path):
    """Falha imediatamente em conflito e libera o bloqueio ao fechar o descritor."""
    caminho = arquivo_validado(caminho.parent, caminho.name)
    fd = os.open(caminho, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        try:
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as erro:
            if erro.errno not in (errno.EACCES, errno.EAGAIN, errno.EDEADLK):
                raise
            raise ArmazenamentoOcupado(f"Trava em uso em {caminho}.") from erro
        yield
    finally:
        # O arquivo é reaproveitado. Apagá-lo permitiria que dois processos bloqueassem arquivos diferentes.
        os.close(fd)


def gravar_json_atomico(caminho: Path, dados: dict):
    """Publica o JSON completo com substituição no mesmo diretório."""
    temporario = None
    try:
        with NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=caminho.parent, prefix=".v2-", delete=False
        ) as arquivo:
            temporario = Path(arquivo.name)
            json.dump(dados, arquivo, ensure_ascii=False, indent=2)
            arquivo.write("\n")
            arquivo.flush()
            os.fsync(arquivo.fileno())
        temporario.replace(caminho)
    finally:
        if temporario is not None:
            temporario.unlink(missing_ok=True)


def _ler_metadados(caminho: Path, contexto: ContextoArmazenamento) -> dict:
    try:
        _validar_entrada(caminho, stat.S_ISREG)
        dados = json.loads(caminho.read_text(encoding="utf-8"))
        if type(dados["versao"]) is not int or dados["versao"] != VERSAO:
            raise ValueError
        if dados["identidade"] != contexto.identidade:
            raise ValueError
        if datetime.fromisoformat(dados["criado_em"]).utcoffset() is None:
            raise ValueError
        for campo in ("rotulos_iniciais", "rotulos_atuais"):
            rotulos = dados[campo]
            if rotulos.keys() != contexto.rotulos.keys() or not all(
                isinstance(valor, str) for valor in rotulos.values()
            ):
                raise ValueError
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as erro:
        raise IdentidadeArmazenamentoInvalida(f"Metadados v2 ausentes ou incompatíveis: {caminho}") from erro
    return dados


@contextmanager
def abrir_empresa(destino: str | Path, contexto: ContextoArmazenamento, *, somente_leitura: bool = False):
    """Resolve a empresa e mantém a trava durante a operação do chamador."""
    destino = Path(destino).resolve()
    raiz = destino / PASTA_CONTEXTOS
    tipo = raiz / contexto.tipo_contexto
    prefixo_contexto = "org" if contexto.tipo_contexto == "portal" else "contexto"
    id_contexto = f"{prefixo_contexto}_{contexto.contexto_id}"
    id_empresa = f"{contexto.tipo_documento}_{contexto.documento}"
    # O rótulo do escritório deixa espaço para qualquer origem/documento suportado.
    reserva_contexto = len("/nfse_nacional/cnpj_" + "0" * 14) + RESERVA_ARQUIVOS
    nova_pasta_contexto = _nome_pasta(tipo, id_contexto, contexto.nome_contexto, 20, reserva_contexto)
    if somente_leitura:
        subpasta_existente_validada(destino, PASTA_CONTEXTOS, contexto.tipo_contexto)
        travas = subpasta_existente_validada(raiz, "_travas")
    else:
        destino.mkdir(parents=True, exist_ok=True)
        _diretorio(raiz)
        travas = _diretorio(raiz / "_travas")
        _diretorio(tipo)

    # Uma trava curta para escolher o nome inicial do escritório, inclusive quando
    # dois processos começam por empresas diferentes.
    with trava_exclusiva(travas / f"{id_contexto}.lock"):
        pasta_contexto = _buscar_pasta(tipo, id_contexto)
        if pasta_contexto is None:
            if somente_leitura:
                raise FileNotFoundError(nova_pasta_contexto)
            pasta_contexto = _diretorio(nova_pasta_contexto)

    trava_empresa = travas / f"{id_contexto}-{contexto.origem}-{id_empresa}.lock"
    _verificar_tamanho(trava_empresa)
    with trava_exclusiva(trava_empresa):
        origem = pasta_contexto / contexto.origem
        rotulo = "-".join(filter(None, (contexto.codigo, contexto.nome)))
        nova_pasta = _nome_pasta(origem, id_empresa, rotulo, 40, RESERVA_ARQUIVOS)
        if somente_leitura:
            subpasta_existente_validada(pasta_contexto, contexto.origem)
        else:
            _diretorio(origem)
        pasta = _buscar_pasta(origem, id_empresa)
        if pasta is None:
            if somente_leitura:
                raise FileNotFoundError(nova_pasta)
            pasta = _diretorio(nova_pasta)
            dados = {
                "versao": VERSAO, "identidade": contexto.identidade,
                "criado_em": datetime.now(timezone.utc).isoformat(),
                "rotulos_iniciais": contexto.rotulos, "rotulos_atuais": contexto.rotulos,
            }
            gravar_json_atomico(pasta / "empresa.json", dados)
        else:
            _verificar_tamanho(pasta, RESERVA_ARQUIVOS)
            dados = _ler_metadados(pasta / "empresa.json", contexto)
            if not somente_leitura and dados["rotulos_atuais"] != contexto.rotulos:
                dados["rotulos_atuais"] = contexto.rotulos
                gravar_json_atomico(pasta / "empresa.json", dados)
        yield pasta
