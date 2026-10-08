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
  version: z.literal(2),
  policy: sessionHistoryPolicySchema,
  entries: z.array(sessionHistoryAuditSchema).max(200),
});
// A per-Agent grant must never silently become permission for every delegated
// Agent. Retain selected folders and audit metadata, but require owner consent
// to enable the simpler v2 policy. Old binaries cannot read the v2 store.
const legacyStoreSchema = storeSchema.extend({
  version: z.literal(1),
  policy: sessionHistoryPolicySchema.extend({
    readerProfileIds: z.array(z.string()).max(64),
  }),
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
  if (body === null) {
    return storeSchema.parse({
      version: 2,
      policy: {
        enabled: false,
        connections: [],
        revision: 1,
        updatedAtMs: 0,
      },
      entries: [],
    });
  }
  const parsed: unknown = JSON.parse(body);
  const legacy = legacyStoreSchema.safeParse(parsed);
  if (legacy.success) {
    const { readerProfileIds: _readers, ...policy } = legacy.data.policy;
    return storeSchema.parse({
      ...legacy.data,
      version: 2,
      policy: { ...policy, enabled: false, revision: policy.revision + 1 },
    });
  }
  return storeSchema.parse(parsed);
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
