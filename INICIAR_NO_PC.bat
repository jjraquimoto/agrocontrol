@echo off
cd /d "%~dp0"
echo Abrindo servidor local AgroControl 6.1 na porta 8000...
echo No navegador, acesse http://localhost:8000
python -m http.server 8000
pause
