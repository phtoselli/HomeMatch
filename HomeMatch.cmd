@echo off
rem Dois cliques para abrir o HomeMatch no navegador. Feche esta janela para encerrar.
title HomeMatch
cd /d "%~dp0"
node scripts\app.mjs
if errorlevel 1 pause
