import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type GitRepositoryVerifier,
  GitVerificationUnavailableError,
  NotGitRepositoryError,
} from "../src/local-service/projects/git-repository-verifier";
import {
  type LocalProjectConnectionError,
  validateLocalProjectConnectionPath,
} from "../src/local-service/projects/local-project-connection";

const FINGERPRINT_A = `sha256:${"a".repeat(64)}`;
const FINGERPRINT_B = `sha256:${"b".repeat(64)}`;
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true }))
  );
});

describe("local Project connection validation", () => {
  it.each([
    ["missing", "path_not_found"],
    ["file", "path_not_directory"],
  ] as const)("rejects a %s path", async (kind, code) => {
    const root = await tempRoot();
    const path = join(root, kind);
    if (kind === "file") {
      await writeFile(path, "not a folder", "utf8");
    }

    await expect(
      validateLocalProjectConnectionPath(
        {
          allowUnverifiedNonGit: false,
          declaredPath: path,
          projectRepositoryFingerprint: null,
        },
        { verifier: fakeVerifier() }
      )
    ).rejects.toMatchObject({
      code,
    } satisfies Partial<LocalProjectConnectionError>);
  });

  it("rejects an unreadable directory", async () => {
    if (process.platform === "win32") {
      return;
    }
    const root = await tempRoot();
    const path = join(root, "unreadable");
    await mkdir(path);
    await chmod(path, 0o000);
    try {
      await expect(
        validateLocalProjectConnectionPath(
          {
            allowUnverifiedNonGit: false,
            declaredPath: path,
            projectRepositoryFingerprint: null,
          },
          { verifier: fakeVerifier() }
        )
      ).rejects.toMatchObject({ code: "path_unreadable" });
    } finally {
      await chmod(path, 0o700);
    }
  });

  it("raises a repository subdirectory to the Git toplevel", async () => {
    const root = await tempRoot();
    const repositoryPath = join(root, "repository");
    const nestedPath = join(repositoryPath, "packages", "app");
    await mkdir(nestedPath, { recursive: true });
    const canonicalRepositoryPath = await realpath(repositoryPath);
    const canonicalNestedPath = await realpath(nestedPath);

    await expect(
      validateLocalProjectConnectionPath(
        {
          allowUnverifiedNonGit: false,
          declaredPath: nestedPath,
          projectRepositoryFingerprint: FINGERPRINT_A,
        },
        {
          verifier: fakeVerifier({
            canonicalPath: canonicalRepositoryPath,
            repositoryFingerprint: FINGERPRINT_A,
          }),
        }
      )
    ).resolves.toMatchObject({
      canonicalPath: canonicalRepositoryPath,
      normalizedFrom: canonicalNestedPath,
      repositoryFingerprint: FINGERPRINT_A,
    });
  });

  it("rejects a non-Git folder when the Project has a fingerprint", async () => {
    const root = await tempRoot();
    const path = join(root, "plain-folder");
    await mkdir(path);

    await expect(
      validateLocalProjectConnectionPath(
        {
          allowUnverifiedNonGit: true,
          declaredPath: path,
          projectRepositoryFingerprint: FINGERPRINT_A,
        },
        { verifier: fakeVerifier({ notGit: true }) }
      )
    ).rejects.toMatchObject({ code: "git_repository_required" });
  });

  it("requires a second confirmation for a non-Git folder without a fingerprint", async () => {
    const root = await tempRoot();
    const path = join(root, "plain-folder");
    await mkdir(path);
    const verifier = fakeVerifier({ notGit: true });

    await expect(
      validateLocalProjectConnectionPath(
        {
          allowUnverifiedNonGit: false,
          declaredPath: path,
          projectRepositoryFingerprint: null,
        },
        { verifier }
      )
    ).rejects.toMatchObject({ code: "confirmation_required" });
    await expect(
      validateLocalProjectConnectionPath(
        {
          allowUnverifiedNonGit: true,
          declaredPath: path,
          projectRepositoryFingerprint: null,
        },
        { verifier }
      )
    ).resolves.toMatchObject({ repositoryFingerprint: null });
  });

  it("rejects a repository with a different fingerprint", async () => {
    const root = await tempRoot();
    const path = join(root, "repository");
    await mkdir(path);

    await expect(
      validateLocalProjectConnectionPath(
        {
          allowUnverifiedNonGit: false,
          declaredPath: path,
          projectRepositoryFingerprint: FINGERPRINT_A,
        },
        {
          verifier: fakeVerifier({
            canonicalPath: path,
            repositoryFingerprint: FINGERPRINT_B,
          }),
        }
      )
    ).rejects.toMatchObject({ code: "repository_fingerprint_mismatch" });
  });

  it("fails closed when Git is unavailable for a fingerprinted Project", async () => {
    const root = await tempRoot();
    const path = join(root, "repository");
    await mkdir(path);

    await expect(
      validateLocalProjectConnectionPath(
        {
          allowUnverifiedNonGit: true,
          declaredPath: path,
          projectRepositoryFingerprint: FINGERPRINT_A,
        },
        { verifier: fakeVerifier({ unavailable: true }) }
      )
    ).rejects.toMatchObject({ code: "git_verification_unavailable" });
  });
});

function fakeVerifier(
  input: {
    canonicalPath?: string;
    notGit?: boolean;
    repositoryFingerprint?: string | null;
    unavailable?: boolean;
  } = {}
): GitRepositoryVerifier {
  return {
    checkAvailability: () => Promise.resolve("available"),
    inspectRepository: (path) => {
      if (input.unavailable) {
        return Promise.reject(
          new GitVerificationUnavailableError("unavailable")
        );
      }
      if (input.notGit) {
        return Promise.reject(new NotGitRepositoryError(path));
      }
      return Promise.resolve({
        canonicalPath: input.canonicalPath ?? path,
        originUrl: null,
        repositoryFingerprint: input.repositoryFingerprint ?? null,
      });
    },
    listWorktrees: () => Promise.resolve([]),
    runForTest: () => Promise.resolve({ stderr: "", stdout: "" }),
  };
}

async function tempRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "openmeld-project-connect-"));
  temporaryRoots.push(path);
  return path;
}
