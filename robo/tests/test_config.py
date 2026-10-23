import config


def test_destino_do_exemplo_vai_para_documentos_deste_computador(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DESTINO_PADRAO", tmp_path / "XML SEFAZ-PB")
    cfg = {"pastas": {"destino": "C:\\Users\\SEU-USUARIO\\Documents\\XML SEFAZ-PB", "diagnostico": ""}}
    avisos = config.resolver_pastas(cfg)
    assert avisos and cfg["pastas"]["destino"] == str(tmp_path / "XML SEFAZ-PB")
    assert cfg["pastas"]["diagnostico"] == str(tmp_path / "XML SEFAZ-PB" / "_diagnostico")
    assert (tmp_path / "XML SEFAZ-PB").is_dir()


def test_destino_vazio_e_destino_valido(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DESTINO_PADRAO", tmp_path / "padrao")
    vazio = {"pastas": {"destino": "", "diagnostico": ""}}
    assert config.resolver_pastas(vazio) == [] and vazio["pastas"]["destino"] == str(tmp_path / "padrao")
    escolhido = {"pastas": {"destino": str(tmp_path / "Clientes" / "XML"), "diagnostico": ""}}
    assert config.resolver_pastas(escolhido) == [] and escolhido["pastas"]["destino"] == str(tmp_path / "Clientes" / "XML")
