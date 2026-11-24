import json
from datetime import date, datetime
from pathlib import Path
from types import SimpleNamespace

import pytest
from openpyxl import load_workbook

import arquivos
import mei
import robo_xml
from armazenamento import PASTA_CONTEXTOS, ContextoArmazenamento, IdentidadeArmazenamentoInvalida
from atf_pb import AtfPB, Emissao
from test_atf_contexto import ORG_A, ORG_B, AtfFalso, cfg, linha
from test_nfse import Resposta
from util import IE_EMPRESA


def contexto(org, tipo="portal"):
    return ContextoArmazenamento(tipo, org, "sefaz_pb", "ie", IE_EMPRESA, "Loja MEI", "7")


def coleta(valor):
    return {"saidas": valor, "entradas": 1, "qtd_saidas": 1, "qtd_entradas": 1,
            "sem_movimento": False, "simei": True, "linhas": [["Tabela bruta"]],
            "inicio_atividade": "2026-01-01"}


def test_historico_separa_contextos_e_compara_horario_real(cfg):
    destino = cfg["pastas"]["destino"]
    a, b, local = contexto(ORG_A), contexto(ORG_B), contexto(ORG_A, "local")
    caminhos = []
    for ctx, valor in [(a, 100), (b, 900), (local, 500)]:
        r = mei.salvar(destino, ctx, "2026-01", coleta(valor), "2026-02-01T12:00:00-03:00")
        caminhos.append(r["pasta"])
    assert len(set(caminhos)) == 3
    r = mei.salvar(destino, a, "2026-01", coleta(999), "2026-02-01T15:00:00Z")
    assert r["saidas"] == 100
    dados = coleta(123) | {"outros_meses": {"2026-01": coleta(999) | {"consultado_em": "2026-02-01T14:59:59Z"}}}
    r = mei.salvar(destino, a, "2026-02", dados, "2026-03-01T00:00:00Z")
    assert r["historico"]["2026-01"]["saidas"] == 100
    assert r["historico"]["2026-02"]["saidas"] == 123
    assert mei.periodos(destino, a, date(2026, 2, 1)) == []
    assert mei.periodos(destino, a, date(2026, 2, 1), refazer_ano=True)[0][0] == date(2026, 1, 1)
    assert [h["meses"]["2026-01"]["saidas"] for h in sorted(mei.historicos_portal(destino), key=lambda h: h["org_id"])] == [
        900, 100,
    ]


def test_historico_existente_continua_legivel_com_reserva_anterior_de_caminho(cfg):
    destino = Path(cfg["pastas"]["destino"]).resolve()
    r = mei.salvar(destino, contexto(ORG_A), "2026-01", coleta(100), "2026-02-01T12:00:00Z")
    empresa = Path(r["pasta"]).parent
    prefixo = empresa.name.partition("--")[0] + "--"
    tamanho = 165 - len(str(empresa.parent).encode("utf-16-le")) // 2 - 1
    nova = empresa.with_name(prefixo + "x" * (tamanho - len(prefixo)))
    assert nova.parent == empresa.parent and nova.is_relative_to(destino)
    empresa.rename(nova)
    (h,) = mei.historicos_portal(destino)
    assert h["org_id"] == ORG_A and h["meses"]["2026-01"]["saidas"] == 100
    assert (nova / "Dossiê MEI" / "Faturamento MEI 2026.json").is_file()


@pytest.mark.parametrize("corrupcao", ["json", "versao", "ano", "identidade", "competencia", "fuso", "total_ausente"])
def test_historico_invalido_bloqueia_leitura_e_escrita_mesmo_ao_refazer(cfg, corrupcao):
    destino = cfg["pastas"]["destino"]
    ctx = contexto(ORG_A)
    r = mei.salvar(destino, ctx, "2026-01", coleta(100))
    pasta = Path(r["pasta"])
    arquivo = pasta / "Faturamento MEI 2026.json"
    planilha = pasta / "Faturamento MEI 2026.xlsx"
    anterior = planilha.read_bytes()
    h = json.loads(arquivo.read_text(encoding="utf-8"))
    if corrupcao == "versao":
        h["versao"] = 99
    elif corrupcao == "ano":
        h["ano"] = 2025
    elif corrupcao == "identidade":
        h["identidade"]["contexto_id"] = ORG_B
    elif corrupcao == "competencia":
        h["meses"]["2025-01"] = h["meses"].pop("2026-01")
    elif corrupcao == "fuso":
        h["meses"]["2026-01"]["consultado_em"] = "2026-02-01T12:00:00"
    elif corrupcao == "total_ausente":
        h["meses"]["2026-01"]["saidas"] = None
    invalido = b"{" if corrupcao == "json" else json.dumps(h).encode()
    arquivo.write_bytes(invalido)
    with pytest.raises(IdentidadeArmazenamentoInvalida):
        mei.periodos(destino, ctx, date(2026, 2, 1), refazer_ano=True)
    with pytest.raises(IdentidadeArmazenamentoInvalida):
        mei.salvar(destino, ctx, "2026-02", coleta(200))
    assert arquivo.read_bytes() == invalido and planilha.read_bytes() == anterior


def test_falha_na_planilha_preserva_anterior_e_regera_do_json(cfg, monkeypatch):
    destino = cfg["pastas"]["destino"]
    ctx = contexto(ORG_A)
    r = mei.salvar(destino, ctx, "2026-01", coleta(100))
    pasta = Path(r["pasta"])
    arquivo = pasta / "Faturamento MEI 2026.json"
    planilha = pasta / "Faturamento MEI 2026.xlsx"
    anterior = planilha.read_bytes()

    def interromper(caminho, escrever):
        raise PermissionError("Planilha aberta no Excel.")

    with monkeypatch.context() as ajuste:
        ajuste.setattr(mei, "publicar_arquivo", interromper)
        r = mei.salvar(destino, ctx, "2026-02", coleta(200))
    assert r["planilha_pendente"] and r["notas_acumulado"] == 300
    assert planilha.read_bytes() == anterior
    json_salvo = json.loads(arquivo.read_text(encoding="utf-8"))
    assert json_salvo["planilha_pendente"] and json_salvo["meses"]["2026-02"]["saidas"] == 200
    assert mei.periodos(destino, ctx, date(2026, 3, 1)) == []
    wb = load_workbook(planilha, read_only=True)
    try:
        assert wb.active["G3"].value == 300
    finally:
        wb.close()
    recuperado = json.loads(arquivo.read_text(encoding="utf-8"))
    assert not recuperado["planilha_pendente"]
    assert recuperado["meses"] == json_salvo["meses"]


class AtfMei(AtfFalso):
    limpar_cache_dossie = AtfPB.limpar_cache_dossie

    def __init__(self, cfg):
        super().__init__(cfg, [])
        self._dossie_cache = {}
        self.consultas = []
        self.valores = iter([100, 900])

    def emitir(self, tipo, ie, inicio, fim, nome, **kw):
        chave = (ie, inicio)
        if chave not in self._dossie_cache:
            self.consultas.append(ie)
            self._dossie_cache[chave] = coleta(next(self.valores))
        dados = self._dossie_cache[chave].copy()
        dados["outros_meses"] = {"2026-01": coleta(10)}
        return Emissao(ie, tipo, dados=dados)


def _robo_simulado(cfg, monkeypatch, pedidos, requisicao=None):
    monkeypatch.setattr(robo_xml.cripto, "carregar_privada", lambda _: object())
    monkeypatch.setattr(robo_xml.cripto, "decifrar", lambda *_: "falsa")

    def chamada(metodo, url, **kw):
        dados = kw["json"]
        pedidos.append((metodo, url.split("/rest/v1/")[-1], dados))
        if requisicao:
            return requisicao(metodo, url, dados)
        return Resposta(200, True if url.endswith("/rpc/xml_atualizar_tarefa_reservada") else 2)

    monkeypatch.setattr(robo_xml.requests, "request", chamada)
    return robo_xml.Robo(cfg)


def test_tarefa_mei_envia_contexto_correto_e_limpa_dossie_entre_escritorios(cfg, monkeypatch):
    pedidos = []
    robo = _robo_simulado(cfg, monkeypatch, pedidos)
    atf = AtfMei(cfg)
    monkeypatch.setattr(robo.executor, "_garantir_chrome", lambda diag: setattr(robo.executor, "atf", atf))
    robo.processar([linha("tarefa-a", ORG_A, tipos=["mei"]), linha("tarefa-b", ORG_B, tipos=["mei"])])
    assert atf.consultas == [IE_EMPRESA, IE_EMPRESA]
    callbacks = [d for _, url, d in pedidos if url == "rpc/xml_mei_registrar_tarefa_reservada"]
    for d, tid, org, valor in zip(callbacks, ("tarefa-a", "tarefa-b"), (ORG_A, ORG_B), (100, 900), strict=True):
        assert (d["p_tarefa"], d["p_tentativa"], d["p_org"], d["p_ie"]) == (tid, f"reserva-{tid}", org, IE_EMPRESA)
        assert d["p_meses"]["2026-09"]["saidas"] == valor
        assert d["p_meses"]["2026-01"]["saidas"] == 10
        assert all("linhas" not in m and datetime.fromisoformat(m["consultado_em"]).utcoffset() is not None
                   for m in d["p_meses"].values())
    conclusoes = [d["p_campos"]["status"] for _, url, d in pedidos
                  if url == "rpc/xml_atualizar_tarefa_reservada" and "status" in d["p_campos"]]
    assert conclusoes == ["concluido"] * 2


def test_portal_mostra_planilha_pendente_e_ainda_recebe_os_meses_salvos(cfg, monkeypatch):
    pedidos = []
    robo = _robo_simulado(cfg, monkeypatch, pedidos)
    atf = AtfMei(cfg)
    monkeypatch.setattr(robo.executor, "_garantir_chrome", lambda diag: setattr(robo.executor, "atf", atf))

    def falhar(*args):
        raise PermissionError("Planilha aberta no Excel.")

    monkeypatch.setattr(mei, "publicar_arquivo", falhar)
    robo.processar([linha("tarefa-a", ORG_A, tipos=["mei"])])
    (enviado,) = [d for _, url, d in pedidos if url == "rpc/xml_mei_registrar_tarefa_reservada"]
    assert enviado["p_meses"]["2026-09"]["saidas"] == 100
    (final,) = [d["p_campos"] for _, url, d in pedidos
                if url == "rpc/xml_atualizar_tarefa_reservada" and "status" in d["p_campos"]]
    assert final["status"] == "erro"
    assert final["detalhes"]["mei"]["mensagem"] == mei.PLANILHA_PENDENTE
    assert final["detalhes"]["mei"]["arquivos"] == 0


def test_reenvio_ignora_legado_local_e_invalido_e_continua_apos_erro(cfg, monkeypatch):
    destino = Path(cfg["pastas"]["destino"])
    legado = destino / "Arquivos baixados" / "Loja MEI" / "Dossiê MEI" / "Faturamento MEI 2026.json"
    legado.parent.mkdir(parents=True)
    anterior = json.dumps({"empresa": {"ie": IE_EMPRESA}, "meses": {"2026-01": coleta(999)}}).encode()
    legado.write_bytes(anterior)
    mei.salvar(destino, contexto(ORG_A, "local"), "2026-01", coleta(777))
    a = mei.salvar(destino, contexto(ORG_A), "2026-01", coleta(100))
    mei.salvar(destino, contexto(ORG_B), "2026-01", coleta(900))
    # Um ano inválido não interfere no ano válido do mesmo escritório.
    (Path(a["pasta"]) / "Faturamento MEI 2025.json").write_bytes(b"{")
    (destino / PASTA_CONTEXTOS / "portal" / "org_invalido" / "sefaz_pb" / f"ie_{IE_EMPRESA}").mkdir(parents=True)
    pedidos = []
    robo = _robo_simulado(cfg, monkeypatch, pedidos, lambda m, u, d: (
        Resposta(400, {"message": "Organização suspensa"}) if d["p_org"] == ORG_B else Resposta(200, 1)
    ))
    robo.enviar_historico_mei()
    assert [(url, d["p_org"], d["p_ie"], d["p_meses"]["2026-01"]["saidas"]) for _, url, d in pedidos] == [
        ("rpc/xml_mei_registrar_contexto", ORG_B, IE_EMPRESA, 900),
        ("rpc/xml_mei_registrar_contexto", ORG_A, IE_EMPRESA, 100),
    ]
    assert legado.read_bytes() == anterior


def test_mei_por_planilha_local_grava_historico_sem_chamar_portal(cfg, monkeypatch):
    empresa = SimpleNamespace(ie=IE_EMPRESA, nome="Empresa", login="login", senha="senha", tipos=["mei"],
                              cnpj="", codigo="7")
    monkeypatch.setattr(robo_xml.planilha, "ler", lambda _: SimpleNamespace(erros=[], avisos=[], empresas=[empresa]))
    monkeypatch.setattr(robo_xml.requests, "request", lambda *a, **k: pytest.fail("Modo local acessou o portal."))
    atf = AtfMei(cfg)
    monkeypatch.setattr(robo_xml.Executor, "_garantir_chrome", lambda self, diag: setattr(self, "atf", atf))
    robo_xml.rodar_local(cfg, "planilha.xlsx", date(2026, 9, 1), date(2026, 9, 30),
                        contexto_local=(ORG_A, "Local"))
    destino = Path(cfg["pastas"]["destino"])
    (arquivo,) = list((destino / PASTA_CONTEXTOS / "local").rglob("Faturamento MEI *.json"))
    h = json.loads(arquivo.read_text(encoding="utf-8"))
    assert h["identidade"] == contexto(ORG_A, "local").identidade
    assert h["meses"]["2026-09"]["saidas"] == 100
    assert list(mei.historicos_portal(destino)) == []
