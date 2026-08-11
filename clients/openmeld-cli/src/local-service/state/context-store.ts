import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirnamePath, normalizeOptionalText } from "../core/logger";

export async function loadContextStore(
  contextStorePath: string
): Promise<Map<string, string>> {
  const raw = await readFile(contextStorePath, "utf8").catch(() => "");
  if (!raw) {
    return new Map();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Map();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return new Map();
  }
  const contextStore = new Map<string, string>();
  for (const [key, value] of Object.entries(parsed)) {
    const normalizedKey = normalizeOptionalText(key);
    const normalizedValue = normalizeOptionalText(value);
    if (!(normalizedKey && normalizedValue)) {
      continue;
    }
    contextStore.set(normalizedKey, normalizedValue);
  }
  return contextStore;
}

export async function persistContextStore(input: {
  contextStore: Map<string, string>;
  contextStorePath: string;
}): Promise<void> {
  const payload = Object.fromEntries(input.contextStore.entries());
  const tempPath = `${input.contextStorePath}.tmp-${Date.now()}-${process.pid}`;
  await mkdir(dirnamePath(input.contextStorePath), {
    recursive: true,
  });
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(tempPath, input.contextStorePath).catch(async (error) => {
    await rm(tempPath, {
      force: true,
    }).catch(() => undefined);
    throw error;
  });
}
