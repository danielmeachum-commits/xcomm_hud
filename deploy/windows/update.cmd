@echo off
rem Double-click to update xcomm_hud from this package. Run it as the account
rem that runs xcomm (not "as administrator": xcomm's Podman machine is that
rem account's). The window stays open so you can read how it went.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1"
pause
