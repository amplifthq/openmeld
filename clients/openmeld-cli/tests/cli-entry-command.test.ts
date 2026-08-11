import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatInlineOpenMeldCliCommands,
  formatOpenMeldCliCommand,
  formatOpenMeldCliCommands,
  formatOpenMeldCliLine,
  formatOpenMeldCliTextBlock,
  formatProfileAwareOpenMeldCliCommand,
  formatProfileAwareOpenMeldCliCommands,
  resolveSetupFollowUpCliEntryCommand,
  resolveUserFacingCliEntryCommand,
} from "../src/runtime/cli-entry-command";

describe("cli entry command formatting", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps openmeld commands unchanged for installed cli usage", () => {
    const input = {
      env: {},
      argv: [
        "/usr/local/bin/node",
        "/usr/local/lib/node_modules/openmeld/dist/openmeld.js",
      ],
    };

    expect(resolveUserFacingCliEntryCommand(input)).toBe("openmeld");
    expect(formatOpenMeldCliCommand("openmeld login", input)).toBe(
      "openmeld login"
    );
    expect(
      formatOpenMeldCliCommands(
        ["openmeld login", "openmeld space"],
        input
      ).join("\n")
    ).toBe("openmeld login\nopenmeld space");
    expect(
      formatInlineOpenMeldCliCommands(
        "Run `openmeld login`, then `openmeld start`.",
        input
      )
    ).toBe("Run `openmeld login`, then `openmeld start`.");
  });

  it("rewrites user-facing commands for npm exec and npx usage", () => {
    vi.stubEnv("npm_command", "exec");
    vi.stubEnv("npm_lifecycle_script", '"openmeld"');
    vi.stubEnv(
      "npm_config_user_agent",
      "npm/11.6.2 node/v25.1.0 darwin arm64 workspaces/false"
    );

    expect(resolveUserFacingCliEntryCommand()).toBe("npx -y openmeld@latest");
    expect(formatOpenMeldCliCommand("openmeld login")).toBe(
      "npx -y openmeld@latest login"
    );
    expect(
      formatOpenMeldCliCommands([
        "openmeld auth status",
        "openmeld space join <space-id>",
      ])
    ).toEqual([
      "npx -y openmeld@latest auth status",
      "npx -y openmeld@latest space join <space-id>",
    ]);
    expect(
      formatInlineOpenMeldCliCommands(
        "Run `openmeld login`, then `openmeld start`."
      )
    ).toBe(
      "Run `npx -y openmeld@latest login`, then `npx -y openmeld@latest start`."
    );
  });

  it("detects npx cache entry paths even without npm env metadata", () => {
    expect(
      resolveUserFacingCliEntryCommand({
        env: {},
        argv: [
          "/usr/local/bin/node",
          "/Users/test/.npm/_npx/abc/node_modules/openmeld/dist/openmeld.js",
        ],
      })
    ).toBe("npx -y openmeld@latest");
  });

  it("does not treat pnpm exec as npx", () => {
    expect(
      resolveUserFacingCliEntryCommand({
        env: {
          npm_command: "exec",
          npm_config_user_agent: "pnpm/10.30.0 npm/? node/v25.1.0 darwin arm64",
        },
        argv: ["/usr/local/bin/node", "/usr/local/bin/openmeld"],
      })
    ).toBe("openmeld");
  });

  it("detects a locally installed openmeld run through npx without the cache path", () => {
    expect(
      resolveUserFacingCliEntryCommand({
        env: {
          npm_command: "exec",
          npm_lifecycle_script: '"openmeld"',
          npm_config_user_agent:
            "npm/11.6.2 node/v25.1.0 darwin arm64 workspaces/false",
        },
        argv: [
          "/usr/local/bin/node",
          "/Users/test/project/node_modules/.bin/openmeld",
        ],
      })
    ).toBe("npx -y openmeld@latest");
  });

  it("does not treat inherited npm exec env from another npx tool as npx openmeld", () => {
    // `npx vitest` (or any `npx <tool>` ancestor) leaks npm_command=exec and
    // the npm user agent into descendants; npm_lifecycle_script names the tool
    // npm actually executed, so openmeld must keep its installed-CLI label.
    expect(
      resolveUserFacingCliEntryCommand({
        env: {
          npm_command: "exec",
          npm_lifecycle_script: '"vitest"',
          npm_config_user_agent:
            "npm/11.6.2 node/v25.1.0 darwin arm64 workspaces/false",
        },
        argv: [
          "/usr/local/bin/node",
          "/Users/test/project/node_modules/vitest/vitest.mjs",
        ],
      })
    ).toBe("openmeld");
  });

  it("prefers an explicit user-facing command override for repo-local openmeld-dev", () => {
    const input = {
      env: {
        OPENMELD_USER_FACING_CLI_COMMAND: "openmeld-dev",
      },
      argv: ["/usr/local/bin/node", "/usr/local/bin/openmeld-dev"],
    };

    expect(resolveUserFacingCliEntryCommand(input)).toBe("openmeld-dev");
    expect(formatOpenMeldCliCommand("openmeld login", input)).toBe(
      "openmeld-dev login"
    );
  });

  it("uses the setup-owned follow-up command for setup.complete only", () => {
    const input = {
      env: {
        OPENMELD_SETUP_FOLLOW_UP_CLI_COMMAND: "openmeld",
        npm_command: "exec",
        npm_lifecycle_script: '"openmeld"',
        npm_config_user_agent:
          "npm/11.6.2 node/v25.1.0 darwin arm64 workspaces/false",
      },
      argv: ["/usr/local/bin/node", "/usr/local/bin/openmeld"],
    };

    expect(resolveSetupFollowUpCliEntryCommand(input)).toBe("openmeld");
    expect(resolveUserFacingCliEntryCommand(input)).toBe(
      "npx -y openmeld@latest"
    );
  });

  it("formats profile-aware agent-view suggested commands without relying on selected profile", () => {
    const input = {
      env: {
        OPENMELD_USER_FACING_CLI_COMMAND: "openmeld-dev",
      },
      profileId: "agt-demo",
      resolvedView: "agent" as const,
    };

    expect(
      formatProfileAwareOpenMeldCliCommand(
        "openmeld space create --name <space-name> --visibility private",
        input
      )
    ).toBe(
      "openmeld-dev space create --profile agt-demo --name <space-name> --visibility private --view agent"
    );
    expect(
      formatProfileAwareOpenMeldCliCommand(
        "openmeld space join <space-id>",
        input
      )
    ).toBe(
      "openmeld-dev space join --profile agt-demo <space-id> --view agent"
    );
    expect(
      formatProfileAwareOpenMeldCliCommands(["openmeld whoami"], input)
    ).toEqual(["openmeld-dev whoami --profile agt-demo --view agent"]);
  });

  it("does not duplicate explicit profile or view arguments in suggested commands", () => {
    expect(
      formatProfileAwareOpenMeldCliCommand(
        "openmeld space create --profile agt-existing --name <space-name> --view human",
        {
          profileId: "agt-demo",
          resolvedView: "agent",
        }
      )
    ).toBe(
      "openmeld space create --profile agt-existing --name <space-name> --view human"
    );
    expect(
      formatProfileAwareOpenMeldCliCommand(
        "openmeld space create --profile=agt-existing --name <space-name>",
        {
          profileId: "agt-demo",
          resolvedView: "agent",
        }
      )
    ).toBe(
      "openmeld space create --profile=agt-existing --name <space-name> --view agent"
    );
    expect(
      formatProfileAwareOpenMeldCliCommand(
        "openmeld space join --view agent <space-id>",
        {
          profileId: "agt-demo",
          resolvedView: "agent",
        }
      )
    ).toBe("openmeld space join --profile agt-demo --view agent <space-id>");
  });

  it("keeps profile insertion after parent options and before space operands", () => {
    expect(
      formatProfileAwareOpenMeldCliCommand(
        "openmeld space --gateway-url <url> add-members <space-id> --member <profile-id...>",
        {
          profileId: "agt-demo",
          resolvedView: "agent",
        }
      )
    ).toBe(
      "openmeld space --gateway-url <url> add-members --profile agt-demo <space-id> --member <profile-id...> --view agent"
    );
    expect(
      formatProfileAwareOpenMeldCliCommand(
        "openmeld space --gateway-url=https://gateway.example add-members <space-id> --all",
        {
          profileId: "agt-demo",
          resolvedView: "agent",
        }
      )
    ).toBe(
      "openmeld space --gateway-url=https://gateway.example add-members --profile agt-demo <space-id> --all --view agent"
    );
    expect(
      formatProfileAwareOpenMeldCliCommand(
        "openmeld space --gateway-url <url> add-agents <space-id> --agent-profile <agent-profile-id...>",
        {
          profileId: "agt-demo",
          resolvedView: "agent",
        }
      )
    ).toBe(
      "openmeld space --gateway-url <url> add-agents --profile agt-demo <space-id> --agent-profile <agent-profile-id...> --view agent"
    );
    expect(
      formatProfileAwareOpenMeldCliCommand(
        "openmeld space --gateway-url <url> add-human-profiles <space-id> --human-profile <human-profile-id...>",
        {
          profileId: "agt-demo",
          resolvedView: "agent",
        }
      )
    ).toBe(
      "openmeld space --gateway-url <url> add-human-profiles --profile agt-demo <space-id> --human-profile <human-profile-id...> --view agent"
    );
  });

  it("does not add profile to commands that do not accept acting profile", () => {
    expect(
      formatProfileAwareOpenMeldCliCommand("openmeld service status", {
        profileId: "agt-demo",
        resolvedView: "agent",
      })
    ).toBe("openmeld service status --view agent");
  });

  it("supports openmeld-canary as an explicit user-facing command override", () => {
    const input = {
      env: {
        OPENMELD_USER_FACING_CLI_COMMAND: "openmeld-canary",
      },
      argv: [
        "/usr/local/bin/node",
        "/Users/test/.local/share/openmeld-canary/package-install/node_modules/openmeld/dist/openmeld.js",
      ],
    };

    expect(resolveUserFacingCliEntryCommand(input)).toBe("openmeld-canary");
    expect(
      formatInlineOpenMeldCliCommands(
        "Run `openmeld login`, then `openmeld start`.",
        input
      )
    ).toBe("Run `openmeld-canary login`, then `openmeld-canary start`.");
    expect(
      formatProfileAwareOpenMeldCliCommand("openmeld space list", {
        ...input,
        profileId: "agt-demo",
        resolvedView: "agent",
      })
    ).toBe("openmeld-canary space list --profile agt-demo --view agent");
  });

  it("keeps npx command examples profile-aware without changing prefix shape", () => {
    const input = {
      env: {
        npm_command: "exec",
        npm_config_user_agent:
          "npm/11.6.2 node/v25.1.0 darwin arm64 workspaces/false",
      },
      argv: ["/usr/local/bin/node", "/tmp/.npm/_npx/abc/openmeld.js"],
      profileId: "agt-demo",
      resolvedView: "agent" as const,
    };

    expect(
      formatProfileAwareOpenMeldCliCommand(
        "openmeld space add-members <space-id> --all",
        input
      )
    ).toBe(
      "npx -y openmeld@latest space add-members --profile agt-demo <space-id> --all --view agent"
    );
  });

  it("formats numbered command lines and shell pipe examples in text blocks", () => {
    const input = {
      env: {
        OPENMELD_USER_FACING_CLI_COMMAND: "openmeld-dev",
      },
    };

    expect(formatOpenMeldCliLine("1) openmeld start", input)).toBe(
      "1) openmeld-dev start"
    );
    expect(
      formatOpenMeldCliLine(
        'echo "hello from file-safe input" | openmeld space send <space-id> --stdin',
        input
      )
    ).toBe(
      'echo "hello from file-safe input" | openmeld-dev space send <space-id> --stdin'
    );
    expect(
      formatOpenMeldCliTextBlock(
        [
          "Examples:",
          "  openmeld start",
          "  openmeld auth login",
          '  echo "hello" | openmeld space send <space-id> --stdin',
        ].join("\n"),
        input
      )
    ).toBe(
      [
        "Examples:",
        "  openmeld-dev start",
        "  openmeld-dev auth login",
        '  echo "hello" | openmeld-dev space send <space-id> --stdin',
      ].join("\n")
    );
  });

  it("formats bare openmeld command mentions inside descriptive sentences", () => {
    const input = {
      env: {
        OPENMELD_USER_FACING_CLI_COMMAND: "openmeld-dev",
      },
    };

    expect(
      formatOpenMeldCliTextBlock(
        "openmeld start in agent view requires authentication before OpenMeld profile setup.",
        input
      )
    ).toBe(
      "openmeld-dev start in agent view requires authentication before OpenMeld profile setup."
    );
    expect(
      formatOpenMeldCliTextBlock(
        "Gateway overrides stay on the parent command: openmeld space --gateway-url <url> <subcommand> ...",
        input
      )
    ).toBe(
      "Gateway overrides stay on the parent command: openmeld space --gateway-url <url> <subcommand> ..."
    );
    expect(
      formatOpenMeldCliTextBlock(
        "openmeld auth login: invalid --method value: use device|ott",
        input
      )
    ).toBe("openmeld-dev auth login: invalid --method value: use device|ott");
  });
});
