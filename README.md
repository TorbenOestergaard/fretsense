# Fretsense

A fretboard memorisation trainer that listens to your guitar. It asks for a note, you play it on
the real instrument, and the laptop microphone checks it. No cable or audio interface needed.

Standard tuning, frets 0–12, runs locally in the browser.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5183 in Chrome, press **Start round**, and allow the microphone.
Do the **Mic check and tuner** first: tune up, and confirm all six open strings are recognised.

```bash
npm test
```

## How it teaches

There are three exercises. Each keeps its own statistics, because they are not equally hard.

| Exercise | Prompt | What it builds |
| --- | --- | --- |
| Note finder | "Play C on the G string" | Direct recall of each note on each string |
| Scale positions | "G major, position 2: play the 5th" | Where every degree sits inside each of the five boxes |
| String sweep | "Every C, low to high" | The same note across all strings (octave shapes) |

**Note finder and String sweep** track *this note on this string*: 6 strings × 12 notes = 72
items (fret 12 repeats the open string). The Note finder is adaptive: slow, missed, new and
long-unseen notes are asked more often, and a missed note returns three questions later.

**Scale positions** takes one box at a time, in a key and scale you choose (major, natural
minor, major or minor pentatonic). A box starts with an untimed step, *play the root*, to get
your hand in place. Then every degree of the scale is asked once in random order, and any place
that degree occurs inside the box counts. A missed degree is asked again before the box is
left. Then the next box. It tracks *this degree in this box of this scale type*, independent of
key. Minor boxes are numbered from the one with the root under the first finger on the low E
string. You choose what the board shows while asking: the scale shape, the roots only, or
nothing.

In every exercise a wrong note does not end the question. After 12 seconds (or Space) the
answer is shown, and you play it to continue.

### Status and progress

A note only counts as known when it is both right and fast, because "working it out from the
low E string" is the habit to replace with recall. Each attempt scores 0 for a miss, or between
0 and 1 by speed for a first-try answer (2 s or faster is full marks, 8 s or slower is none).

The status of an item (New, Shaky, Learning, Solid, Instant) is the average of its last eight
attempts, and fewer than four attempts are averaged as if the missing ones scored zero. That
damps it in both directions: one lucky fast answer makes a note Shaky, not Instant, and it takes
four to get there; one slip or slow answer on a well-known note leaves it Instant, two drop it
to Solid.

The **Progress** view shows, per exercise: the status map, the same map coloured by average
time, average time per string, note and fret (or per position and degree), and average time
and first-try rate per practice day. The timing charts can be limited to naturals or to sharps
and flats, so days with harder material do not look like a step back. A stamina chart shows
correct notes per day against the daily goal of 40, across all exercises.

Suggested routine: 5–10 minutes a day. Start with naturals only on the D, G and B strings in the
Note finder, switch on sharps and flats once those rows turn green, and add a Scale positions
round in the key you are currently playing in.

## How the listening works

`src/audio/` contains the chain: microphone → 85 ms analysis windows every 24 ms → pitch → note
events.

- Pitch uses the McLeod pitch method ([pitchy](https://github.com/ianprime0509/pitchy)), which
  measures the waveform's periodicity. That matters for the low strings: a laptop microphone
  barely records an 82 Hz fundamental, but the periodicity is still there in the overtones.
- The browser's echo cancellation, noise suppression and auto gain are switched off. They are
  tuned for speech and treat a sustained note as noise.
- A gate compares the level with a running estimate of the room noise, so a quiet unplugged
  electric is separated from silence without a fixed threshold.
- `NoteTracker` turns the pitch stream into one event per pluck. A note still ringing from the
  previous answer can never answer the next question, a fading note does not re-trigger, and
  the same pitch plucked again (C on the low E string, then C on the A string) counts twice.

### What a microphone cannot know

A microphone hears pitch, not position. C3 at fret 8 of the low E string and C3 at fret 3 of the
A string are the same sound. The app checks the exact octave the asked string produces, which
catches most wrong-string answers, but where two strings overlap it trusts you to be on the
string that is highlighted. In Scale positions no pitch occurs twice inside a box, so there the
pitch does identify the place. If you play the right note name in another octave you get a nudge
rather than a penalty, since that can also be the detector slipping an octave.

It also listens for one note at a time. Mute the other strings.

## Testing without a guitar

- Clicking a fret on the on-screen fretboard answers the question (also the fallback when the
  microphone is unavailable).
- Open `/?debug` to expose `fretsense.mic` in the console. `await fretsense.mic.startSynth()`
  replaces the microphone with a test-tone source feeding the same analysis chain, and
  `fretsense.mic.pluck(48)` plays a C3 into it. The mic check screen gets a "Use test tones"
  button in this mode.
- `src/audio/audio.test.ts` runs the detector and tracker over synthesised plucks (weak
  fundamental, pick noise, room noise) for every position from open to fret 12 on all strings.

## Research notes

**Method.** Guitar teaching sources agree on a few things, and the modes follow them: learn
natural notes before accidentals, work string by string instead of the whole neck at once, use
octaves to connect the same note across strings, favour short daily sessions, and aim for
recall rather than counting up from a known note.
([Guitar Player](https://www.guitarplayer.com/technique/fretboard-memorization-three-steps-to-neck-knowledge-tab),
[TrueFire](https://learn.truefire.com/how-to-memorize-the-guitar-fretboard),
[Hub Guitar](https://www.hubguitar.com/fretboard/knowledge-exercises),
[Study Guitar](https://study-guitar.com/blog/how-to-memorise-the-notes-on-guitar))
Saying the note name aloud as you play it is also widely recommended and costs nothing here.

**Existing apps.** Microphone-checked note trainers exist, mostly as iOS apps:
[Guitar Blast](https://apps.apple.com/app/id1483606692),
[FredsBoard](https://apps.apple.com/us/app/-/id6757344687),
[Polyphono](https://apps.apple.com/us/app/polyphono/id6450939490), and FretGenius, which offers
a [microphone note trainer](https://fretgenius-main-site.pages.dev/guitar-microphone-note-trainer)
as a paid feature. Scale and interval viewers that label degrees also exist
([Fretonomy](https://apps.apple.com/us/app/fretonomy-learn-fretboard/id1279576225),
[Songtive Guitar Scales](https://www.songtive.com/apps/guitar-scales)), but they are answered by
tapping the screen. A quick search did not turn up one that combines the three things this app
is built around: answering on the real guitar, prompts by scale degree in a key, and a per-note
mastery map that drives what is asked next.

**Pitch detection in the browser.** Time-domain periodicity methods beat FFT peak-picking for
low guitar notes, and voice processing has to be disabled to get a raw signal.
([autocorrelation tuner write-up](https://alexanderell.is/posts/tuner/),
[getUserMedia audio constraints](https://blog.addpipe.com/audio-constraints-getusermedia/),
[why FFT tuners struggle with low notes](https://dev.to/sendotltd/why-your-web-audio-tuner-sucks-at-low-notes-and-what-to-use-instead-of-fft-391h))

## Layout

```
src/music/theory.ts     tuning, note names, scales, degree spelling
src/audio/pitch.ts      pitch + level + noise gate per analysis window
src/audio/noteTracker.ts  pitch stream -> one event per pluck
src/audio/mic.ts        microphone / test-tone source, Web Audio wiring
src/game/progress.ts    per-exercise stats, mastery, answer log, XP, streaks, localStorage
src/game/analytics.ts   averages per string, note, fret, position and day from the answer log
src/game/scheduler.ts   what to ask next
src/game/session.ts     one round as a state machine
src/sync/               optional sign-in and sync: merge logic, backend interface, Nhost adapter
src/ui/                 React screens
backend/                SQL to create the sync table
```

## Where progress is stored, and sync

Progress is stored in the browser's localStorage. That copy is always the master: the app works
fully without an account and without a network. Each browser and each address (`localhost:5183`,
the deployed site) has its own copy.

**Sync is optional.** Open *Sign in to sync* at the bottom of the home screen and create an
account (email and password). From then on:

- Signing in downloads the copy on the server, merges it with what is in the browser, and
  uploads the result. Signing in on a second browser therefore adds its answers to the first
  browser's; nothing is overwritten.
- After that the app syncs when it loads, shortly after each finished round, and when the page
  is hidden or closed.
- If the server cannot be reached (offline, or the free backend is paused), practice carries
  on and the status line says "Sync off" with the time of the last sync. It catches up on the
  next successful sync.
- A reset is synced too: resetting an exercise in one browser resets it in the others.

**How merging works** (`src/sync/merge.ts`, tests in `merge.test.ts`). The answer log is the
source of truth. Two logs are combined by taking every answer in either one once (same
timestamp, exercise and item = same answer). Per-item statistics, per-day totals and XP are then
worked out again from the combined log, so the same data arriving twice changes nothing. XP is
the one approximation: when both browsers practised separately on the same day, that day's XP
is the larger side's plus a proportional share of the other's.

**Backup file.** *Progress → Backup* exports everything to a JSON file and merges such a file
back in. It needs no account and is independent of the server.

### Privacy

- Without an account nothing leaves the browser. Microphone audio is analysed locally and is
  never sent or stored.
- With an account the server holds: your email address, a hashed password, and one row with the
  practice record (answer log, statistics, XP, days, exercise settings). The microphone choice
  and sensitivity stay on the device.
- No analytics, no ads, no tracking cookies, no third-party scripts. The only outside requests
  are to the sync server, and only when signed in. The sign-in session is kept in localStorage.
- Each account can read and write only its own row (enforced by the database permissions
  below, not by the app).
- *Account and sync → Delete account and synced progress* removes the server copy and the
  account. Local progress stays until you use Reset.

### Backend setup (Nhost)

The backend is an [Nhost](https://nhost.io) project that can be shared with other apps, so
everything belonging to this app is prefixed `fretsense_`. Accounts are shared across those apps.

1. Put the project's subdomain and region in `src/sync/config.ts`. They are public values, not
   secrets. With an empty subdomain the app builds without sync.
2. Dashboard → Database → SQL Editor: paste `backend/nhost-setup.sql`, keep **Track this** on, run.
3. Dashboard → Database → `fretsense_progress` → Edit Permissions, role **user**:

   | Action | Row check | Columns | Column preset |
   | --- | --- | --- | --- |
   | Insert | Without any checks | `data` | `user_id` = `X-Hasura-User-Id` |
   | Select | `user_id` `_eq` `X-Hasura-User-Id` | `data`, `updated_at` | |
   | Update | `user_id` `_eq` `X-Hasura-User-Id` | `data` | |
   | Delete | `user_id` `_eq` `X-Hasura-User-Id` | | |

   Leave the **public** role without any permission.
4. To let users delete their own account: table `auth.users` → Edit Permissions, role **user**,
   Delete with check `id` `_eq` `X-Hasura-User-Id`. Without this the app still deletes the
   synced progress but reports that the account itself remains.
5. Settings → Sign-In Methods → Email and Password: switch **Require Verified Emails** off
   (the free plan is not documented to send verification emails). The app also copes with it
   being on: it then asks the new user to confirm by email before signing in.

Notes on the free plan: a project is paused after one week of inactivity and is woken from the
Nhost dashboard. The app treats a paused project like being offline.

### Using another backend

Only `src/sync/nhostAdapter.ts` knows about Nhost. To switch, write another file that implements
the `SyncBackend` interface in `src/sync/types.ts` (sign up, sign in, sign out, current user,
pull, push, delete account) and return it from `src/sync/backend.ts`. The stored document is the
`SyncDoc` type in `src/sync/merge.ts`; any store that keeps one JSON document per user will do.

## Deploying

The app is a static site. `.github/workflows/deploy.yml` tests, builds and publishes it to
GitHub Pages on every push to `main`. Pages serves over HTTPS, which browsers require for
microphone access.

## License

MIT, see [LICENSE](LICENSE).

## Ideas for later

- Scale positions across two octaves in order (1 to 8 and back), and modes of the major scale.
- Frets 13 and up.
- Intervals from a moving root ("a major 3rd above this note, on the next string").
