import { NextRequest, NextResponse } from "next/server";
import type { Project } from "@/types";
import { listProjects, saveProject } from "@/lib/server/projects";
import { workspaceId } from "@/lib/server/workspace";

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
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "Project is too large." }, { status: 413 });
  }
  let project: Project;
  try {
    project = (await request.json()) as Project;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!project?.id || typeof project.name !== "string") {
    return NextResponse.json({ error: "Invalid project payload." }, { status: 400 });
  }

  try {
    await saveProject(await workspaceId(), { ...project, updatedAt: Date.now() });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not save the project." }, { status: 500 });
  }
}
