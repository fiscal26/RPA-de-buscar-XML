"""Robô na VPS atendendo vários escritórios: cada tarefa do portal grava na pasta do escritório dela."""
from cryptography.hazmat.primitives.asymmetric import rsa

import cripto
import robo_xml


class ExecutorFalso:
    def __init__(self):
        self.trabalhos = []

    def executar_rodada(self, grupo):
        self.trabalhos.extend(grupo)
        return [robo_xml.Resultado("concluido", "ok") for _ in grupo]


class PortalFalso:
    def __init__(self):
        self.atualizacoes = []

    def atualizar_tarefa(self, tid, campos):
        self.atualizacoes.append((tid, campos))


def test_rodada_da_sefaz_usa_a_pasta_do_escritorio(tmp_path):
    privada = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    robo = object.__new__(robo_xml.Robo)
    robo.cfg = {"pastas": {"destino": str(tmp_path), "por_escritorio": True}}
    robo.privada, robo.executor, robo.portal = privada, ExecutorFalso(), PortalFalso()
    robo.em_curso, robo.aguardando, robo.chrome_ok = {}, {}, True
    senha = cripto.cifrar("certa", cripto.publica_de(privada))
    lote = [{"id": f"t{i}", "ie": ie, "nome": nome, "tipos": ["nfe_saida"], "data_inicio": "2026-09-01",
             "data_fim": "2026-09-30", "login_atf": "mar00134", "senha_cifrada": senha, "org_nome": "Contábil Sousa"}
            for i, (ie, nome) in enumerate([("160123453", "Padaria"), ("160987652", "Mercado")])]
    robo.processar(lote)
    assert {t.destino for t in robo.executor.trabalhos} == {str(tmp_path / "Contábil Sousa")}
    assert all(t.senha == "" for t in robo.executor.trabalhos)  # a senha não fica na memória depois da rodada
    # sem a opção (robô do computador): tudo na pasta de sempre
    robo.cfg["pastas"]["por_escritorio"] = False
    robo.executor = ExecutorFalso()
    robo.processar(lote)
    assert {t.destino for t in robo.executor.trabalhos} == {str(tmp_path)}
