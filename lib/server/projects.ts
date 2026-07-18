import fs from "fs";
import path from "path";
import type { Project, ProjectSummary } from "@/types";
import { PROJECTS_DIR, ensureDataDirs, safeId } from "./paths";

const BLOB_PREFIX = "projects/";

function usesBlob(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

async function readBlobProject(pathname: string): Promise<Project | null> {
  const { get } = await import("@vercel/blob");
  const result = await get(pathname, { access: "public", useCache: false });
  if (!result || result.statusCode !== 200) return null;
  return JSON.parse(await new Response(result.stream).text()) as Project;
}

/** Simple JSON-file project store under data/projects. */

export async function listProjects(): Promise<ProjectSummary[]> {
  if (usesBlob()) {
    const { list } = await import("@vercel/blob");
    const summaries: ProjectSummary[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: BLOB_PREFIX, cursor, limit: 100 });
      for (const blob of page.blobs) {
        if (!blob.pathname.endsWith(".json")) continue;
        try {
          const project = await readBlobProject(blob.pathname);
          if (project) summaries.push(toSummary(project));
        } catch {
          // Ignore a malformed project without hiding the rest.
        }
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  ensureDataDirs();
  const files = await fs.promises.readdir(PROJECTS_DIR);
  const summaries: ProjectSummary[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await fs.promises.readFile(path.join(PROJECTS_DIR, file), "utf8");
      const project = JSON.parse(raw) as Project;
      summaries.push(toSummary(project));
    } catch {
      // skip corrupted project files rather than failing the whole list
    }
  }
  return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadProject(id: string): Promise<Project | null> {
  const projectId = safeId(id);
  if (usesBlob()) return readBlobProject(`${BLOB_PREFIX}${projectId}.json`);

  ensureDataDirs();
  const file = path.join(PROJECTS_DIR, `${projectId}.json`);
  try {
    return JSON.parse(await fs.promises.readFile(file, "utf8")) as Project;
  } catch {
    return null;
  }
}

export async function saveProject(project: Project): Promise<void> {
  const projectId = safeId(project.id);
  if (usesBlob()) {
    const { put } = await import("@vercel/blob");
    await put(`${BLOB_PREFIX}${projectId}.json`, JSON.stringify(project), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
    });
    return;
  }

  ensureDataDirs();
  const file = path.join(PROJECTS_DIR, `${projectId}.json`);
  await fs.promises.writeFile(file, JSON.stringify(project, null, 2), "utf8");
}

export async function deleteProject(id: string): Promise<void> {
  const projectId = safeId(id);
  if (usesBlob()) {
    const { del } = await import("@vercel/blob");
    await del(`${BLOB_PREFIX}${projectId}.json`);
    return;
  }

  const file = path.join(PROJECTS_DIR, `${projectId}.json`);
  await fs.promises.rm(file, { force: true });
}

function toSummary(project: Project): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    updatedAt: project.updatedAt,
    clipCount: project.clips?.length ?? 0,
  };
}
