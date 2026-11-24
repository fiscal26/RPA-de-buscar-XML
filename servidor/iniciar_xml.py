"""Inicia o serviço de XML com a URL do banco confirmada na instalação."""

import os
import sys
from pathlib import Path


def main():
    banco = os.environ.get("LOTIVISSE_XML_BANCO_CONFIRMADO")
    if not banco:
        sys.exit("Falta LOTIVISSE_XML_BANCO_CONFIRMADO. Confira a instalação em servidor/LEIAME.md.")
    robo = Path(__file__).resolve().parents[1] / "robo" / "robo_xml.py"
    os.execv(sys.executable, [sys.executable, "-u", str(robo), "--confirmar-banco", banco])


if __name__ == "__main__":
    main()
