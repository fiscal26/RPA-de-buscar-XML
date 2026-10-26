@echo off
REM Teste da NFS-e pelo Portal Nacional (API oficial) com um certificado A1 deste PC.
REM Pergunta o arquivo .pfx e a senha; a senha nao fica gravada.
cd /d "%~dp0"
set /p COMP=Competencia (MM/AAAA, ex.: 09/2026): 
where py >nul 2>nul
if %errorlevel%==0 (
    py robo_xml.py --nfse-teste --competencia "%COMP%"
) else (
    python robo_xml.py --nfse-teste --competencia "%COMP%"
)
pause
