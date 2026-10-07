import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  sessionHistoryAuditSchema,
  sessionHistoryPolicySchema,
} from "@openmeld/schemas";
import type {
  SessionHistoryAudit,
  SessionHistoryPolicy,
} from "@openmeld/schemas/types";
import { z } from "zod/v4";

const storeSchema = z.strictObject({
  version: z.literal(1),
  policy: sessionHistoryPolicySchema,
  entries: z.array(sessionHistoryAuditSchema).max(200),
});
const tails = new Map<string, Promise<void>>();
export function sessionHistoryStorePath(
  dataRoot: string,
  owner: string,
  organization: string
) {
  const key = createHash("sha256")
    .update(JSON.stringify([owner, organization]))
    .digest("hex");
  return join(dataRoot, "session-history", `${key}.json`);
}
export async function readSessionHistoryStore(path: string) {
  const body = await readFile(path, "utf8").catch((error: unknown) => {
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
  return body === null
    ? storeSchema.parse({
        version: 1,
        policy: {
          enabled: false,
          connections: [],
          readerProfileIds: [],
          revision: 1,
          updatedAtMs: 0,
        },
        entries: [],
      })
    : storeSchema.parse(JSON.parse(body));
}
export async function updateSessionHistoryStore<T>(
  path: string,
  operation: (store: z.infer<typeof storeSchema>) => T
): Promise<T> {
  const previous = tails.get(path) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  tails.set(path, next);
  await previous;
  try {
    const store = await readSessionHistoryStore(path);
    const result = operation(store);
    const temporary = `${path}.${randomUUID()}.tmp`;
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    try {
      await writeFile(temporary, JSON.stringify(storeSchema.parse(store)), {
        mode: 0o600,
      });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
    return result;
  } finally {
    release();
    if (tails.get(path) === next) {
      tails.delete(path);
    }
  }
}
export async function appendSessionHistoryAudit(
  path: string,
  entry: SessionHistoryAudit,
  expectedRevision?: SessionHistoryPolicy["revision"]
) {
  return await updateSessionHistoryStore(path, (store) => {
    const current =
      expectedRevision === undefined ||
      store.policy.revision === expectedRevision;
    store.entries = [
      {
        ...entry,
        outcome: current ? entry.outcome : "denied",
        count: current ? entry.count : 0,
      },
      ...store.entries,
    ].slice(0, 200);
    return current;
  });
}
