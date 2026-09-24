import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { dispatchProjectShellResultSchema } from "@openmeld/schemas";
import type { ExecutionContextTask } from "@openmeld/schemas/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  markExecutionContextWorkspaceInUse,
  prepareExecutionContextWorkspace,
  releaseExecutionContextWorkspace,
} from "../src/local-service/dispatch/execution-context-workspace";
import {
  buildClaudeProjectContainerArgs,
  prepareClaudeProjectContainer,
  runClaudeProjectContainerCommand,
  stopClaudeProjectContainersForContext,
} from "../src/local-service/file-access/claude-project-container";
import { DISPATCH_OWNED_RUNTIME_MODE } from "../src/runtime/dispatch-runtime-env";
import {
  createDispatchSpaceActionContext,
  readDispatchSpaceActionRecord,
} from "../src/runtime/dispatch-space-action-context";
import {
  createDispatchSpaceTools,
  createSpaceActionMcpServer,
} from "../src/space/action-mcp-server";

const execFileAsync = promisify(execFile);
afterEach(() => vi.unstubAllEnvs());

describe("Claude project container native smoke", () => {
  // #1250: This gate requires a running local Docker/Podman Linux engine and
  // the pinned image; the dedicated cross-platform CI job opts in explicitly.
  it.skipIf(process.env.OPENMELD_CLAUDE_CONTAINER_SMOKE !== "1")(
    "confines real commands to one disposable workspace",
    async () => {
      const root = await realpath(
        await mkdtemp(join(tmpdir(), "openmeld-claude-container-"))
      );
      const boundaryRoot = join(root, "boundary");
      const workspacePath = join(boundaryRoot, "worktree");
      await mkdir(workspacePath, { recursive: true });
      try {
        await writeFile(join(workspacePath, "inside.txt"), "inside", "utf8");
        await writeFile(join(root, "outside.txt"), "outside", "utf8");
        const contextId = "11111111-1111-4111-8111-111111111111";
        const runtime = await prepareClaudeProjectContainer({
          boundaryRoot,
          contextId,
          workspacePath,
        });
        const inside = await runClaudeProjectContainerCommand({
          command: "cat inside.txt",
          contextId,
          runtime,
          boundaryRoot,
          workspacePath,
        });
        expect(inside).toMatchObject({ exitCode: 0, stdout: "inside" });
        const outside = await runClaudeProjectContainerCommand({
          command: `cat ${join(root, "outside.txt")}`,
          contextId,
          runtime,
          boundaryRoot,
          workspacePath,
        });
        expect(outside.exitCode).not.toBe(0);
        expect(outside.stdout).not.toContain("outside");
        const outsideWrite = await runClaudeProjectContainerCommand({
          command: "printf changed > /outside.txt",
          contextId,
          runtime,
          boundaryRoot,
          workspacePath,
        });
        expect(outsideWrite.exitCode).not.toBe(0);
        const write = await runClaudeProjectContainerCommand({
          command: "printf changed > inside.txt",
          contextId,
          runtime,
          boundaryRoot,
          workspacePath,
        });
        expect(write.exitCode).toBe(0);
        expect(await readFile(join(workspacePath, "inside.txt"), "utf8")).toBe(
          "changed"
        );
        expect(await readFile(join(root, "outside.txt"), "utf8")).toBe(
          "outside"
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  );

  it.skipIf(process.env.OPENMELD_CLAUDE_CONTAINER_SMOKE !== "1")(
    "exposes project shell only for the active dispatch and records no Space action",
    async () => {
      const root = await realpath(
        await mkdtemp(join(tmpdir(), "openmeld-claude-mcp-"))
      );
      const source = join(root, "source");
      const ledgerRootPath = join(root, "lane");
      await mkdir(source);
      const context: ExecutionContextTask = {
        version: 1,
        id: "33333333-3333-4333-8333-333333333333",
        scope: {
          organizationId: "org",
          requesterProfileId: "human",
          spaceId: "space",
          targetProfileId: "agent",
          threadId: null,
        },
        access: "workspace",
        workspace: "isolated",
        nativeConversationId: null,
        runtimeWorkspaceFingerprint: null,
      };
      let use: Awaited<ReturnType<typeof markExecutionContextWorkspaceInUse>> =
        null;
      let server: ReturnType<typeof createSpaceActionMcpServer> | null = null;
      let client: Client | null = null;
      try {
        await execFileAsync("git", ["-C", source, "init", "--template="]);
        await writeFile(join(source, "tracked.txt"), "project-code", "utf8");
        await execFileAsync("git", ["-C", source, "add", "."]);
        await execFileAsync("git", [
          "-C",
          source,
          "-c",
          "user.name=Container Test",
          "-c",
          "user.email=container@example.invalid",
          "commit",
          "-m",
          "fixture",
        ]);
        const workspace = await prepareExecutionContextWorkspace({
          context,
          ledgerRootPath,
          currentWorkingDirectory: source,
          policy: {
            mode: "local_agent_settings",
            revision: 1,
            updatedAtMs: 1,
          },
        });
        const runtime = await prepareClaudeProjectContainer({
          boundaryRoot: workspace.boundaryRoot,
          contextId: context.id,
          workspacePath: workspace.workingDirectory,
        });
        use = await markExecutionContextWorkspaceInUse({
          context,
          ledgerRootPath,
          containerRuntime: runtime,
          dispatchId: "dispatch-current",
          attemptId: "attempt-current",
        });
        const action = createDispatchSpaceActionContext({
          attemptId: "attempt-current",
          dispatchId: "dispatch-current",
          env: { OPENMELD_HOME: root },
          sourceEventId: "signal-current",
          spaceId: "space",
          targetProfileId: "agent",
          taskId: "task-current",
          sendTargetReference: {
            status: "loaded",
            projection: [],
            referenceLines: [],
          },
          spaceContractSnapshot: null,
          projectShell: {
            boundaryRoot: workspace.boundaryRoot,
            executionContextId: context.id,
            ledgerRootPath,
            workspacePath: workspace.workingDirectory,
            runtime,
          },
        });
        vi.stubEnv("OPENMELD_SPACE_ACTION_CONTEXT_PATH", action.contextPath);
        vi.stubEnv(
          "OPENMELD_DISPATCH_RUNTIME_MODE",
          DISPATCH_OWNED_RUNTIME_MODE
        );
        vi.stubEnv("OPENMELD_DISPATCH_RUNTIME_DISPATCH_ID", "dispatch-current");
        vi.stubEnv("OPENMELD_DISPATCH_RUNTIME_TARGET_PROFILE_ID", "agent");
        const [clientTransport, serverTransport] =
          InMemoryTransport.createLinkedPair();
        const dispatchTools = createDispatchSpaceTools();
        expect(
          dispatchTools.tools.some((tool) => tool.name === "project_shell")
        ).toBe(true);
        const directResult = await dispatchTools.call("project_shell", {
          command: "cat tracked.txt",
        });
        expect(
          dispatchProjectShellResultSchema.parse(directResult.structuredContent)
        ).toMatchObject({ exitCode: 0, stdout: "project-code" });
        dispatchTools.close();
        server = createSpaceActionMcpServer();
        client = new Client({ name: "project-shell-test", version: "1" });
        await Promise.all([
          server.connect(serverTransport),
          client.connect(clientTransport),
        ]);
        const result = await client.callTool({
          name: "project_shell",
          arguments: { command: "cat tracked.txt" },
        });
        expect(result.isError).not.toBe(true);
        expect(
          dispatchProjectShellResultSchema.parse(result.structuredContent)
        ).toMatchObject({ exitCode: 0, stdout: "project-code" });
        const gitStatus = await client.callTool({
          name: "project_shell",
          arguments: { command: "git status --short" },
        });
        expect(
          dispatchProjectShellResultSchema.parse(gitStatus.structuredContent)
        ).toMatchObject({ exitCode: 0, stdout: "" });
        expect(
          readDispatchSpaceActionRecord({ context: action.context }).status
        ).toBe("missing");
        const running = client.callTool({
          name: "project_shell",
          arguments: {
            command:
              "printf ready > command-started; while [ ! -f command-release ]; do sleep 0.05; done",
          },
        });
        try {
          await vi.waitFor(async () => {
            expect(
              await readFile(
                join(workspace.workingDirectory, "command-started"),
                "utf8"
              )
            ).toBe("ready");
          });
          await expect(
            releaseExecutionContextWorkspace({
              ledgerRootPath,
              context,
              ownedProcessesQuiescent: true,
              use,
            })
          ).rejects.toThrow();
        } finally {
          await writeFile(
            join(workspace.workingDirectory, "command-release"),
            "go"
          );
          await running;
        }
        const recordPath = join(
          ledgerRootPath,
          "execution-context-workspace-records",
          `${context.id}.json`
        );
        const record = JSON.parse(await readFile(recordPath, "utf8"));
        await writeFile(
          recordPath,
          JSON.stringify({ ...record, activeAttemptId: "attempt-new" })
        );
        const stale = await client.callTool({
          name: "project_shell",
          arguments: { command: "cat tracked.txt" },
        });
        expect(stale.isError).toBe(true);
      } finally {
        await client?.close();
        await server?.close();
        if (use) {
          await releaseExecutionContextWorkspace({
            ledgerRootPath,
            context,
            ownedProcessesQuiescent: true,
            use,
          }).catch(() => undefined);
        }
        await rm(root, { recursive: true, force: true });
      }
    }
  );

  it.skipIf(process.env.OPENMELD_CLAUDE_CONTAINER_SMOKE !== "1")(
    "runs two independent project containers at the same time",
    async () => {
      const root = await realpath(
        await mkdtemp(join(tmpdir(), "openmeld-claude-parallel-"))
      );
      const workspaces = ["a", "b"].map((label) => ({
        boundaryRoot: join(root, label),
        contextId:
          label === "a"
            ? "44444444-4444-4444-8444-444444444444"
            : "55555555-5555-4555-8555-555555555555",
        workspacePath: join(root, label, "worktree"),
      }));
      let runtimes: Awaited<
        ReturnType<typeof prepareClaudeProjectContainer>
      >[] = [];
      let running: Promise<
        Awaited<ReturnType<typeof runClaudeProjectContainerCommand>>
      >[] = [];
      try {
        await Promise.all(
          workspaces.map((workspace) =>
            mkdir(workspace.workspacePath, { recursive: true })
          )
        );
        runtimes = await Promise.all(
          workspaces.map((workspace) =>
            prepareClaudeProjectContainer(workspace)
          )
        );
        const settled = [false, false];
        running = workspaces.map((workspace, index) => {
          const runtime = runtimes[index];
          if (!runtime) {
            throw new Error("Missing prepared runtime");
          }
          return runClaudeProjectContainerCommand({
            ...workspace,
            runtime,
            command:
              "printf started > started; while [ ! -f release ]; do sleep 0.05; done; printf finished > result",
          }).then((result) => {
            settled[index] = true;
            return result;
          });
        });
        await vi.waitFor(async () => {
          for (const workspace of workspaces) {
            expect(
              await readFile(join(workspace.workspacePath, "started"), "utf8")
            ).toBe("started");
          }
        });
        expect(settled).toEqual([false, false]);
        await Promise.all(
          workspaces.map((workspace) =>
            writeFile(join(workspace.workspacePath, "release"), "go")
          )
        );
        expect(
          (await Promise.all(running)).map((result) => result.exitCode)
        ).toEqual([0, 0]);
        for (const workspace of workspaces) {
          expect(
            await readFile(join(workspace.workspacePath, "result"), "utf8")
          ).toBe("finished");
        }
      } finally {
        await Promise.allSettled(
          workspaces.map((workspace, index) => {
            const runtime = runtimes[index];
            return runtime
              ? stopClaudeProjectContainersForContext({
                  contextId: workspace.contextId,
                  runtime,
                })
              : Promise.resolve();
          })
        );
        await Promise.allSettled(running);
        await rm(root, { recursive: true, force: true });
      }
    }
  );

  it.skipIf(process.env.OPENMELD_CLAUDE_CONTAINER_SMOKE !== "1")(
    "stops a still-running task container before workspace release",
    async () => {
      const root = await realpath(
        await mkdtemp(join(tmpdir(), "openmeld-claude-stop-"))
      );
      const source = join(root, "source");
      const ledgerRootPath = join(root, "lane");
      await mkdir(source);
      await execFileAsync("git", ["-C", source, "init", "--template="]);
      await writeFile(join(source, "tracked.txt"), "project-code");
      await execFileAsync("git", ["-C", source, "add", "."]);
      await execFileAsync("git", [
        "-C",
        source,
        "-c",
        "user.name=Container Test",
        "-c",
        "user.email=container@example.invalid",
        "commit",
        "-m",
        "fixture",
      ]);
      const contextId = "22222222-2222-4222-8222-222222222222";
      const context: ExecutionContextTask = {
        version: 1,
        id: contextId,
        scope: {
          organizationId: "org",
          requesterProfileId: "human",
          spaceId: "space",
          targetProfileId: "agent",
          threadId: null,
        },
        access: "workspace",
        workspace: "isolated",
        nativeConversationId: null,
        runtimeWorkspaceFingerprint: null,
      };
      const workspace = await prepareExecutionContextWorkspace({
        context,
        ledgerRootPath,
        currentWorkingDirectory: source,
        policy: { mode: "local_agent_settings", revision: 1, updatedAtMs: 1 },
      });
      const runtime = await prepareClaudeProjectContainer({
        boundaryRoot: workspace.boundaryRoot,
        contextId,
        workspacePath: workspace.workingDirectory,
      });
      const use = await markExecutionContextWorkspaceInUse({
        context,
        ledgerRootPath,
        containerRuntime: runtime,
        dispatchId: "dispatch-stop",
        attemptId: "attempt-stop",
      });
      const name = `openmeld-claude-project-${contextId.replaceAll("-", "")}-smoke`;
      const args = buildClaudeProjectContainerArgs({
        boundaryRoot: workspace.boundaryRoot,
        command: "sleep 60",
        name,
        relativeWorkspace: "worktree",
      });
      args.splice(1, 0, "-d");
      try {
        await execFileAsync(runtime.binary, args, { timeout: 15_000 });
        await releaseExecutionContextWorkspace({
          context,
          ledgerRootPath,
          ownedProcessesQuiescent: true,
          use,
        });
        const { stdout } = await execFileAsync(
          runtime.binary,
          ["ps", "-a", "--filter", `name=${name}`, "--format", "{{.Names}}"],
          { timeout: 15_000 }
        );
        expect(stdout.trim()).toBe("");
      } finally {
        await execFileAsync(runtime.binary, ["rm", "-f", name], {
          timeout: 15_000,
        }).catch(() => undefined);
        await rm(root, { recursive: true, force: true });
      }
    }
  );
});
