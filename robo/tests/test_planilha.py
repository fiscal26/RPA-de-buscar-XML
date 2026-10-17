import planilha


def test_cnpj():
    assert planilha.normalizar_cnpj("11.222.333/0001-81") == ("11222333000181", None)
    assert planilha.normalizar_cnpj(1222333000181.0)[0] is None  # dígito errado
    assert planilha.normalizar_cnpj(191.0) == ("00000000000191", None)  # zeros que o Excel apagou
    assert planilha.normalizar_cnpj("11.222.333/0001-82")[0] is None


def test_modelo_ida_e_volta(tmp_path):
    from openpyxl import load_workbook

    arq = planilha.gerar_modelo(tmp_path / "m.xlsx")
    wb = load_workbook(arq)
    ws = wb["Empresas"]
    ws.append(["11.222.333/0001-81", "Padaria", "s3nh@", ""])
    ws.append(["45723174000110", "Mercado", "x", "login.mercado"])
    ws.append(["11222333000181", "Repetida", "y", ""])
    ws.append(["123", "Erro", "z", ""])
    ws.append(["45723174000110", "", "", ""])
    wb.save(arq)
    leitura = planilha.ler(arq)
    assert [(e.cnpj, e.apelido, e.login_atf) for e in leitura.empresas] == [
        ("11222333000181", "Padaria", "11222333000181"),
        ("45723174000110", "Mercado", "login.mercado"),
    ]
    assert len(leitura.erros) == 2 and len(leitura.avisos) == 1


def test_csv(tmp_path):
    arq = tmp_path / "e.csv"
    arq.write_text("CNPJ;Apelido;Senha\n# comentario\n11222333000181;Padaria;abc\n", encoding="cp1252")
    assert planilha.ler(arq).empresas[0].senha == "abc"
