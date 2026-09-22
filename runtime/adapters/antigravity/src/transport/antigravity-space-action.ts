import { spawn } from "node:child_process";
import { resolveDispatchSpaceActionMcpServer } from "@openmeld/adapter-core";

const FINAL_STATUSES = new Set(["done", "blocked", "needs_input", "handoff"]);

export const ANTIGRAVITY_SPACE_ACTION_JSON_SCHEMA = JSON.stringify({
  additionalProperties: false,
  properties: {
    action: { enum: ["reply", "status", "silent"], type: "string" },
    mentionTargets: { items: { type: "string" }, type: "array" },
    referenceTargets: { items: { type: "string" }, type: "array" },
    status: {
      enum: ["none", "done", "blocked", "needs_input", "handoff"],
      type: "string",
    },
    text: { minLength: 1, type: "string" },
    wakeTargets: { items: { type: "string" }, type: "array" },
  },
  required: [
    "action",
    "text",
    "status",
    "wakeTargets",
    "referenceTargets",
    "mentionTargets",
  ],
  type: "object",
});

type AntigravityStructuredSpaceAction = {
  action: "reply" | "silent" | "status";
  mentionTargets: string[];
  referenceTargets: string[];
  status: "blocked" | "done" | "handoff" | "needs_input" | "none";
  text: string;
  wakeTargets: string[];
};

export async function withAntigravityDispatchSpaceAction<
  T extends { structuredOutput: unknown },
>(input: {
  env: Record<string, string | undefined> | undefined;
  prompt: string;
  workdir: string;
  run: (input: { prompt: string; jsonSchema: string | null }) => Promise<T>;
}): Promise<T> {
  const actionServer = resolveDispatchSpaceActionMcpServer(input.env);
  if (!actionServer) {
    return await input.run({ prompt: input.prompt, jsonSchema: null });
  }

  const result = await input.run({
    prompt: `${input.prompt}\n\n${buildSpaceActionInstructions(input.workdir)}`,
    jsonSchema: ANTIGRAVITY_SPACE_ACTION_JSON_SCHEMA,
  });
  await recordStructuredSpaceAction({
    action: parseStructuredSpaceAction(result.structuredOutput),
    actionServer,
  });
  return result;
}

function buildSpaceActionInstructions(workdir: string): string {
  return [
    "OpenMeld Antigravity invocation contract:",
    `The working folder for this invocation is ${JSON.stringify(workdir)}. Resolve relative task paths there.`,
    "For this OpenMeld Wake, do not run a Space Action CLI command and do not inspect its environment variables.",
    "The structured outcome below is the complete reply/publication contract. Reading the OpenMeld CLI Skill is not required to reply; consult it only for additional OpenMeld operations requested by the user.",
    "If the request can be answered without tools, return the structured outcome immediately; do not inspect the workspace or run a command just to orient yourself.",
    "Complete the user's work under the normal Antigravity permission policy.",
    "At the end, return exactly one structured outcome using the required JSON schema: reply for a public message, status for a short final status, or silent when no public reply is appropriate.",
    "Put the public reply, status text, or silence reason in text.",
    "Use status=none unless action=status. Include only validated profile IDs from the provided target reference lists; otherwise leave all target arrays empty.",
    "OpenMeld will validate and record this outcome for the current dispatch.",
  ].join(" ");
}

function parseStructuredSpaceAction(
  value: unknown
): AntigravityStructuredSpaceAction {
  const record = toRecord(value);
  const action = record?.action;
  const status = record?.status;
  const text = normalizeRequiredText(record?.text);
  const wakeTargets = parseTargetIds(record?.wakeTargets);
  const referenceTargets = parseTargetIds(record?.referenceTargets);
  const mentionTargets = parseTargetIds(record?.mentionTargets);
  if (
    (action !== "reply" && action !== "status" && action !== "silent") ||
    (status !== "none" && !FINAL_STATUSES.has(String(status))) ||
    !text ||
    wakeTargets === null ||
    referenceTargets === null ||
    mentionTargets === null
  ) {
    throw createSpaceActionError(
      "Antigravity returned an invalid structured Space outcome."
    );
  }
  if (
    (action === "status" && !FINAL_STATUSES.has(String(status))) ||
    (action !== "status" && status !== "none") ||
    (action !== "reply" &&
      (wakeTargets.length > 0 ||
        referenceTargets.length > 0 ||
        mentionTargets.length > 0))
  ) {
    throw createSpaceActionError(
      "Antigravity returned an inconsistent structured Space outcome."
    );
  }
  return {
    action,
    mentionTargets,
    referenceTargets,
    status: status as AntigravityStructuredSpaceAction["status"],
    text,
    wakeTargets,
  };
}

async function recordStructuredSpaceAction(input: {
  action: AntigravityStructuredSpaceAction;
  actionServer: NonNullable<
    ReturnType<typeof resolveDispatchSpaceActionMcpServer>
  >;
}): Promise<void> {
  const baseArgs = input.actionServer.args.slice(0, -1);
  let args: string[];
  let stdin = "";
  if (input.action.action === "reply") {
    args = [...baseArgs, "reply", "--message-file", "-"];
    stdin = input.action.text;
    appendTargetArgs(args, "--wake", input.action.wakeTargets);
    appendTargetArgs(args, "--reference", input.action.referenceTargets);
    appendTargetArgs(args, "--mention", input.action.mentionTargets);
  } else if (input.action.action === "status") {
    args = [...baseArgs, "status", input.action.status, input.action.text];
  } else {
    args = [...baseArgs, "silent", "--reason", input.action.text];
  }

  await runActionWriter({
    args,
    commandPath: input.actionServer.commandPath,
    env: input.actionServer.env,
    stdin,
  });
}

function appendTargetArgs(
  args: string[],
  option: "--mention" | "--reference" | "--wake",
  values: readonly string[]
): void {
  for (const value of values) {
    args.push(option, value);
  }
}

async function runActionWriter(input: {
  args: readonly string[];
  commandPath: string;
  env: Record<string, string>;
  stdin: string;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(input.commandPath, [...input.args], {
      env: { ...process.env, ...input.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      reject(createSpaceActionError(error.message));
    });
    child.once("close", (code, signal) => {
      if (code === 0 && signal === null) {
        resolve();
        return;
      }
      reject(
        createSpaceActionError(
          normalizeRequiredText(stderr) ??
            `The Space outcome writer exited with code ${String(code)}.`
        )
      );
    });
    child.stdin.end(input.stdin);
  });
}

function createSpaceActionError(message: string): Error {
  return Object.assign(new Error(message), {
    code: "space.action.record_failed",
    errorType: "adapter",
  });
}

function parseTargetIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const values = value.map(normalizeRequiredText);
  if (values.some((item) => item === null)) {
    return null;
  }
  return values as string[];
}

function normalizeRequiredText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
