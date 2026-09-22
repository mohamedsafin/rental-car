@echo off
REM ===========================================================================
REM  start.bat - starts the whole car rental system in one double-click.
REM ===========================================================================
REM  Opens three terminal windows, one for each part. Each window KEEPS its
REM  part running: if the server inside stops - a crash, or another project's
REM  "taskkill /IM node.exe" - it restarts by itself within ten seconds.
REM
REM  Three windows rather than one, so that when something goes wrong you can
REM  see WHICH part said it, and restart just that one.
REM
REM  Close a window to stop that part for good.
REM ===========================================================================

cd /d "%~dp0"

echo.
echo  Starting the car rental system...
echo.

REM The API first. The two websites are useless without it, and a head start
REM means they are not loading against a server that is not there yet.
start "Car rental - API (port 4000)" cmd /k "scripts\run-service.bat backend console"

timeout /t 5 /nobreak >nul

start "Car rental - Admin (port 5174)" cmd /k "scripts\run-service.bat admin console"
start "Car rental - Customer site (port 5173)" cmd /k "scripts\run-service.bat frontend console"

echo  Three windows are opening. Give them about 10 seconds.
echo.
echo    Admin          http://localhost:5174
echo    Customer site  http://localhost:5173
echo    API            http://localhost:4000
echo.
echo  Leave those three windows OPEN. Each one restarts its part by itself
echo  if it ever stops. Closing a window stops that part for good.
echo.
echo  NEVER use "taskkill /IM node.exe" - it stops every project on this
echo  computer, not just one. To stop this system, close its three windows.
echo.
pause
