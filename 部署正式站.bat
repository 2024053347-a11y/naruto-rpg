@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================
echo   忍者手记 - 一键部署到正式站
echo ========================================
echo.
bash deploy.sh production
echo.
pause
