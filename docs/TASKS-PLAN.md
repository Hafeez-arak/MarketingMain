# Tasks, follow-ups and meetings (v2)

Written 2026-10-19 on the owner's ask: "we had a meeting with the sales team,
we assign the tasks, then the follow-ups, reminders, deadlines, all reminded
through the application. Task management, basically."

Built in v2 only, on the local database (dev/v2db). v1 is untouched.

## The everyday flow

1. **The meeting.** Someone opens *Tasks → Meetings → New meeting*: a title,
   a date, who was there, and notes. They type the action items as they are
   agreed, one line each, with who does it and by when.
2. **Saving assigns.** Each action item becomes a task in that person's
   list. The bell tells them straight away: "Sami gave you a task: Send the
   revised quote to Falcon Interiors, due Thursday."
3. **Everyone works from My tasks.** Grouped as Overdue, Today, This week,
   Later and No date. A tick finishes a task. Opening one shows its details,
   a status (To do, In progress, Waiting, Done), comments, its history, and
   *Add a follow-up*, which creates the next task already linked to this one.
4. **The app does the chasing.**
   - Each task can have a reminder: at the due time, 1 hour before, 1 day
     before, or a chosen time.
   - **Due soon:** 24 hours before the deadline, the person doing it is
     reminded.
   - **Overdue:** when the deadline passes, the person doing it and the
     person who set it are both told, once.
   - **Every morning (08:00 Riyadh):** each person gets one summary in the
     bell, and by email where a company mailbox can send: overdue, due today,
     and due this week.
5. **Following up.** *I assigned* lists everything a person gave others,
   with its status, so a manager sees what is late without asking. *Team*
   (for whoever manages the section, and the admin) shows open, overdue and
   done-this-week per person. A meeting's page shows its action items and
   where each stands, ready for the next meeting.
6. **The sales team** sees the same *My tasks* inside their own Leads app,
   and any lead can get a follow-up task ("Call back Sunday about the
   revised quote") that links back to it.

## Rules

- **Who can be given tasks:** everyone in the company, members and the
  sales team's seats. Anyone can set a task for anyone there.
- **Who sees a task:** the person doing it, the person who set it, whoever
  manages that task's section (Sales or Marketing, a v2 grant), whoever
  manages the CEO section (oversight of everything), and the admin. Nobody
  else.
- **Who changes it:** the person doing it moves its status and comments.
  The person who set it, a section manager or the admin can change
  anything. Only the setter or the admin deletes it.
- **Everything is written down.** Created, assigned, status changes, due
  date moves and comments go into the task's history, written by the
  database itself (a trigger), whoever made the change.
- **Reminders are sent once.** Each kind is sent once per deadline. Moving
  the deadline re-arms them.

## Pieces

| Piece | Where |
|---|---|
| Tables `meetings`, `tasks`, `task_events`; who-can-see rules; history and notification triggers | `supabase/migrations/20261102_tasks.sql` |
| Due buckets, labels, reminder planning, daily digest (pure, tested) | `src/lib/tasks/logic.js` |
| Reads and writes from the browser (the database rules decide) | `src/lib/tasks/client.js` |
| Reminder round: due soon, overdue, the morning digest | `api/leads/_tasks.js`, run by the 5-minute heartbeat and the daily job |
| Screens: My tasks, I assigned, Team, Meetings, task panel | `src/pages/tasks/` |
| In the sales team's app | the Leads app's side bar |
| On Home | "Today" (my overdue and due today) |

## Later

- The assistant reading and creating tasks ("what's late for Omar?", "give
  Lina a follow-up for Friday").
- Repeating tasks (weekly reports).
- WhatsApp reminders, once WhatsApp exists.
