import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/** Write a file atomically: temp file next to it, then rename over it. */
export async function writeAtomic(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now().toString(36)}.tmp`);
  try {
    await writeFile(tmp, text, { flag: "wx" });
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}
