import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";

type SafeParseResult<T> = { success: true; data: T } | { success: false };

type DaemonLocalStateSchema<T> = {
  safeParse: (value: unknown) => SafeParseResult<T>;
};

export async function readDaemonLocalStateFile<T>(input: {
  path: string;
  schema: DaemonLocalStateSchema<T>;
}): Promise<T | null> {
  const raw = await readFile(input.path, "utf8").catch((error) => {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  });
  if (raw === null) {
    return null;
  }

  const parsedJson = safeParseJson(raw);
  if (parsedJson === null) {
    return null;
  }
  const parsed = input.schema.safeParse(parsedJson);
  return parsed.success ? parsed.data : null;
}

export async function writeDaemonLocalStateFile<T>(input: {
  path: string;
  schema: DaemonLocalStateSchema<T>;
  value: T;
  mode?: number;
}): Promise<void> {
  const parsed = input.schema.safeParse(input.value);
  if (!parsed.success) {
    throw new Error(`invalid daemon local state for ${input.path}`);
  }

  await mkdir(dirname(input.path), { recursive: true });
  const tempPath = `${input.path}.tmp-${process.pid}-${Date.now()}`;
  let shouldCleanupTemp = true;

  try {
    await writeFile(tempPath, `${JSON.stringify(parsed.data, null, 2)}\n`, {
      encoding: "utf8",
      ...(typeof input.mode === "number" ? { mode: input.mode } : {}),
    });
    await rename(tempPath, input.path);
    if (typeof input.mode === "number") {
      await chmod(input.path, input.mode);
    }
    shouldCleanupTemp = false;
  } finally {
    if (shouldCleanupTemp) {
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
  }
}

function safeParseJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
