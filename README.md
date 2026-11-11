# Voice Notes

A personal iPhone home-screen web app. Record a thought or a meeting; a minute or so later you get a transcript with speaker labels, a summary, to-dos and dated reminders, saved and searchable.

## How it works

- **Phone**: records in the browser, writes a chunk to IndexedDB every 5 seconds, and uploads straight to Supabase Storage in resumable 6 MB pieces. Audio stays on the phone until the server confirms the recording.
- **Supabase**: login (email and password, sign-ups off), database with row-level security, a private `audio` bucket, and the scheduler. `pg_cron` runs every minute and uses `pg_net` to call `/api/tick` only when work is waiting.
- **Vercel**: the Next.js app and the worker. Each tick claims one step at a time: `uploaded > transcribing > transcribed > extracting > ready`, or `failed` after three attempts, with a Retry button.
- **AssemblyAI** transcribes with speaker labels from a short-lived signed link. **Claude** returns a fixed structure (no tools): Haiku 5.5 for a short single-speaker memo, Opus 5.5 otherwise, with an Opus rerun when the cheap pass reports low confidence.

## Setup

1. Supabase: turn off new sign-ups, add your user, then run `supabase/setup.sql` in the SQL editor. Its last result shows your user id.
2. Vercel environment variables (Production and Preview):

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | Project URL |
   | `SUPABASE_ANON_KEY` | Publishable (anon) key |
   | `SUPABASE_SERVICE_ROLE_KEY` | Secret (service role) key |
   | `ASSEMBLYAI_API_KEY` | AssemblyAI key |
   | `ANTHROPIC_API_KEY` | Claude API key |
   | `OWNER_USER_ID` | Your Supabase user id |
   | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Made in your browser at `/keys` |
   | `SELFTEST_SECRET` | Any long random string; protects `/api/selftest` |

   Secrets live only in these variables. The scheduler's own secret is generated inside the database by the setup script.
3. Redeploy, open the app on the iPhone, add it to the Home Screen, sign in.

## Checks

```bash
npm run lint
npm run typecheck
npm test        # unit tests, then Playwright with a fake microphone against mocks
npm run build
```

`/api/selftest?key=<SELFTEST_SECRET>&action=start` runs a spoken sample through the live pipeline; call it again without `action` to follow it to the final report. `/phone-check` tests what the iPhone itself allows.
