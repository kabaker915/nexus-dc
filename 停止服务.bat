@echo off
setlocal EnableExtensions
title Stop NEXUS DC
cd /d "%~dp0"
set FOUND=0
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /C:":5199 " ^| findstr /I "LISTENING"') do (
  set FOUND=1
  echo 停止服务进程 PID %%a ...
  taskkill /PID %%a /F >nul 2>nul
)
if "%FOUND%"=="0" echo 没有检测到运行中的服务（端口 5199 空闲）。
echo 完成。
ping -n 3 127.0.0.1 >nul