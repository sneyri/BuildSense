@echo off
rem FreeCAD Checker: start local server and open the browser (double-click on Windows).
cd /d "%~dp0"
python serve.py %*
if errorlevel 1 (
  echo.
  echo Could not start. Python 3.8+ is required: https://www.python.org/downloads/
  pause
)
