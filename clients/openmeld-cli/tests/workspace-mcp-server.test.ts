import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import {
  createWorkspaceMcpServer,
  formatWorkspaceCliResult,
  resolveSelfCliCommand,
  type WorkspaceCliInvocation,
  type WorkspaceCliResult,
} from "../src/mcp/workspace-mcp-server";

const SPACE = "a".repeat(64);
const TASK = "tsk_33333333-3333-4333-8333-333333333333";
const AGENT = "agt_22222222-2222-4222-8222-222222222222";

async function connect(input: {
  readOnly?: boolean;
  profile?: string;
  result?: WorkspaceCliResult;
}) {
  const calls: WorkspaceCliInvocation[] = [];
  const server = createWorkspaceMcpServer({
    readOnly: input.readOnly ?? false,
    profile: input.profile,
    runCli: (invocation) => {
      calls.push(invocation);
      return Promise.resolve(
        input.result ?? {
          exitCode: 0,
          stdout: '{"ok":true}\n',
          stderr: "",
          timedOut: false,
        }
      );
    },
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { calls, client };
}

describe("openmeld mcp", () => {
  it("exposes only read tools in read-only mode", async () => {
    const { client } = await connect({ readOnly: true });

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual([
      "list_spaces",
      "read_space_board",
      "list_space_members",
      "read_space_history",
      "list_space_tasks",
      "read_space_task",
    ]);
    expect(tools.every((tool) => tool.annotations?.readOnlyHint)).toBe(true);
  });

  it("adds the write tools by default and marks none of them read-only", async () => {
    const { client } = await connect({});

    const { tools } = await client.listTools();
    const writes = tools.filter((tool) => !tool.annotations?.readOnlyHint);

    expect(writes.map((tool) => tool.name)).toEqual([
      "send_space_message",
      "create_space_task",
      "start_space_task",
      "submit_space_task_result",
      "review_space_task",
      "cancel_space_task",
    ]);
  });

  it("runs a read as one Agent View CLI command and returns its output", async () => {
    const { calls, client } = await connect({});

    const result = await client.callTool({
      name: "read_space_board",
      arguments: { space: SPACE },
    });

    expect(calls).toEqual([
      {
        args: ["--view", "agent", "space", "board", "--json", "--", SPACE],
        stdin: undefined,
      },
    ]);
    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([{ type: "text", text: '{"ok":true}' }]);
  });

  it("sends message text on stdin and names Wake recipients explicitly", async () => {
    const { calls, client } = await connect({ profile: "usr_me" });

    await client.callTool({
      name: "send_space_message",
      arguments: {
        space: SPACE,
        text: "--plain please ship it",
        wake: [AGENT],
      },
    });

    expect(calls).toEqual([
      {
        args: [
          "--view",
          "agent",
          "space",
          "send",
          "--stdin",
          "--wake",
          AGENT,
          "--profile",
          "usr_me",
          "--",
          SPACE,
        ],
        stdin: "--plain please ship it",
      },
    ]);
  });

  it("posts a message with no recipients as plain so it wakes nobody", async () => {
    const { calls, client } = await connect({});

    await client.callTool({
      name: "send_space_message",
      arguments: { space: SPACE, text: "FYI" },
    });

    expect(calls[0]?.args).toEqual([
      "--view",
      "agent",
      "space",
      "send",
      "--stdin",
      "--plain",
      "--",
      SPACE,
    ]);
  });

  it("keeps model-supplied text from being read as CLI options", async () => {
    const { calls, client } = await connect({});

    await client.callTool({
      name: "create_space_task",
      arguments: { space: SPACE, title: "--password leak" },
    });

    const args = calls[0]?.args ?? [];
    expect(args.slice(args.indexOf("--"))).toEqual([
      "--",
      SPACE,
      "--password leak",
    ]);
  });

  it("passes the revisions a review is bound to", async () => {
    const { calls, client } = await connect({});

    await client.callTool({
      name: "review_space_task",
      arguments: {
        space: SPACE,
        taskId: TASK,
        expectedRevision: 5,
        expectedResultRevision: 2,
        decision: "changes_requested",
        feedback: "Fix the FAQ.",
      },
    });

    expect(calls[0]?.args).toEqual([
      "--view",
      "agent",
      "space",
      "tasks",
      "review",
      "--json",
      "--revision",
      "5",
      "--result-revision",
      "2",
      "--request-changes",
      "--feedback",
      "Fix the FAQ.",
      "--",
      SPACE,
      TASK,
    ]);
  });

  it("rejects invalid tool input without running the CLI", async () => {
    const { calls, client } = await connect({});

    const result = await client.callTool({
      name: "read_space_task",
      arguments: { space: SPACE, taskId: "not-a-task" },
    });

    expect(result.isError).toBe(true);
    expect(calls).toEqual([]);
  });

  it("reports a failed command as a tool error with the CLI's own message", () => {
    expect(
      formatWorkspaceCliResult({
        exitCode: 1,
        stdout: "",
        stderr: "Sign in first: openmeld start\n",
        timedOut: false,
      })
    ).toEqual({
      isError: true,
      content: [{ type: "text", text: "Sign in first: openmeld start" }],
    });
  });

  it("reports a timeout as an unknown outcome rather than a failure to act", () => {
    const result = formatWorkspaceCliResult({
      exitCode: null,
      stdout: "",
      stderr: "",
      timedOut: true,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("The outcome is unknown");
  });

  it("starts itself through node for the npm build and directly for the binary", () => {
    expect(
      resolveSelfCliCommand({
        argv: ["/usr/bin/node", "/app/dist/openmeld.js", "mcp"],
        binary: false,
        execPath: "/usr/bin/node",
      })
    ).toEqual({
      command: "/usr/bin/node",
      prefixArgs: ["/app/dist/openmeld.js"],
    });
    expect(
      resolveSelfCliCommand({
        argv: ["/opt/openmeld", "/$bunfs/root/openmeld", "mcp"],
        binary: true,
        execPath: "/opt/openmeld",
      })
    ).toEqual({ command: "/opt/openmeld", prefixArgs: [] });
  });
});
