import fs from "fs";
import path from "path";

function temporaryPath(file: string): string {
  return `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
}

/** Write a complete replacement beside the target, then atomically rename it. */
export async function writeFileAtomic(
  file: string,
  data: string | NodeJS.ArrayBufferView
): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const temporary = temporaryPath(file);
  try {
    await fs.promises.writeFile(temporary, data);
    await fs.promises.rename(temporary, file);
  } finally {
    await fs.promises.rm(temporary, { force: true }).catch(() => undefined);
  }
}
/** Synchronous counterpart for analysis cache writes inside the FFmpeg path. */
export function writeFileAtomicSync(file: string, data: string | NodeJS.ArrayBufferView): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = temporaryPath(file);
  try {
    fs.writeFileSync(temporary, data);
    fs.renameSync(temporary, file);
  } finally {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      // Best-effort cleanup; the completed target is already safe.
    }
  }
}
