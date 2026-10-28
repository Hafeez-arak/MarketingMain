<#
.SYNOPSIS
    Arak attendance bridge (v2): reads a ZKTeco fingerprint device on the office network, READ ONLY,
    and sends its punches and user list to Arak with the device's own key.

.DESCRIPTION
    2026-10-28, docs/ATTENDANCE-DEVICE-SETUP.md. The server side is the database function
    hr_device_sync(device_key, payload) (supabase/migrations/20261128_attendance_2_devices.sql): it
    finds the device by its key, keeps each punch once (sending again is always safe), pairs the
    days and flags late arrivals and early leaves.

    The device is read through the vendor's Standalone SDK COM object (zkemkeeper.ZKEM.1, 32-bit):
    Connect_Net, ReadAllUserID / SSR_GetAllUserInfo, ReadGeneralLogData / SSR_GetGeneralLogData,
    GetSerialNumber, GetProductCode, GetFirmwareVersion, GetDeviceTime, Disconnect. Nothing that
    writes to or clears the device is ever called.

    Each run sends the punches newer than the last one sent, minus an hour of overlap; once a day it
    sends the last 7 days again; at least once an hour it sends an empty batch, so Arak shows the
    last contact (and judges yesterday's early leaves).

.PARAMETER SetKey     Ask for the device key from Arak and store it encrypted for this computer.
.PARAMETER Test       Read the device and show what it holds; send nothing.
.PARAMETER Full       Send every punch on the device (the first load).
.PARAMETER Csv        Write the device's punches to this CSV file instead of sending (to upload by hand).
.PARAMETER Install    Create the scheduled task (every 5 minutes, as SYSTEM).
.PARAMETER Uninstall  Remove the scheduled task.
#>
param(
    [switch]$SetKey,
    [switch]$Test,
    [switch]$Full,
    [string]$Csv,
    [switch]$Install,
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigFile = Join-Path $Here 'bridge.config.json'
$KeyFile = Join-Path $Here 'device.key'
$StateFile = Join-Path $Here 'bridge.state.json'
$LogFile = Join-Path $Here 'bridge.log'
$TaskName = 'Arak attendance bridge'

function Log([string]$Text, [string]$Level = 'INFO') {
    $line = '{0} [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Text
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
    if ($Level -eq 'ERROR') { Write-Host $line -ForegroundColor Red } else { Write-Host $line }
}

# The SDK is 32-bit: a 64-bit PowerShell starts itself again in 32-bit.
if ([Environment]::Is64BitProcess -and -not ($Install -or $Uninstall -or $SetKey)) {
    $ps32 = Join-Path $env:WINDIR 'SysWOW64\WindowsPowerShell\v1.0\powershell.exe'
    $args32 = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $MyInvocation.MyCommand.Path)
    if ($Test) { $args32 += '-Test' }
    if ($Full) { $args32 += '-Full' }
    if ($Csv) { $args32 += @('-Csv', $Csv) }
    & $ps32 @args32
    exit $LASTEXITCODE
}

function Get-Config {
    if (-not (Test-Path $ConfigFile)) { throw "Copy bridge.config.example.json to bridge.config.json and fill it in." }
    $c = Get-Content $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($k in 'ServerUrl', 'ApiKey', 'DeviceIp') { if (-not $c.$k) { throw "bridge.config.json needs $k." } }
    if (-not $c.DevicePort) { $c | Add-Member DevicePort 4370 }
    if (-not $c.MachineNumber) { $c | Add-Member MachineNumber 1 }
    if ($null -eq $c.CommKey) { $c | Add-Member CommKey 0 }
    if (-not $c.BatchSize) { $c | Add-Member BatchSize 1000 }
    return $c
}

# The key is encrypted with Windows DPAPI for this computer (LocalMachine), so the SYSTEM task can read it
# and no other computer can.
Add-Type -AssemblyName System.Security
function Save-DeviceKey([string]$Key) {
    if ($Key -notmatch '^ARK1-[0-9a-f-]{36}-[0-9A-Za-z]{40}$') { throw 'That is not a device key from Arak (ARK1-…).' }
    $bytes = [Text.Encoding]::UTF8.GetBytes($Key)
    $sealed = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, 'LocalMachine')
    [IO.File]::WriteAllBytes($KeyFile, $sealed)
}
function Get-DeviceKey {
    if (-not (Test-Path $KeyFile)) { throw 'No device key yet: run with -SetKey.' }
    $bytes = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($KeyFile), $null, 'LocalMachine')
    return [Text.Encoding]::UTF8.GetString($bytes)
}

function Get-State {
    if (Test-Path $StateFile) { return Get-Content $StateFile -Raw -Encoding UTF8 | ConvertFrom-Json }
    return [pscustomobject]@{ LastPunch = $null; LastSend = $null; LastWeekly = $null }
}
function Save-State($State) { $State | ConvertTo-Json | Set-Content $StateFile -Encoding UTF8 }

function Format-Time([int]$Y, [int]$Mo, [int]$D, [int]$H, [int]$Mi, [int]$S) {
    return '{0:D4}-{1:D2}-{2:D2} {3:D2}:{4:D2}:{5:D2}' -f $Y, $Mo, $D, $H, $Mi, $S
}

# Everything the device holds, read only.
function Read-Device($Config) {
    $zk = New-Object -ComObject 'zkemkeeper.ZKEM.1'
    $m = [int]$Config.MachineNumber
    if ([int]$Config.CommKey -ne 0) { [void]$zk.SetCommPassword([int]$Config.CommKey) }
    if (-not $zk.Connect_Net([string]$Config.DeviceIp, [int]$Config.DevicePort)) {
        $err = 0; [void]$zk.GetLastError([ref]$err)
        throw "Cannot reach the device at $($Config.DeviceIp):$($Config.DevicePort) (SDK error $err)."
    }
    try {
        $serial = ''; [void]$zk.GetSerialNumber($m, [ref]$serial)
        $model = ''; [void]$zk.GetProductCode($m, [ref]$model)
        $firmware = ''; [void]$zk.GetFirmwareVersion($m, [ref]$firmware)
        $y = 0; $mo = 0; $d = 0; $h = 0; $mi = 0; $s = 0
        $clock = if ($zk.GetDeviceTime($m, [ref]$y, [ref]$mo, [ref]$d, [ref]$h, [ref]$mi, [ref]$s)) { Format-Time $y $mo $d $h $mi $s } else { $null }

        $users = New-Object System.Collections.ArrayList
        if ($zk.ReadAllUserID($m)) {
            $no = ''; $name = ''; $pw = ''; $priv = 0; $enabled = $false
            while ($zk.SSR_GetAllUserInfo($m, [ref]$no, [ref]$name, [ref]$pw, [ref]$priv, [ref]$enabled)) {
                [void]$users.Add([ordered]@{ no = "$no".Trim(); name = "$name".Trim([char]0, ' '); enabled = [bool]$enabled })
            }
        }

        $punches = New-Object System.Collections.ArrayList
        if ($zk.ReadGeneralLogData($m)) {
            $no = ''; $verify = 0; $inout = 0; $wc = 0
            while ($zk.SSR_GetGeneralLogData($m, [ref]$no, [ref]$verify, [ref]$inout, [ref]$y, [ref]$mo, [ref]$d, [ref]$h, [ref]$mi, [ref]$s, [ref]$wc)) {
                [void]$punches.Add([ordered]@{ user_no = "$no".Trim(); time = (Format-Time $y $mo $d $h $mi $s); verify = $verify; inout = $inout; workcode = $wc })
            }
        }
        return [pscustomobject]@{ Device = [ordered]@{ serial = $serial; model = $model; firmware = $firmware; time = $clock }; Users = $users; Punches = $punches }
    } finally {
        $zk.Disconnect()
    }
}

function Send-Batch($Config, [string]$Key, $Device, $Users, $Punches) {
    $body = @{ device_key = $Key; payload = @{ device = $Device; users = $Users; punches = @($Punches) } } | ConvertTo-Json -Depth 6 -Compress
    $url = ($Config.ServerUrl.TrimEnd('/')) + '/rest/v1/rpc/hr_device_sync'
    $headers = @{ apikey = $Config.ApiKey; 'Content-Type' = 'application/json; charset=utf-8' }
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    try {
        return Invoke-RestMethod -Method Post -Uri $url -Headers $headers -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 120
    } catch {
        $msg = $_.ErrorDetails.Message
        if (-not $msg) { $msg = $_.Exception.Message }
        throw "Arak refused the batch: $msg"
    }
}

# ── The modes ──
try {
    if ($Uninstall) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
        Log 'Scheduled task removed.'
        exit 0
    }
    if ($Install) {
        $ps32 = Join-Path $env:WINDIR 'SysWOW64\WindowsPowerShell\v1.0\powershell.exe'
        $action = New-ScheduledTaskAction -Execute $ps32 -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$($MyInvocation.MyCommand.Path)`""
        $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)
        $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 4) -StartWhenAvailable
        Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
        Log 'Scheduled task created: every 5 minutes, as SYSTEM.'
        exit 0
    }
    if ($SetKey) {
        $secure = Read-Host 'Paste the device key from Arak' -AsSecureString
        $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
        Save-DeviceKey $plain.Trim()
        Log 'Device key stored (encrypted for this computer).'
        exit 0
    }

    $config = Get-Config
    $read = Read-Device $config

    if ($Test) {
        Write-Host ("Device: {0} {1} firmware {2}, clock {3}" -f $read.Device.model, $read.Device.serial, $read.Device.firmware, $read.Device.time)
        Write-Host ("Users: {0}. Punches: {1}." -f $read.Users.Count, $read.Punches.Count)
        $read.Punches | Select-Object -Last 5 | ForEach-Object { Write-Host ("  #{0} {1}" -f $_.user_no, $_.time) }
        exit 0
    }
    if ($Csv) {
        $read.Punches | ForEach-Object { [pscustomobject]$_ } | Select-Object user_no, time, verify, inout, workcode |
            Export-Csv -Path $Csv -NoTypeInformation -Encoding UTF8
        Log "Wrote $($read.Punches.Count) punches to $Csv; upload it on the device's row in Arak."
        exit 0
    }

    $key = Get-DeviceKey
    $state = Get-State
    $now = Get-Date
    $weekly = $Full -or -not $state.LastWeekly -or ([datetime]$state.LastWeekly).Date -lt $now.Date
    $since = if ($Full) { '' } elseif ($weekly) { $now.AddDays(-7).ToString('yyyy-MM-dd HH:mm:ss') }
             elseif ($state.LastPunch) { ([datetime]$state.LastPunch).AddHours(-1).ToString('yyyy-MM-dd HH:mm:ss') } else { '' }
    $todo = @($read.Punches | Where-Object { $since -eq '' -or $_.time -ge $since } | Sort-Object { $_.time })
    $due = -not $state.LastSend -or ($now - [datetime]$state.LastSend).TotalMinutes -ge 60

    if ($todo.Count -eq 0 -and -not $due) { exit 0 }
    $sent = 0; $new = 0
    $parts = [Math]::Max(1, [Math]::Ceiling($todo.Count / [int]$config.BatchSize))
    for ($i = 0; $i -lt $parts; $i++) {
        $part = @($todo | Select-Object -Skip ($i * [int]$config.BatchSize) -First ([int]$config.BatchSize))
        # The user list goes with the first part only.
        $users = if ($i -eq 0) { $read.Users } else { $null }
        $r = Send-Batch $config $key $read.Device $users $part
        $sent += $part.Count; $new += [int]$r.inserted
        if ([int]$r.rejected -gt 0) { Log ("{0} punches refused as in the future (check the device clock): {1}" -f $r.rejected, ($r.rejected_examples -join ', ')) 'WARN' }
    }
    if ($todo.Count) { $state.LastPunch = ($todo | Select-Object -Last 1).time }
    $state.LastSend = $now.ToString('s')
    if ($weekly) { $state.LastWeekly = $now.ToString('s') }
    Save-State $state
    Log ("Sent {0} punches ({1} new), {2} users." -f $sent, $new, $read.Users.Count)
} catch {
    Log $_.Exception.Message 'ERROR'
    exit 1
}
