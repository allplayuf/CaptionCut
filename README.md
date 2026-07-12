# CaptionCut 🎬

An AI-powered short-form video editor built for **football creators**.

Upload raw match clips → hit **Create montage** (Hype, Clean Recap, Street, Goals & Reactions, Community, Interview + Match, Sponsor Recap) → get a TikTok-ready edit on a real multi-track timeline → fine-tune every cut, caption and zoom → export for TikTok/Reels/Shorts, Instagram Square or Landscape. Automatic captions run 100% locally and free.

![stack](https://img.shields.io/badge/Next.js-16-black) ![stack](https://img.shields.io/badge/TypeScript-strict-blue) ![stack](https://img.shields.io/badge/FFmpeg-bundled-green)

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:3000. That's it — FFmpeg/FFprobe binaries are bundled via `ffmpeg-static`/`ffprobe-static`, and **Auto Captions runs 100% locally and for free** via [whisper.cpp](https://github.com/ggml-org/whisper.cpp). No API key, no cloud, no per-minute costs; audio never leaves your machine.

On the first "Auto Captions" click the app downloads the whisper.cpp engine (~8 MB) and the `ggml-base` model (~148 MB) into `data/whisper/` — a one-time wait. To pre-download instead:

```bash
npm run setup-whisper
```

## Transcription (free & local by default)

The active provider is chosen in `lib/transcription/index.ts`:

| Provider | Cost | Needs | Notes |
|---|---|---|---|
| `local-whisper` **(default)** | free | nothing | whisper.cpp on-device, word-level timestamps |
| `openai` | paid | `OPENAI_API_KEY` | opt-in only, via `TRANSCRIPTION_PROVIDER=openai` |
| `mock` | free | nothing | instant demo captions for UI development |

Tuning local transcription (all optional, in `.env.local`):

```env
WHISPER_MODEL=base        # tiny · base · small · medium · large-v3-turbo (+ .en variants)
WHISPER_CPP_PATH=...      # use your own whisper.cpp build (required on macOS/Linux,
                          # e.g. `brew install whisper-cpp`; Windows auto-downloads)
```

`tiny` is ~3× faster, `small` noticeably more accurate. English and Swedish are selectable in the UI (or auto-detect); whisper models support ~100 languages, so adding more is just adding `<option>`s in `components/CaptionsPanel.tsx`.

### How the caption pipeline works

1. `POST /api/transcribe` receives the current clip layout.
2. FFmpeg extracts the **edited timeline's** audio (trimmed clips, concatenated, silent clips padded) as 16 kHz mono WAV — so caption timestamps are already in timeline time.
3. `whisper-cli` runs with `-ml 1 -sow` (one word per segment), yielding word-level timestamps directly from the local model.
4. `lib/captions/chunk.ts` splits the words into punchy 3–6 word TikTok chunks (breaking on sentence punctuation, silence gaps, and length caps) with word timings preserved for the spoken-word highlight.

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

One button turns raw phone clips into a paced 9:16 short. The editor "watches and listens" to the footage with two fast local FFmpeg passes per file (cached in `data/analysis/`):

- **audio** → energy envelope (cheers, laughs, shouts), overall loudness, and a beat grid (BPM + phase) when the audio is musical;
- **video** → a motion curve (tackles, sprints, celebrations) and scene-change instants.

Those signals are fused with the transcript (when there is one) into a single edit recipe:

- **Highlights** — audio-burst + motion-spike moments (a goal and the roar after it) are detected, listed in the panel, protected from cutting, and given punch-in zooms.
- **Hook cold-open** — the strongest spoken hook opens the video; with no usable speech, the biggest detected *moment* opens it instead. Football montages work with zero dialogue.
- **Cuts** — silence, filler words and stutters (from the transcript) plus *dead space* (low energy + low motion) are removed; kept fragments under 0.6 s are absorbed so there's no stutter-cutting, and an over-cut guard keeps at least ~30 % of the footage.
- **Music-synced cutting** — the **Add music** button (AI Edit panel, or "Music" on any audio in the media bin) uploads a song and sets it as the soundtrack in one click. Montage cut points are then **phase-locked to the song's actual beat instants** (drift-corrected, half-tempo-aware detection), not just beat-length multiples. Footage without music falls back to an **energy-onset grid** (ball strikes, cheers), so beat-synced cutting always works.
- **Intentional zooms** — punch-ins land on reactions (anchored high, for faces), action and emphasized sentences; filler pattern-interrupts only fill long uneventful gaps, and total zoom density is capped so it never feels random.
- **Regenerate** — one click undoes the edit and cuts a *different take* (deterministic seed: alternate hook, shifted interrupts, varied zoom scales).
- **Loudness-normalized export** — the final mix is normalized to −14 LUFS (the TikTok/Reels standard) so clips shot at different distances sit at one level.

Styles (Viral / Clean / Podcast / Sports / Storytime / Educational / Meme) tune all thresholds — **Sports** cuts hardest, zooms strongest and opens on the biggest moment. Everything runs locally; if analysis or transcription fails, the editor gracefully falls back to whatever evidence it has.

### Football montage presets

The montage engine (`lib/autoEdit/montage.ts`) ships seven presets with real pacing/effect differences — **Hype** (fastest cuts, big zooms), **Clean Recap** (chronological, calm), **Street Football** (gritty, tight), **Goals & Reactions** (action + the celebration after it, slow-mo on the top moment), **Community** (people-first), **Interview + Match** (best spoken lines interleaved with action) and **Sponsor Recap** (clean, partner-friendly, end card). Target length is 10/15/20/30s or custom (8–60s). After a cut, one-tap regenerate modifiers — **Faster · More goals · More reactions · Less effects** — recut a meaningfully different take that keeps your preset.

## Features

- **Start screen** — first-run onboarding with drag-and-drop upload, workflow explanation and recent projects.
- **Upload** — drag & drop, multiple videos, vertical or horizontal (anything is cover-cropped to 9:16); friendly errors for unsupported/oversized files (512 MB cap); media bin shows real thumbnails, duration/orientation badges and analysis status.
- **Timeline** — scrub, play/pause (Space), trim by dragging clip edges (Shift disables snapping), split at playhead (S), delete (Del), duplicate (Ctrl+D), copy/paste (Ctrl+C/V), drag-reorder, **multi-select** (Ctrl/Cmd-click, group delete), Home/End jumps, zoom in/out, filmstrip thumbnails + audio waveforms.
- **Effects** — punch-in zooms, **freeze-frames** (hold the frame while music keeps playing), **flash pops** (soft white accent — 40 ms attack, 0.75 peak, smooth decay; never a white-out) and one-click **instant replay** (last 3 s repeated in slow-mo with a zoom) — all previewed live and rendered identically in the export.
- **Inspector** — Premiere-style contextual panel: clip timing/speed/volume/fades, text style, transform (position/scale/rotation/opacity) with reset, zoom strength/anchor, caption text + timing, project format + overview.
- **Preview** — **format-aware** (9:16 / 1:1 / 16:9 — switch in the transport bar or Inspector; captions and overlays scale exactly like the export), accurate multi-track playback, **drag text/stickers/images directly in the preview**, scrubber, theater/fullscreen mode, buffering indicator, TikTok safe-zone guides.
- **Auto Captions** — one button; editable line-by-line (text + start/end times), click a caption to jump to it, add captions manually.
- **Styling** — 5 presets (TikTok Bold, MrBeast Style, Clean Minimal, Podcast Clip, Meme Style) plus full control: font, size, weight, colors, stroke, shadow, background box + opacity, ALL CAPS, spoken-word highlight, and three TikTok-safe positions.
- **Safe zones** — toggleable overlay showing TikTok's top UI, right button rail and bottom caption/music areas.
- **Projects** — everything autosaves to `data/projects` (1.2 s debounce); the last project reopens automatically, and the Projects menu lets you switch/delete.

## Notes & limitations (MVP)

- Best for videos **under 3 minutes** (the UI warns above that). Local transcription with the `base` model runs at roughly realtime on a typical CPU.
- The bundled whisper.cpp build is CPU-only; for GPU speed, build whisper.cpp with CUDA/Metal yourself and point `WHISPER_CPP_PATH` at it.
- Fonts must exist on the machine that runs the export (the presets stick to Windows/mac-safe families: Arial, Arial Black, Impact, Segoe UI, Verdana, …).
- The caption background box renders with rounded corners in the preview but square corners in the export (libass limitation); background replaces stroke/shadow in both.
- No optical video stabilization yet — for shaky phone footage, shoot with the phone's built-in stabilization on.

## TODO (post-MVP)

- [ ] Timeline zoom + drag-to-reorder clips
- [ ] Live transcription progress bar (whisper.cpp progress → SSE)
- [ ] Karaoke-style progressive word fill (ASS `\k` tags) as an alternative highlight mode
- [ ] Background music track + volume ducking
- [ ] Export queue UI with cancel; clean up old exports automatically
- [ ] SRT/VTT import & export
- [ ] Blurred-background "fit" mode as an alternative to center-crop for horizontal footage
