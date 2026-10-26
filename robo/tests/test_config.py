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


def test_pasta_antiga_xml_sefaz_pb_vira_rpa_xml_lotivisse(tmp_path, monkeypatch):
    antiga, nova = tmp_path / "XML SEFAZ-PB", tmp_path / "RPA XML LotiVisse"
    (antiga / "Arquivos baixados" / "5-Joao").mkdir(parents=True)
    monkeypatch.setattr(config, "DESTINO_PADRAO", nova)
    monkeypatch.setattr(config, "DESTINO_ANTIGO", antiga)
    cfg = {"pastas": {"destino": "", "diagnostico": ""}}
    avisos = config.resolver_pastas(cfg)
    assert cfg["pastas"]["destino"] == str(nova) and (nova / "Arquivos baixados" / "5-Joao").is_dir()
    assert not antiga.exists() and avisos and "agora se chama" in avisos[0]
