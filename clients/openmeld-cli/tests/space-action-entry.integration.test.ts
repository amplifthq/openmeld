import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { expect, it } from "vitest";
import {
  createDispatchSpaceActionContext,
  readDispatchSpaceActionRecord,
} from "../src/runtime/dispatch-space-action-context";

it("discovers every packaged Wake tool before recording a reply", async () => {
  const root = mkdtempSync(join(tmpdir(), "openmeld-action-discovery-"));
  const { context, contextPath } = createDispatchSpaceActionContext({
    attemptId: "attempt-1",
    dispatchId: "dispatch-1",
    env: { OPENMELD_HOME: root },
    sourceEventId: "source-1",
    spaceId: "space-1",
    targetProfileId: "agt_test",
    taskId: "task-1",
    sendTargetReference: {
      status: "loaded",
      projection: [],
      referenceLines: [],
    },
    spaceContractSnapshot: {
      allowedActions: ["post_message"],
      publicationMode: "collaboration",
    },
  });
  const binary = process.env.OPENMELD_TEST_CLI_BINARY;
  const transport = new StdioClientTransport({
    command: binary || process.execPath,
    args: [
      ...(binary ? [] : [resolve("dist/openmeld.js")]),
      "space",
      "action",
      "tool-server",
    ],
    env: {
      PATH: process.env.PATH ?? "",
      OPENMELD_HOME: root,
      OPENMELD_SPACE_ACTION_CONTEXT_PATH: contextPath,
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "packaged-wake-test", version: "1" });
  try {
    await client.connect(transport);
    const catalog = await client.listTools();
    expect(catalog.tools.map((tool) => tool.name).sort()).toEqual([
      "read_file",
      "reply",
      "status",
      "stay_silent",
    ]);
    expect(
      catalog.tools.find((tool) => tool.name === "read_file")?.inputSchema
    ).toMatchObject({
      properties: {
        fileId: { type: "string", minLength: 1, maxLength: 128 },
        revision: { type: "integer", minimum: 1 },
      },
      required: ["fileId"],
    });
    const result = await client.callTool({
      name: "reply",
      arguments: { message: "Packaged tools ready." },
    });
    expect(result.isError).not.toBe(true);
    expect(readDispatchSpaceActionRecord({ context }).status).toBe("loaded");
  } finally {
    await client.close();
    await transport.close();
    rmSync(root, { recursive: true, force: true });
  }
});

it("records a scoped reply without initializing unrelated global state", () => {
  const root = mkdtempSync(join(tmpdir(), "openmeld-action-entry-"));
  try {
    const { context, contextPath } = createDispatchSpaceActionContext({
      attemptId: "attempt-1",
      dispatchId: "dispatch-1",
      env: { OPENMELD_HOME: root },
      sendTargetReference: {
        status: "loaded",
        projection: [],
        referenceLines: [],
      },
      sourceEventId: "source-1",
      spaceContractSnapshot: {
        allowedActions: ["post_message"],
        publicationMode: "collaboration",
      },
      spaceId: "space-1",
      targetProfileId: "agt_test",
      taskId: "task-1",
    });
    // A file at the global layout directory makes initialization impossible.
    // The dispatch already has everything needed to record its reply.
    writeFileSync(join(root, "system"), "preserve this unrelated state");
    const result = spawnSync(
      process.execPath,
      [resolve("dist/openmeld.js"), "space", "action", "reply", "Scoped reply"],
      {
        encoding: "utf8",
        timeout: 15_000,
        env: {
          ...process.env,
          OPENMELD_HOME: root,
          OPENMELD_SPACE_ACTION_CONTEXT_PATH: contextPath,
        },
      }
    );
    expect(result.status, result.stderr).toBe(0);
    expect(readDispatchSpaceActionRecord({ context })).toMatchObject({
      status: "loaded",
      record: {
        action: {
          type: "post_message",
          messageEnvelope: { text: "Scoped reply" },
        },
      },
    });
    expect(readFileSync(join(root, "system"), "utf8")).toBe(
      "preserve this unrelated state"
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
