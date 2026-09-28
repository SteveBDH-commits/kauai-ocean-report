@echo off
rem Double-click to start the Kauai ocean report test page.
rem Edit the email below (NWS asks API users to identify themselves), then save.
set NWS_USER_AGENT=KauaiBeachGuide (add-your-email@example.com)

cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get the LTS version from https://nodejs.org , install it, then double-click this file again.
  pause
  exit /b 1
)
node src\serve.mjs --open
echo.
echo The test page has stopped.
pause
