@echo off
setlocal
REM Liga o robo de XML do portal LotiVisse (deixe esta janela aberta).
REM Antes, abra o Chrome pelo abrir_chrome.bat.
cd /d "%~dp0"
set "PYTHON_ROBO=%~dp0..\.venv\Scripts\python.exe"
if not exist "%PYTHON_ROBO%" (
    echo Prepare o ambiente .venv conforme o README antes de executar este atalho.
    pause
    exit /b 1
)
"%PYTHON_ROBO%" robo_xml.py %*
set "RESULTADO_ROBO=%errorlevel%"
pause
exit /b %RESULTADO_ROBO%
