import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { systemDir } from "./paths";

const SYSTEM_LAYOUT_SCHEMA = "openmeld-fs-v1";
const SYSTEM_LAYOUT_READ_RETRY_COUNT = 5;
const SYSTEM_LAYOUT_READ_RETRY_DELAY_MS = 20;
const ISO_UTC_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

type SystemLayoutV1 = {
  v: 1;
  schema: typeof SYSTEM_LAYOUT_SCHEMA;
  createdAt: string;
  updatedAt: string;
};

export async function ensureSystemLayout(): Promise<SystemLayoutV1> {
  const path = systemLayoutPath();
  const existing = await readSystemLayoutWithRetry(path);
  if (existing) {
    return existing;
  }

  await mkdir(systemDir(), { recursive: true });

  const now = new Date().toISOString();
  const next: SystemLayoutV1 = {
    v: 1,
    schema: SYSTEM_LAYOUT_SCHEMA,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const file = await open(path, "wx");
    try {
      await file.writeFile(`${JSON.stringify(next, null, 2)}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    return next;
  } catch (error) {
    if (
      !(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "EEXIST"
      )
    ) {
      throw error;
    }
  }

  const racedExisting = await readSystemLayoutWithRetry(path);
  if (racedExisting) {
    return racedExisting;
  }

  // Keep legacy behavior: repair invalid/corrupt layout payloads in place.
  // False-positive note: corrupt payload fields (including createdAt) are treated
  // as untrusted, so repair intentionally writes a fresh canonical timestamp.
  await writeLayoutRepairAtomically(path, next);
  return next;
}

function systemLayoutPath(): string {
  return join(systemDir(), "layout.json");
}

function parseSystemLayout(raw: string): SystemLayoutV1 | null {
  let parsed: Partial<SystemLayoutV1>;
  try {
    parsed = JSON.parse(raw) as Partial<SystemLayoutV1>;
  } catch {
    return null;
  }
  if (
    parsed &&
    typeof parsed === "object" &&
    typeof parsed.v === "number" &&
    parsed.v > 1
  ) {
    throw new Error(
      "This OpenMeld version cannot read the newer local layout. Update OpenMeld to continue. Your local data has been preserved."
    );
  }
  try {
    if (parsed.v !== 1) {
      return null;
    }
    if (parsed.schema !== SYSTEM_LAYOUT_SCHEMA) {
      return null;
    }
    if (typeof parsed.createdAt !== "string") {
      return null;
    }
    if (!isValidTimestamp(parsed.createdAt)) {
      return null;
    }
    if (typeof parsed.updatedAt !== "string") {
      return null;
    }
    if (!isValidTimestamp(parsed.updatedAt)) {
      return null;
    }
    return {
      v: 1,
      schema: SYSTEM_LAYOUT_SCHEMA,
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return null;
  }
}

async function readSystemLayoutWithRetry(
  path: string
): Promise<SystemLayoutV1 | null> {
  for (
    let attempt = 0;
    attempt < SYSTEM_LAYOUT_READ_RETRY_COUNT;
    attempt += 1
  ) {
    let raw = "";
    try {
      raw = await readFile(path, "utf8");
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return null;
      }
      throw error;
    }

    const parsed = raw ? parseSystemLayout(raw) : null;
    if (parsed) {
      return parsed;
    }
    if (attempt < SYSTEM_LAYOUT_READ_RETRY_COUNT - 1) {
      await delay(SYSTEM_LAYOUT_READ_RETRY_DELAY_MS);
    }
  }

  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isValidTimestamp(value: string): boolean {
  if (!ISO_UTC_TIMESTAMP_RE.test(value)) {
    return false;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }
  return parsed.toISOString() === value;
}

async function writeLayoutRepairAtomically(
  path: string,
  next: SystemLayoutV1
): Promise<void> {
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;

  try {
    const file = await open(tempPath, "w");
    try {
      await file.writeFile(`${JSON.stringify(next, null, 2)}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }

    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
