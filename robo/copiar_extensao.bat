@echo off
REM Copia os arquivos da extensao "Baixar NFS-e" (so o codigo dela, nenhuma senha ou dado seu)
REM para robo\gravacoes\extensao_nfse.zip. Procura no Chrome do robo e no Chrome normal.
cd /d "%~dp0"
set ID=enehmclajcndmgefbmjhecccoegbdgea
if not exist gravacoes mkdir gravacoes
powershell -NoProfile -Command ^
  "$id='%ID%';" ^
  "$raizes=@(\"$env:LOCALAPPDATA\LotiVisseXML\ChromePerfil\", \"$env:LOCALAPPDATA\Google\Chrome\User Data\");" ^
  "$achou=$null; foreach($r in $raizes){ if(Test-Path $r){ $d=Get-ChildItem $r -Directory -Recurse -Depth 2 -Filter $id -ErrorAction SilentlyContinue | Where-Object { $_.Parent.Name -eq 'Extensions' } | Select-Object -First 1; if($d){ $achou=$d; break } } };" ^
  "if(-not $achou){ Write-Host 'Nao achei a extensao. Instale-a no Chrome (de preferencia no aberto pelo abrir_chrome.bat) e rode de novo.'; exit 1 };" ^
  "$zip=Join-Path (Get-Location) 'gravacoes\extensao_nfse.zip'; if(Test-Path $zip){ Remove-Item $zip };" ^
  "Compress-Archive -Path (Join-Path $achou.FullName '*') -DestinationPath $zip;" ^
  "Write-Host \"Pronto: $zip\"; Write-Host 'Mande esse arquivo para ajustarmos o robo.'"
pause
