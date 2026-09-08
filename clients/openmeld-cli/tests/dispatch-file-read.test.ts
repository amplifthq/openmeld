import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DISPATCH_OWNED_RUNTIME_MODE } from "../src/runtime/dispatch-runtime-env";
import {
  createDispatchSpaceActionContext,
  readDispatchSpaceActionRecord,
} from "../src/runtime/dispatch-space-action-context";
import { createSpaceActionMcpServer } from "../src/space/action-mcp-server";
import { readDispatchSpaceFile } from "../src/space/dispatch-file-read";

// Captured from the public `space files read --json` command on 2026-09-09.
// Test-owned production CSV; identity fields anonymized, response shape retained.
const response = JSON.parse(
  readFileSync(
    new URL("./fixtures/space-file-read.json", import.meta.url),
    "utf8"
  )
);
const homes: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const home of homes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
});

function setup(ttlMs = 60_000) {
  const home = mkdtempSync(join(tmpdir(), "openmeld-dispatch-file-"));
  homes.push(home);
  const { context, contextPath } = createDispatchSpaceActionContext({
    attemptId: "attempt-1",
    dispatchId: "dispatch-1",
    sourceEventId: "source-1",
    taskId: "task-1",
    spaceId: response.file.spaceId,
    targetProfileId: "agt_test",
    ttlMs,
    env: { OPENMELD_HOME: home },
    sendTargetReference: {
      status: "loaded",
      projection: [],
      referenceLines: [],
    },
    spaceContractSnapshot: {
      allowedActions: ["post_message", "post_status", "stay_silent"],
      publicationMode: "collaboration",
    },
  });
  const commandPath = join(home, "openmeld-dev");
  const argsPath = join(home, "argv.json");
  writeFileSync(
    commandPath,
    `#!${process.execPath}\nconst fs = require('node:fs');\nfs.writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(process.argv.slice(2)));\nprocess.stdout.write(${JSON.stringify(JSON.stringify(response))});\n`,
    { mode: 0o700 }
  );
  for (const [name, value] of Object.entries({
    OPENMELD_HOME: home,
    OPENMELD_SPACE_ACTION_CONTEXT_PATH: contextPath,
    OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH: commandPath,
    OPENMELD_USER_FACING_CLI_COMMAND: "openmeld-dev",
    OPENMELD_DISPATCH_RUNTIME_MODE: DISPATCH_OWNED_RUNTIME_MODE,
    OPENMELD_DISPATCH_RUNTIME_DISPATCH_ID: context.dispatchId,
    OPENMELD_DISPATCH_RUNTIME_TARGET_PROFILE_ID: context.targetProfileId,
  })) {
    vi.stubEnv(name, value);
  }
  return { context, commandPath, argsPath };
}

describe("dispatch Space file reader", () => {
  it("reads through the trusted process as the current Agent and preserves the final reply", async () => {
    const { context, argsPath } = setup();
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = createSpaceActionMcpServer();
    const client = new Client({ name: "file-reader-test", version: "1" });
    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);
      const result = await client.callTool({
        name: "read_file",
        arguments: {
          fileId: "file-fixture",
          revision: 1,
          spaceId: "untrusted-space",
          profile: "untrusted-profile",
        },
      });
      expect(result.isError).not.toBe(true);
      expect(result.content).toEqual([
        { type: "text", text: JSON.stringify(response) },
      ]);
      expect(JSON.parse(readFileSync(argsPath, "utf8"))).toEqual([
        "space",
        "files",
        "read",
        "--profile",
        "agt_test",
        "--json",
        "--view",
        "agent",
        "--revision",
        "1",
        "--",
        context.spaceId,
        "file-fixture",
      ]);
      expect(readDispatchSpaceActionRecord({ context }).status).toBe("missing");
      const reply = await client.callTool({
        name: "reply",
        arguments: { message: "Calculated from the shared file." },
      });
      expect(reply.isError).not.toBe(true);
      expect(readDispatchSpaceActionRecord({ context }).status).toBe("loaded");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it.each([
    "expired",
    "wrong-dispatch",
    "wrong-profile",
  ])("rejects %s authority before starting file access", async (failure) => {
    const { argsPath } = setup(failure === "expired" ? -1 : 60_000);
    if (failure === "wrong-dispatch") {
      vi.stubEnv("OPENMELD_DISPATCH_RUNTIME_DISPATCH_ID", "other");
    }
    if (failure === "wrong-profile") {
      vi.stubEnv("OPENMELD_DISPATCH_RUNTIME_TARGET_PROFILE_ID", "other");
    }
    await expect(
      readDispatchSpaceFile({ fileId: "file-fixture" })
    ).rejects.toThrow();
    expect(existsSync(argsPath)).toBe(false);
  });

  it("never interprets a file ID as a CLI option and rejects mismatched returned content", async () => {
    const { argsPath, context } = setup();
    await expect(
      readDispatchSpaceFile({ fileId: "--profile=someone-else" })
    ).rejects.toThrow("does not match");
    expect(JSON.parse(readFileSync(argsPath, "utf8")).slice(-3)).toEqual([
      "--",
      context.spaceId,
      "--profile=someone-else",
    ]);
    await expect(
      readDispatchSpaceFile({ fileId: "file-fixture", revision: 2 })
    ).rejects.toThrow("does not match");
  });

  it("preserves failed file access instead of returning fabricated content or recording a final action", async () => {
    const { context, commandPath } = setup();
    // Captured public CLI missing-file error, with request ID anonymized.
    const failure = {
      schemaVersion: 1,
      type: "error",
      error: {
        code: "space_file.not_found",
        message: "File or folder not found.",
        requestId: "test-request",
      },
    };
    writeFileSync(
      commandPath,
      `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(JSON.stringify(failure))});process.exit(1);\n`,
      { mode: 0o700 }
    );
    await expect(
      readDispatchSpaceFile({ fileId: "file-fixture" })
    ).rejects.toThrow("space_file.not_found");
    expect(readDispatchSpaceActionRecord({ context }).status).toBe("missing");
  });
});
