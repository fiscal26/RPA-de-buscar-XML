@echo off
REM Liga o robo de XML do portal LotiVisse (deixe esta janela aberta).
REM Antes, abra o Chrome pelo abrir_chrome.bat.
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
    py robo_xml.py
) else (
    python robo_xml.py
)
pause
