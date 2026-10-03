import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { buildCodexFileAccessBoundaryGlobalArgs } from "../dist/transport/codex-file-access-boundary.js";

const binary = process.env.OPENMELD_CODEX_SANDBOX_TEST_BINARY;
const DENIED = /Operation not permitted|Permission denied/u;
const UNVERIFIED = /execution_context.file_access_unverified/u;
const UPSTREAM_BRANCH = /\[branch "task-positive"\]/u;
const GIT_POINTER = /^gitdir: /u;
const gitExecutable =
  process.env.OPENMELD_GIT_SANDBOX_TEST_BINARY ?? "/usr/bin/git";
const toolReadPaths = JSON.parse(
  process.env.OPENMELD_GIT_SANDBOX_TEST_READ_PATHS ?? "[]"
);
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const nodeExecutable = process.env.OPENMELD_GIT_SANDBOX_TEST_NODE;
const pnpmScript = process.env.OPENMELD_GIT_SANDBOX_TEST_PNPM;

it(
  "protects isolated executable Git metadata in a real native sandbox",
  {
    skip: process.platform !== "darwin" || !binary,
  },
  () => {
    const root = realpathSync(
      mkdtempSync(join(tmpdir(), "openmeld-git-sandbox-"))
    );
    const source = join(root, "source");
    const task = join(root, "task");
    const worktree = join(task, "worktree");
    const repository = join(task, "repository.git");
    const git = (cwd, args) => {
      const result = spawnSync(
        "git",
        [
          "-c",
          "user.name=Sandbox fixture",
          "-c",
          "user.email=fixture@example.invalid",
          "-c",
          "core.hooksPath=/dev/null",
          ...args,
        ],
        {
          cwd,
          encoding: "utf8",
          env: {
            ...process.env,
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_CONFIG_GLOBAL: "/dev/null",
          },
        }
      );
      assert.equal(result.status, 0, result.stderr);
    };
    try {
      mkdirSync(source);
      mkdirSync(task);
      git(source, ["init", "--template="]);
      writeFileSync(join(source, "ordinary.txt"), "fixture\n");
      git(source, ["add", "."]);
      git(source, ["commit", "-m", "Harmless sandbox fixture"]);
      git(root, ["clone", "--bare", "--no-hardlinks", source, repository]);
      git(root, [
        `--git-dir=${repository}`,
        "worktree",
        "add",
        "--detach",
        worktree,
        "HEAD",
      ]);
      mkdirSync(join(repository, "hooks"), { recursive: true });
      mkdirSync(join(repository, "logs"), { recursive: true });
      git(root, [
        `--git-dir=${repository}`,
        "config",
        "extensions.worktreeConfig",
        "true",
      ]);
      writeFileSync(
        join(repository, "worktrees/worktree/config.worktree"),
        "[core]\n bare = false\n[harmless]\n marker = fixture\n"
      );
      const args = buildCodexFileAccessBoundaryGlobalArgs({
        boundary: {
          mode: "only_selected_folders",
          folders: [task],
          revision: 1,
          updatedAtMs: 1,
          executionContextAccess: "workspace",
          gitMetadata: {
            commonDirectoryPointerPath: join(
              repository,
              "worktrees/worktree/commondir"
            ),
            configPath: join(repository, "config"),
            gitDirectoryPointerPath: join(
              repository,
              "worktrees/worktree/gitdir"
            ),
            hooksPath: join(repository, "hooks"),
            worktreeConfigPath: join(
              repository,
              "worktrees/worktree/config.worktree"
            ),
            worktreeGitPointerPath: join(worktree, ".git"),
          },
        },
        permissionMode: "codex:fullAccess",
      })
        .slice(0, -2)
        .map((arg) =>
          arg.includes("filesystem = {")
            ? arg.replace(
                "filesystem = {",
                `filesystem = { ${toolReadPaths.map((path) => `${JSON.stringify(path)} = "read"`).join(", ")}${toolReadPaths.length ? ", " : ""}`
              )
            : arg
        );
      const run = (command) =>
        spawnSync(
          binary,
          [
            ...args,
            "sandbox",
            "-P",
            "openmeld_computer_boundary",
            "-C",
            worktree,
            "/bin/sh",
            "-c",
            `export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0; ${command}`,
          ],
          {
            cwd: worktree,
            encoding: "utf8",
            timeout: 15_000,
          }
        );
      git(worktree, ["checkout", "-b", "task-positive"]);
      const remote = join(task, "remote.git");
      git(task, ["init", "--bare", "--template=", remote]);
      git(worktree, ["remote", "set-url", "origin", remote]);
      const submoduleRemote = join(task, "submodule.git");
      git(task, ["clone", "--bare", "--no-hardlinks", source, submoduleRemote]);
      git(worktree, [
        "-c",
        "protocol.file.allow=always",
        "submodule",
        "add",
        submoduleRemote,
        "sub",
      ]);
      mkdirSync(join(worktree, ".husky"));
      writeFileSync(join(worktree, ".husky/pre-commit"), "#!/bin/sh\nexit 0\n");
      writeFileSync(
        join(worktree, "package.json"),
        JSON.stringify({
          name: "native-sandbox-positive",
          private: true,
          scripts: {
            prepare: `${shellQuote(gitExecutable)} config core.hooksPath .husky`,
          },
        })
      );
      git(worktree, ["add", "."]);
      git(worktree, [
        "commit",
        "-m",
        "Committed installer and submodule fixture",
      ]);
      git(worktree, ["submodule", "deinit", "--force", "sub"]);
      const positiveResults = [
        [
          "commit",
          `${shellQuote(gitExecutable)} -c user.name=Fixture -c user.email=fixture@example.invalid -c core.hooksPath=/dev/null commit --allow-empty -m 'Native sandbox positive'`,
        ],
        [
          "push-upstream",
          `${shellQuote(gitExecutable)} push -u origin task-positive`,
        ],
        [
          "user-config",
          `${shellQuote(gitExecutable)} config user.email fixture@example.invalid`,
        ],
        [
          "submodule-init",
          `${shellQuote(gitExecutable)} -c protocol.file.allow=always submodule update --init`,
        ],
        [
          "worktree-add",
          `${shellQuote(gitExecutable)} -c core.hooksPath=/dev/null worktree add ../x -b task-sibling HEAD`,
        ],
        ...(nodeExecutable && pnpmScript
          ? [
              [
                "pnpm-hook-install",
                `PATH=${shellQuote(`${join(nodeExecutable, "..")}:${join(gitExecutable, "..")}:/usr/bin:/bin`)} HOME=${shellQuote(join(task, "home"))} XDG_CONFIG_HOME=${shellQuote(join(task, "home"))} XDG_CACHE_HOME=${shellQuote(join(task, "cache"))} npm_config_userconfig=/dev/null ${shellQuote(nodeExecutable)} ${shellQuote(pnpmScript)} install --offline --store-dir ../pnpm-store --config.script-shell=/bin/sh --config.manage-package-manager-versions=false`,
              ],
            ]
          : []),
      ].map(([name, command]) => {
        const result = run(command);
        console.log(
          JSON.stringify({ name, status: result.status, stderr: result.stderr })
        );
        return { name, ...result };
      });
      assert.deepEqual(
        positiveResults
          .filter((result) => result.status !== 0)
          .map((result) => result.name),
        [],
        "Normal Git operations must remain available"
      );
      assert.doesNotMatch(
        positiveResults.find((result) => result.name === "push-upstream")
          .stderr,
        DENIED,
        "A successful push must also save its upstream"
      );
      assert.match(
        readFileSync(join(repository, "config"), "utf8"),
        UPSTREAM_BRANCH
      );
      assert.equal(
        run(
          `${shellQuote(gitExecutable)} config --get user.email`
        ).stdout.trim(),
        "fixture@example.invalid"
      );
      // These files route Git to executable configuration. Protect the pointer
      // itself, including unlink/replace, rather than only its current target.
      for (const path of [
        "../repository.git/worktrees/worktree/commondir",
        "../repository.git/worktrees/worktree/gitdir",
        ".git",
      ]) {
        const absolutePath = join(worktree, path);
        const beforePointer = readFileSync(absolutePath);
        for (const command of [
          `printf harmless > ${path}`,
          `printf harmless > replacement && /bin/mv replacement ${path}`,
          `/bin/rm ${path} && printf harmless > ${path}`,
        ]) {
          const result = run(command);
          assert.notEqual(
            result.status,
            0,
            `Git routing must be read-only: ${command}`
          );
          assert.match(result.stderr, DENIED);
          assert.deepEqual(readFileSync(absolutePath), beforePointer);
        }
      }
      rmSync(join(repository, "worktrees/worktree/config.worktree"));
      const worktreeConfig = run(
        "printf '[harmless]\\n marker = fixture\\n' > ../repository.git/worktrees/worktree/config.worktree"
      );
      assert.equal(
        worktreeConfig.status,
        0,
        "Worktree configuration must remain writable"
      );
      const moveGitDirectory = run(
        "/bin/mv ../repository.git/worktrees/worktree ../repository.git/worktrees/replaced"
      );
      assert.notEqual(
        moveGitDirectory.status,
        0,
        "Moving the routing directory must not bypass protection"
      );
      assert.match(moveGitDirectory.stderr, DENIED);
      for (const path of ["../repository.git/hooks/harmless-marker"]) {
        const result = run(`printf harmless >> ${path}`);
        assert.notEqual(
          result.status,
          0,
          `Executable metadata must be read-only: ${path}`
        );
        assert.match(result.stderr, DENIED);
      }
      const index = join(repository, "worktrees/worktree/index");
      writeFileSync(join(worktree, "index-copy"), readFileSync(index));
      const writeIndex = run(
        "/bin/cat index-copy > ../repository.git/worktrees/worktree/index"
      );
      assert.equal(
        writeIndex.status,
        0,
        `The actual Git index must stay writable: ${writeIndex.stderr}`
      );
      const link = run(
        "/bin/ln .git alias-pointer && printf harmless >> alias-pointer"
      );
      assert.notEqual(
        link.status,
        0,
        "The sandbox must not create a writable metadata alias"
      );
      for (const command of [
        "/bin/rm .git && /bin/mkdir .git",
        "/bin/mv .git saved-pointer && /bin/ln -s ../repository.git .git",
      ]) {
        const result = run(command);
        assert.notEqual(
          result.status,
          0,
          "Removing or renaming the original pointer must be refused"
        );
        assert.match(result.stderr, DENIED);
        assert.match(readFileSync(join(worktree, ".git"), "utf8"), GIT_POINTER);
      }
      rmSync(join(repository, "hooks"), { recursive: true });
      assert.equal(
        run("printf harmless >> ordinary.txt").status,
        0,
        "An absent hooks directory must not prevent ordinary work"
      );
      const createHooks = run("/bin/mkdir ../repository.git/hooks");
      assert.notEqual(
        createHooks.status,
        0,
        "The read-only hooks path must cover future creation"
      );
      assert.match(createHooks.stderr, DENIED);
      for (const path of [
        "ordinary.txt",
        "../repository.git/objects/harmless-marker",
        "../repository.git/refs/harmless-marker",
        "../repository.git/logs/harmless-marker",
        "../repository.git/worktrees/worktree/harmless-index-marker",
      ]) {
        const result = run(`printf harmless >> ${path}`);
        assert.equal(
          result.status,
          0,
          `Task and Git data writes must remain available: ${path}: ${result.stderr}`
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
);

it("does not grant read access to metadata outside the task boundary", () => {
  assert.throws(
    () =>
      buildCodexFileAccessBoundaryGlobalArgs({
        boundary: {
          mode: "only_selected_folders",
          folders: ["/task"],
          revision: 1,
          updatedAtMs: 1,
          executionContextAccess: "workspace",
          gitMetadata: {
            commonDirectoryPointerPath: "/task/commondir",
            configPath: "/other/config",
            gitDirectoryPointerPath: "/task/gitdir",
            hooksPath: "/other/hooks",
            worktreeConfigPath: "/task/config.worktree",
            worktreeGitPointerPath: "/task/.git",
          },
        },
        permissionMode: "codex:fullAccess",
      }),
    UNVERIFIED
  );
});
