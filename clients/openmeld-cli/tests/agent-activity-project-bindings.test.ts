import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveObservedAgentActivityBinding } from "../src/agent-activity/observer-adapters";
import {
  bindProject,
  listProjectBindings,
  listProjectConnectionsWithStatus,
  migrateProjectBindingStore,
  ProjectBindingOperationError,
  ProjectBindingStoreUpdateRequiredError,
  parseProjectBindingStore,
  removeMissingProjectConnections,
  removeProjectConnection,
  resolveProjectBinding,
  setDefaultProjectConnection,
  unbindProject,
} from "../src/agent-activity/project-bindings";

const temporaryRoots: string[] = [];
const LEGACY_BINDING_GENERATION_PATTERN = /^legacy-[a-f0-9]{64}$/u;

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true }))
  );
});

describe("Agent Activity local Project bindings", () => {
  it("stores absolute paths only in a mode-0600 lane-local file", async () => {
    const rootDir = await tempRoot();
    const repositoryPath = join(rootDir, "repos", "openmeld");
    await mkdir(repositoryPath, { recursive: true });

    await bindProject({
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "openmeld",
      repositoryFingerprint: null,
      repositoryPath,
      rootDir,
    });

    await expect(
      listProjectBindings({ organizationId: "org-1", rootDir })
    ).resolves.toEqual([
      expect.objectContaining({
        projectId: "project-1",
        repositoryPath: await realpath(repositoryPath),
      }),
    ]);
    const storePath = join(
      rootDir,
      "device",
      "agent-activity",
      "project-bindings.json"
    );
    expect((await stat(storePath)).mode % 0o1000).toBe(0o600);
    expect(await readFile(storePath, "utf8")).toContain(repositoryPath);
  });

  it("repairs an existing Agent Activity directory to private permissions", async () => {
    const rootDir = await tempRoot();
    const repositoryPath = join(rootDir, "repos", "openmeld");
    const activityDirectory = join(rootDir, "device", "agent-activity");
    await mkdir(repositoryPath, { recursive: true });
    await mkdir(activityDirectory, { mode: 0o755, recursive: true });
    await chmod(activityDirectory, 0o755);

    await bindProject({
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "openmeld",
      repositoryFingerprint: null,
      repositoryPath,
      rootDir,
    });

    expect((await stat(activityDirectory)).mode % 0o1000).toBe(0o700);
  });

  it("uses the longest matching opt-in root and removes it immediately", async () => {
    const rootDir = await tempRoot();
    const workspacePath = join(rootDir, "workspace");
    const childPath = join(workspacePath, "child");
    const childFilePath = join(childPath, "src", "index.ts");
    await mkdir(join(childPath, "src"), { recursive: true });
    await writeFile(childFilePath, "export {};\n", "utf8");
    await bindProject({
      organizationId: "org-1",
      projectId: "project-parent",
      projectSlug: "parent",
      repositoryFingerprint: null,
      repositoryPath: workspacePath,
      rootDir,
    });
    await bindProject({
      organizationId: "org-1",
      projectId: "project-child",
      projectSlug: "child",
      repositoryFingerprint: null,
      repositoryPath: childPath,
      rootDir,
    });

    await expect(
      resolveProjectBinding({
        organizationId: "org-1",
        path: childFilePath,
        rootDir,
      })
    ).resolves.toMatchObject({ projectId: "project-child" });
    const bindings = await listProjectBindings({ rootDir });
    await expect(
      resolveObservedAgentActivityBinding(childFilePath, bindings)
    ).resolves.toMatchObject({ projectId: "project-child" });
    await expect(
      unbindProject({
        organizationId: "org-1",
        projectId: "project-child",
        rootDir,
      })
    ).resolves.toBe(true);
    await expect(
      resolveProjectBinding({
        organizationId: "org-1",
        path: childFilePath,
        rootDir,
      })
    ).resolves.toMatchObject({ projectId: "project-parent" });
  });

  it("rejects missing, non-directory, and cross-Organization duplicate roots", async () => {
    const rootDir = await tempRoot();
    const repositoryPath = join(rootDir, "repository");
    const filePath = join(rootDir, "not-a-repository");
    await mkdir(repositoryPath);
    await writeFile(filePath, "not a directory", "utf8");

    await expect(
      bindProject({
        organizationId: "org-1",
        projectId: "project-missing",
        projectSlug: "missing",
        repositoryFingerprint: null,
        repositoryPath: join(rootDir, "missing"),
        rootDir,
      })
    ).rejects.toThrow("does not exist");
    await expect(
      bindProject({
        organizationId: "org-1",
        projectId: "project-file",
        projectSlug: "file",
        repositoryFingerprint: null,
        repositoryPath: filePath,
        rootDir,
      })
    ).rejects.toThrow("must be a directory");

    if (process.platform !== "win32") {
      const unreadablePath = join(rootDir, "unreadable");
      await mkdir(unreadablePath);
      await chmod(unreadablePath, 0o000);
      try {
        await expect(
          bindProject({
            organizationId: "org-1",
            projectId: "project-unreadable",
            projectSlug: "unreadable",
            repositoryFingerprint: null,
            repositoryPath: unreadablePath,
            rootDir,
          })
        ).rejects.toThrow("not readable");
      } finally {
        await chmod(unreadablePath, 0o700);
      }
    }

    await bindProject({
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "first",
      repositoryFingerprint: null,
      repositoryPath,
      rootDir,
    });
    await expect(
      bindProject({
        organizationId: "org-2",
        projectId: "project-2",
        projectSlug: "second",
        repositoryFingerprint: null,
        repositoryPath,
        rootDir,
      })
    ).rejects.toThrow("already connected");
  });

  it("moves a cross-Organization folder only after confirming the reported conflict", async () => {
    const rootDir = await tempRoot();
    const repositoryPath = join(rootDir, "repository");
    await mkdir(repositoryPath);

    await bindProject({
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "first",
      repositoryFingerprint: null,
      repositoryPath,
      rootDir,
    });

    let conflict: ProjectBindingOperationError | null = null;
    try {
      await bindProject({
        organizationId: "org-2",
        projectId: "project-2",
        projectSlug: "second",
        repositoryFingerprint: null,
        repositoryPath,
        rootDir,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectBindingOperationError);
      conflict = error as ProjectBindingOperationError;
    }

    expect(conflict).toMatchObject({
      code: "path_conflict",
      message:
        "This folder is already connected to the “first” Project in another Organization.",
      pathConflict: {
        conflictingProjectSlug: "first",
        conflictScope: "another_organization",
        moveImpact: "only_connection",
      },
    });
    expect(conflict?.pathConflict?.moveConfirmationToken).toBeTruthy();

    await expect(
      bindProject({
        moveConfirmationToken:
          conflict?.pathConflict?.moveConfirmationToken ?? "missing-token",
        organizationId: "org-2",
        projectId: "project-3",
        projectSlug: "third",
        repositoryFingerprint: null,
        repositoryPath,
        rootDir,
      })
    ).rejects.toMatchObject({
      code: "binding_generation_stale",
    });

    await bindProject({
      moveConfirmationToken:
        conflict?.pathConflict?.moveConfirmationToken ?? "missing-token",
      organizationId: "org-2",
      projectId: "project-2",
      projectSlug: "second",
      repositoryFingerprint: null,
      repositoryPath,
      rootDir,
    });

    await expect(listProjectBindings({ rootDir })).resolves.toEqual([
      expect.objectContaining({
        isDefault: true,
        organizationId: "org-2",
        projectId: "project-2",
        projectSlug: "second",
        repositoryPath: await realpath(repositoryPath),
      }),
    ]);
  });

  it("adds another connection without replacing the current default", async () => {
    const rootDir = await tempRoot();
    const firstPath = join(rootDir, "first");
    const secondPath = join(rootDir, "second");
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
      rootDir,
    });

    await bindProject({
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "openmeld",
      repositoryFingerprint: null,
      repositoryPath: secondPath,
      rootDir,
    });
    await expect(listProjectBindings({ rootDir })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          isDefault: true,
          repositoryPath: await realpath(firstPath),
        }),
        expect.objectContaining({
          isDefault: false,
          repositoryPath: await realpath(secondPath),
        }),
      ])
    );
  });
});

describe("Project binding store v3 migration", () => {
  const legacyBinding = {
    boundAtMs: 1_783_892_400_000,
    organizationId: "org-1",
    projectId: "project-1",
    projectSlug: "openmeld",
    repositoryFingerprint: null,
    repositoryPath: "/Users/felix/work/openmeld",
  };

  it("migrates v1 and v2 single bindings to one default v3 connection", () => {
    const v1 = parseProjectBindingStore(
      { bindings: [legacyBinding], version: 1 },
      "project-bindings.json"
    );
    const v2 = parseProjectBindingStore(
      {
        bindings: [{ ...legacyBinding, bindingGeneration: "binding-2" }],
        version: 2,
      },
      "project-bindings.json"
    );

    expect(v1).toMatchObject({
      bindings: [
        {
          bindingGeneration: expect.stringMatching(
            LEGACY_BINDING_GENERATION_PATTERN
          ),
          isDefault: true,
        },
      ],
      version: 3,
    });
    expect(v2).toMatchObject({
      bindings: [{ bindingGeneration: "binding-2", isDefault: true }],
      version: 3,
    });
  });

  it("preserves v3 multiple connections and the explicit default", () => {
    expect(
      parseProjectBindingStore(
        {
          bindings: [
            {
              ...legacyBinding,
              bindingGeneration: "binding-default",
              isDefault: true,
            },
            {
              ...legacyBinding,
              bindingGeneration: "binding-worktree",
              isDefault: false,
              repositoryPath: "/Users/felix/work/openmeld-feature",
            },
          ],
          version: 3,
        },
        "project-bindings.json"
      )
    ).toMatchObject({
      bindings: [
        { bindingGeneration: "binding-default", isDefault: true },
        { bindingGeneration: "binding-worktree", isDefault: false },
      ],
      version: 3,
    });
  });

  it("fails closed on invalid default groups and duplicate canonical paths", () => {
    expect(() =>
      parseProjectBindingStore(
        {
          bindings: [
            {
              ...legacyBinding,
              bindingGeneration: "binding-1",
              isDefault: false,
            },
          ],
          version: 3,
        },
        "project-bindings.json"
      )
    ).toThrow("exactly one default");
    expect(() =>
      parseProjectBindingStore(
        {
          bindings: [
            {
              ...legacyBinding,
              bindingGeneration: "binding-1",
              isDefault: true,
            },
            {
              ...legacyBinding,
              bindingGeneration: "binding-2",
              isDefault: true,
              organizationId: "org-2",
              projectId: "project-2",
              projectSlug: "other",
            },
          ],
          version: 3,
        },
        "project-bindings.json"
      )
    ).toThrow("canonical path");
  });

  it("requires a same-machine update before reading a newer store", () => {
    expect(() =>
      parseProjectBindingStore(
        { bindings: [], version: 4 },
        "project-bindings.json"
      )
    ).toThrow(ProjectBindingStoreUpdateRequiredError);
    try {
      parseProjectBindingStore(
        { bindings: [], version: 4 },
        "project-bindings.json"
      );
    } catch (error) {
      expect(error).toMatchObject({
        code: "project_bindings.update_required",
      });
    }
  });

  it("keeps a real v2 file unchanged until the first mutation writes v3", async () => {
    const rootDir = await tempRoot();
    const firstPath = join(rootDir, "first");
    const secondPath = join(rootDir, "second");
    await Promise.all([mkdir(firstPath), mkdir(secondPath)]);
    const path = await writeBindingStore(rootDir, {
      bindings: [
        {
          ...legacyBinding,
          bindingGeneration: "binding-v2",
          repositoryPath: firstPath,
        },
      ],
      version: 2,
    });

    await expect(listProjectBindings({ rootDir })).resolves.toMatchObject([
      { bindingGeneration: "binding-v2", isDefault: true },
    ]);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      version: 2,
    });

    await bindProject({
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "openmeld",
      repositoryFingerprint: null,
      repositoryPath: secondPath,
      rootDir,
    });

    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      bindings: [
        { bindingGeneration: "binding-v2", isDefault: true },
        { isDefault: false },
      ],
      version: 3,
    });
  });

  it("migrates proactively only when doctor requests it", async () => {
    const rootDir = await tempRoot();
    const repositoryPath = join(rootDir, "repository");
    await mkdir(repositoryPath);
    const path = await writeBindingStore(rootDir, {
      bindings: [
        {
          ...legacyBinding,
          bindingGeneration: "binding-v2",
          repositoryPath,
        },
      ],
      version: 2,
    });

    await expect(migrateProjectBindingStore({ rootDir })).resolves.toBe(
      "migrated"
    );
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      bindings: [{ bindingGeneration: "binding-v2", isDefault: true }],
      version: 3,
    });
    await expect(migrateProjectBindingStore({ rootDir })).resolves.toBe(
      "current"
    );
  });
});

describe("Project binding store v3 connection invariants", () => {
  it("fails closed when two connections reuse one binding generation", () => {
    expect(() =>
      parseProjectBindingStore(
        {
          bindings: [
            {
              bindingGeneration: "duplicate-generation",
              boundAtMs: 1,
              isDefault: true,
              organizationId: "org-1",
              projectId: "project-1",
              projectSlug: "openmeld",
              repositoryFingerprint: null,
              repositoryPath: "/work/first",
            },
            {
              bindingGeneration: "duplicate-generation",
              boundAtMs: 2,
              isDefault: false,
              organizationId: "org-1",
              projectId: "project-1",
              projectSlug: "openmeld",
              repositoryFingerprint: null,
              repositoryPath: "/work/second",
            },
          ],
          version: 3,
        },
        "/test/project-bindings.json"
      )
    ).toThrow("duplicate binding generation");
  });

  it("keeps exactly one explicit default across add, select, and removal", async () => {
    const rootDir = await tempRoot();
    const firstPath = join(rootDir, "first");
    const secondPath = join(rootDir, "second");
    await Promise.all([mkdir(firstPath), mkdir(secondPath)]);

    const first = await bindProject({
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "openmeld",
      repositoryFingerprint: null,
      repositoryPath: firstPath,
      rootDir,
    });
    const second = await bindProject({
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "openmeld",
      repositoryFingerprint: null,
      repositoryPath: secondPath,
      rootDir,
    });
    expect(first.isDefault).toBe(true);
    expect(second.isDefault).toBe(false);

    await expect(
      setDefaultProjectConnection({
        expectedBindingGeneration: second.bindingGeneration,
        organizationId: "org-1",
        projectId: "project-1",
        rootDir,
      })
    ).resolves.toMatchObject({ isDefault: true });
    await expect(
      removeProjectConnection({
        expectedBindingGeneration: second.bindingGeneration,
        organizationId: "org-1",
        projectId: "project-1",
        rootDir,
      })
    ).rejects.toThrow("replacement default");
    await expect(
      removeProjectConnection({
        expectedBindingGeneration: second.bindingGeneration,
        organizationId: "org-1",
        projectId: "project-1",
        replacementBindingGeneration: first.bindingGeneration,
        rootDir,
      })
    ).resolves.toMatchObject({
      removed: expect.objectContaining({
        bindingGeneration: second.bindingGeneration,
      }),
      replacementDefault: expect.objectContaining({
        bindingGeneration: first.bindingGeneration,
        isDefault: true,
      }),
    });
    await expect(listProjectBindings({ rootDir })).resolves.toMatchObject([
      { bindingGeneration: first.bindingGeneration, isDefault: true },
    ]);
  });

  it("returns the existing identity when the same Project and path reconnect", async () => {
    const rootDir = await tempRoot();
    const repositoryPath = join(rootDir, "repository");
    await mkdir(repositoryPath);
    const input = {
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "openmeld",
      repositoryFingerprint: null,
      repositoryPath,
      rootDir,
    };

    const first = await bindProject(input);
    const second = await bindProject(input);

    expect(second).toEqual(first);
    await expect(listProjectBindings({ rootDir })).resolves.toHaveLength(1);
  });

  it("removes only missing non-default connections without changing the default", async () => {
    const rootDir = await tempRoot();
    const availablePath = join(rootDir, "available");
    const missingPath = join(rootDir, "missing");
    await Promise.all([mkdir(availablePath), mkdir(missingPath)]);
    const available = await bindProject({
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "openmeld",
      repositoryFingerprint: null,
      repositoryPath: availablePath,
      rootDir,
    });
    const missing = await bindProject({
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "openmeld",
      repositoryFingerprint: null,
      repositoryPath: missingPath,
      rootDir,
    });
    const { rm } = await import("node:fs/promises");
    await rm(missingPath, { recursive: true });

    await expect(
      removeMissingProjectConnections({
        organizationId: "org-1",
        projectId: "project-1",
        rootDir,
      })
    ).resolves.toMatchObject({
      remaining: [
        { bindingGeneration: available.bindingGeneration, isDefault: true },
      ],
      removed: [{ bindingGeneration: missing.bindingGeneration }],
    });
  });

  it("does not classify an unreadable connection as missing", async () => {
    const rootDir = await tempRoot();
    const restrictedParent = join(rootDir, "restricted");
    const repositoryPath = join(restrictedParent, "repository");
    await mkdir(repositoryPath, { recursive: true });
    await bindProject({
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "openmeld",
      repositoryFingerprint: null,
      repositoryPath,
      rootDir,
    });
    await chmod(restrictedParent, 0o000);

    try {
      await expect(
        listProjectConnectionsWithStatus({
          organizationId: "org-1",
          rootDir,
        })
      ).rejects.toThrow("Failed to inspect Project connection path");
      await expect(
        removeMissingProjectConnections({
          organizationId: "org-1",
          projectId: "project-1",
          rootDir,
        })
      ).rejects.toThrow("Failed to inspect Project connection path");
      await expect(listProjectBindings({ rootDir })).resolves.toHaveLength(1);
    } finally {
      await chmod(restrictedParent, 0o700);
    }
  });

  it("rejects bulk cleanup when a missing default has a healthy replacement", async () => {
    const rootDir = await tempRoot();
    const defaultPath = join(rootDir, "default");
    const healthyPath = join(rootDir, "healthy");
    await Promise.all([mkdir(defaultPath), mkdir(healthyPath)]);
    await bindProject({
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "openmeld",
      repositoryFingerprint: null,
      repositoryPath: defaultPath,
      rootDir,
    });
    await bindProject({
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "openmeld",
      repositoryFingerprint: null,
      repositoryPath: healthyPath,
      rootDir,
    });
    const { rm } = await import("node:fs/promises");
    await rm(defaultPath, { recursive: true });

    await expect(
      removeMissingProjectConnections({
        organizationId: "org-1",
        projectId: "project-1",
        rootDir,
      })
    ).rejects.toMatchObject({
      code: "default_missing_requires_replacement",
    });
    await expect(listProjectBindings({ rootDir })).resolves.toHaveLength(2);
  });

  it("removes the whole Project group when every connection is missing", async () => {
    const rootDir = await tempRoot();
    const firstPath = join(rootDir, "first");
    const secondPath = join(rootDir, "second");
    await Promise.all([mkdir(firstPath), mkdir(secondPath)]);
    await bindProject({
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "openmeld",
      repositoryFingerprint: null,
      repositoryPath: firstPath,
      rootDir,
    });
    await bindProject({
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "openmeld",
      repositoryFingerprint: null,
      repositoryPath: secondPath,
      rootDir,
    });
    const { rm } = await import("node:fs/promises");
    await Promise.all([
      rm(firstPath, { recursive: true }),
      rm(secondPath, { recursive: true }),
    ]);

    await expect(
      removeMissingProjectConnections({
        organizationId: "org-1",
        projectId: "project-1",
        rootDir,
      })
    ).resolves.toMatchObject({ remaining: [], removed: [{}, {}] });
    await expect(listProjectBindings({ rootDir })).resolves.toEqual([]);
  });
});

async function tempRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "openmeld-agent-activity-"));
  temporaryRoots.push(path);
  return path;
}

async function writeBindingStore(
  rootDir: string,
  value: unknown
): Promise<string> {
  const path = join(
    rootDir,
    "device",
    "agent-activity",
    "project-bindings.json"
  );
  await mkdir(join(rootDir, "device", "agent-activity"), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return path;
}
