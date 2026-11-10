# TaskAI

Turn screenshots, voice notes, photos and messages into tasks you can share.

**Stack:** Next.js on Vercel · Supabase (Postgres, Auth, Realtime, Storage, Edge Functions) · PWA first, Capacitor native apps later.

## Phase 1 (this version)

- Email sign-in link
- Add tasks from the "Search or add anything" bar; the same bar filters the list
- Swipe a task in the reading direction: Done or Snooze; after Done, choose Archive or Delete
- Stars celebration on done
- English and Hebrew, full right-to-left layout; each task follows its own text direction
- Installable PWA with an offline copy of the task list

## Data rules (why the old app hit 40 GB of egress, and how this one avoids it)

1. One row per task, step, note, file and message; a change updates only that row.
2. Writes do not ask for the row back.
3. Realtime sends only changed rows, filtered to the user's workspace.
4. The list loads once and is cached on the device; no polling.
5. Screens select only the columns they show, with a row limit.

The database schema and its security rules are in `supabase/migrations/`.

## Environment

Copy `.env.example` to `.env.local` and fill in the Supabase URL and publishable key. On Vercel these are set as project environment variables.
