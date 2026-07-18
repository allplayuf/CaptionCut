# CaptionCut 🎬

An AI-powered short-form video editor built for **football creators**.

Upload raw match clips → choose **Montage** or **Interview** → assign the exact source clips you want → review the proposed moments before applying them to a real multi-track timeline → fine-tune every cut, caption and zoom → export for TikTok/Reels/Shorts, Instagram Square or Landscape. Automatic captions run 100% locally and free.

![stack](https://img.shields.io/badge/Next.js-16-black) ![stack](https://img.shields.io/badge/TypeScript-strict-blue) ![stack](https://img.shields.io/badge/FFmpeg-bundled-green)

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:3000. That's it — FFmpeg/FFprobe binaries are bundled via `ffmpeg-static`/`ffprobe-static`, and **Auto Captions runs 100% locally and for free** via [whisper.cpp](https://github.com/ggml-org/whisper.cpp). No API key, no cloud, no per-minute costs; audio never leaves your machine.

On the first "Auto Captions" click the app downloads the whisper.cpp engine (~8 MB) and the selected model into `data/whisper/` — `small` (~488 MB) for the default **Accurate** mode or `base` (~148 MB) for **Fast**. This is a one-time wait. To pre-download the configured model instead:

```bash
npm run setup-whisper
```

### Import from Google Drive

CaptionCut can copy video and audio straight from a user's Drive into the media bin. The browser uses Google Picker with the per-file `drive.file` permission; the short-lived Google token is used only for that import and is never saved.

1. In one Google Cloud project, enable **Google Picker API** and **Google Drive API**.
2. Configure the OAuth consent screen and audience. While the app is in **Testing**, add every Google account that should use it as a test user.
3. Create a **Web application OAuth client** and add your local/deployed origins (for example `http://localhost:3000`) under Authorized JavaScript origins.
4. Create a browser API key, restrict it to your site origins, and restrict its APIs to Picker/Drive.
5. Copy `.env.example` to `.env.local` and set:

```env
GOOGLE_DRIVE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_DRIVE_API_KEY=...
GOOGLE_DRIVE_APP_ID=... # the Google Cloud project number
```

Drive files are copied into CaptionCut's normal local or Vercel Blob storage, so preview, analysis, captions and export keep working after the Google access token expires. Drive imports are capped at 512 MB locally and 400 MB on Vercel because deployed imports use the Function's temporary disk before copying to Blob. Current Blob media is public and the app has no user authentication or per-user rate limiting; do not expose this integration publicly until authentication and private media delivery are added.

### Deploy to Vercel

1. Import the repository into Vercel.
2. In the project dashboard, open **Storage**, create/connect a **Vercel Blob** store, and redeploy. Vercel supplies `BLOB_READ_WRITE_TOKEN` automatically.
3. Optional but recommended for captions: set `TRANSCRIPTION_PROVIDER=openai` and `OPENAI_API_KEY`. The default local whisper.cpp provider remains intended for local/self-hosted use because Vercel's Linux Functions do not include `whisper-cli`.

Deployed uploads go directly from the browser to Blob, including multipart uploads above Vercel's Function body limit. Media URLs, projects, export job state, and completed MP4 exports are durable across Function invocations. FFmpeg uses `/tmp` only as invocation-local scratch space. Exports have a 5-minute Function limit, so keep deployed edits short; local/self-hosted mode remains the better fit for long renders.

## Transcription (free & local by default)

The active provider is chosen in `lib/transcription/index.ts`:

| Provider | Cost | Needs | Notes |
|---|---|---|---|
| `local-whisper` **(default)** | free | nothing | whisper.cpp on-device, word-level timestamps |
| `openai` | paid | `OPENAI_API_KEY` | opt-in only, via `TRANSCRIPTION_PROVIDER=openai` |
| `mock` | free | nothing | instant demo captions for UI development |

Tuning local transcription (all optional, in `.env.local`):

```env
WHISPER_MODEL=small       # optional override; UI maps Accurate→small, Fast→base
WHISPER_CPP_PATH=...      # use your own whisper.cpp build (required on macOS/Linux,
                          # e.g. `brew install whisper-cpp`; Windows auto-downloads)
```

`tiny` is ~3× faster, `small` noticeably more accurate. English and Swedish are selectable in the UI (or auto-detect); whisper models support ~100 languages, so adding more is just adding `<option>`s in `components/CaptionsPanel.tsx`.

### How the caption pipeline works

1. `POST /api/transcribe` receives the current clip layout.
2. FFmpeg extracts the **edited timeline's** audio (trimmed clips, concatenated, silent clips padded) as 16 kHz mono WAV — so caption timestamps are already in timeline time.
3. `whisper-cli` runs with full JSON word output; optional project names/jargon are passed as an initial glossary prompt. Per-word probabilities are retained instead of discarded.
4. `lib/captions/chunk.ts` splits the words into punchy 3–6 word TikTok chunks (breaking on sentence punctuation, silence gaps, and length caps) with word timings and confidence preserved for spoken-word highlighting and the **Review uncertain** queue.

The Captions panel can transcribe the whole timeline or only selected main-track clips. Selected-scope transcription pads every other clip with silence, so returned timestamps remain in the original timeline and captions outside the selected sources are preserved.

**Adding a provider** (e.g. faster-whisper behind HTTP): implement the `TranscriptionProvider` interface from `lib/transcription/types.ts` in `lib/transcription/providers/`, and register it in `PROVIDERS` in `lib/transcription/index.ts`. Nothing else changes — everything downstream consumes `Caption[]`.

> Captions are **anchored to the source footage**: re-trimming, splitting, reordering or speed-changing clips after captioning re-times every caption (word-accurately) instead of letting content drift under them. Words whose footage you cut are dropped automatically.

## How export works

1. `POST /api/export` starts a background FFmpeg job; the client polls `GET /api/export/:jobId` for progress (parsed from FFmpeg's `time=` output, with estimated time remaining) and downloads from `/api/export/:jobId/download`.
2. The FFmpeg filter graph (`lib/export/exporter.ts`):
   - partitions the timeline into **(clip × zoom) pieces** — every piece trims straight from its source with the punch-zoom applied inline, then one flat concat (no split/trim/concat fan-out, which deadlocks FFmpeg's filter scheduler),
   - scales + smart-crops each piece to the export canvas (9:16 **1080×1920** by default; **1080×1080** square and **1920×1080** landscape presets re-crop around the detected action and scale caption geometry to match),
   - keeps silent clips aligned with generated silence,
   - burns captions in with **libass** using a generated `.ass` file (`lib/export/ass.ts`) whose `PlayResX/Y` is 1080×1920 — every pixel value in the style panel maps 1:1 to the output, which is what keeps preview ≈ export,
   - encodes H.264 (CRF 19, maxrate 10 Mb/s, high profile) + AAC 192k with `+faststart` — a TikTok-friendly upload.
3. Word highlighting is exported as one ASS dialogue event per spoken word with the active word recolored.
4. Job state is persisted to `data/exports/*.json`, output MP4s to `data/exports/*.mp4`.

## Project structure

```
app/               editor page + API routes (upload, media streaming, transcribe, export, projects)
components/        Header, MediaPanel, VideoPreview, CaptionOverlay, SafeZoneOverlay,
                   Timeline, CaptionsPanel, StylePanel, ExportModal, Toasts
hooks/             useEditorStore — zustand store for the whole editor state
lib/transcription/ provider registry + local whisper.cpp, OpenAI (optional), mock providers,
                   and the whisper binary/model auto-downloader
lib/captions/      TikTok caption chunking, style presets
lib/export/        ASS subtitle builder + FFmpeg export job manager
lib/server/        FFmpeg/FFprobe wrappers, data paths, JSON project store
lib/autoEdit/      the auto-edit brain: transcript analysis, highlight/dead-space detection,
                   silence & filler cuts, hook scoring, moment scoring, signal stitching,
                   recipe generation + application
lib/video/         timeline math (shared client/server), client upload helpers
lib/audio/         browser waveform peak extraction
types/             shared TypeScript types (Caption, Clip, CaptionStyle, Project, …)
data/              user data: uploads, projects, exports (gitignored)
```

## AI Auto Edit (free & local)

The AI panel builds a non-destructive draft from explicitly chosen sources. The editor "watches and listens" to the footage with two fast local FFmpeg passes per file (cached in `data/analysis/`), then lets you preview, reject and reorder every proposed moment before applying it:

- **audio** → energy envelope (cheers, laughs, shouts), overall loudness, and a beat grid (BPM + phase) when the audio is musical;
- **video** → a motion curve (tackles, sprints, celebrations) and scene-change instants.

Those signals are fused with the transcript (when there is one) into a single edit recipe:

- **Highlights** — audio-burst + motion-spike moments (a goal and the roar after it) are detected, listed in the panel, protected from cutting, and given punch-in zooms.
- **Hook cold-open** — the strongest spoken hook opens the video; with no usable speech, the biggest detected *moment* opens it instead. Football montages work with zero dialogue.
- **Cuts** — silence, filler words and stutters (from the transcript) plus *dead space* (low energy + low motion) are removed; kept fragments under 0.6 s are absorbed so there's no stutter-cutting, and an over-cut guard keeps at least ~30 % of the footage.
- **Music-synced cutting** — the **Add music** button (AI Edit panel, or "Music" on any audio in the media bin) uploads a song and sets it as the soundtrack in one click. Montage cut points are then **phase-locked to the song's actual beat instants** (drift-corrected, half-tempo-aware detection), not just beat-length multiples. Footage without music falls back to an **energy-onset grid** (ball strikes, cheers), so beat-synced cutting always works.
- **Intentional zooms** — punch-ins land on reactions (anchored high, for faces), action and emphasized sentences; filler pattern-interrupts only fill long uneventful gaps, and total zoom density is capped so it never feels random.
- **Draft review** — source clips can be included/skipped (or assigned as Interview audio/B-roll), and every suggested moment can be previewed, kept, rejected or reordered before the timeline changes.
- **Regenerate** — creates a *different draft* without touching the timeline (deterministic seed: alternate hook, shifted interrupts, varied zoom scales).
- **Loudness-normalized export** — the final mix is normalized to −14 LUFS (the TikTok/Reels standard) so clips shot at different distances sit at one level.

Styles (Viral / Clean / Podcast / Sports / Storytime / Educational / Meme) tune all thresholds — **Sports** cuts hardest, zooms strongest and opens on the biggest moment. Everything runs locally; if analysis or transcription fails, the editor gracefully falls back to whatever evidence it has.

### Football montage presets

The montage engine (`lib/autoEdit/montage.ts`) ships six montage directions with real pacing/effect differences — **Hype**, **Clean Recap**, **Street Football**, **Goals & Reactions**, **Community** and **Sponsor Recap**. **Interview** is now a separate workflow: chosen interview clips stay on the main track so their speech and captions continue, while chosen action sources become muted full-frame B-roll cutaways. Target length is 10/15/20/30s or custom (8–60s), with pace, action/reaction focus, effects and CTA controls available before generation.

## Features

- **Start screen** — first-run onboarding with drag-and-drop upload, workflow explanation and recent projects.
- **Upload** — drag & drop from a device or choose multiple video/audio files directly in Google Drive; vertical or horizontal footage (anything is cover-cropped to 9:16); friendly errors for unsupported/oversized files (512 MB cap); media bin shows real thumbnails, duration/orientation badges and analysis status.
- **Linked audio** — pair a video with a separately recorded microphone/recorder track, auto-sync their sound envelopes or nudge the delay manually, and choose whether to replace or mix camera audio. The source-level link survives trims, splits, reorders, speed changes, captions and export.
- **Timeline** — scrub, play/pause (Space), trim by dragging clip edges (Shift disables snapping), split at playhead (S), delete (Del), duplicate (Ctrl+D), copy/paste (Ctrl+C/V), drag-reorder, real **multi-select** (Ctrl/Cmd-click toggle, Shift-click range, **drag-marquee** over empty space; group move/duplicate/delete, Alt+←/→ nudge), one-undo-step drags, **beat ticks on the ruler** that clips and captions snap onto, Home/End jumps, zoom in/out, filmstrip thumbnails + audio waveforms.
- **Effects** — punch-in zooms, **slow zoom** (Ken Burns ramp), **handheld shake** (deterministic — preview matches export frame-for-frame), **cinematic vignette** (+contrast boost), **freeze-frames** (hold the frame while music keeps playing), **flash pops** (soft white accent; never a white-out), one-click **instant replay** (last 3 s in slow-mo with a zoom) and football presets — **Goal impact** (zoom+flash+shake), **Reaction punch**, **Ending freeze** (final-frame hold + editable outro text) — all previewed live and rendered identically in the export.
- **Per-clip framing** — **Fill** (smart cover-crop around the action) or **Fit** (whole frame letterboxed over a blurred copy of itself), plus **Stabilize** (FFmpeg deshake + slight over-zoom at render time; the preview shows the matching framing and says so honestly).
- **Inspector** — Premiere-style contextual panel: clip timing/speed/volume/fades, framing (fill/fit/stabilize), text style, transform with reset, all effect parameters, caption text + timing, **multi-selection view** (per-track counts, group actions), project format + overview.
- **Preview** — **format-aware** (9:16 / 1:1 / 16:9 — switch in the transport bar or Inspector; captions and overlays scale exactly like the export), accurate multi-track playback, **drag text/stickers/images directly in the preview** with center/thirds **snap guides** and safe-margin frame (Shift = free), **drag captions** between the three safe positions, scrubber, theater/fullscreen mode, buffering indicator, TikTok safe-zone guides.
- **Auto Captions** — Accurate/Fast local models, language choice, names/jargon glossary, whole-timeline or selected-clip scope, confidence badges and an uncertain-caption review queue; still editable line-by-line with manual timing.
- **Styling** — 5 presets (TikTok Bold, MrBeast Style, Clean Minimal, Podcast Clip, Meme Style) plus full control: font, size, weight, colors, stroke, shadow, background box + opacity, ALL CAPS, spoken-word highlight, and three TikTok-safe positions.
- **Safe zones** — toggleable overlay showing TikTok's top UI, right button rail and bottom caption/music areas.
- **Projects & versions** — everything autosaves to `data/projects` (1.2 s debounce); the last project reopens automatically, and the Projects menu lets you switch/delete. The **Versions** menu keeps restore points: save one manually before a risky change, and every auto edit snapshots itself so **Reset to auto edit** always works.
- **Beat controls** — detected BPM + confidence shown next to the soundtrack (never a silent failure), **manual BPM** override, **tap tempo**, and a beat-sync on/off switch; the resulting grid draws as ticks under the timeline ruler and everything snaps to it.
- **Export preflight** — before rendering, the exporter verifies every referenced media file still exists on disk (blocking, with filenames) and lists honest notes (e.g. which clips get deshaked or blur-fitted).

## Notes & limitations (MVP)

- Best for videos **under 3 minutes**. Accurate (`small`) favors recognition quality; Fast (`base`) is the lighter roughly-realtime option on a typical CPU.
- The bundled whisper.cpp build is CPU-only; for GPU speed, build whisper.cpp with CUDA/Metal yourself and point `WHISPER_CPP_PATH` at it.
- Fonts must exist on the machine that runs the export (the presets stick to Windows/mac-safe families: Arial, Arial Black, Impact, Segoe UI, Verdana, …).
- The caption background box renders with rounded corners in the preview but square corners in the export (libass limitation); background replaces stroke/shadow in both.
- **Stabilization is export-time only**: the per-clip "Stabilize" toggle runs FFmpeg's `deshake` (plus a 3% over-zoom to hide edge compensation) during rendering. The browser can't deshake in real time, so the preview shows the matching framing with a badge saying exactly that — it is a shake *reducer*, not gimbal-grade optical stabilization.

## TODO (post-MVP)

- [ ] Timeline zoom + drag-to-reorder clips
- [ ] Live transcription progress bar (whisper.cpp progress → SSE)
- [ ] Karaoke-style progressive word fill (ASS `\k` tags) as an alternative highlight mode
- [ ] Background music track + volume ducking
- [ ] Export queue UI with cancel; clean up old exports automatically
- [ ] SRT/VTT import & export
