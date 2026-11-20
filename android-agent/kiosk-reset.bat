@echo off
rem ===========================================================================
rem  Sarfli Agent - turn kiosk mode off over USB (forgot the PIN)
rem
rem  Turns kiosk mode off and clears the kiosk PIN. The app stays device owner,
rem  so kiosk mode can be turned on again in the app with a new PIN.
rem
rem  Usage:  kiosk-reset.bat           (one device connected)
rem          kiosk-reset.bat SERIAL    (several devices, see "adb devices")
rem ===========================================================================
setlocal EnableExtensions
title Sarfli Agent - kiosk reset

set "PKG=com.rasseed.agent"
set "HERE=%~dp0"

set "ADB="
for /f "delims=" %%p in ('where adb 2^>nul') do if not defined ADB set "ADB=%%p"
if not defined ADB if exist "%HERE%adb.exe" set "ADB=%HERE%adb.exe"
if not defined ADB if exist "%HERE%platform-tools\adb.exe" set "ADB=%HERE%platform-tools\adb.exe"
if not defined ADB if exist "%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" set "ADB=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"
if not defined ADB (
    echo [ERROR] adb not found. Put adb.exe next to this file or in your PATH.
    goto :end
)

if "%~1"=="" ( set "A="%ADB%"" ) else ( set "A="%ADB%" -s %~1" )

%A% shell am broadcast -a %PKG%.KIOSK_RESET -n %PKG%/.KioskResetReceiver
if errorlevel 1 (
    echo [ERROR] Could not reach the device. Check USB debugging, or pass the SERIAL.
) else (
    echo.
    echo Kiosk mode is off and the PIN is cleared.
    echo Turn it back on in the app: Kiosk mode ^> "Turn on kiosk mode".
)

:end
echo.
pause
