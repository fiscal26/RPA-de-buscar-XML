@echo off
setlocal
REM Teste da NFS-e pelo Portal Nacional (API oficial) com um certificado A1 deste PC.
REM Pergunta o arquivo .pfx e a senha; a senha nao fica gravada.
cd /d "%~dp0"
set /p COMP=Competencia (MM/AAAA, ex.: 09/2026):
set "PYTHON_ROBO=%~dp0..\.venv\Scripts\python.exe"
if not exist "%PYTHON_ROBO%" (
    echo Prepare o ambiente .venv conforme o README antes de executar este atalho.
    pause
    exit /b 1
)
"%PYTHON_ROBO%" robo_xml.py --nfse-teste --competencia "%COMP%" %*
set "RESULTADO_ROBO=%errorlevel%"
pause
exit /b %RESULTADO_ROBO%
