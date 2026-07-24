@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================
echo   忍者手记 - 一键部署到正式站
echo ========================================
echo.
echo 警告：此操作会更新正式站并重启正式后端。
set /p "PRODUCTION_CONFIRM=请输入 DEPLOY-PRODUCTION 继续："
if not "%PRODUCTION_CONFIRM%"=="DEPLOY-PRODUCTION" (
  echo 已取消，未连接正式服务器。
  pause
  exit /b 2
)
echo.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1" -Mode production -ConfirmProduction %*
set "DEPLOY_EXIT=%ERRORLEVEL%"
echo.
if not "%DEPLOY_EXIT%"=="0" echo 正式站部署失败，错误码：%DEPLOY_EXIT%
pause
exit /b %DEPLOY_EXIT%
