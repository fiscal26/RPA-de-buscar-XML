@echo off
REM Abre o Chrome com a porta de depuracao 9222 num perfil proprio do robo de XML.
REM Use sempre este atalho antes de ligar o robo.
set PERFIL=%LOCALAPPDATA%\LotiVisseXML\ChromePerfil
set CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe
if not exist "%CHROME%" set CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe
if not exist "%CHROME%" set CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe
start "" "%CHROME%" --remote-debugging-port=9222 --user-data-dir="%PERFIL%" --no-first-run
