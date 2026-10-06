# Legt eine Windows-Aufgabe an, die den Preisvergleich täglich um 08:00 Uhr ausführt.
# Ausführen:  powershell -ExecutionPolicy Bypass -File setup-schedule.ps1
# Entfernen:  schtasks /Delete /TN "Cardmarket Buylist-Arbitrage" /F

$ErrorActionPreference = 'Stop'
$taskName = 'Cardmarket Buylist-Arbitrage'
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node).Source
$cmd = "`"$node`" `"$projectDir\run.js`" > `"$projectDir\output\letzter-lauf.log`" 2>&1"

$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c $cmd" -WorkingDirectory $projectDir
$triggers = @(
  (New-ScheduledTaskTrigger -Daily -At 08:00),
  (New-ScheduledTaskTrigger -AtLogOn)
)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Settings $settings -Force | Out-Null
Write-Host "Aufgabe '$taskName' angelegt: täglich 08:00 Uhr und bei Anmeldung."
Write-Host "Report: $projectDir\output\report.html"
