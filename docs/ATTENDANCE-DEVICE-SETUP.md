# Connecting a fingerprint device to attendance (v2)

2026-10-28. How a ZKTeco terminal in the office feeds HR → Attendance. The
screens only say what is wrong; how to set it up is here.

## How it works

A small program, the **bridge**, runs on a Windows computer in the office,
on the same network as the device. It works like this:

- Every 5 minutes it reads the device, **read only**. It never writes to the
  device or clears it.
- It sends the new punches and the device's user list to Arak.
- It proves who it is with the device's own key, never a person's login.
- Arak keeps each punch once, so sending the same punches again is always
  safe.

The program is in [`tools/attendance-bridge`](../tools/attendance-bridge).

On the Arak side, the database function `hr_device_sync(device_key, payload)`
receives each batch
([`20261128_attendance_2_devices.sql`](../supabase/migrations/20261128_attendance_2_devices.sql)).
It finds the device by its key and refuses anything else. It accepts at most
60 batches a minute from one device. It then pairs each day: the first punch
is the arrival and the last punch is the departure. Finally it records late
arrivals and early leaves.

## What you need

- **The computer.** Windows, on the office network, with internet. It stays
  on during work hours. If it is off, the punches wait in the device and go
  with the next run.
- **The vendor's SDK.** The ZKTeco Standalone SDK, installed and registered:
  `zkemkeeper.dll`, the 32-bit version. The bridge starts itself in 32-bit
  PowerShell.
- **Arak's address and public key.** The Supabase address (`ServerUrl`) and
  its public anon key (`ApiKey`). The anon key is the same one the web app
  uses. It is safe to give out, because the device key is what proves the
  device.

## Install (PowerShell as Administrator)

1. Copy `tools/attendance-bridge` to `C:\ArakAttendanceBridge`. Then let
   only administrators and SYSTEM read it:

   ```
   icacls C:\ArakAttendanceBridge /inheritance:r /grant "Administrators:(OI)(CI)F" /grant "SYSTEM:(OI)(CI)F"
   ```

2. Copy `bridge.config.example.json` to `bridge.config.json` and fill in the
   fields:
   - `ServerUrl`
   - `ApiKey`
   - the device's `DeviceIp` and `DevicePort` (4370 by default)
   - `CommKey`, if the device has a communication password (0 means none)
3. In Arak, open **HR → Attendance → Records → Devices and linking →
   Register a device**. This needs HR at Manage level.
   - Give the device a name, and the time zone of its clock (Asia/Riyadh).
   - **Copy the key.** It is shown once.
4. Run `.\arak-attendance-bridge.ps1 -SetKey` and paste the key. It is
   stored encrypted for this computer only.
5. Run `.\arak-attendance-bridge.ps1 -Test`. It shows the model, the clock,
   the users and the last punches, and sends nothing.
6. Run `.\arak-attendance-bridge.ps1 -Full` once. This first load sends
   every punch on the device.
7. Run `.\arak-attendance-bridge.ps1 -Install`. This creates the scheduled
   task, which runs every 5 minutes as SYSTEM.
8. In Arak, on the same Devices screen, link each number on the device to
   its employee and press **Save links**. The days already received are
   paired right away.

## Day to day

- **The log.** `bridge.log`, in the same folder, gets one line per run that
  sends something. Errors are marked `[ERROR]`.
- **What each run sends.** Each run sends the punches since the last run,
  with an hour of overlap. Once a day it sends the last 7 days again.
- **Keeping in touch.** At least once an hour it sends an empty batch, so
  Arak shows "Last sync" and judges yesterday's early leaves.
- **A new key.** Pressing **New key** in Arak stops the old key at once.
  Then run `-SetKey` again with the new one.
- **Stopping the device.** **Stop** in Arak refuses everything from the
  device until it is started again.
- **When the bridge cannot reach Arak.** Run
  `.\arak-attendance-bridge.ps1 -Csv C:\temp\punches.csv`. Then press
  **Upload a file of punches** on the device's card in Arak.
- **Removing the scheduled task.** Run
  `.\arak-attendance-bridge.ps1 -Uninstall`.

## Not tested yet

The bridge is written from the vendor's SDK manual. It has not been run
against a real terminal yet.

The server side was tested end to end on the local v2 database:

- a batch sent to the key with no login;
- a wrong key, which was refused;
- duplicate punches, which were kept once;
- punches with a time in the future, which were refused;
- linking a number, which paired that employee's days;
- lateness, which was recorded.

Try `-Test` on the real device first.
