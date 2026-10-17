@echo off
REM Cria as chaves que protegem as senhas do ATF (rode UMA vez so).
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
    py robo_xml.py --gerar-chaves
) else (
    python robo_xml.py --gerar-chaves
)
pause
