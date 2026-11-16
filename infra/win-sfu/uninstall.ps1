<#
Stops and removes the Windows-native SFU from this PC (README.md, section 7). Run by the OWNER:

    pwsh -File infra\win-sfu\uninstall.ps1            # stop, remove the task, the firewall rules and the router forwardings
    pwsh -File infra\win-sfu\uninstall.ps1 -Purge     # also delete C:\ProgramData\AlgaMeetSFU (.env, certificates, logs)

Asks for admin rights (UAC). Without -Purge the folder stays, so install.ps1 brings everything back with the same .env.
Messages are ASCII on purpose: Windows PowerShell 5.1 reads a script without BOM as ANSI.
#>
param([switch]$Purge)
$ErrorActionPreference = 'Stop'
$Task = 'AlgaMeetSFU'; $Group = 'Alga Meet SFU'; $Dest = Join-Path $env:ProgramData 'AlgaMeetSFU'

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
  if ($Purge) { $argList += '-Purge' }
  Start-Process -FilePath (Get-Process -Id $PID).Path -Verb RunAs -ArgumentList $argList
  exit 0
}
try {
  if (Get-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $Task -Confirm:$false
    Write-Host "Tarefa '$Task' removida"
  }
  Start-Sleep -Seconds 2
  Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith("$Dest\", [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force -ErrorAction SilentlyContinue
  $node = Join-Path $Dest 'bin\node.exe'
  if (Test-Path $node) {
    # The task was stopped the hard way, so the supervisor could not give the ports back to the router itself.
    Push-Location $Dest
    try { Write-Host 'Roteador: removendo os encaminhamentos deste PC'; & $node router.mjs release } finally { Pop-Location }
  }
  Get-NetFirewallRule -Group $Group -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  Write-Host 'Regras de firewall removidas'
  if ($Purge -and (Test-Path $Dest)) { Remove-Item $Dest -Recurse -Force; Write-Host "$Dest apagada" }
  elseif (Test-Path $Dest) { Write-Host "$Dest mantida (.env e certificados). Para apagar: -Purge" }
} catch { Write-Host "ERRO: $($_.Exception.Message)" -ForegroundColor Red }
Read-Host 'Enter para fechar' | Out-Null
