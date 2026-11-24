@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title NEXUS DC - 3D/2D Data Center
color 0B

set "NODE=runtime\node.exe"
if not exist "%NODE%" (
  where node >nul 2>nul
  if errorlevel 1 (
    echo [错误] 未找到 Node.js 运行时。
    echo 请保留 runtime 文件夹，或安装 Node.js 18+ 后重试。
    pause
    exit /b 1
  )
  set "NODE=node"
)

netstat -ano | findstr /C:":5199 " | findstr /I "LISTENING" >nul
if not errorlevel 1 (
  echo 检测到服务已在运行，直接打开浏览器...
  start "" "http://127.0.0.1:5199/"
  exit /b 0
)

echo ==========================================================
echo   NEXUS DC  -  3D / 2D 机房构建与智能运维
echo   启动地址: http://127.0.0.1:5199/
echo   关闭本窗口即停止服务
echo ==========================================================
echo.

if not defined NEXUS_NO_BROWSER (
  start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:5199/'"
)

"%NODE%" server.mjs

echo.
echo 服务已退出。如果提示端口被占用，请先运行 停止服务.bat。
pause