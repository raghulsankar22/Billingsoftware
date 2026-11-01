@echo off
setlocal
set "APP_DIR=%~dp0"
set "NODE_EXE=%APP_DIR%.desktop-runtime\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"

"%NODE_EXE%" "%APP_DIR%scripts\start-preview.mjs"
if errorlevel 1 (
  echo.
  echo The billing website could not start. Please ask for help with this message.
  pause
  exit /b 1
)

start "" "http://127.0.0.1:3101/"
