import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCodexExecArgs } from "../dist/transport/codex-cli-transport.js";
import { buildCodexSpaceActionMcpGlobalArgs } from "../dist/transport/codex-space-action-mcp-config.js";

const DANGEROUS_BYPASS_FLAG = "--dangerously-bypass-approvals-and-sandbox";

const countDangerousBypassFlags = (args) =>
  args.filter((arg) => arg === DANGEROUS_BYPASS_FLAG).length;

describe("Codex CLI transport args", () => {
  it("keeps cwd write inherited while selected parent and additional roots stay read-only", () => {
    for (const agentControllerPermissionMode of [
      "codex:askForApproval",
      "codex:approveForMe",
    ]) {
      const args = buildCodexExecArgs({
        agentControllerPermissionMode,
        computerFileAccessBoundary: {
          folders: ["/Users/felix", '/Volumes/Client "Archive"'],
          mode: "only_selected_folders",
          revision: 2,
          updatedAtMs: 100,
        },
        threadId: null,
      });

      assert.equal(args.includes("--strict-config"), true);
      assert.equal(args.includes("-s"), false);
      assert.equal(countDangerousBypassFlags(args), 0);
      assert.equal(
        args.includes(
          'permissions.openmeld_computer_boundary={ extends = ":workspace", filesystem = { ":root" = "deny", "/Users/felix" = "read", "/Users/felix/**" = "read", "/Volumes/Client \\"Archive\\"" = "read", "/Volumes/Client \\"Archive\\"/**" = "read" } }'
        ),
        true
      );
      assert.equal(
        args.includes('default_permissions="openmeld_computer_boundary"'),
        true
      );
    }
  });

  it("keeps selected folders writable when native Codex access is unrestricted", () => {
    const args = buildCodexExecArgs({
      agentControllerPermissionMode: "codex:fullAccess",
      computerFileAccessBoundary: {
        folders: ["/Users/felix/work"],
        mode: "only_selected_folders",
        revision: 2,
        updatedAtMs: 100,
      },
      threadId: null,
    });

    assert.equal(
      args.includes(
        'permissions.openmeld_computer_boundary={ filesystem = { ":root" = "deny", "/Users/felix/work" = "write", "/Users/felix/work/**" = "write" }, network = { enabled = true, mode = "full" } }'
      ),
      true
    );
    assert.equal(countDangerousBypassFlags(args), 0);
  });

  it("keeps repair read-only inside selected folders", () => {
    const args = buildCodexExecArgs({
      agentControllerPermissionMode: "codex:fullAccess",
      computerFileAccessBoundary: {
        folders: ["/Users/felix/work"],
        mode: "only_selected_folders",
        revision: 2,
        updatedAtMs: 100,
      },
      executionMode: "repair",
      threadId: "thread-1",
    });

    assert.equal(
      args.includes(
        'permissions.openmeld_computer_boundary={ extends = ":read-only", filesystem = { ":root" = "deny", "/Users/felix/work" = "read", "/Users/felix/work/**" = "read" } }'
      ),
      true
    );
    assert.equal(countDangerousBypassFlags(args), 0);
  });

  it("overlays blocked folders on full access without using the bypass flag", () => {
    const args = buildCodexExecArgs({
      agentControllerPermissionMode: "codex:fullAccess",
      computerFileAccessBoundary: {
        folders: ["/Users/felix/Secrets"],
        mode: "block_selected_folders",
        revision: 2,
        updatedAtMs: 100,
      },
      threadId: null,
    });

    assert.equal(
      args.includes(
        'permissions.openmeld_computer_boundary={ filesystem = { ":root" = "write", "/Users/felix/Secrets" = "deny", "/Users/felix/Secrets/**" = "deny" }, network = { enabled = true, mode = "full" } }'
      ),
      true
    );
    assert.equal(args.includes("never"), true);
    assert.equal(countDangerousBypassFlags(args), 0);
  });

  it("passes model and reasoning effort for a new thread", () => {
    assert.deepEqual(
      buildCodexExecArgs({
        conversationPolicy: {
          model: "gpt-5.5",
          reasoningLevel: "high",
        },
        threadId: null,
      }),
      [
        "-s",
        "workspace-write",
        "-a",
        "untrusted",
        "exec",
        "--json",
        "--skip-git-repo-check",
        "-m",
        "gpt-5.5",
        "-c",
        "model_reasoning_effort=high",
        "-",
      ]
    );
  });

  it("adds the approval-free Space Action MCP server to CLI execution", () => {
    const args = buildCodexExecArgs({
      env: {
        OPENMELD_SPACE_ACTION_CONTEXT_PATH: "/tmp/action/context.json",
        OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH: "/tmp/action/bin/openmeld",
        OPENMELD_USER_FACING_CLI_COMMAND: "openmeld",
      },
      threadId: "thread-1",
    });

    assert.equal(
      args.includes(
        'mcp_servers.openmeld_internal_dispatch_space_action.command="/tmp/action/bin/openmeld"'
      ),
      true
    );
    assert.equal(
      args.includes(
        'mcp_servers.openmeld_internal_dispatch_space_action.default_tools_approval_mode="approve"'
      ),
      true
    );
  });

  it("passes model and reasoning effort when resuming a thread", () => {
    assert.deepEqual(
      buildCodexExecArgs({
        conversationPolicy: {
          model: "gpt-5.5",
          reasoningLevel: "medium",
        },
        threadId: "thread-1",
      }),
      [
        "-s",
        "workspace-write",
        "-a",
        "untrusted",
        "exec",
        "resume",
        "--json",
        "--skip-git-repo-check",
        "-m",
        "gpt-5.5",
        "-c",
        "model_reasoning_effort=medium",
        "thread-1",
        "-",
      ]
    );
  });

  it("preserves an existing thread when no model selection is present", () => {
    const args = buildCodexExecArgs({
      threadId: "thread-existing-model",
    });

    assert.equal(args.includes("-m"), false);
    assert.equal(
      args.some((arg) => arg.startsWith("model_reasoning_effort=")),
      false
    );
    assert.deepEqual(args.slice(-2), ["thread-existing-model", "-"]);
  });

  it("maps Agent Controller Permission Mode to exact Codex CLI args", () => {
    assert.deepEqual(
      buildCodexExecArgs({
        agentControllerPermissionMode: "codex:approveForMe",
        threadId: null,
      }),
      [
        "-s",
        "workspace-write",
        "-a",
        "on-request",
        "-c",
        'approvals_reviewer="auto_review"',
        "exec",
        "--json",
        "--skip-git-repo-check",
        "-",
      ]
    );

    assert.deepEqual(
      buildCodexExecArgs({
        agentControllerPermissionMode: "codex:askForApproval",
        threadId: "thread-1",
      }),
      [
        "-s",
        "workspace-write",
        "-a",
        "untrusted",
        "exec",
        "resume",
        "--json",
        "--skip-git-repo-check",
        "thread-1",
        "-",
      ]
    );

    const bypassNewArgs = buildCodexExecArgs({
      agentControllerPermissionMode: "codex:fullAccess",
      threadId: null,
    });
    assert.equal(countDangerousBypassFlags(bypassNewArgs), 1);
    assert.deepEqual(bypassNewArgs, [
      "exec",
      DANGEROUS_BYPASS_FLAG,
      "--json",
      "--skip-git-repo-check",
      "-",
    ]);

    const bypassResumeArgs = buildCodexExecArgs({
      agentControllerPermissionMode: "codex:fullAccess",
      threadId: "thread-1",
    });
    assert.equal(countDangerousBypassFlags(bypassResumeArgs), 1);
    assert.deepEqual(bypassResumeArgs, [
      "exec",
      "resume",
      DANGEROUS_BYPASS_FLAG,
      "--json",
      "--skip-git-repo-check",
      "thread-1",
      "-",
    ]);

    assert.deepEqual(
      buildCodexExecArgs({
        agentControllerPermissionMode: "codex:fullAccess",
        executionMode: "repair",
        threadId: "thread-1",
      }),
      [
        "-s",
        "read-only",
        "-a",
        "untrusted",
        "exec",
        "resume",
        "--json",
        "--skip-git-repo-check",
        "thread-1",
        "-",
      ]
    );
  });
});

describe("Codex Space Action MCP config", () => {
  it("adds one required, approval-free dispatch tool server", () => {
    assert.deepEqual(
      buildCodexSpaceActionMcpGlobalArgs({
        OPENMELD_SPACE_ACTION_CONTEXT_PATH:
          "/tmp/openmeld dispatch/context.json",
        OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH:
          "/tmp/openmeld dispatch/bin/openmeld-dev",
        OPENMELD_USER_FACING_CLI_COMMAND: "openmeld-dev",
      }),
      [
        "-c",
        'mcp_servers.openmeld_internal_dispatch_space_action.command="/tmp/openmeld dispatch/bin/openmeld-dev"',
        "-c",
        'mcp_servers.openmeld_internal_dispatch_space_action.args=["space","action","tool-server"]',
        "-c",
        'mcp_servers.openmeld_internal_dispatch_space_action.env_vars=["OPENMELD_SPACE_ACTION_CONTEXT_PATH","OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH","OPENMELD_USER_FACING_CLI_COMMAND"]',
        "-c",
        "mcp_servers.openmeld_internal_dispatch_space_action.enabled=true",
        "-c",
        "mcp_servers.openmeld_internal_dispatch_space_action.required=true",
        "-c",
        'mcp_servers.openmeld_internal_dispatch_space_action.enabled_tools=["reply","status","stay_silent"]',
        "-c",
        "mcp_servers.openmeld_internal_dispatch_space_action.disabled_tools=[]",
        "-c",
        'mcp_servers.openmeld_internal_dispatch_space_action.default_tools_approval_mode="approve"',
      ]
    );
  });

  it("does not add the tool server outside an active Space dispatch", () => {
    assert.deepEqual(
      buildCodexSpaceActionMcpGlobalArgs({
        OPENMELD_USER_FACING_CLI_COMMAND: "openmeld",
      }),
      []
    );
  });
});
