import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runProjectsUnbind } from "../src/agent-activity/command";
import {
  bindProject,
  listProjectBindings,
} from "../src/agent-activity/project-bindings";

const { getAuthSessionState, requestLocalAgentActivitySync } = vi.hoisted(
  () => ({
    getAuthSessionState: vi.fn(() => {
      throw new Error("offline unbind must not read authentication state");
    }),
    requestLocalAgentActivitySync: vi.fn(() =>
      Promise.resolve({ accepted: true })
    ),
  })
);

vi.mock("../src/config/auth-session", () => ({ getAuthSessionState }));
vi.mock(
  "../src/local-service/control-plane/client",
  async (importOriginal) => ({
    ...(await importOriginal()),
    requestLocalAgentActivitySync,
  })
);

let temporaryRoot: string | null = null;
const originalOpenMeldHome = process.env.OPENMELD_HOME;

afterEach(async () => {
  process.exitCode = 0;
  getAuthSessionState.mockClear();
  requestLocalAgentActivitySync.mockClear();
  if (originalOpenMeldHome === undefined) {
    process.env.OPENMELD_HOME = undefined;
  } else {
    process.env.OPENMELD_HOME = originalOpenMeldHome;
  }
  if (temporaryRoot) {
    await rm(temporaryRoot, { force: true, recursive: true });
    temporaryRoot = null;
  }
  vi.restoreAllMocks();
});

describe("projects unbind command", () => {
  it("preserves the update-required code for a newer binding store", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "openmeld-unbind-command-"));
    process.env.OPENMELD_HOME = temporaryRoot;
    await mkdir(join(temporaryRoot, "device", "agent-activity"), {
      recursive: true,
    });
    await writeFile(
      join(temporaryRoot, "device", "agent-activity", "project-bindings.json"),
      `${JSON.stringify({ bindings: [], version: 4 })}\n`,
      "utf8"
    );
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await runProjectsUnbind({ json: true, projectSlug: "openmeld" });

    expect(process.exitCode).toBe(1);
    expect(
      stdout.mock.calls.map(([chunk]) => String(chunk)).join("")
    ).toContain('"code":"project_bindings.update_required"');
  });

  it("removes every connection in one selected Project scope", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "openmeld-unbind-command-"));
    process.env.OPENMELD_HOME = temporaryRoot;
    const firstPath = join(temporaryRoot, "first-connection");
    const secondPath = join(temporaryRoot, "second-connection");
    await Promise.all([
      mkdir(firstPath, { recursive: true }),
      mkdir(secondPath, { recursive: true }),
    ]);
    for (const repositoryPath of [firstPath, secondPath]) {
      await bindProject({
        organizationId: "org-1",
        projectId: "project-1",
        projectSlug: "openmeld",
        repositoryFingerprint: null,
        repositoryPath,
      });
    }
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runProjectsUnbind({
      json: true,
      organizationId: "org-1",
      projectSlug: "openmeld",
    });

    expect(process.exitCode).toBeUndefined();
    await expect(listProjectBindings({})).resolves.toEqual([]);
    expect(requestLocalAgentActivitySync).toHaveBeenCalledWith({
      payload: { reason: "project_connection_disconnected" },
    });
  });

  it("uses project id to disambiguate a reused slug in one Organization", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "openmeld-unbind-command-"));
    process.env.OPENMELD_HOME = temporaryRoot;
    const firstPath = join(temporaryRoot, "first-project");
    const secondPath = join(temporaryRoot, "second-project");
    await Promise.all([mkdir(firstPath), mkdir(secondPath)]);
    await bindProject({
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "reused",
      repositoryFingerprint: null,
      repositoryPath: firstPath,
    });
    await bindProject({
      organizationId: "org-1",
      projectId: "project-2",
      projectSlug: "reused",
      repositoryFingerprint: null,
      repositoryPath: secondPath,
    });
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runProjectsUnbind({
      json: true,
      organizationId: "org-1",
      projectSlug: "reused",
    });
    expect(process.exitCode).toBe(1);

    process.exitCode = 0;
    await runProjectsUnbind({
      json: true,
      organizationId: "org-1",
      projectId: "project-2",
      projectSlug: "reused",
    });

    await expect(listProjectBindings({})).resolves.toEqual([
      expect.objectContaining({ projectId: "project-1" }),
    ]);
  });

  it("stops local collection offline, resolves duplicate slugs explicitly, and never prints paths", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "openmeld-unbind-command-"));
    process.env.OPENMELD_HOME = temporaryRoot;
    const firstPath = join(temporaryRoot, "first-private-path");
    const secondPath = join(temporaryRoot, "second-private-path");
    await Promise.all([
      mkdir(firstPath, { recursive: true }),
      mkdir(secondPath, { recursive: true }),
    ]);
    await bindProject({
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "openmeld",
      repositoryFingerprint: null,
      repositoryPath: firstPath,
    });
    await bindProject({
      organizationId: "org-2",
      projectId: "project-2",
      projectSlug: "openmeld",
      repositoryFingerprint: null,
      repositoryPath: secondPath,
    });
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await runProjectsUnbind({ json: true, projectSlug: "openmeld" });
    expect(process.exitCode).toBe(1);
    expect(await listProjectBindings({})).toHaveLength(2);

    process.exitCode = 0;
    await runProjectsUnbind({
      json: true,
      organizationId: "org-2",
      projectSlug: "openmeld",
    });

    expect(getAuthSessionState).not.toHaveBeenCalled();
    await expect(listProjectBindings({})).resolves.toEqual([
      expect.objectContaining({ organizationId: "org-1" }),
    ]);
    const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(output).toContain('"type":"projects.unbind"');
    expect(output).toContain('"organizationId":"org-2"');
    expect(output).not.toContain(firstPath);
    expect(output).not.toContain(secondPath);
  });
});
