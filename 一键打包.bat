@echo off
chcp 65001 >nul
echo.
echo   ═══════════════════════════════════════
echo   忍者手记 — 一键打包
echo   ═══════════════════════════════════════
echo.
cd /d "%~dp0"

REM 自动查找 Node.js 路径
set NODE_PATH=
if exist "D:\node.exe" set NODE_PATH=D:\node.exe
if exist "C:\Program Files\nodejs\node.exe" set NODE_PATH=C:\Program Files\nodejs\node.exe
if exist "%ProgramFiles%\nodejs\node.exe" set NODE_PATH=%ProgramFiles%\nodejs\node.exe
if "%NODE_PATH%"=="" (
    echo   ❌ 未找到 Node.js！请先安装 Node.js
    echo.
    pause
    exit /b 1
)

echo   使用 Node.js: %NODE_PATH%
echo.
"%NODE_PATH%" scripts\bundle.mjs
if %errorlevel% neq 0 (
    echo   ❌ Bundle 打包失败！
    pause
    exit /b 1
)
"%NODE_PATH%" scripts\build-regex.mjs
if %errorlevel% neq 0 (
    echo   ❌ Regex 生成失败！
    pause
    exit /b 1
)
echo.
echo   ✅ 打包完成！输出在 dist\ 目录
echo.
echo   按任意键退出...
pause >nul
