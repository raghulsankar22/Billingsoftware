@echo off
setlocal
set "APP_DIR=%~dp0"
set "NODE_EXE=C:\Users\raghu_1aexzck\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"

"%NODE_EXE%" "%APP_DIR%scripts\start-local.mjs"
if errorlevel 1 (
  echo.
  echo Billing could not start. Please send a photo of this window for help.
  pause
  exit /b 1
)

start "" "http://127.0.0.1:3100/"
