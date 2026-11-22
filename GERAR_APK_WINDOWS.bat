@echo off
setlocal
cd /d "%~dp0"
title AgroControl 6.3.2 - APK Android

echo =========================================
echo    AgroControl 6.3.2 - Gerador de APK
 echo =========================================
echo.
where node >nul 2>nul || (echo ERRO: instale Node.js 22 ou superior. & pause & exit /b 1)
where npm >nul 2>nul || (echo ERRO: npm nao encontrado. & pause & exit /b 1)

if not exist "node_modules\@capacitor\cli" (
  echo Instalando dependencias do projeto...
  call npm ci || (echo ERRO durante npm ci. & pause & exit /b 1)
)

echo Copiando a interface e sincronizando o projeto Android...
call npm run android:sync || (echo ERRO na sincronizacao. & pause & exit /b 1)

if not exist "android\local.properties" (
  echo.
  echo SDK Android ainda nao configurado. Abra a pasta android no Android Studio,
  echo aguarde o carregamento do Gradle e execute este arquivo novamente.
  pause
  exit /b 1
)

pushd android
call gradlew.bat assembleDebug
if errorlevel 1 (popd & echo ERRO: Gradle nao conseguiu gerar o APK. & pause & exit /b 1)
popd

if exist "android\app\build\outputs\apk\debug\app-debug.apk" (
  copy /y "android\app\build\outputs\apk\debug\app-debug.apk" "AgroControl_6_3_2_DEBUG.apk" >nul
  echo.
  echo SUCESSO: AgroControl_6_3_2_DEBUG.apk
  echo Instale em aparelho de testes e confirme login, offline e sincronizacao.
) else (
  echo ERRO: Gradle terminou, mas o APK nao foi encontrado.
  pause
  exit /b 1
)
pause
