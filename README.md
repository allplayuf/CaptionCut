# CaptionCut

A transcript-first video editor for removing pauses, cutting unwanted parts,
creating captions and exporting social video without fighting a crowded UI.

The main workflow is intentionally short:

1. Import video.
2. Organize source files in searchable project folders.
3. Select many clips and append them as one contiguous sequence.
4. Find and review pauses, or open Smart editing for a complete first cut.
5. Cut by clicking the transcript or splitting the timeline.
6. Add polished motion effects, generate captions and export an MP4.

The editor still includes advanced sequence, styling and auto-edit tools under
**Mer**, but they no longer compete with the core cutting workflow.

The workspace is adjustable: drag the divider beside the tool panel or above
the timeline to give the current task more room. Sizes persist on the device,
the tool panel can collapse to its rail, and the timeline can switch between
active tracks and every available layer.

## Local development

Requirements: Node.js 20+ and npm.

```bash
npm install
copy .env.example .env.local
npm run dev
```

Open <http://localhost:3000>. FFmpeg and FFprobe are bundled. Local captions use
whisper.cpp by default and download the selected model on first use. To prepare
it ahead of time:

```bash
npm run setup-whisper
```

## Production deployment on Vercel

1. Import this repository into Vercel or run `npx vercel`.
2. Create and connect a Vercel Blob store. Confirm that
   `BLOB_READ_WRITE_TOKEN` is available to Production.
3. Deployed captions use Vercel AI Gateway with the Function's short-lived OIDC
   identity. No transcription secret needs to be added. Vercel requires a
   payment method on the team before it unlocks the included AI Gateway credit;
   configure a spend limit before sharing the app broadly.
4. Optionally configure Google Drive with the variables below.
5. Deploy, then open `/api/health`. A launch-ready deployment returns HTTP 200
   with Blob storage and both media tools ready.

Uploads go directly from the browser to Blob and are capped at 500 MB. Projects,
export status and completed MP4 files are also stored in Blob. FFmpeg only uses
the Function's `/tmp` directory as short-lived working space. Functions are
configured for a five-minute maximum, so the hosted beta is best for short-form
projects.

### Anonymous workspaces

Every browser receives a long-lived, HttpOnly workspace cookie. Project lists
and new media paths are separated per workspace, so friends using different
machines get independent editors without creating accounts. Clearing site data
loses the workspace pointer, and projects do not sync between browsers yet.

This is an invite-only beta model, not authenticated collaboration. Blob media
URLs are public, unguessable URLs. Do not use it for confidential footage.
Direct upload token creation has a best-effort 20-files-per-hour burst limit per
browser/IP.

## Environment variables

```env
# Required in production
BLOB_READ_WRITE_TOKEN=

# Optional Vercel AI Gateway override
# AI_GATEWAY_TRANSCRIPTION_MODEL=openai/whisper-1
# TRANSCRIPTION_PROVIDER=gateway

# Optional direct OpenAI provider for non-Vercel hosting
# OPENAI_API_KEY=
# OPENAI_WHISPER_MODEL=whisper-1
# TRANSCRIPTION_PROVIDER=openai

# Optional Google Drive Picker
GOOGLE_DRIVE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_DRIVE_API_KEY=...
GOOGLE_DRIVE_APP_ID=...

# Optional local whisper.cpp tuning
# TRANSCRIPTION_PROVIDER=local-whisper
# WHISPER_MODEL=small
# WHISPER_CPP_PATH=
```

For Google Drive, enable both Google Picker API and Google Drive API in one
Google Cloud project. Add each deployed origin to the OAuth web client's
authorized JavaScript origins. While the consent screen is in Testing, add each
friend as a test user. Imported files are copied to CaptionCut storage; Drive
tokens are never saved. Drive imports are capped at 400 MB on Vercel.

## Commands

```bash
npm run lint
npm run build
npx tsx scripts/verify-editor-workflows.ts
npx tsx scripts/verify-pipeline.ts
npx tsx scripts/verify-montage.ts
npx tsx scripts/verify-layers.ts
npx tsx scripts/verify-formats.ts
npx tsx scripts/verify-effects.ts
npx tsx scripts/verify-fast-interview.ts
npx tsx scripts/verify-drive-pairing.ts
# With a linked Vercel project and a short test audio file:
npx tsx scripts/verify-gateway.ts path/to/test.wav
```

## Architecture

- `app/` — editor and API routes for uploads, projects, transcription and export
- `components/` — focused workspace, preview, timeline and advanced panels
- `hooks/` — Zustand editor state, autosave and history
- `lib/video/` — client uploads and timeline math
- `lib/transcription/` — local, OpenAI and mock providers
- `lib/export/` — FFmpeg render pipeline and persisted job manager
- `lib/server/` — Blob/local project storage, media materialization and binaries
- `lib/autoEdit/` — silence, filler, highlight and sequence analysis

The timeline remains non-destructive: cuts update clip ranges, captions stay
anchored to source time, and exports render from the same track state shown in
the editor.
