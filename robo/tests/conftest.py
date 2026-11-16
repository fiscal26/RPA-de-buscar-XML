import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402


@pytest.fixture
def destino(tmp_path_factory):
    return tmp_path_factory.mktemp("ctx")
