"""Textos do ATF que o robô precisa reconhecer."""
from atf_pb import _CONFIRMADA, _MENSAGEM_FINAL, _SEM_NOTAS


def test_nenhum_registro_e_sem_notas():
    for texto in ("Mensagem: Nenhum registro satisfaz a pesquisa.", "NENHUM REGISTRO SATISFAZ A PESQUISA"):
        assert _SEM_NOTAS.search(texto)
        assert _MENSAGEM_FINAL.search(texto)  # é a resposta final da consulta (sem anexo)


def test_confirmacao_do_consultar_nao_e_sem_notas():
    texto = "O resultado será enviado para sua caixa de mensagens do ATF"
    assert _CONFIRMADA.search(texto) and not _SEM_NOTAS.search(texto)


def test_mensagens_de_andamento_nao_sao_finais():
    for texto in ("Tarefa recebida.", "Tarefa em processamento."):
        assert not _MENSAGEM_FINAL.search(texto)
