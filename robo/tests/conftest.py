import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _sem_mexer_na_pasta_real(tmp_path_factory, monkeypatch):
    """Os testes nunca renomeiam a pasta Documentos\\XML SEFAZ-PB de verdade deste PC."""
    import config
    monkeypatch.setattr(config, "DESTINO_ANTIGO", tmp_path_factory.mktemp("sem_pasta_antiga") / "nao-existe")
