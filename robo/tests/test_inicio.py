import json
import sys

import pytest

import config
import robo_xml


@pytest.mark.parametrize("modo", [[], ["--enviar-mei"]])
def test_url_efetiva_exige_confirmacao_antes_de_usar_o_portal(tmp_path, monkeypatch, capsys, modo):
    arquivo = tmp_path / "config.json"
    destino = tmp_path / "documentos"
    arquivo.write_text(json.dumps({"portal": {"supabase_url": "https://antigo.invalid",
                                               "chave_service_role": "chave-do-json"},
                                   "pastas": {"destino": str(destino)}}), encoding="utf-8")
    monkeypatch.setattr(config, "ARQUIVO_CONFIG", arquivo)
    monkeypatch.setattr(config, "RAIZ", tmp_path)
    monkeypatch.setenv("SUPABASE_URL", "https://ensaio.invalid/")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "chave-do-ambiente")
    monkeypatch.setattr(robo_xml.signal, "signal", lambda *_: None)
    executado = []

    class RoboSimulado:
        def __init__(self, cfg):
            assert cfg["portal"]["supabase_url"] == "https://ensaio.invalid"
            assert cfg["portal"]["chave_service_role"] == "chave-do-ambiente"
            executado.append("abriu")

        def rodar(self):
            executado.append("rodou")

        def enviar_historico_mei(self):
            executado.append("enviou")

        def encerrar(self):
            pass

    monkeypatch.setattr(robo_xml, "Robo", RoboSimulado)
    monkeypatch.setattr(sys, "argv", ["robo_xml.py", "--conferir-banco"])
    robo_xml.main()
    assert capsys.readouterr().out == "Banco efetivo: https://ensaio.invalid\n"

    for argumentos in ([], ["--confirmar-banco", "https://antigo.invalid"]):
        monkeypatch.setattr(sys, "argv", ["robo_xml.py", *modo, *argumentos])
        with pytest.raises(SystemExit, match="confirmar-banco"):
            robo_xml.main()
    assert not executado and not destino.exists()

    monkeypatch.setattr(sys, "argv", ["robo_xml.py", *modo, "--confirmar-banco", "https://ensaio.invalid"])
    robo_xml.main()
    assert executado == ["abriu", "enviou" if modo else "rodou"]
