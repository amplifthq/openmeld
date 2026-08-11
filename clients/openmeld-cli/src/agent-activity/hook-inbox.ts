import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  link,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { agentActivityEventSchema } from "@openmeld/schemas";
import type { AgentActivityEvent } from "@openmeld/schemas/types";
import { z } from "zod/v4";
import { resolveOpenMeldRootDir } from "../config/paths";
import { recordAgentActivityHookProjection } from "./hook-projection-store";
import { enqueueAgentActivityEvent } from "./local-event-store";
import { listProjectBindings } from "./project-bindings";

const MAX_INBOX_FILES = 10_000;
const DRAIN_BATCH_SIZE = 64;
const inboxRecordSchema = z.strictObject({
  bindingGeneration: z.string().trim().min(1).max(128),
  event: agentActivityEventSchema,
  version: z.literal(1),
});
type InboxRecord = z.infer<typeof inboxRecordSchema>;

export async function enqueueAgentActivityHookEvent(input: {
  bindingGeneration: string;
  event: AgentActivityEvent;
  rootDir?: string;
}): Promise<"queued" | "reused"> {
  const record = inboxRecordSchema.parse({
    bindingGeneration: input.bindingGeneration,
    event: input.event,
    version: 1,
  });
  const directory = await ensureInbox(input);
  const names = await readdir(directory);
  if (
    names.filter((name) => name.endsWith(".json")).length >= MAX_INBOX_FILES
  ) {
    throw new Error(
      `Agent Activity hook inbox reached its ${MAX_INBOX_FILES} event safety limit.`
    );
  }
  const json = `${JSON.stringify(record)}\n`;
  const target = join(directory, `${recordId(record)}.json`);
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, json, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    try {
      await link(temporary, target);
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) {
        throw error;
      }
      if ((await readFile(target, "utf8")) !== json) {
        throw new Error("Agent Activity hook inbox id conflict.");
      }
      return "reused";
    }
    await chmod(target, 0o600);
  } finally {
    await rm(temporary, { force: true });
  }
  return "queued";
}

export async function drainAgentActivityHookInbox(input: {
  nowMs?: number;
  rootDir?: string;
}) {
  const directory = await ensureInbox(input);
  const bindings = await listProjectBindings({
    rootDir: input.rootDir,
  });
  let observedCount = 0;
  let queuedCount = 0;
  let driftCount = 0;
  const names = (await readdir(directory))
    .filter((entry) => entry.endsWith(".json"))
    .sort()
    .slice(0, DRAIN_BATCH_SIZE);
  for (const name of names) {
    const path = join(directory, name);
    const parsed = await readInboxRecord(path);
    if (!parsed) {
      driftCount += 1;
      await rm(path, { force: true });
      continue;
    }
    observedCount += 1;
    const stillBound = bindings.some(
      (binding) =>
        binding.organizationId === parsed.event.organizationId &&
        binding.projectId === parsed.event.projectId &&
        binding.bindingGeneration === parsed.bindingGeneration
    );
    if (stillBound) {
      const outcome = await enqueueAgentActivityEvent({
        event: parsed.event,
        nowMs: input.nowMs,
        rootDir: input.rootDir,
      });
      if (outcome === "queued") {
        queuedCount += 1;
      }
      if (outcome !== "unbound") {
        await recordAgentActivityHookProjection({
          event: parsed.event,
          rootDir: input.rootDir,
        });
      }
    }
    await rm(path, { force: true });
  }
  return { driftCount, observedCount, queuedCount };
}

export async function removeProjectInbox(input: {
  organizationId: string;
  projectId: string;
  rootDir?: string;
}) {
  const directory = await ensureInbox(input);
  let removed = 0;
  for (const name of await readdir(directory)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const path = join(directory, name);
    const record = await readInboxRecord(path);
    if (
      record?.event.organizationId === input.organizationId &&
      record.event.projectId === input.projectId
    ) {
      await rm(path, { force: true });
      removed += 1;
    }
  }
  return removed;
}

function recordId(record: InboxRecord) {
  return createHash("sha256").update(JSON.stringify(record)).digest("hex");
}

async function readInboxRecord(path: string): Promise<InboxRecord | null> {
  return await readFile(path, "utf8")
    .then((raw) => {
      const parsed = inboxRecordSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    })
    .catch(() => null);
}

async function ensureInbox(input: { rootDir?: string }) {
  const directory = join(
    input.rootDir ?? resolveOpenMeldRootDir(),
    "device",
    "agent-activity",
    "inbox"
  );
  await mkdir(directory, { mode: 0o700, recursive: true });
  return directory;
}

function isNodeError(error: unknown, code: string) {
  return (
    error instanceof Error && "code" in error && String(error.code) === code
  );
}
