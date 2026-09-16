import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Device inventory must not discover a Project through the caller's cwd.
export async function withProbeWorkingDirectory<T>(
  probe: (workingDirectory: string) => Promise<T>
): Promise<T> {
  const workingDirectory = await mkdtemp(join(tmpdir(), "openmeld-inventory-"));
  try {
    return await probe(await realpath(workingDirectory));
  } finally {
    await rm(workingDirectory, { force: true, recursive: true });
  }
}
