@echo off
cd /d "%~dp0"
node run.js --open > "output\letzter-lauf.log" 2>&1
type "output\letzter-lauf.log"
if errorlevel 1 pause
