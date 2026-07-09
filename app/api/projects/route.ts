import { NextRequest, NextResponse } from "next/server";
import type { Project } from "@/types";
import { listProjects, saveProject } from "@/lib/server/projects";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await listProjects());
  } catch {
    return NextResponse.json({ error: "Could not list projects." }, { status: 500 });
  }
}

/** Upsert a project (used by the editor's autosave). */
export async function POST(request: NextRequest) {
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
    await saveProject({ ...project, updatedAt: Date.now() });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not save the project." }, { status: 500 });
  }
}
