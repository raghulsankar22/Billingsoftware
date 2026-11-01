@echo off
setlocal
set "APP_DIR=%~dp0"
set "NODE_EXE=%APP_DIR%.desktop-runtime\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"
"%NODE_EXE%" "%APP_DIR%scripts\start-tamil-preview.mjs"
if errorlevel 1 (
  echo Tamil demo did not start. The sample folder must exist and be marked.
  pause
  exit /b 1
)
start "" "http://127.0.0.1:3103/"
