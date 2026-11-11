# Voice Notes

A personal iPhone home-screen web app. Record a thought or a meeting; a minute or so later you get a transcript with speaker labels, a summary, to-dos and dated reminders, saved and searchable.

## How it works

- **Phone**: records in the browser, writes a chunk to IndexedDB every 5 seconds, and uploads straight to Supabase Storage in resumable 6 MB pieces. Audio stays on the phone until the server confirms the recording.
- **Supabase**: login (email and password, sign-ups off), database with row-level security, a private `audio` bucket, and the scheduler. `pg_cron` runs every minute and uses `pg_net` to call `/api/tick` only when work is waiting.
- **Vercel**: the Next.js app and the worker. Each tick claims one step at a time: `uploaded > transcribing > transcribed > extracting > ready`, or `failed` after three attempts, with a Retry button.
- **AssemblyAI** transcribes with speaker labels from a short-lived signed link. **Claude** returns a fixed structure (no tools): Haiku 5.5 for a short single-speaker memo, Opus 5.5 otherwise, with an Opus rerun when the cheap pass reports low confidence.

## Where it runs

- **App:** https://voice-notes-beige.vercel.app (Vercel project `voice-notes`, team `daniel-priests-projects`).
- **Database:** Supabase project `hhcrfdmwtbjzqewzvuyz`.
- **Deploys are manual.** The Vercel project is not linked to this repository, so merging to `main` does not deploy on its own. Either connect it (Vercel project > Settings > Git > Connect Git Repository) or trigger a production deployment of `main` after each merge.
- Environment variable changes only take effect on the next deployment.

## Setup

1. Supabase: turn off new sign-ups (Authentication > Sign In / Providers) and add your user (Authentication > Users > Add user, auto-confirm on). The user's UID is the value for `OWNER_USER_ID`.
2. Supabase SQL editor: run the whole of `supabase/setup.sql`.
   - Paste the file's contents, not its name. On GitHub, the "Copy raw file" button copies all of it.
   - Check the paste is complete: the last line is `select id, email, created_at from auth.users order by created_at;`.
   - Run with nothing highlighted and accept the "destructive operations" warning (the script drops and recreates its own policies so it can be re-run).
   - A complete run ends with a small table of users. Plain "Success" with no table usually means only part of the file was pasted.
   - The script is safe to run again, and running it again is how database fixes in later versions are picked up.
3. Vercel environment variables:

   | Name | Value | Needed in |
   |---|---|---|
   | `SUPABASE_URL` | Project URL | Production |
   | `SUPABASE_ANON_KEY` | Publishable (anon) key | Production |
   | `SUPABASE_SERVICE_ROLE_KEY` | Secret (service role) key | Production |
   | `ASSEMBLYAI_API_KEY` | AssemblyAI key | Production |
   | `ANTHROPIC_API_KEY` | Claude API key | Production |
   | `OWNER_USER_ID` | Your Supabase user UID (not a secret) | Production |
   | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | A pair made in your browser at `/keys` | Production |
   | `SELFTEST_SECRET` | Any long random string; protects `/api/selftest` | Production |

   Secrets live only in these variables. The scheduler's own secret is generated inside the database by the setup script, and the app tells the database its own address on each sign-in and self-test.
4. Deploy, open the app on the iPhone in Safari, add it to the Home Screen, open it from the icon and sign in.

## Checks

```bash
npm run lint
npm run typecheck
npm test        # 47 unit tests, then 4 Playwright tests with a fake microphone against mocks
npm run build
```

- `/api/selftest?key=<SELFTEST_SECRET>&action=start` uploads a spoken sample and lets the real scheduler drive it; call it again without `action` about once a minute until `done` is true. It checks: uploaded to ready, a to-do, a dated reminder, a due reminder sent by the tick, and test rows removed.
- If something is not set up, the same endpoint says what: missing variable names, or which Supabase project it is connected to and which tables, bucket or functions it cannot find.
- `/phone-check` tests what the iPhone itself allows (formats, real bytes per second, joined-chunk playback, wake lock, interruption, the Shortcuts link).

## Status (11 November 2026)

Verified against the live services by the self-test: the pipeline from uploaded to ready, speech to text, Claude extraction on Haiku 5.5 with a to-do and a dated reminder, the scheduler's tick sending a due reminder, and cleanup.

Not yet verified:

- Anything on a real iPhone: recording, wake lock, interruptions, the Home Screen login, push delivery, the Shortcuts hand-off.
- The phone's resumable upload against real Supabase Storage (tested only against mocks).
- Recordings with several speakers or longer than 10 minutes: the Opus path, the low-confidence rerun, the Review list, the 50 MB part roll-over.
- The 30-day audio deletion, Retry after three failures, and "Redo with best model" end to end.

Known issue: databases set up before pull request 3 do not record the "last tick" stamp, because Supabase rejects an `UPDATE` without `WHERE` from API roles. Nothing depends on it; re-running `supabase/setup.sql` fixes it.

Cost: AssemblyAI is estimated at $0.23 per hour of audio (list price with speaker labels); Claude is billed per token and logged per recording. Settings shows the month's estimate, not the providers' actual bills.
