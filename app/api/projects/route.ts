import { NextRequest, NextResponse } from "next/server";
import type { Project } from "@/types";
import { listProjects, saveProject } from "@/lib/server/projects";
import { workspaceId } from "@/lib/server/workspace";
import {
  jsonTooLarge,
  MAX_PROJECT_BYTES,
  requestTooLarge,
  validateProjectPayload,
} from "@/lib/server/requestValidation";

export const runtime = "nodejs";

export async function GET() {
  if (process.env.VERCEL && !process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Cloud storage is not configured." },
      { status: 503 }
    );
  }
  try {
    return NextResponse.json(await listProjects(await workspaceId()), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Could not list projects." }, { status: 500 });
  }
}

/** Upsert a project (used by the editor's autosave). */
export async function POST(request: NextRequest) {
  if (process.env.VERCEL && !process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Cloud storage is not configured." },
      { status: 503 }
    );
  }
  if (requestTooLarge(request, MAX_PROJECT_BYTES)) {
    return NextResponse.json({ error: "Project is too large." }, { status: 413 });
  }
  let project: Project;
  try {
    project = (await request.json()) as Project;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (jsonTooLarge(project, MAX_PROJECT_BYTES)) {
    return NextResponse.json({ error: "Project is too large." }, { status: 413 });
  }
  const validationError = validateProjectPayload(project);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

  try {
    await saveProject(await workspaceId(), {
      ...project,
      name: project.name.trim() || "Namnlöst projekt",
      updatedAt: Date.now(),
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not save the project." }, { status: 500 });
  }
}
