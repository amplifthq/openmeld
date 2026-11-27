import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { expect, it } from "vitest";

it.each([
  { args: ["mcp"], readOnly: false },
  { args: ["--view", "agent", "mcp", "--read-only"], readOnly: true },
  { args: ["mcp", "--view=human", "--read-only"], readOnly: true },
])("serves MCP over stdio with CLI args $args", async ({ args, readOnly }) => {
  const root = mkdtempSync(join(tmpdir(), "openmeld-workspace-mcp-"));
  const binary = process.env.OPENMELD_TEST_CLI_BINARY;
  const transport = new StdioClientTransport({
    command: binary || process.execPath,
    args: [...(binary ? [] : [resolve("dist/openmeld.js")]), ...args],
    env: {
      PATH: process.env.PATH ?? "",
      OPENMELD_HOME: root,
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "workspace-mcp-entry-test", version: "1" });
  try {
    await client.connect(transport, { timeout: 3000 });
    const { tools } = await client.listTools();
    expect(tools.some(({ name }) => name === "list_space_tasks")).toBe(true);
    expect(tools.some(({ name }) => name === "create_space_task")).toBe(
      !readOnly
    );
  } finally {
    await client.close();
    rmSync(root, { recursive: true, force: true });
  }
});
