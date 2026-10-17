# Auto-deploy for the n8n box: every minute, fast-forward this checkout to origin/main and apply the change.
# Git runs on Windows (it has the GitHub login and matches this checkout's line endings); the Docker work runs in
# WSL (apply.sh). It never touches a checkout that is on another branch or has uncommitted changes.
# Started hidden at logon by the ArakMarketingAutoDeploy task (auto-deploy.vbs).
# Log: %LOCALAPPDATA%\ArakMarketing\auto-deploy.log
# -Repo points it at another checkout (a first run from a copy that is not on main yet).
param([switch]$Loop, [string]$Repo = (Join-Path $PSScriptRoot '..\..'))

$Repo = (Resolve-Path $Repo).Path
$StateDir = Join-Path $env:LOCALAPPDATA 'ArakMarketing'
$Log = Join-Path $StateDir 'auto-deploy.log'
$StateFile = Join-Path $StateDir 'deployed-commit'
$FailedFile = Join-Path $StateDir 'failed-commit'
$Git = 'C:\Program Files\Git\cmd\git.exe'
$env:GIT_TERMINAL_PROMPT = '0'
# apply.sh prints workflow names with en dashes; read wsl.exe's output as the UTF-8 it is.
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
New-Item -ItemType Directory -Force $StateDir | Out-Null
$script:LastSkip = ''

function Write-Log($Message) {
    if ((Test-Path $Log) -and (Get-Item $Log).Length -gt 1MB) { Move-Item $Log "$Log.old" -Force }
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message" | Out-File -FilePath $Log -Append -Encoding utf8
}

function Skip($Reason) {
    # Logged once per reason, not every minute.
    if ($script:LastSkip -ne $Reason) { Write-Log "waiting: $Reason"; $script:LastSkip = $Reason }
}

function Read-State($Path) {
    if (Test-Path $Path) { (Get-Content $Path -Raw).Trim() } else { '' }
}

function ConvertTo-WslPath($Path) {
    '/mnt/' + $Path.Substring(0, 1).ToLower() + ($Path.Substring(2) -replace '\\', '/')
}

function Invoke-Once {
    & $Git -C $Repo fetch --quiet origin main
    if ($LASTEXITCODE -ne 0) { Skip 'git fetch failed (offline or no GitHub login?)'; return }
    $branch = (& $Git -C $Repo rev-parse --abbrev-ref HEAD).Trim()
    $head = (& $Git -C $Repo rev-parse HEAD).Trim()
    $remote = (& $Git -C $Repo rev-parse origin/main).Trim()

    # First run: what is checked out now is taken as what is deployed, so anything
    # pulled from here on gets deployed, including the first pull.
    if (-not (Read-State $StateFile)) { Set-Content $StateFile $head; Write-Log "baseline $($head.Substring(0, 7))" }

    if ($head -ne $remote) {
        if ($branch -ne 'main') { Skip "the checkout is on branch $branch, not main"; return }
        if (& $Git -C $Repo status --porcelain --untracked-files=no) { Skip 'the checkout has uncommitted changes'; return }
        & $Git -C $Repo merge --ff-only --quiet origin/main
        if ($LASTEXITCODE -ne 0) { Skip 'main cannot fast-forward to origin/main (local commits?)'; return }
        Write-Log "pulled $($head.Substring(0, 7)) -> $($remote.Substring(0, 7))"
        $head = $remote
    }
    $script:LastSkip = ''

    $deployed = Read-State $StateFile
    if ($deployed -eq $head) { return }
    # A failed deploy is not retried every minute (each try can restart n8n). The next push
    # retries the whole range from the last good deploy.
    if ((Read-State $FailedFile) -eq $head) { return }

    Write-Log "deploying $($deployed.Substring(0, 7)) -> $($head.Substring(0, 7))"
    # The apply.sh just pulled, not the one this loop started with.
    $applyPath = ConvertTo-WslPath (Join-Path $Repo 'n8n\deploy\apply.sh')
    $output = & wsl.exe -d Ubuntu -- bash $applyPath $deployed $head 2>&1
    $code = $LASTEXITCODE
    $output | ForEach-Object { Write-Log "  $_" }
    if ($code -eq 0 -or $code -eq 3) {
        Set-Content $StateFile $head
        Write-Log $(if ($code -eq 0) { "deployed $($head.Substring(0, 7))" } else { "deployed $($head.Substring(0, 7)) but a container is NOT healthy" })
    } else {
        Set-Content $FailedFile $head
        Write-Log "deploy FAILED (exit $code); not retrying $($head.Substring(0, 7)), the next push will. To retry now: delete $FailedFile"
    }
}

if ($Loop) {
    $mutex = New-Object System.Threading.Mutex($false, 'Global\ArakMarketingAutoDeploy')
    if (-not $mutex.WaitOne(0)) { exit 0 }   # another loop is already running
    Write-Log "auto-deploy started for $Repo"
    while ($true) {
        try { Invoke-Once } catch { Write-Log "error: $_" }
        Start-Sleep -Seconds 60
    }
} else {
    Invoke-Once
}
