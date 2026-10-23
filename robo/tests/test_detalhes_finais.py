import robo_xml
from robo_xml import Resultado, detalhes_finais


def test_cada_servico_com_o_proprio_motivo():
    """A rodada caiu no meio: o que terminou continua valendo; o resto ganha um motivo curto, não o erro inteiro."""
    andamento = {"faturas": {"situacao": "concluido", "mensagem": "1 arquivo(s)"},
                 "nfe_saida": {"situacao": "aguardando", "mensagem": "consulta enviada"}}
    d = detalhes_finais(["nfe_saida", "faturas", "certidao"], Resultado("erro", robo_xml.FALHA_NO_RETORNO), andamento)
    assert d["faturas"] == {"situacao": "concluido", "mensagem": "1 arquivo(s)"}
    assert d["nfe_saida"] == {"situacao": "erro", "mensagem": "o ATF não devolveu o XML"}
    assert d["certidao"] == {"situacao": "erro", "mensagem": "não foi concluído nesta execução"}


def test_login_recusado_e_detalhe_do_resultado():
    r = Resultado("senha_invalida", "Login 123 recusado pelo ATF: senha incorreta (texto longo do ATF)")
    d = detalhes_finais(["nfe_saida", "mei"], r, {})
    assert {v["mensagem"] for v in d.values()} == {"login recusado pelo ATF"}
    # o que o resultado já traz por serviço não é trocado
    r = Resultado("erro", "NF-e Saída: x; Faturas: y", detalhes={"faturas": {"arquivos": 0, "situacao": "erro", "mensagem": "y"}})
    assert detalhes_finais(["faturas"], r, {})["faturas"]["mensagem"] == "y"
