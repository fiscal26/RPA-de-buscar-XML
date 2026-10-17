@echo off
REM Grava os passos que voce faz no Chrome do robo (a senha nao e gravada).
REM Antes, abra o Chrome pelo abrir_chrome.bat. Para terminar, aperte Ctrl+C nesta janela.
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
    py robo_xml.py --gravar
) else (
    python robo_xml.py --gravar
)
pause
