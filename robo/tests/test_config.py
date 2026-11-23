import config


def test_sondagem_de_destino_preserva_arquivo_existente(tmp_path):
    existente = tmp_path / ".teste_gravacao"
    existente.write_text("já existia", encoding="utf-8")
    assert config._pasta_gravavel(tmp_path)
    assert existente.read_text(encoding="utf-8") == "já existia"
    assert list(tmp_path.iterdir()) == [existente]
import pytest


def test_destino_do_exemplo_exige_correcao(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DESTINO_PADRAO", tmp_path / "XML SEFAZ-PB")
    cfg = {"pastas": {"destino": "C:\\Users\\SEU-USUARIO\\Documents\\XML SEFAZ-PB", "diagnostico": ""}}
    with pytest.raises(config.ConfigInvalida, match="destino gravável"):
        config.resolver_pastas(cfg)
    assert not (tmp_path / "XML SEFAZ-PB").exists()


def test_destino_vazio_e_destino_valido(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DESTINO_PADRAO", tmp_path / "padrao")
    vazio = {"pastas": {"destino": "", "diagnostico": ""}}
    assert config.resolver_pastas(vazio) == [] and vazio["pastas"]["destino"] == str(tmp_path / "padrao")
    escolhido = {"pastas": {"destino": str(tmp_path / "Clientes" / "XML"), "diagnostico": ""}}
    assert config.resolver_pastas(escolhido) == [] and escolhido["pastas"]["destino"] == str(tmp_path / "Clientes" / "XML")


def test_pasta_antiga_permanece_intacta(tmp_path, monkeypatch):
    antiga, nova = tmp_path / "XML SEFAZ-PB", tmp_path / "RPA XML LotiVisse"
    (antiga / "Arquivos baixados" / "5-Joao").mkdir(parents=True)
    monkeypatch.setattr(config, "DESTINO_PADRAO", nova)
    cfg = {"pastas": {"destino": "", "diagnostico": ""}}
    config.resolver_pastas(cfg)
    assert antiga.is_dir() and nova.is_dir() and not list(nova.iterdir())

def test_filas_do_robo(tmp_path, monkeypatch):
    import json
    import pytest
    monkeypatch.setattr(config, "DESTINO_PADRAO", tmp_path / "padrao")
    arquivo = tmp_path / "config.json"
    monkeypatch.setattr(config, "ARQUIVO_CONFIG", arquivo)
    assert config.carregar()["portal"]["filas"] == ["sefaz", "nfse"]  # sem nada: as duas
    arquivo.write_text(json.dumps({"portal": {"filas": ["NFSe "]}}), encoding="utf-8")
    assert config.carregar()["portal"]["filas"] == ["nfse"]
    arquivo.write_text(json.dumps({"portal": {"filas": ["atf"]}}), encoding="utf-8")
    with pytest.raises(config.ConfigInvalida, match="filas"):
        config.carregar()
