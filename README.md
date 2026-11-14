# Voice Notes

A personal iPhone home-screen web app. Record a thought or a meeting; a minute or so later you get a transcript with speaker labels, a summary, to-dos and dated reminders, saved and searchable.

## How it works

- **Recording**: one tap on the microphone starts a recording from any screen and brings up the Record screen. A recording stopped within two seconds is treated as a stray tap: it is not kept and nothing is uploaded.
- **A conversation's screen**: when it was and how long, with three dots at the top right (Share, Copy transcript, Move to folder, Export, Delete), then three tabs: Summary (with its to-dos, reminders and the audio, plus a Redo button on recordings the cheaper model read, which has the best model read the transcript again), Transcript, and the lightning bolt for Zeus (a chat about that conversation alone, which picks up the last chat held about it on this phone). There is no back button; the tab bar is the way out. Arriving from a search hit opens the Transcript tab at that moment.
- **Screens**: the bottom bar is Home, Folders, the microphone, Zeus and Settings. Home has two headers to choose between, Conversations (the list) and Action Items (to-dos and reminders). At Home's top right, a magnifying glass opens search over the whole screen and a cloud with an up arrow imports an audio file. Search keeps the last eight searches in the phone's browser storage and offers them while the box is empty. Press and hold a conversation in any list for a card about it (when, how long, how many speakers, its summary) with Share, Move to folder, Export and Delete beneath.
- **Import**: the cloud at the top right of Home or of a folder takes an audio file made elsewhere, for example a conversation exported from another notes app and saved to Files. Formats: m4a, mp3, wav, aac, ogg, webm, flac, mp4, up to 50 MB each (the Supabase Free limit for one file). The file is stored on the phone, uploaded in resumable pieces and then transcribed and summarised exactly like a recording made here. Its date is the file's modified date. iPhone does not let a home-screen web app appear in another app's share sheet, so the file has to be picked from inside this app.
- **Folders**: a conversation can sit in one folder. Create one with the plus at the top right of the Folders tab. Inside a folder, the top right has search (that folder only), import (the file is filed in that folder) and three dots for Add conversations, Rename folder and Delete folder; deleting a folder keeps its conversations. Searching one folder in full needs the two-argument `search_notes` from the current `supabase/setup.sql`; on an older database the app searches everything and keeps that folder's matches, which can miss some. Needs the `folders` table from the current `supabase/setup.sql`; without it the app says so.
- **Press and hold a conversation** (any list) for Share (summary and action items through the phone's share sheet, or copied where there is none), Move to folder, Export transcript (a text file with times and speakers), Export audio (the original file, while it is still kept) and Move to Trash.
- **Deleting and Trash**: swipe a recording left in any list and tap Delete. It moves to Trash (Settings > Trash), where it can be restored for 30 days; after that the worker erases the audio, transcript and items for good. Its to-dos are hidden and its reminders do not alert while it is in Trash. Trash needs the `deleted_at` column from the current `supabase/setup.sql`; on a database without it the app says so and deleting erases at once.
- **Recording controls**: the blue microphone in the centre of the bottom bar starts a recording (from another screen the first tap only opens the Record screen). While recording, the bar shows the timer, a pause button that becomes the microphone again to resume, and a stop button (red square in a white circle) to its right. Paused time is left out of the clock and of the recording's length; what was said before a pause is flushed to the phone's storage first.
- **Opening animation**: on launch a bolt strikes in from the right, the screen flashes once, and the bolt blinks out and returns (about 1.15 seconds, once per launch). With the phone's Reduce Motion setting on, it is a still bolt with no flash.
- **Look**: dark grey to black by default. Settings > Appearance switches to Light or follows the phone; the choice is kept on the phone.
- **To-dos**: each item shows the recording it came from and that recording's date, and opens it at the moment it was said.
- **Completed items**: a ticked item shows under "Done today" until midnight on the phone, then only under "Show earlier" (50 at a time, most recently completed first). Nothing is deleted: items from a recording stay, ticked, inside it and in search, and Zeus still reads them. The completion time is `items.done_at`, set by a database trigger whenever an item becomes done (whoever ticks it) and cleared when it is opened again; items completed before the column existed have none and are listed last. Open items load separately from completed ones, so a pile of completed items can never push an open one off the list. On a database without `done_at` (the current `supabase/setup.sql` not yet run) Done shows the 15 newest completed items, as before.
- **Phone**: records in the browser, writes a chunk to IndexedDB every 5 seconds, and uploads straight to Supabase Storage in resumable 6 MB pieces. Audio stays on the phone until the server confirms the recording.
- **Supabase**: login (email and password, sign-ups off), database with row-level security, a private `audio` bucket, and the scheduler. Every row and file rule also requires the owner's account (`public.is_owner()`), so another account could read and write nothing even if sign-ups were switched on by mistake. Of a recording, the phone may write only the upload's own columns and, afterwards, its folder and Trash date; its status, transcript id, costs and dates are the server's. The owner's id is saved in `private.app_config` by `/api/sync` on each app open (from `OWNER_USER_ID`), or by the setup script when the project has exactly one account. `pg_cron` runs every minute and uses `pg_net` to call `/api/tick` only when work is waiting.
- **Security headers** (`src/lib/security-headers.ts`): every response carries a Content-Security-Policy that lets pages talk only to this site and the Supabase project in `SUPABASE_URL` (read at build time, so a new project needs a redeploy), forbids framing and plugins, plus `X-Frame-Options`, `X-Content-Type-Options` and `Referrer-Policy`. Scripts allow `'unsafe-inline'` because Next.js inlines its own; nonces would make every page render on the server. The browser tests fail on any policy refusal.
- **Vercel**: the Next.js app and the worker. Each tick claims one step at a time: `uploaded > transcribing > transcribed > extracting > ready`, or `failed` after three attempts, with a Retry button.
- **Fast start**: when an upload is confirmed the phone calls `/api/kick`, which runs the same worker passes every few seconds until the recording is ready. The once-a-minute scheduler stays as the safety net for retries, reminders and anything the fast path misses.
- **Zeus**: an in-app chat (`/zeus`, Claude Sonnet 5.5) for reviewing recordings. From a note it reads that recording's full transcript; from the Zeus tab it reads the 40 most recent summaries and items plus transcript lines matching the question. It has three tools, all limited to the owner's to-dos and reminders: add, update (wording, due time, done or active) and remove. Adding, rewording, re-dating and reopening happen at once and are written into the reply as a `✓` line. Removing an item or marking it done only proposes it: the server writes a marker instead of changing anything, the chat shows the item (its wording read from the database) with a button, and the phone makes the change under the owner's login only when it is tapped. Removal is a soft delete (the row is kept as dismissed). Transcripts are treated as material, never instructions: angle brackets in recording text are replaced before it reaches the model, and the model's own words cannot produce a confirm button. The self-test runs Zeus with the tools switched off. Chats are saved in the phone's browser storage only, and their cost is not in the Settings estimate.
- **Reminders** alert with the title "Reminder from a recording" when they were taken from a recording, and "Reminder" when added by hand or through Zeus.
- **AssemblyAI** transcribes with speaker labels from a short-lived signed link. As soon as the transcript is saved in Supabase the worker deletes AssemblyAI's copy (its delete keeps only billing details such as the id and duration). A delete that fails is retried each pass; a recording that failed while transcribing keeps its job so Retry can reuse it. **Claude** returns a fixed structure (no tools): Haiku 5.5 for a short single-speaker memo, Opus 5.5 otherwise, with an Opus rerun when the cheap pass reports low confidence.

## Where it runs

- **App:** https://voice-notes-beige.vercel.app (Vercel project `voice-notes`, team `daniel-priests-projects`).
- **Database:** Supabase project `hhcrfdmwtbjzqewzvuyz`.
- **Deploys are automatic.** The Vercel project is linked to this repository: merging to `main` deploys to production, and pull requests get a preview build (previews are behind Vercel login).
- Environment variable changes only take effect on the next deployment.

## Setup

1. Supabase: turn off new sign-ups (Authentication > Sign In / Providers) and add your user (Authentication > Users > Add user, auto-confirm on). The user's UID is the value for `OWNER_USER_ID`.
2. Supabase SQL editor: run the whole of `supabase/setup.sql`.
   - Paste the file's contents, not its name. On GitHub, the "Copy raw file" button copies all of it.
   - Check the paste is complete: the last line ends `order by u.created_at;`.
   - Run with nothing highlighted and accept the "destructive operations" warning (the script drops and recreates its own policies so it can be re-run).
   - A complete run ends with a small table of users, with `is_owner` true for yours (it is blank until the app has been opened once, if the project has more than one user). Plain "Success" with no table usually means only part of the file was pasted.
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
   | `SELFTEST_SECRET` | Any long random string; protects `/api/selftest`. Leave it unset to switch the self-test off | Production, optional |

   Secrets live only in these variables. The scheduler's own secret is generated inside the database by the setup script, and the app tells the database its own address on each sign-in and self-test.
4. Deploy, open the app on the iPhone in Safari, add it to the Home Screen, open it from the icon and sign in.

## Checks

```bash
npm run lint
npm run typecheck
npm test        # 127 unit tests, then 32 Playwright tests: 16 in the browser (one walks every screen with realistic data), 16 straight to the server
npm run build
```

- `/api/selftest?action=start`, with the secret in an `x-selftest-secret` header (never in the address, which ends up in logs and history), uploads a spoken sample and lets the real scheduler drive it; call it again without `action` about once a minute until `done` is true. Add `&fast=1` to drive the run with the fast path the phone uses. For example: `curl -H "x-selftest-secret: $SELFTEST_SECRET" "https://voice-notes-beige.vercel.app/api/selftest?action=start"`. Without `SELFTEST_SECRET` set in Vercel the endpoint is switched off. It checks: uploaded to ready, a to-do, a dated reminder, a due reminder sent by the tick, a Zeus answer about the sample, and test rows removed.
- If something is not set up, the same endpoint says what: missing variable names, or which Supabase project it is connected to and which tables, bucket or functions it cannot find.
- `package.json` overrides `minimatch` for the TypeScript lint parser (`@typescript-eslint/typescript-estree`) to 11.x, which clears advisory GHSA-g3hv-75wg-m249 in the lint tooling. Remove the override once a `typescript-eslint` release depends on minimatch 11.0.1 or later. Nothing that ships uses it (`npm audit --omit=dev` was already clean).
- `/phone-check` tests what the iPhone itself allows (formats, real bytes per second, joined-chunk playback, wake lock, interruption, the Shortcuts link).

## Status (13 November 2026)

Verified against the live services by the self-test: the pipeline from uploaded to ready, speech to text, Claude extraction on Haiku 5.5 with a to-do and a dated reminder, the scheduler's tick sending a due reminder, and cleanup.

Not yet verified:

- Anything on a real iPhone: recording, wake lock, interruptions, the Home Screen login, push delivery, the Shortcuts hand-off.
- The phone's resumable upload against real Supabase Storage (tested only against mocks).
- Zeus changing to-dos against the live model (its tools are tested for input validation only; the browser test uses a mocked reply).
- Swipe-to-delete and press-and-hold on a real touchscreen (tested with a simulated drag, a held mouse button and a right-click).
- Import on an iPhone: picking a file from Files, and files exported by other apps (tested in a desktop browser with an mp3, against a mocked upload).
- Share and Export on an iPhone: the share sheet with a text file, and the audio download (the test browser has no share sheet, so it exercises the copy and download fallbacks).
- Folders against the real database (tested against mocks; they need the current `supabase/setup.sql`).
- Pause and resume on an iPhone: Safari's recorder is asked to pause and resume, which is tested only in a desktop browser.
- Recordings with several speakers or longer than 10 minutes: the Opus path, the low-confidence rerun, the Review list, the 50 MB part roll-over.
- The 30-day audio deletion, Retry after three failures, and Redo end to end.
- Deleting transcripts at AssemblyAI against the live service (tested with the service stubbed; the self-test's own clean-up has always used the same delete call).

Database version: Trash, Folders and the "last tick" fix all need the current `supabase/setup.sql` to have been run. The app works without it, with Trash and Folders switched off.

Behaviours worth knowing:

- A redo or a repeated extraction never removes items you have kept, edited, completed or dismissed. It replaces only suggestions nobody acted on and adds only tasks that are new.
- Items added through Zeus belong to no recording, so deleting or redoing a recording does not remove them.
- After an upload the fast path stops at the first failed step; the scheduler retries a minute later, up to three attempts.
- A transcription that cannot be read back eight times in a row stops as failed with Retry. A job the speech service leaves queued indefinitely is not detected.
- A reminder is marked as sent before the push goes out, so it is sent at most once; if the push fails it shows only as overdue in the app.
- `/api/tick` refuses a request without a secret shaped like the scheduler's, and the owner-only routes refuse one without a token shaped like a Supabase sign-in, before any database or Supabase call and before saying anything about the server's set-up. There is no per-address rate limit in the app; a Vercel Firewall rule can add one.
- The worker only processes, polls, cleans up and empties Trash for recordings belonging to `OWNER_USER_ID`, and only signs or deletes audio files inside that user's folder.

Known issue: databases set up before pull request 3 do not record the "last tick" stamp, because Supabase rejects an `UPDATE` without `WHERE` from API roles. Nothing depends on it; re-running `supabase/setup.sql` fixes it.

Cost: AssemblyAI is estimated at $0.23 per hour of audio (list price with speaker labels); Claude is billed per token and logged per recording. Settings shows the month's estimate, not the providers' actual bills.
