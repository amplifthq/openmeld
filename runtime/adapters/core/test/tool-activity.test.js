import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveAdapterToolActivityName,
  resolveAdapterToolWorkActivity,
} from "../dist/index.js";

describe("adapter tool activity", () => {
  it("maps provider-specific tools to stable privacy-safe Agent activity names", () => {
    assert.equal(resolveAdapterToolActivityName("Bash"), "agent_run_command");
    assert.equal(resolveAdapterToolActivityName("Read"), "agent_read_files");
    assert.equal(resolveAdapterToolActivityName("Edit"), "agent_edit_files");
    assert.equal(resolveAdapterToolActivityName("Grep"), "agent_search_files");
    assert.equal(
      resolveAdapterToolActivityName("WebSearch"),
      "agent_search_web"
    );
    assert.equal(
      resolveAdapterToolActivityName("WebFetch"),
      "agent_open_webpage"
    );
    assert.equal(resolveAdapterToolActivityName("Task"), "agent_delegate_task");
    assert.equal(
      resolveAdapterToolActivityName("mcp__private_server__secret_tool"),
      "agent_use_tool"
    );
  });

  it("describes recognized command work without exposing the command or local path", () => {
    assert.deepEqual(
      resolveAdapterToolWorkActivity("Bash", {
        command:
          "git clone git@github.com:amplifthq/reply.git /Users/felix/Desktop/work/reply",
      }),
      {
        v: 1,
        key: "repository.clone",
        subject: {
          kind: "repository",
          label: "amplifthq/reply",
        },
      }
    );
    assert.deepEqual(
      resolveAdapterToolWorkActivity("Bash", {
        command: "pnpm test --filter @openmeld/web",
      }),
      {
        v: 1,
        key: "tests.run",
      }
    );
    assert.deepEqual(
      resolveAdapterToolWorkActivity("Bash", {
        command: "rg -n AgentWorkActivity packages",
      }),
      {
        v: 1,
        key: "source.search",
      }
    );
    assert.deepEqual(
      resolveAdapterToolWorkActivity("Bash", {
        command: "sed -n '1,120p' src/index.ts",
      }),
      {
        v: 1,
        key: "source.read",
      }
    );
    assert.deepEqual(
      resolveAdapterToolWorkActivity("Bash", {
        command: "command -v vitest",
      }),
      {
        v: 1,
        key: "environment.check",
      }
    );
    assert.equal(
      resolveAdapterToolWorkActivity("Bash", {
        command: "echo git status",
      }),
      null
    );
    assert.equal(
      resolveAdapterToolWorkActivity("Bash", {
        command: "print-secret",
      }),
      null
    );
  });

  it("describes file, web, delegation, and image work at a useful level", () => {
    assert.deepEqual(
      resolveAdapterToolWorkActivity("Read", {
        file_path: "/Users/felix/Desktop/work/reply/README.md",
      }),
      {
        v: 1,
        key: "documentation.read",
      }
    );
    assert.deepEqual(resolveAdapterToolWorkActivity("Grep", {}), {
      v: 1,
      key: "source.search",
    });
    assert.deepEqual(resolveAdapterToolWorkActivity("WebSearch", {}), {
      v: 1,
      key: "web.search",
    });
    assert.deepEqual(resolveAdapterToolWorkActivity("Task", {}), {
      v: 1,
      key: "task.delegate",
    });
    assert.deepEqual(resolveAdapterToolWorkActivity("ImageView", {}), {
      v: 1,
      key: "image.inspect",
    });
    assert.equal(
      resolveAdapterToolWorkActivity("mcp__private_server__secret_tool", {}),
      null
    );
  });
});
