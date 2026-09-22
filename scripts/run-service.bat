@echo off
REM ===========================================================================
REM  run-service.bat <backend|admin|frontend> [console]
REM ===========================================================================
REM  Runs ONE part of the car rental system and KEEPS it running.
REM
REM  WHY THE LOOP
REM  This machine runs several projects side by side. Any of them can kill this
REM  one without meaning to - the classic is "taskkill /IM node.exe", typed to
REM  stop some other project, which stops EVERY Node program on the machine,
REM  this one included. A crash and a kill look identical from here: the server
REM  simply stops. So when it stops, this loop waits ten seconds and starts it
REM  again. The window stays open throughout; only the server inside restarts.
REM
REM  Closing the WINDOW is still the way to stop it for good. That is the one
REM  thing the loop cannot survive, and it should not - it is how you say "off".
REM
REM  CONSOLE vs LOG
REM    console   print everything in this window  - what start.bat uses
REM    (nothing) append everything to logs\<name>.log - for running unattended
REM ===========================================================================

setlocal
set ROOT=%~dp0..
set NAME=%1
set MODE=%2

if "%NAME%"=="" (
  echo Usage: run-service.bat ^<backend^|admin^|frontend^> [console]
  exit /b 1
)

cd /d "%ROOT%"
if not exist "logs" mkdir "logs"

:loop
if /i "%MODE%"=="console" (
  echo.
  echo  [%time%] Starting %NAME%...
  echo.
  call npm run dev:%NAME%
  echo.
  echo  [%time%] %NAME% stopped. Restarting in 10 seconds.
  echo  Close this window to stop it for good.
) else (
  echo [%date% %time%] starting %NAME% >> "logs\%NAME%.log"
  call npm run dev:%NAME% >> "logs\%NAME%.log" 2>&1
  echo [%date% %time%] %NAME% stopped, restarting in 10s >> "logs\%NAME%.log"
)

REM The pause stops a service that genuinely cannot start - its port taken by
REM another project, the database down - from restarting hundreds of times a
REM minute. Ten seconds is long enough to read the error above it.
timeout /t 10 /nobreak >nul
goto loop
