<#
Installs the Windows-native SFU on this PC (README.md). Run by the OWNER, from the repo root:

    pwsh -File infra\win-sfu\install.ps1 -OldServer usuario@ip-do-servidor    # first time: migrate from the Linux server
    pwsh -File infra\win-sfu\install.ps1                                      # later: update the kit, keep .env

It asks for admin rights (UAC): it creates firewall rules and a scheduled task. What it does, in order:
  1. copies the kit and the three programs to C:\ProgramData\AlgaMeetSFU, locked so only admins can change it
  2. .env: copied from the old server with scp (you type its SSH password; nothing is shown), or typed here (hidden)
  3. Windows Firewall: three inbound rules, each tied to one program and its ports
  4. scheduled task "AlgaMeetSFU": starts at boot, before anyone logs in, as LocalService (no access to your files)
  5. cutover: if the old server still holds the router's ports, offers to stop its SFU over SSH, then starts this one
Idempotent: run it again after pulling a new version of the kit.

-DryInstall <folder> only copies files and checks .env into <folder>: no admin, no firewall, no task (for testing).
Messages are ASCII on purpose: Windows PowerShell 5.1 reads a script without BOM as ANSI.
#>
param(
  [string]$OldServer,
  [string]$SeedEnv,     # a .env prepared beforehand. Not named EnvFile: PowerShell variables ignore case and $envFile is the installed one
  [switch]$Yes,
  [switch]$SetDuckToken,   # ask (hidden) for the DuckDNS token and put it in the .env that is already installed
  [string]$NodeExe,
  [string]$OwnerSid,
  [string]$DryInstall,
  [switch]$NoStart
)
$ErrorActionPreference = 'Stop'
$Kit   = $PSScriptRoot
$Repo  = (Resolve-Path (Join-Path $Kit '..\..')).Path
$Task  = 'AlgaMeetSFU'
$Group = 'Alga Meet SFU'
$Dest  = if ($DryInstall) { $DryInstall } else { Join-Path $env:ProgramData 'AlgaMeetSFU' }

function Say($m)  { Write-Host "==> $m" -ForegroundColor Cyan }
function Note($m) { Write-Host "    $m" }
function Done()   { if (-not $DryInstall) { Read-Host 'Enter para fechar' | Out-Null } }
function Die($m)  { Write-Host "ERRO: $m" -ForegroundColor Red; Done; exit 1 }
function Read-Secret($prompt) {
  $s = Read-Host $prompt -AsSecureString
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b).Trim() } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $NodeExe)  { $c = Get-Command node -ErrorAction SilentlyContinue; if ($c) { $NodeExe = $c.Source } }
if (-not $OwnerSid) { $OwnerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value }

if (-not $isAdmin -and -not $DryInstall) {
  # Elevate, carrying what only the non-elevated session knows for sure: where node is and who the owner is.
  Say 'Pedindo permissao de administrador (UAC)...'
  $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-OwnerSid', $OwnerSid)
  if ($NodeExe)   { $argList += @('-NodeExe', "`"$NodeExe`"") }
  if ($OldServer) { $argList += @('-OldServer', $OldServer) }
  if ($SeedEnv)   { $argList += @('-SeedEnv', "`"$((Resolve-Path $SeedEnv).Path)`"") }
  if ($Yes)       { $argList += '-Yes' }
  if ($SetDuckToken) { $argList += '-SetDuckToken' }
  if ($NoStart)   { $argList += '-NoStart' }
  Start-Process -FilePath (Get-Process -Id $PID).Path -Verb RunAs -ArgumentList $argList
  Note 'A instalacao continua na janela nova.'
  exit 0
}

try {
  # --- 1. Programs ------------------------------------------------------------------------------------------------
  $lk = Join-Path $Repo 'infra\livekit\bin\livekit-server.exe'
  $cd = Join-Path $Kit 'bin\caddy.exe'
  if (-not (Test-Path $lk)) { Die "falta $lk (rode uma vez 'node scripts/livekit.mjs' e feche com Ctrl+C)" }
  if (-not (Test-Path $cd)) { Die "falta $cd (rode 'node infra/win-sfu/fetch-caddy.mjs')" }
  if (-not $NodeExe -or -not (Test-Path $NodeExe)) { Die 'node.exe nao encontrado (passe -NodeExe <caminho>)' }
  Say "Programas: $((& $lk --version) -join ' '), caddy $(((& $cd version) -split ' ')[0]), node $(& $NodeExe --version)"

  # --- 2. Stop a previous install -----------------------------------------------------------------------------------
  if (-not $DryInstall) {
    if (Get-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue) {
      Say 'Parando a instalacao anterior'
      Stop-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue
      Start-Sleep -Seconds 2
    }
    Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith("$Dest\", [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force -ErrorAction SilentlyContinue
    # A provisional copy of this kit running from another folder (started by hand, without admin) holds the same
    # ports. It is recognised by the kit's layout: <folder>\bin\<program> with <folder>\sfu.mjs. The dev SFU
    # (infra\livekit\bin) has no sfu.mjs next to bin\ and is left alone.
    $loose = Get-Process -Name node, livekit-server, caddy -ErrorAction SilentlyContinue | Where-Object {
      $_.Path -and (Split-Path (Split-Path $_.Path) -Leaf) -eq 'bin' -and (Test-Path (Join-Path (Split-Path (Split-Path $_.Path)) 'sfu.mjs'))
    }
    if ($loose) { Say 'Parando a copia provisoria do SFU'; $loose | Sort-Object { $_.Name -ne 'node' } | Stop-Process -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 1
  }

  # --- 3. Folder, locked BEFORE anything goes in ------------------------------------------------------------------
  # C:\ProgramData lets any user create files in a new folder (a planted DLL next to node.exe would run as the
  # service). So inheritance is cut first: SYSTEM and admins full, the service account read+execute, the owner's
  # normal (non-admin) session read-only for logs and state.
  Say "Pasta $Dest"
  $sys = '*S-1-5-18'; $adm = '*S-1-5-32-544'; $svc = '*S-1-5-19'; $own = "*$OwnerSid"
  New-Item -ItemType Directory -Force $Dest | Out-Null
  if (-not $DryInstall) {
    & icacls.exe $Dest /inheritance:r /grant:r "${sys}:(OI)(CI)F" "${adm}:(OI)(CI)F" "${svc}:(OI)(CI)RX" "${own}:(OI)(CI)RX" /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { Die 'icacls falhou ao travar a pasta' }
  }
  foreach ($d in 'bin', 'run', 'logs', 'data', 'control') { New-Item -ItemType Directory -Force (Join-Path $Dest $d) | Out-Null }
  if (-not $DryInstall) {
    foreach ($d in 'run', 'logs') { & icacls.exe (Join-Path $Dest $d) /grant "${svc}:(OI)(CI)M" /Q | Out-Null }
    & icacls.exe (Join-Path $Dest 'control') /grant "${svc}:(OI)(CI)M" "${own}:(OI)(CI)M" /Q | Out-Null
    # data\ holds the TLS private keys: service and admins only.
    & icacls.exe (Join-Path $Dest 'data') /inheritance:r /grant:r "${sys}:(OI)(CI)F" "${adm}:(OI)(CI)F" "${svc}:(OI)(CI)M" /Q | Out-Null
  }
  foreach ($f in 'sfu.mjs', 'lib.mjs', 'doctor.mjs', 'router.mjs', 'livekit.win.yaml', 'caddy.win.json') { Copy-Item (Join-Path $Kit $f) -Destination $Dest -Force }
  Copy-Item $lk, $cd -Destination (Join-Path $Dest 'bin') -Force
  Copy-Item $NodeExe -Destination (Join-Path $Dest 'bin\node.exe') -Force
  $node = Join-Path $Dest 'bin\node.exe'

  # --- 4. .env (secrets: checked, never echoed) ---------------------------------------------------------------------
  $envFile = Join-Path $Dest '.env'
  $fresh = $false
  if (Test-Path $envFile) {
    Say '.env existente mantido'
    if ($SetDuckToken) {
      $t = Read-Secret 'Token DuckDNS (https://www.duckdns.org, topo da pagina)'
      if ($t) {
        $rest = @(Get-Content $envFile | Where-Object { $_ -and $_ -notmatch '^DUCKDNS_TOKEN=' })
        [IO.File]::WriteAllLines($envFile, [string[]]($rest + "DUCKDNS_TOKEN=$t"), (New-Object Text.UTF8Encoding $false))
        Say 'Token do DuckDNS gravado no .env'
      }
    }
  }
  else {
    $pairs = @{}
    if ($SeedEnv) {
      # A .env prepared beforehand (same keys). It is read here and left where it is: delete it once this works.
      Say "Usando o .env de $SeedEnv"
      foreach ($line in Get-Content $SeedEnv) { if ($line -match '^([A-Z][A-Z0-9_]*)=(.*)$') { $pairs[$Matches[1]] = $Matches[2].Trim() } }
    }
    elseif ($OldServer) {
      Say "Copiando o .env de $OldServer (digite a senha do SSH quando pedir; o conteudo nao aparece)"
      $tmp = Join-Path $Dest 'data\env.old'
      & scp.exe -o ConnectTimeout=8 "${OldServer}:alga-sfu/.env" $tmp
      if ($LASTEXITCODE -eq 0 -and (Test-Path $tmp)) {
        foreach ($line in Get-Content $tmp) { if ($line -match '^([A-Z][A-Z0-9_]*)=(.*)$') { $pairs[$Matches[1]] = $Matches[2].Trim() } }
        Remove-Item $tmp -Force
      } else { Write-Host '    Nao deu para copiar (servidor desligado, ou usuario/senha errados). Vamos digitar os valores.' -ForegroundColor Yellow }
    }
    if (-not $pairs.LIVEKIT_API_SECRET) {
      Say 'Sem .env: informe os valores (os segredos nao aparecem enquanto voce cola)'
      Note 'LIVEKIT_API_KEY / LIVEKIT_API_SECRET: Railway > servico api > Variables (o MESMO par da API).'
      Note 'DuckDNS: subdominio e token em https://www.duckdns.org (os mesmos do servidor antigo).'
      $pairs.LIVEKIT_API_KEY    = (Read-Host 'LIVEKIT_API_KEY').Trim()
      $pairs.LIVEKIT_API_SECRET = Read-Secret 'LIVEKIT_API_SECRET'
      $u = (Read-Host 'URL da API [https://api-staging-b3ea.up.railway.app]').Trim()
      $pairs.ALGA_API_URL       = if ($u) { $u } else { 'https://api-staging-b3ea.up.railway.app' }
      $pairs.DUCKDNS_SUBDOMAIN  = (Read-Host 'Subdominio DuckDNS (so o nome)').Trim()
      $pairs.DUCKDNS_TOKEN      = Read-Secret 'Token DuckDNS (Enter para deixar sem: o DNS nao sera atualizado)'
    }
    # Only what this kit uses. Not carried over: the relay secret (no coturn here) and the Linux-only settings.
    $lines = foreach ($k in 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'ALGA_API_URL', 'DUCKDNS_SUBDOMAIN', 'DUCKDNS_TOKEN') { if ($pairs[$k]) { "$k=$($pairs[$k])" } }
    [IO.File]::WriteAllLines($envFile, [string[]]$lines, (New-Object Text.UTF8Encoding $false))
    $fresh = $true
  }
  if (-not $DryInstall) { & icacls.exe $envFile /inheritance:r /grant:r "${sys}:F" "${adm}:F" "${svc}:R" /Q | Out-Null }
  Push-Location $Dest
  try {
    $check = & $node -e "import('./lib.mjs').then(m=>{const c=m.checkEnv(m.readEnv('.env'));console.log('dominio '+c.domain+', API '+c.api+', chave '+c.key)}).catch(e=>{console.log('INVALIDO: '+e.message);process.exit(1)})"
    if ($LASTEXITCODE -ne 0) { if ($fresh) { Remove-Item $envFile -Force }; Die ".env: $check" }
    Say ".env completo: $check"
  } finally { Pop-Location }

  if ($DryInstall) { Say "DryInstall pronto em $Dest (sem firewall, sem tarefa)"; exit 0 }

  # --- 5. Windows Firewall: one rule per program, only its ports ----------------------------------------------------
  # The loopback-only ports (7870 signaling, 5349 TURN behind Caddy) get no rule, so they stay closed to the network.
  Say 'Firewall do Windows: 3 regras de entrada'
  Get-NetFirewallRule -Group $Group -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  # Leftovers of the kit's local tests: "Allow" answers to the Windows Security Alert for copies in a temp folder
  # (any port, any origin). Nothing should keep running from there once this install is in place.
  Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue | Where-Object { $_.Program -match '\\scratchpad\\[^\\]+\\bin\\(livekit-server|caddy)\.exe$' } | ForEach-Object { $_ | Get-NetFirewallRule | Remove-NetFirewallRule }
  $caddyExe = Join-Path $Dest 'bin\caddy.exe'; $lkExe = Join-Path $Dest 'bin\livekit-server.exe'
  New-NetFirewallRule -DisplayName 'Alga Meet SFU - Caddy (TCP 80, 443)' -Group $Group -Direction Inbound -Action Allow -Profile Any -Program $caddyExe -Protocol TCP -LocalPort 80, 443 | Out-Null
  New-NetFirewallRule -DisplayName 'Alga Meet SFU - LiveKit (TCP 7881)' -Group $Group -Direction Inbound -Action Allow -Profile Any -Program $lkExe -Protocol TCP -LocalPort 7881 | Out-Null
  New-NetFirewallRule -DisplayName 'Alga Meet SFU - LiveKit (UDP 7882, 3478)' -Group $Group -Direction Inbound -Action Allow -Profile Any -Program $lkExe -Protocol UDP -LocalPort 7882, 3478 | Out-Null

  # --- 6. Scheduled task --------------------------------------------------------------------------------------------
  # LocalService: the internet-facing processes cannot read the owner's profile. AtStartup: voice comes back after a
  # Windows Update reboot with nobody logged in. Priority 4 (normal): tasks default to 7, below normal, which is
  # wrong for real-time media.
  Say "Tarefa agendada '$Task' (sobe no boot, conta LocalService)"
  $svcName   = (New-Object Security.Principal.SecurityIdentifier 'S-1-5-19').Translate([Security.Principal.NTAccount]).Value
  $action    = New-ScheduledTaskAction -Execute $node -Argument 'sfu.mjs' -WorkingDirectory $Dest
  $trigger   = New-ScheduledTaskTrigger -AtStartup
  $principal = New-ScheduledTaskPrincipal -UserId $svcName -LogonType ServiceAccount -RunLevel Limited
  $settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -Priority 4
  Register-ScheduledTask -TaskName $Task -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force `
    -Description 'Alga Meet: SFU de voz e tela (LiveKit + Caddy + DuckDNS + UPnP). Kit: infra/win-sfu no repositorio.' | Out-Null

  if ($NoStart) { Say 'Instalado, NAO iniciado (-NoStart). Para iniciar: Start-ScheduledTask AlgaMeetSFU'; Done; exit 0 }

  # --- 7. Cutover ---------------------------------------------------------------------------------------------------
  Push-Location $Dest
  try {
    Say 'Roteador: quem recebe as portas hoje'
    & $node router.mjs status
    if ($LASTEXITCODE -eq 3) {
      Write-Host '    As portas ainda apontam para outra maquina (o servidor antigo).' -ForegroundColor Yellow
      if ($Yes -or ((Read-Host '    Passar as portas para este PC agora? [s/N]') -match '^[sSyY]')) {
        # Removes the old server's forwardings only if it no longer answers on 443; a live SFU makes it refuse (exit 3).
        & $node router.mjs takeover
        if ($LASTEXITCODE -eq 3) {
          Note 'O SFU de la esta no ar. Para este PC assumir ele precisa parar: a voz cai por cerca de 1 minuto.'
          if ($OldServer -and ((Read-Host "    Parar o SFU em $OldServer agora? [s/N]") -match '^[sSyY]')) {
            & ssh.exe $OldServer 'cd ~/alga-sfu && docker compose --profile cinema down -t 60'
            if ($LASTEXITCODE -ne 0) { Write-Host '    O ssh falhou: pare o SFU no servidor antigo a mao (docker compose --profile cinema down).' -ForegroundColor Yellow }
            Start-Sleep -Seconds 3
            & $node router.mjs takeover
          }
        }
      }
      & $node router.mjs status
      if ($LASTEXITCODE -eq 3) {
        # Measured on the owner's Huawei: only the machine that created a forwarding may delete or replace it
        # (714 / 718 to anyone else), so a dead server's entries cannot be removed from here.
        Note 'Continuam com o servidor antigo: este roteador so deixa apagar quem criou.'
        Note 'Elas vencem sozinhas em ate 1 h depois que o SFU de la parou, e o SFU daqui assume em seguida.'
        Note 'Para ja: reinicie o roteador, ou apague as entradas "alga-sfu" na pagina dele (UPnP / Port Mapping).'
      }
    }
    Say 'Iniciando'
    Start-ScheduledTask -TaskName $Task
    Note 'Esperando 45 s (encaminhar portas, DuckDNS, certificados)...'
    Start-Sleep -Seconds 45
    & $node doctor.mjs
  } finally { Pop-Location }
  Write-Host ''
  Say 'Para conferir de novo, sem admin:  node infra/win-sfu/doctor.mjs'
  Done
} catch {
  Die $_.Exception.Message
}
