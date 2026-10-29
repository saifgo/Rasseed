@echo off
rem ===========================================================================
rem  Sarfli Agent - device setup over USB (adb)
rem
rem  Prepares an Android phone / Sunmi POS terminal to run the Sarfli agent:
rem    1. turns ON the Sunmi "phone & SMS" switch (without it calls/USSD are cancelled)
rem    2. installs / updates the agent APK (if found)
rem    3. grants SMS + phone permissions
rem    4. enables the USSD balance reader (accessibility service)
rem    5. bot mode: never sleeps, screen on while charging, no lock screen,
rem       no doze / battery saver, agent never put to sleep or killed
rem    6. checks the SIM is registered on the network, optional USSD test
rem
rem  Usage:  setup-device.bat              (one device connected)
rem          setup-device.bat SERIAL       (several devices: pick one, see "adb devices")
rem          setup-device.bat SERIAL path\to\app.apk
rem
rem  Needs USB debugging enabled on the device (Settings > Developer options).
rem ===========================================================================
setlocal EnableExtensions EnableDelayedExpansion
title Sarfli Agent - device setup

set "PKG=com.rasseed.agent"
set "SVC=%PKG%/%PKG%.UssdAccessibilityService"
set "HERE=%~dp0"

rem ---------------------------------------------------------------- find adb
set "ADB="
for /f "delims=" %%p in ('where adb 2^>nul') do if not defined ADB set "ADB=%%p"
if not defined ADB if exist "%HERE%adb.exe" set "ADB=%HERE%adb.exe"
if not defined ADB if exist "%HERE%platform-tools\adb.exe" set "ADB=%HERE%platform-tools\adb.exe"
if not defined ADB if exist "%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" set "ADB=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"
if not defined ADB (
    echo [ERROR] adb not found.
    echo     Install "SDK Platform-Tools" from https://developer.android.com/tools/releases/platform-tools
    echo     and put adb.exe next to this file or in your PATH.
    goto :fail
)
echo adb: %ADB%

rem ---------------------------------------------------------- pick the device
set "SERIAL=%~1"
if not defined SERIAL (
    set /a COUNT=0
    for /f "skip=1 tokens=1,2" %%a in ('"%ADB%" devices') do (
        if "%%b"=="device" ( set /a COUNT+=1 & set "SERIAL=%%a" )
        if "%%b"=="unauthorized" echo [WARN] %%a is unauthorized: unlock it and accept the "Allow USB debugging" prompt.
    )
    if !COUNT!==0 (
        echo [ERROR] No device connected. Plug it in with USB debugging on, then run this again.
        goto :fail
    )
    if !COUNT! GTR 1 (
        echo [ERROR] Several devices connected. Run:  %~nx0 SERIAL
        "%ADB%" devices
        goto :fail
    )
)
set "A="%ADB%" -s %SERIAL%"

call :prop ro.product.manufacturer MAKER
call :prop ro.product.model MODEL
call :prop ro.build.version.release ANDROID
call :prop ro.build.version.sdk SDK
if not defined SDK (
    echo [ERROR] Could not talk to the device %SERIAL%.
    goto :fail
)
echo.
echo Device: %MAKER% %MODEL%  -  Android %ANDROID% (SDK %SDK%)  -  serial %SERIAL%
if %SDK% LSS 25 (
    echo [ERROR] Android 7.1 ^(SDK 25^) or newer is required.
    goto :fail
)
echo.

rem ------------------------------------------- 1. Sunmi phone & SMS switch
echo [1/6] Phone ^& SMS function
call :setting secure is_open_phone_sms BEFORE
%A% shell settings put secure is_open_phone_sms 1
call :setting secure is_open_phone_sms AFTER
if "%AFTER%"=="1" (
    echo       enabled ^(was %BEFORE%^)
) else (
    echo [WARN] Could not turn it on ^(value: %AFTER%^). Calls and USSD may stay blocked.
)

rem ------------------------------------------------------- 2. install the APK
echo [2/6] Agent app
set "APK=%~2"
if not defined APK if exist "%HERE%sarfli-agent.apk" set "APK=%HERE%sarfli-agent.apk"
if not defined APK if exist "%HERE%..\web\public\downloads\sarfli-agent.apk" set "APK=%HERE%..\web\public\downloads\sarfli-agent.apk"
if not defined APK if exist "%HERE%app\build\outputs\apk\release\app-release.apk" set "APK=%HERE%app\build\outputs\apk\release\app-release.apk"
if defined APK (
    echo       installing %APK%
    %A% install -r "%APK%"
) else (
    echo       no APK found next to this file - skipping install
)
%A% shell pm path %PKG% >nul 2>&1
if errorlevel 1 (
    echo [ERROR] %PKG% is not installed. Put sarfli-agent.apk next to this file and run again.
    goto :fail
)

rem ---------------------------------------------------------- 3. permissions
echo [3/6] Permissions
for %%p in (RECEIVE_SMS READ_SMS CALL_PHONE READ_PHONE_STATE) do (
    %A% shell pm grant %PKG% android.permission.%%p
    if errorlevel 1 ( echo [WARN] could not grant %%p ) else ( echo       %%p granted )
)
if %SDK% GEQ 33 (
    %A% shell pm grant %PKG% android.permission.POST_NOTIFICATIONS >nul 2>&1
    echo       POST_NOTIFICATIONS granted
)

rem -------------------------------------------- 4. accessibility (USSD reader)
echo [4/6] Balance reader ^(accessibility^)
call :setting secure enabled_accessibility_services CUR
set "NEW="
if "%CUR%"=="" set "NEW=%SVC%"
if "%CUR%"=="null" set "NEW=%SVC%"
if not defined NEW (
    echo %CUR% | findstr /i /c:"%SVC%" >nul
    if errorlevel 1 ( set "NEW=%CUR%:%SVC%" ) else ( set "NEW=%CUR%" )
)
%A% shell settings put secure enabled_accessibility_services "%NEW%"
%A% shell settings put secure accessibility_enabled 1
ping -n 3 127.0.0.1 >nul
%A% shell dumpsys accessibility | findstr /i /c:"Sarfli" >nul
if errorlevel 1 (
    echo [WARN] Not active yet. On the device: Settings ^> Accessibility ^> Sarfli Agent ^> ON
) else (
    echo       enabled
)

rem ------------------------------------------------------- 5. bot mode
echo [5/6] Bot mode ^(never sleep, agent never killed^)
rem battery: no doze, no app standby, no battery saver
%A% shell dumpsys deviceidle whitelist +%PKG% >nul 2>&1
%A% shell dumpsys deviceidle disable >nul 2>&1
%A% shell cmd appops set %PKG% RUN_IN_BACKGROUND allow >nul 2>&1
%A% shell cmd appops set %PKG% RUN_ANY_IN_BACKGROUND allow >nul 2>&1
if %SDK% GEQ 28 %A% shell am set-standby-bucket %PKG% active >nul 2>&1
%A% shell settings put global app_standby_enabled 0 >nul 2>&1
%A% shell settings put global adaptive_battery_management_enabled 0 >nul 2>&1
%A% shell settings put global low_power 0 >nul 2>&1
%A% shell settings put global low_power_sticky 0 >nul 2>&1
echo       battery optimisation, doze and app standby off
rem screen: always on while charging (AC+USB+wireless), never times out, dimmed
%A% shell settings put global stay_on_while_plugged_in 7
%A% shell settings put system screen_off_timeout 2147483647
%A% shell settings put system screen_brightness_mode 0
%A% shell settings put system screen_brightness 15
echo       screen stays on while charging ^(dimmed^)
rem Wi-Fi never sleeps, no surprise system updates / reboots
%A% shell settings put global wifi_sleep_policy 2 >nul 2>&1
%A% shell settings put global ota_disable_automatic_update 1 >nul 2>&1
rem animations off: USSD popups open and close faster for the reader
%A% shell settings put global window_animation_scale 0
%A% shell settings put global transition_animation_scale 0
%A% shell settings put global animator_duration_scale 0
echo       Wi-Fi always on, auto system updates off, animations off
rem lock screen: removed, so the agent works after a reboot without anyone unlocking
%A% shell locksettings set-disable true >nul 2>&1
call :shellvar "locksettings get-disabled" LOCKOFF
if /i "%LOCKOFF%"=="true" (
    echo       lock screen disabled
) else (
    echo [WARN] Lock screen still on - the phone probably has a PIN/pattern.
    echo     Remove it on the device: Settings ^> Security ^> Screen lock ^> None, then run this again.
)
%A% shell input keyevent KEYCODE_WAKEUP >nul 2>&1
%A% shell wm dismiss-keyguard >nul 2>&1
%A% shell am start -n %PKG%/.MainActivity >nul 2>&1
rem brand battery killers cannot be changed over adb
set "KILLER="
for %%m in (xiaomi redmi poco huawei honor oppo realme vivo oneplus samsung) do (
    echo %MAKER% | findstr /i /c:"%%m" >nul && set "KILLER=1"
)
if defined KILLER (
    echo [TODO] %MAKER% phones also kill apps on their own. On the device:
    echo     - Settings ^> Apps ^> Sarfli Agent ^> Battery: "Unrestricted" / "No restrictions"
    echo     - turn ON "Autostart" / "Auto-launch" for Sarfli Agent if the option exists
    echo     - in Recent apps, lock the Sarfli Agent card ^(padlock^) so "clear all" skips it
)

rem ------------------------------------------------------ 6. SIM and network
echo [6/6] SIM and network
call :prop gsm.sim.state SIMSTATE
call :prop gsm.sim.operator.alpha SIMOP
call :prop gsm.network.type NETTYPE
echo       SIM: %SIMSTATE%   operator: %SIMOP%   network: %NETTYPE%
%A% shell dumpsys telephony.registry | findstr /c:"mServiceState=0" >nul
if errorlevel 1 (
    echo [WARN] No SIM is registered on the network ^(no service / emergency calls only^).
    echo     Check the SIM is active ^(not suspended^), inserted correctly and has coverage.
    set "NETOK=0"
) else (
    echo       registered - calls and USSD can go out
    set "NETOK=1"
)

echo.
set "CODE="
set /p "CODE=Optional: USSD code to test now (e.g. *100#), or press Enter to skip: "
if defined CODE (
    set "DIAL=!CODE:#=%%23!"
    %A% shell am start -a android.intent.action.CALL -d 'tel:!DIAL!' >nul
    echo       sent !CODE! - the operator reply appears on the device screen in a few seconds.
)

echo.
echo ===========================================================================
echo  Done. Next, in the Sarfli Agent app on the device:
echo    - pair it: Admin ^> Numbers ^& phones ^> Add phone ^(server URL + 6-digit code^)
echo    - keep it charging, on Wi-Fi. The screen stays on only while charging.
echo  After a reboot, run this file again ^(doze and the Sunmi switch can reset^).
echo ===========================================================================
pause
exit /b 0

:fail
echo.
pause
exit /b 1

rem ------------------------------------------------------------------ helpers
rem :prop NAME VAR  -> reads a system property into VAR
:prop
set "%2="
for /f "usebackq delims=" %%v in (`%A% shell getprop %1`) do set "%2=%%v"
exit /b 0

rem :shellvar "COMMAND" VAR  -> first line of a device shell command into VAR
:shellvar
set "%2="
for /f "usebackq delims=" %%v in (`%A% shell %~1`) do if not defined %2 set "%2=%%v"
exit /b 0

rem :setting NAMESPACE KEY VAR
:setting
set "%3="
for /f "usebackq delims=" %%v in (`%A% shell settings get %1 %2`) do set "%3=%%v"
exit /b 0

