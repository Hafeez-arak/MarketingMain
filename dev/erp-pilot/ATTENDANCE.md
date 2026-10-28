# Attendance: Musa's in full, rewritten in our stack (v2)

2026-10-28, branch `v2-attendance` (from `v2` at e0e4cea). The owner asked
for it: "there was a lot to attendance in Musa's app". The first HR port
(HR.md) kept a simplified attendance: one row per person per day, with a
status. This pass brings his whole attendance across, with no extras. It
follows the owner's exact-parity rule.

Local only, on the v2 database in `dev/v2db`.

## What his app does, and where it is now

| His | Ours |
|---|---|
| **Records:** check-in and check-out sessions, several a day, one open at a time, no overlaps, at most 24 hours, never in the future, only for an active employee, never on approved leave | `hr_attendance`, rebuilt as sessions (`20261128_attendance_1_sessions.sql`), with the same rules in `hr_attendance_guard` |
| **Where a record came from:** manual, device or corrected. The pairing alone writes device records; a person's change makes a record "corrected", and it is never paired again | `source` and `device_day`, guarded by `hr_attendance_source_guard` |
| **Correcting a record:** his form asks for the reason | `hr_attendance_update()` needs the reason and keeps before and after in `hr_attendance_changes` (his general audit log, for these records) |
| **No deleting** a record | No delete policy (the first port had a Manage delete; it is gone) |
| **The board's check-in/out button:** none while a device runs | `hr_attendance_toggle()` refuses while a running device covers that person |
| **Settings:** work days and daily hours (required); start, end, grace and the date it applies from (all four or none); the repeat-punch minutes; the employee-email switch, with who changed it and when | `hr_settings` columns plus the `hr_settings_schedule` check. The switch is guarded by `hr_settings_guard` |
| **Devices:** time zone, a key kept as SHA-256 only and shown once, rotated, stopped (never deleted); the device's user list; syncs; punches kept exactly as sent, never changed, duplicates ignored, the future refused; the employee's device number, locked once the device made records | `hr_devices` (the key hash is never readable), `hr_device_users`, `hr_device_syncs`, `hr_punches`, `hr_employees.device_user_no` (`20261128_attendance_2_devices.sql`) |
| **Pairing:** first punch in, last out. These states: one punch or repeat → single; a hand record that day → manual; inactive or before hire → inactive / before_hire; on leave → on_leave; refused by the rules → conflict | `hr_attendance_apply_day` / `_sync` / `_employee` and the view `hr_punch_days` |
| **The bridge API:** `POST /api/attendance/device/sync`, authenticated by the device key, rate-limited | `hr_device_sync(device_key, payload)`, open to anonymous callers, with the key checked inside and 60 batches a minute at most. No new `api/` file |
| **CSV upload** | Read in the browser (`parseCsv`), then `hr_device_upload()` in parts of 2,000 |
| **Linking numbers** to employees, then pairing and flagging those employees' days | `hr_device_link()` |
| **Retrying** an employee's days | `hr_attendance_retry()` |
| **Late and early leave:** late counts from the start once it is past the grace; early is the last punch before the end, judged once the day is over. Only work days, from the schedule's date, inside the employment, not on leave. The record never changes; the email status only moves forward; an excuse is added once, with its reason | `hr_attendance_flags`, `hr_attendance_flag_day` / `_sync` / `_employee`, `hr_attendance_excuse()` (`20261128_attendance_3_flags.sql`) |
| **Email status:** pending, sent, failed, no email, past, off | The same. In v2 the switch cannot be turned on: `hr_mailbox_ready()` is false until the HR mailbox is connected (see "Waiting") |
| **Screens:** Today; Records (with the manual form, the settings, the month summary, filters and grouping, corrections); Punch log (periods, what each punch counts as, repeats, unlinked numbers, late and early shown on the punch); Late and early (the month per employee, filters, excuses); Daily report (print, Excel); Monthly sheet (print); Device-day review; Devices; Everyone on the device | `src/pages/hr/attendance/`: Today, Records, PunchLog, Flags, Reports (daily and monthly), Devices (review, devices, everyone). The routes are `/hr/attendance/*`. His four tabs, with the sub-screens reached from Records |
| **His AttendanceDay and PunchRoles** | `src/lib/hr/attendance.js` (`buildDays`, `sheetTotals`, `monthSummary`, `punchRoles`) |
| **Excel** | `src/lib/xlsx.js`, a small writer that produces stored zips; no package |
| **The office bridge** (PowerShell, his code) | Ours, written fresh from the vendor's SDK manual: `tools/attendance-bridge/`. Setup is in `docs/ATTENDANCE-DEVICE-SETUP.md` |

The work week moved from **HR settings** to **Attendance → Records**, where
he keeps it. HR settings now holds only the leave types and a pointer to
Attendance. The employee page's "attendance this month" reads the new
records through the same day builder.

## Waiting on purpose

- **Late and early-leave emails.** He sends them from the HR mailbox through
  Microsoft Graph, and his own switch is off too ("keep it turned off until
  we do it"). Ours records everything with its email status and refuses to
  turn the switch on until `hr_mailbox_ready()` says the mailbox is
  connected. Still to build: the mailbox connection, a sender that runs
  after each sync, and the test email.
- **The project worked at** (his `attendances.project_id`). This waits for
  the Projects module.
- **The bridge on a real terminal.** It has not been run against one yet;
  try `-Test` first.

## The first port's rows

Migration 1 keeps every row of the old one-per-day table, unchanged, in
`hr_attendance_day_records`, and its history in `hr_attendance_changes_day`.
Both are closed to the app. Present and late days that had a departure (and
today's open ones) were copied in as sessions. Days with no departure were
not copied: as sessions they would stay "in" for ever and overlap every later
day. Absent rows were not copied either: absence is not a record in his
model.

## Checks

- **Database:** `dev/erp-pilot/hr/run-tests.sh` runs 133 checks, rolled back
  afterwards. They cover:
  - the session rules, corrections and the board button;
  - the key: shown once, its hash unreadable, a wrong key refused,
    rotation, stop;
  - punches: unreadable ones refused, duplicates, the future, punches final
    even below the app;
  - linking and pairing states, the corrected lock, the device-number lock,
    company separation;
  - flags, excuses and the email switch.
- **Browser:** the day builder, the month figures, punch roles, periods and
  CSV (22 tests), and the Excel writer (3).
- **In the running app (:5185), with real flows:**
  - **Device:** registered in the app; a batch sent to its key with curl
    exactly as the bridge does; a wrong key refused.
  - **Linking:** numbers linked in the app, which paired 17 days.
  - **Settings:** saved in the app.
  - **Lateness:** recalculated on the next sync.
  - **Correction:** a device record corrected in the app became
    "corrected".
  - **Every screen**, in English and Arabic.
  - **View-only HR (staff.dev@):** sees no write controls; the devices page
    is refused. The grant was removed afterwards.
  - **Phone width:** no sideways scroll.

## Decisions for the owner (safe and reversible)

1. **The work week lives under Attendance → Records**, as in his app.
2. **View sees all attendance screens except Devices.** He gives the same
   to anyone with `hr.attendance`. Corrections and the button need Work;
   devices, linking, settings, retry and excuses need Manage.
3. **The first port's past days with no departure were not carried over.**
   They are kept apart; see above.
