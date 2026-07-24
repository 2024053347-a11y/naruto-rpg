@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================
echo   忍者手记 - 一键部署到测试站
echo ========================================
echo.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1" -Mode staging %*
set "DEPLOY_EXIT=%ERRORLEVEL%"
echo.
if "%DEPLOY_EXIT%"=="0" goto deploy_success
if "%DEPLOY_EXIT%"=="0" set "DEPLOY_EXIT=1"
echo 测试站部署失败，错误码：%DEPLOY_EXIT%
if not defined NARUTO_DEPLOY_NO_PAUSE pause
exit /b %DEPLOY_EXIT%

:deploy_success
echo 测试站部署成功。
if not defined NARUTO_DEPLOY_NO_PAUSE pause
exit /b 0
