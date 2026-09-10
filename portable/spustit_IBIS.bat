@echo off
chcp 65001 > nul
title IBIS Onkogynekologické Konzilium - Portable VFN
echo ====================================================================
echo   IBIS ONKOGYNEKOLOGIE - PORTABLE VERZE PRO USB DISK
echo   Všechna data zůstávají uložená výhradně na tomto USB disku.
echo ====================================================================
echo.
echo Spouštím přenosný IBIS server...
echo Otevírám webové rozhraní v prohlížeči...
echo.

start "" "http://localhost:3000/chronology.html"

"%~dp0node\node.exe" "%~dp0dist\server.js"

pause
