import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import packageJson from "../../package.json";

export async function seedVersionState(home: string): Promise<void> {
  const openMeldDir = join(home, ".openmeld");
  await mkdir(openMeldDir, { recursive: true });
  const now = new Date().toISOString();
  await writeFile(
    join(openMeldDir, "version.json"),
    `${JSON.stringify(
      {
        v: 1,
        last_version: packageJson.version,
        latest_version: packageJson.version,
        last_checked_at: now,
        dismissed_version: null,
        updated_at: now,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}
