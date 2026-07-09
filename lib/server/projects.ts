import fs from "fs";
import path from "path";
import type { Project, ProjectSummary } from "@/types";
import { PROJECTS_DIR, ensureDataDirs, safeId } from "./paths";

/** Simple JSON-file project store under data/projects. */

export async function listProjects(): Promise<ProjectSummary[]> {
  ensureDataDirs();
  const files = await fs.promises.readdir(PROJECTS_DIR);
  const summaries: ProjectSummary[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await fs.promises.readFile(path.join(PROJECTS_DIR, file), "utf8");
      const project = JSON.parse(raw) as Project;
      summaries.push({
        id: project.id,
        name: project.name,
        updatedAt: project.updatedAt,
        clipCount: project.clips?.length ?? 0,
      });
    } catch {
      // skip corrupted project files rather than failing the whole list
    }
  }
  return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadProject(id: string): Promise<Project | null> {
  ensureDataDirs();
  const file = path.join(PROJECTS_DIR, `${safeId(id)}.json`);
  try {
    return JSON.parse(await fs.promises.readFile(file, "utf8")) as Project;
  } catch {
    return null;
  }
}

export async function saveProject(project: Project): Promise<void> {
  ensureDataDirs();
  const file = path.join(PROJECTS_DIR, `${safeId(project.id)}.json`);
  await fs.promises.writeFile(file, JSON.stringify(project, null, 2), "utf8");
}

export async function deleteProject(id: string): Promise<void> {
  const file = path.join(PROJECTS_DIR, `${safeId(id)}.json`);
  await fs.promises.rm(file, { force: true });
}
