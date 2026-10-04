import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createCodexAdapter, forkCodexAppServerThread } from "../dist/index.js";

const run = promisify(execFile);

test(
  "native task permissions preserve worktree access and explicit restrictions",
  {
    skip: !process.env.OPENMELD_TEST_CODEX_BIN,
    timeout: 120_000,
  },
  async (t) => {
    // Outside /tmp: Codex may intentionally allow /tmp in workspace-write mode.
    // Only synthetic state and a disposable Git repository enter this fixture.
    const root = await mkdtemp(
      join(homedir(), ".openmeld-permission-fixture-")
    );
    const home = join(root, "native-home");
    const workdir = join(root, "repository");
    const worktree = join(root, "other-worktree");
    await mkdir(home);
    await mkdir(workdir);
    const git = process.env.OPENMELD_TEST_GIT_BIN ?? "git";
    await run(git, ["init", "--quiet", workdir]);
    await run(git, [
      "-C",
      workdir,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--quiet",
      "--allow-empty",
      "-m",
      "test: seed disposable repository",
    ]);
    await run(git, [
      "-C",
      workdir,
      "worktree",
      "add",
      "--quiet",
      "-b",
      "fixture-child",
      worktree,
    ]);
    let phase;
    let step;
    let sequence = 0;
    const toolResults = [];
    const server = createServer((req, res) => {
      (async () => {
        let body = "";
        for await (const chunk of req) {
          body += chunk;
        }
        if (!req.url.endsWith("/responses")) {
          return res.writeHead(404).end();
        }
        const request = JSON.parse(body);
        const first = step++ === 0;
        if (!first) {
          toolResults.push({ phase, input: request.input });
        }
        const id = `fixture_${++sequence}`;
        const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
        const command = `${quote(git)} -C ${quote(worktree)} status --porcelain && printf '%s' ${quote(phase)} > ${quote(join(worktree, `${phase}.txt`))}`;
        const item = first
          ? {
              id: `fc_${id}`,
              type: "function_call",
              call_id: `call_${id}`,
              name: "exec_command",
              arguments: JSON.stringify({
                cmd: command,
                workdir,
                yield_time_ms: 1000,
              }),
              status: "completed",
            }
          : {
              id: `msg_${id}`,
              type: "message",
              role: "assistant",
              status: "completed",
              content: [
                {
                  type: "output_text",
                  text: "Fixture finished.",
                  annotations: [],
                },
              ],
            };
        const response = {
          id,
          object: "response",
          model: request.model,
          output: [],
        };
        const event = (type, payload) =>
          res.write(
            `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`
          );
        res.writeHead(200, { "content-type": "text/event-stream" });
        event("response.created", {
          response: { ...response, status: "in_progress" },
        });
        event("response.output_item.added", {
          output_index: 0,
          item: {
            ...item,
            status: "in_progress",
            ...(first ? { arguments: "" } : { content: [] }),
          },
        });
        if (first) {
          event("response.function_call_arguments.delta", {
            item_id: item.id,
            output_index: 0,
            delta: item.arguments,
          });
          event("response.function_call_arguments.done", {
            item_id: item.id,
            output_index: 0,
            arguments: item.arguments,
          });
        } else {
          event("response.output_text.delta", {
            item_id: item.id,
            output_index: 0,
            content_index: 0,
            delta: "Fixture finished.",
          });
        }
        event("response.output_item.done", { output_index: 0, item });
        event("response.completed", {
          response: {
            ...response,
            status: "completed",
            output: [item],
            usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
          },
        });
        res.end();
      })().catch((error) => res.destroy(error));
    });
    t.after(async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await rm(root, { recursive: true, force: true });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    await writeFile(
      join(home, "config.toml"),
      [
        'model = "gpt-5.4"',
        'model_provider = "fixture"',
        'web_search = "disabled"',
        "[model_providers.fixture]",
        'name = "Loopback fixture"',
        `base_url = "http://127.0.0.1:${server.address().port}/v1"`,
        'wire_api = "responses"',
        "requires_openai_auth = false",
        "",
      ].join("\n")
    );
    const launchContract = {
      kind: "executable",
      commandPath: process.env.OPENMELD_TEST_CODEX_BIN,
    };
    const env = {
      HOME: home,
      CODEX_HOME: home,
      OPENMELD_HOME: join(home, "openmeld"),
      OPENAI_API_KEY: "synthetic-local-only",
      RUST_LOG: "error",
    };
    const context = {
      version: 1,
      id: "11111111-1111-4111-8111-111111111111",
      access: "workspace",
      workspace: "current",
      permissionSource: "agent_settings",
      scope: {
        organizationId: "fixture",
        requesterProfileId: "human",
        spaceId: "fixture",
        targetProfileId: "agent",
        threadId: null,
      },
      nativeConversationId: null,
      runtimeWorkspaceFingerprint: null,
    };
    const dispatch = async (
      name,
      {
        threadId,
        boundary,
        permissionMode = "codex:fullAccess",
        allowed = true,
      } = {}
    ) => {
      phase = name;
      step = 0;
      let turnId;
      const result = await createCodexAdapter({
        launchContract,
        codexTimeoutMs: 20_000,
      }).dispatch({
        agentId: "agent",
        taskId: name,
        sourceEventId: name,
        spaceId: "fixture",
        runtimeContext: { providerRuntimeWorkingDirectory: workdir },
        agentControllerConversationId: threadId,
        agentControllerPermissionMode: permissionMode,
        executionContext: {
          ...context,
          ...(boundary?.executionContextAccess
            ? {
                access: boundary.executionContextAccess,
                permissionSource: undefined,
              }
            : {}),
          nativeConversationId: threadId ?? null,
        },
        computerFileAccessBoundary: boundary,
        executionMode: "normal",
        transportMode: "codex-app-server",
        env,
        prompt: "Execute the one disposable fixture command.",
        onInteractionRequest: async () => ({ kind: "cancel" }),
        onRuntimeEvent: (event) => {
          if (event.phase === "provider_turn_accepted") {
            turnId = event.turnId;
          }
        },
      });
      assert.equal(result.status, "success", JSON.stringify(result));
      if (allowed) {
        assert.equal(
          await readFile(join(worktree, `${name}.txt`), "utf8"),
          name
        );
      } else {
        await assert.rejects(readFile(join(worktree, `${name}.txt`)), {
          code: "ENOENT",
        });
      }
      assert.ok(toolResults.some((row) => row.phase === name));
      return {
        threadId: result.contextDelta?.agentControllerConversationId,
        turnId,
      };
    };
    const started = await dispatch("start");
    assert.ok(started.threadId && started.turnId);
    const resumed = await dispatch("cold-resume", {
      threadId: started.threadId,
    });
    assert.equal(resumed.threadId, started.threadId);
    const child = await forkCodexAppServerThread({
      launchContract,
      codexTimeoutMs: 20_000,
      codexWorkdir: workdir,
      sourceThreadId: resumed.threadId,
      sourceCompletedTurnId: resumed.turnId,
      targetWorkingDirectory: workdir,
      env,
    });
    await dispatch("fork", { threadId: child.threadId });
    await dispatch("native-workspace", {
      permissionMode: "codex:askForApproval",
      allowed: false,
    });
    await dispatch("computer-folders", {
      boundary: {
        mode: "only_selected_folders",
        folders: [workdir],
        revision: 1,
        updatedAtMs: 1,
      },
      allowed: false,
    });
    await dispatch("task-read-only", {
      boundary: {
        mode: "only_selected_folders",
        folders: [workdir],
        revision: 1,
        updatedAtMs: 1,
        executionContextAccess: "read_only",
      },
      allowed: false,
    });
  }
);
