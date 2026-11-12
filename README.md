# Voice Notes

A personal iPhone home-screen web app. Record a thought or a meeting; a minute or so later you get a transcript with speaker labels, a summary, to-dos and dated reminders, saved and searchable.

## How it works

- **Deleting and Trash**: swipe a recording left on the Record or Notes screen and tap Delete. It moves to Trash (Settings > Trash), where it can be restored for 30 days; after that the worker erases the audio, transcript and items for good. Its to-dos are hidden and its reminders do not alert while it is in Trash. Trash needs the `deleted_at` column from the current `supabase/setup.sql`; on a database without it the app says so and deleting erases at once.
- **Recording controls**: the blue microphone in the centre of the bottom bar starts a recording (from another screen the first tap only opens the Record screen). While recording, the bar shows the timer, a pause button that becomes the microphone again to resume, and a stop button (red square in a white circle) to its right. Paused time is left out of the clock and of the recording's length; what was said before a pause is flushed to the phone's storage first.
- **Opening animation**: on launch a bolt strikes in from the right, the screen flashes once, and the bolt blinks out and returns (about 1.15 seconds, once per launch). With the phone's Reduce Motion setting on, it is a still bolt with no flash.
- **Look**: dark grey to black by default. Settings > Appearance switches to Light or follows the phone; the choice is kept on the phone.
- **To-dos**: each item shows the recording it came from and that recording's date, and opens it at the moment it was said.
- **Phone**: records in the browser, writes a chunk to IndexedDB every 5 seconds, and uploads straight to Supabase Storage in resumable 6 MB pieces. Audio stays on the phone until the server confirms the recording.
- **Supabase**: login (email and password, sign-ups off), database with row-level security, a private `audio` bucket, and the scheduler. `pg_cron` runs every minute and uses `pg_net` to call `/api/tick` only when work is waiting.
- **Vercel**: the Next.js app and the worker. Each tick claims one step at a time: `uploaded > transcribing > transcribed > extracting > ready`, or `failed` after three attempts, with a Retry button.
- **Fast start**: when an upload is confirmed the phone calls `/api/kick`, which runs the same worker passes every few seconds until the recording is ready. The once-a-minute scheduler stays as the safety net for retries, reminders and anything the fast path misses.
- **Zeus**: an in-app chat (`/zeus`, Claude Sonnet 5.5) for reviewing recordings. From a note it reads that recording's full transcript; from the Zeus tab it reads the 40 most recent summaries and items plus transcript lines matching the question. It has three tools, all limited to the owner's to-dos and reminders: add, update (wording, due time, done or active) and remove. Removal is a soft delete (the row is kept as dismissed). Every change is written into the reply as a `✓` line. Transcripts are treated as material, never instructions, and the self-test runs Zeus with the tools switched off. Chats are saved in the phone's browser storage only, and their cost is not in the Settings estimate.
- **AssemblyAI** transcribes with speaker labels from a short-lived signed link. **Claude** returns a fixed structure (no tools): Haiku 5.5 for a short single-speaker memo, Opus 5.5 otherwise, with an Opus rerun when the cheap pass reports low confidence.

## Where it runs

- **App:** https://voice-notes-beige.vercel.app (Vercel project `voice-notes`, team `daniel-priests-projects`).
- **Database:** Supabase project `hhcrfdmwtbjzqewzvuyz`.
- **Deploys are automatic.** The Vercel project is linked to this repository: merging to `main` deploys to production, and pull requests get a preview build (previews are behind Vercel login).
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
npm test        # 62 unit tests, then 10 Playwright tests with a fake microphone against mocks
npm run build
```

- `/api/selftest?key=<SELFTEST_SECRET>&action=start` uploads a spoken sample and lets the real scheduler drive it; call it again without `action` about once a minute until `done` is true. Add `&fast=1` to drive the run with the fast path the phone uses. It checks: uploaded to ready, a to-do, a dated reminder, a due reminder sent by the tick, a Zeus answer about the sample, and test rows removed.
- If something is not set up, the same endpoint says what: missing variable names, or which Supabase project it is connected to and which tables, bucket or functions it cannot find.
- `/phone-check` tests what the iPhone itself allows (formats, real bytes per second, joined-chunk playback, wake lock, interruption, the Shortcuts link).

## Status (11 November 2026)

Verified against the live services by the self-test: the pipeline from uploaded to ready, speech to text, Claude extraction on Haiku 5.5 with a to-do and a dated reminder, the scheduler's tick sending a due reminder, and cleanup.

Not yet verified:

- Anything on a real iPhone: recording, wake lock, interruptions, the Home Screen login, push delivery, the Shortcuts hand-off.
- The phone's resumable upload against real Supabase Storage (tested only against mocks).
- Zeus changing to-dos against the live model (its tools are tested for input validation only; the browser test uses a mocked reply).
- Swipe-to-delete on a real touchscreen (tested with a simulated drag).
- Pause and resume on an iPhone: Safari's recorder is asked to pause and resume, which is tested only in a desktop browser.
- Recordings with several speakers or longer than 10 minutes: the Opus path, the low-confidence rerun, the Review list, the 50 MB part roll-over.
- The 30-day audio deletion, Retry after three failures, and "Redo with best model" end to end.

Database version: Trash and the "last tick" fix both need the current `supabase/setup.sql` to have been run. The app works without it, with Trash switched off.

Known issue: databases set up before pull request 3 do not record the "last tick" stamp, because Supabase rejects an `UPDATE` without `WHERE` from API roles. Nothing depends on it; re-running `supabase/setup.sql` fixes it.

Cost: AssemblyAI is estimated at $0.23 per hour of audio (list price with speaker labels); Claude is billed per token and logged per recording. Settings shows the month's estimate, not the providers' actual bills.
