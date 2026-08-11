import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateHookInput,
  extractCommandSubstitutions,
  findBlockedCommand,
  separateHeredocBodies,
  tokenizeShell,
} from "./claude-bash-guard.mjs";

const HOME_VARIABLE = `$${"{HOME}"}`;

describe("Claude Bash safety guard", () => {
  it("blocks guarded deploy, publish, git, and published-state mutations", () => {
    const cases = [
      ["wrangler deploy", "raw-wrangler-deploy"],
      ["pnpm exec wrangler versions deploy", "raw-wrangler-deploy"],
      ["pnpm -C clients/openmeld-cli publish", "raw-package-publish"],
      ["pnpm --dir=clients/openmeld-cli publish", "raw-package-publish"],
      ["yarn --cwd clients/openmeld-cli publish", "raw-package-publish"],
      ["corepack pnpm publish", "raw-package-publish"],
      ["npm exec wrangler deploy", "raw-wrangler-deploy"],
      ["git push origin main --no-verify", "push-no-verify"],
      ["git -C /tmp/repo commit --all -m unsafe", "commit-all"],
      ["git commit -am unsafe", "commit-all"],
      ['rm -rf "$HOME/.openmeld"', "openmeld-home-destruction"],
      [
        `rm -rf ${HOME_VARIABLE}/.openmeld/runtime`,
        "openmeld-home-destruction",
      ],
      ["bash -lc 'wrangler deploy'", "raw-wrangler-deploy"],
      ["echo $(wrangler deploy)", "raw-wrangler-deploy"],
      ['echo "$(wrangler deploy)"', "raw-wrangler-deploy"],
      ["echo `wrangler deploy`", "raw-wrangler-deploy"],
      ["echo safe & wrangler deploy", "raw-wrangler-deploy"],
      ["(wrangler deploy)", "raw-wrangler-deploy"],
      ["{ wrangler deploy; }", "raw-wrangler-deploy"],
      ["sudo -u root wrangler deploy", "raw-wrangler-deploy"],
      ["env -u FOO wrangler deploy", "raw-wrangler-deploy"],
      ["eval 'wrangler deploy'", "raw-wrangler-deploy"],
      ["exec wrangler deploy", "raw-wrangler-deploy"],
      ["nohup wrangler deploy", "raw-wrangler-deploy"],
      ["time wrangler deploy", "raw-wrangler-deploy"],
      ["nice wrangler deploy", "raw-wrangler-deploy"],
      ["wrangler \\\ndeploy", "raw-wrangler-deploy"],
      ["pnpm \\\npublish", "raw-package-publish"],
      ["git commit \\\n-a -m unsafe", "commit-all"],
      ["git push origin main \\\n--no-verify", "push-no-verify"],
      ["rm -rf \\\n~/.openmeld", "openmeld-home-destruction"],
      ["rm -rf ~/{.openmeld,.openmeld-dev}", "openmeld-home-destruction"],
      ["rm -rf ~/.wake*", "openmeld-home-destruction"],
      [">/tmp/release.log wrangler deploy", "raw-wrangler-deploy"],
      ["2>/dev/null npm publish", "raw-package-publish"],
      ["</dev/null git push origin main --no-verify", "push-no-verify"],
      ["if wrangler deploy; then true; fi", "raw-wrangler-deploy"],
      ["while wrangler deploy; do break; done", "raw-wrangler-deploy"],
      ["if false; then true; else wrangler deploy; fi", "raw-wrangler-deploy"],
      [
        "if false; then true; elif wrangler deploy; then true; fi",
        "raw-wrangler-deploy",
      ],
      ["! wrangler deploy", "raw-wrangler-deploy"],
      ["2>&1 wrangler deploy", "raw-wrangler-deploy"],
      ["2>&1 npm publish", "raw-package-publish"],
      ["sudo -n wrangler deploy", "raw-wrangler-deploy"],
      ["sudo -n npm publish", "raw-package-publish"],
      ["sudo -n git commit -a", "commit-all"],
      ["sudo -n rm -rf ~/.openmeld", "openmeld-home-destruction"],
      ["npx --package wrangler -- wrangler deploy", "raw-wrangler-deploy"],
      ["npm exec --package wrangler -- wrangler deploy", "raw-wrangler-deploy"],
      ["npm exec -c 'wrangler deploy'", "raw-wrangler-deploy"],
      ["npx -c 'wrangler deploy'", "raw-wrangler-deploy"],
      ["rm -rf ~//.openmeld", "openmeld-home-destruction"],
      ['rm -rf "$HOME/.openmeld"', "openmeld-home-destruction"],
      ["bash <<'EOF'\nwrangler deploy\nEOF", "raw-wrangler-deploy"],
      ["<<'EOF' bash\nwrangler deploy\nEOF", "raw-wrangler-deploy"],
      ["cat <<EOF\n$(wrangler deploy)\nEOF", "raw-wrangler-deploy"],
      ["bash <<< 'wrangler deploy'", "raw-wrangler-deploy"],
      ["sh <<<'npm publish'", "raw-package-publish"],
    ];

    for (const [command, expected] of cases) {
      assert.equal(findBlockedCommand(command), expected, command);
    }
  });

  it("allows quoted evidence, explicit path commits, normal pushes, and dry runs", () => {
    const commands = [
      "rg 'wrangler deploy' AGENTS.md",
      'printf "%s\\n" "git push --no-verify"',
      "git add -- AGENTS.md && git commit -m docs",
      "git push origin main",
      "wrangler deploy --dry-run --outdir dev-tmp/worker",
      "rm -rf /tmp/.openmeld",
      "pnpm --filter @openmeld/core test",
      "rg '$(wrangler deploy)' AGENTS.md",
      'rg "$(echo wrangler deploy)" AGENTS.md',
      "cat <<'EOF'\nwrangler deploy\nEOF",
      "cat <<EOF\nwrangler deploy\nEOF",
      "sed -n '1p' <<EOF\nnpm publish\nEOF",
      "cat <<< safe",
      'rm -rf "~/.wake*"',
      'rm -rf "$HOME/.wake*"',
      "rm -rf ~/.wake\\*",
      "rm -rf '~/.openmeld'",
      'rm -rf "~/.openmeld"',
      "rm -rf \\~/.openmeld",
      "cat <<\\EOF\nwrangler deploy\nEOF",
      "cat <<E'OF'\nwrangler deploy\nEOF",
    ];

    for (const command of commands) {
      assert.equal(findBlockedCommand(command), null, command);
    }
  });

  it("keeps quoted separators inside one argument", () => {
    assert.deepEqual(tokenizeShell("rg 'a && b' file && git status"), [
      ["rg", "a && b", "file"],
      ["git", "status"],
    ]);
  });

  it("extracts executable command substitutions but ignores single-quoted text", () => {
    assert.deepEqual(extractCommandSubstitutions("echo $(git status)"), [
      "git status",
    ]);
    assert.deepEqual(extractCommandSubstitutions("echo '$(git status)'"), []);
  });

  it("separates quoted data heredocs from executable or expanding bodies", () => {
    assert.deepEqual(separateHeredocBodies("cat <<'EOF'\nhello\nEOF"), {
      command: "cat <<'EOF'\n\n",
      executableBodies: [],
      expandingBodies: [],
    });
    assert.deepEqual(separateHeredocBodies("sh <<'EOF'\necho hello\nEOF"), {
      command: "sh <<'EOF'\n\n",
      executableBodies: ["echo hello"],
      expandingBodies: [],
    });
    assert.deepEqual(separateHeredocBodies("cat <<EOF\n$(echo hello)\nEOF"), {
      command: "cat <<EOF\n\n",
      executableBodies: [],
      expandingBodies: ["$(echo hello)"],
    });
  });

  it("fails closed with diagnostic context when Bash input is malformed", () => {
    const invalidJson = evaluateHookInput("not json");
    assert.equal(invalidJson.code, 2);
    assert.equal(
      invalidJson.message.includes("could not parse hook input"),
      true
    );

    const invalidCommand = evaluateHookInput(
      JSON.stringify({ tool_name: "Bash", tool_input: {} })
    );
    assert.equal(invalidCommand.code, 2);
    assert.equal(invalidCommand.message.includes("without a command"), true);

    const malformedShell = evaluateHookInput(
      JSON.stringify({
        tool_name: "Bash",
        tool_input: { command: "echo 'unterminated" },
      })
    );
    assert.equal(malformedShell.code, 2);
    assert.equal(
      malformedShell.message.includes("could not inspect the command"),
      true
    );
  });

  it("ignores non-Bash hook events", () => {
    assert.deepEqual(
      evaluateHookInput(JSON.stringify({ tool_name: "Read", tool_input: {} })),
      { code: 0, message: "" }
    );
  });
});
