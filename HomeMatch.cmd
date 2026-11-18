@echo off
rem Double-click to open HomeMatch in the browser. Close this window to stop it.
title HomeMatch
cd /d "%~dp0"
node scripts\app.mjs
if errorlevel 1 pause
