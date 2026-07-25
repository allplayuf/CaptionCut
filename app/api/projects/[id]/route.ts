import { NextResponse } from "next/server";
import { deleteProject, loadProject } from "@/lib/server/projects";
import { workspaceId } from "@/lib/server/workspace";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (process.env.VERCEL && !process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: "Cloud storage is not configured." }, { status: 503 });
  }
  const { id } = await params;
  try {
    const project = await loadProject(await workspaceId(), id);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    return NextResponse.json(project);
  } catch {
    return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (process.env.VERCEL && !process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: "Cloud storage is not configured." }, { status: 503 });
  }
  const { id } = await params;
  try {
    await deleteProject(await workspaceId(), id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not delete the project." }, { status: 500 });
  }
}
