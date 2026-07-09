# CaptionCut 🎬

A fast, TikTok-first video editor with one killer feature: **automatic captions that actually work**.

Upload a video → trim/split/reorder clips → hit **Auto Captions** → style them (TikTok Bold, MrBeast, Podcast Clip, …) → export a 1080×1920 MP4 with the captions burned in.

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

> Tip: generate captions **after** you finish trimming — captions are timed to the timeline and don't shift when clips change.

## How export works

1. `POST /api/export` starts a background FFmpeg job; the client polls `GET /api/export/:jobId` for progress (parsed from FFmpeg's `time=` output) and downloads from `/api/export/:jobId/download`.
2. The FFmpeg filter graph (`lib/export/exporter.ts`):
   - trims each clip (`trim`/`atrim`), scales + center-crops to **1080×1920** (matching the preview's `object-fit: cover`), normalizes to 30 fps,
   - concatenates all clips (silent clips get generated silence so audio stays aligned),
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
lib/video/         timeline math (shared client/server), client upload helpers
lib/audio/         browser waveform peak extraction
types/             shared TypeScript types (Caption, Clip, CaptionStyle, Project, …)
data/              user data: uploads, projects, exports (gitignored)
```

## Features

- **Upload** — drag & drop, multiple videos, vertical or horizontal (anything is cover-cropped to 9:16); friendly errors for unsupported/oversized files (512 MB cap).
- **Timeline** — scrub, play/pause (Space), trim by dragging clip edges, split at playhead (S), delete (Del), reorder, audio waveforms (WebAudio-decoded, with a placeholder pattern when the codec can't be decoded in-browser).
- **Auto Captions** — one button; editable line-by-line (text + start/end times), click a caption to jump to it, add captions manually.
- **Styling** — 5 presets (TikTok Bold, MrBeast Style, Clean Minimal, Podcast Clip, Meme Style) plus full control: font, size, weight, colors, stroke, shadow, background box + opacity, ALL CAPS, spoken-word highlight, and three TikTok-safe positions.
- **Safe zones** — toggleable overlay showing TikTok's top UI, right button rail and bottom caption/music areas.
- **Projects** — everything autosaves to `data/projects` (1.2 s debounce); the last project reopens automatically, and the Projects menu lets you switch/delete.

## Notes & limitations (MVP)

- Best for videos **under 3 minutes** (the UI warns above that). Local transcription with the `base` model runs at roughly realtime on a typical CPU.
- The bundled whisper.cpp build is CPU-only; for GPU speed, build whisper.cpp with CUDA/Metal yourself and point `WHISPER_CPP_PATH` at it.
- Fonts must exist on the machine that runs the export (the presets stick to Windows/mac-safe families: Arial, Arial Black, Impact, Segoe UI, Verdana, …).
- The caption background box renders with rounded corners in the preview but square corners in the export (libass limitation); background replaces stroke/shadow in both.
- Captions are timed to the timeline, so re-trimming after captioning shifts content under them — regenerate or adjust times.

## TODO (post-MVP)

- [ ] Timeline zoom + drag-to-reorder clips
- [ ] Live transcription progress bar (whisper.cpp progress → SSE)
- [ ] Karaoke-style progressive word fill (ASS `\k` tags) as an alternative highlight mode
- [ ] Background music track + volume ducking
- [ ] Export queue UI with cancel; clean up old exports automatically
- [ ] SRT/VTT import & export
- [ ] Blurred-background "fit" mode as an alternative to center-crop for horizontal footage
