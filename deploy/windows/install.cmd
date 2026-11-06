@echo off
rem Double-click to install xcomm_hud from this kit. Windows asks for
rem administrator rights; install as the account that will run xcomm.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell.exe -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"%~dp0install.ps1\"'"
