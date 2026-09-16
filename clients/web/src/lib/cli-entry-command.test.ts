import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildWebSetupCommand,
	formatWebCliCommand,
	resolveBrowserSetupCommandPlatform,
	resolveWebAgentProfileSetupCommand,
	resolveWebAgentsRepairCommand,
	resolveWebCliEntryCommand,
	resolveWebServiceStopCommand,
	resolveWebSetupCommand,
	resolveWebSetupFollowUpCliCommandPrefix,
	resolveWebStartCommand,
} from "./cli-entry-command";

const POWERSHELL_ENCODED_COMMAND_RE =
	/^powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ([A-Za-z0-9+/=]+)$/u;

vi.hoisted(() => {
	// Configuration is captured at module load. These formatting fixtures supply
	// lane homes explicitly and must not inherit the focused runner's temp home.
	vi.stubEnv("VITE_OPENMELD_HOME", "");
});

describe("cli-entry-command", () => {
	beforeEach(() => vi.stubEnv("VITE_OPENMELD_HOME", ""));
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it("uses OPENMELD_AUTH_URL and OPENMELD_GATEWAY_URL prefixes for non-default web environments", () => {
		expect(
			resolveWebStartCommand({
				authUrl: "https://auth-preview.openmeld.test",
				gatewayUrl: "https://gateway-preview.openmeld.test",
			})
		).toContain(
			"OPENMELD_GATEWAY_URL=https://gateway-preview.openmeld.test OPENMELD_AUTH_URL=https://auth-preview.openmeld.test openmeld-dev start"
		);
		expect(
			resolveWebSetupCommand({
				authUrl: "https://auth-preview.openmeld.test",
				gatewayUrl: "https://gateway-preview.openmeld.test",
			})
		).toContain(
			"OPENMELD_GATEWAY_URL=https://gateway-preview.openmeld.test OPENMELD_AUTH_URL=https://auth-preview.openmeld.test openmeld-dev setup"
		);
	});

	it("keeps fresh dev OPENMELD_HOME on Web-provided local setup commands", () => {
		expect(
			buildWebSetupCommand({
				openMeldHome: "/tmp/openmeld web start fresh",
				gatewayUrl: "http://localhost:8080",
				humanProfileId: "hum_demo",
				oneTimeToken: "ott_demo",
			})
		).toBe(
			"OPENMELD_HOME='/tmp/openmeld web start fresh' OPENMELD_GATEWAY_URL=http://localhost:8080 openmeld-dev setup --human-profile hum_demo --ott ott_demo --view human"
		);
	});

	it("uses readable npx commands for production Web handoff setup", () => {
		vi.stubEnv("DEV", false);
		vi.stubEnv("PROD", true);
		vi.stubEnv("VITE_OPENMELD_HOME", "/tmp/openmeld-web-start-fresh");

		expect(
			buildWebSetupCommand({
				openMeldHome: "/tmp/explicit-openmeld-home",
				humanProfileId: "hum_demo",
				oneTimeToken: "ott_demo",
			})
		).toBe(
			"npx -y openmeld@latest setup --human-profile hum_demo --ott ott_demo --view human"
		);
		expect(
			resolveWebAgentProfileSetupCommand({
				agentProfileId: "agt_22222222-2222-4222-8222-222222222222",
				openMeldHome: "/tmp/explicit-openmeld-home",
				oneTimeToken: "ott_demo",
			})
		).toBe(
			"npx -y openmeld@latest setup --profile agt_22222222-2222-4222-8222-222222222222 --ott ott_demo --view human"
		);
		expect(
			buildWebSetupCommand({
				openMeldHome: "/tmp/explicit-openmeld-home",
				startSession: "starttok_demo",
				oneTimeToken: "ott_demo",
			})
		).toBe(
			"curl -fsSL https://openmeld.ai/setup | sh -s -- setup --start-session starttok_demo --ott ott_demo --view human"
		);
		expect(
			resolveWebAgentsRepairCommand({
				agentIds: ["codex"],
				openMeldHome: "/tmp/explicit-openmeld-home",
			})
		).toBe("npx -y openmeld@latest setup --agent codex --view human");
		expect(
			resolveWebStartCommand({ openMeldHome: "/tmp/explicit-openmeld-home" })
		).toBe("npx -y openmeld@latest start");
		expect(
			resolveWebServiceStopCommand({
				openMeldHome: "/tmp/explicit-openmeld-home",
			})
		).toBe("npx -y openmeld@latest service stop");
	});

	it("hands Connect Computer an approved device code instead of the browser session", () => {
		vi.stubEnv("DEV", false);
		vi.stubEnv("PROD", true);

		expect(
			buildWebSetupCommand({
				deviceCode: "device-secret",
				startSession: "starttok_demo",
			})
		).toBe(
			"curl -fsSL https://openmeld.ai/setup | sh -s -- setup --start-session starttok_demo --device-code device-secret --view human"
		);
	});

	it("uses npx latest for selected production execution targets", () => {
		expect(resolveWebCliEntryCommand({ userFacingCommand: "openmeld" })).toBe(
			"npx -y openmeld@latest"
		);
		expect(resolveWebCliEntryCommand({ runtimeLane: "prod" })).toBe(
			"npx -y openmeld@latest"
		);
		expect(
			formatWebCliCommand("openmeld service run", {
				userFacingCommand: "openmeld",
			})
		).toBe("npx -y openmeld@latest service run");
		expect(
			resolveWebAgentsRepairCommand({
				agentIds: ["codex"],
				gatewayUrl: "https://gateway.openmeld.ai",
				userFacingCommand: "openmeld",
			})
		).toBe("npx -y openmeld@latest setup --agent codex --view human");
	});

	it("uses a non-interactive npx prefix for production setup follow-up commands", () => {
		expect(
			resolveWebSetupFollowUpCliCommandPrefix({ userFacingCommand: "openmeld" })
		).toBe("npx -y openmeld@latest");
		expect(
			resolveWebSetupFollowUpCliCommandPrefix({ runtimeLane: "dev-local" })
		).toBe("openmeld-dev");
	});

	it("uses the production setup bootstrap for Prepare Session commands only", () => {
		vi.stubEnv("DEV", false);
		vi.stubEnv("PROD", true);

		expect(
			buildWebSetupCommand({
				startSession: "preptok_demo",
				oneTimeToken: "ott_demo",
			})
		).toBe(
			"curl -fsSL https://openmeld.ai/setup | sh -s -- setup --start-session preptok_demo --ott ott_demo --view human"
		);
		expect(
			buildWebSetupCommand({
				agentIds: ["codex"],
				oneTimeToken: "ott_demo",
			})
		).toBe(
			"npx -y openmeld@latest setup --agent codex --ott ott_demo --view human"
		);
	});

	it("builds an agent-view setup session command with local agent selection", () => {
		vi.stubEnv("DEV", false);
		vi.stubEnv("PROD", true);

		expect(
			buildWebSetupCommand({
				localAgents: "all",
				oneTimeToken: "ott_demo",
				startSession: "preptok_demo",
				view: "agent",
			})
		).toBe(
			"curl -fsSL https://openmeld.ai/setup | sh -s -- setup --start-session preptok_demo --local-agents all --ott ott_demo --view agent"
		);
		expect(
			buildWebSetupCommand({
				localAgentIds: ["codex", "claude-code", "codex"],
				oneTimeToken: "ott_demo",
				startSession: "preptok_demo",
				view: "agent",
			})
		).toBe(
			"curl -fsSL https://openmeld.ai/setup | sh -s -- setup --start-session preptok_demo --local-agent codex claude-code --ott ott_demo --view agent"
		);
	});

	it("builds a Windows PowerShell bootstrap for Prepare Session commands", () => {
		vi.stubEnv("DEV", false);
		vi.stubEnv("PROD", true);

		const command = buildWebSetupCommand({
			oneTimeToken: "ott_demo",
			setupPlatform: "windows",
			startSession: "preptok_demo",
		});

		expect(command).toMatch(POWERSHELL_ENCODED_COMMAND_RE);
		expect(decodePowerShellCommand(command)).toBe(
			"& ([scriptblock]::Create((irm 'https://openmeld.ai/setup?platform=windows&dist=npm'))) 'setup' '--start-session' 'preptok_demo' '--ott' 'ott_demo' '--view' 'human'"
		);
	});

	it("uses the local setup bootstrap for dev Prepare Session commands", () => {
		expect(
			buildWebSetupCommand({
				openMeldHome: "/tmp/openmeld web start fresh",
				gatewayUrl: "http://localhost:8080",
				startSession: "preptok_demo",
				oneTimeToken: "ott_demo",
			})
		).toBe(
			"curl -fsSL 'http://localhost:3000/setup?lane=dev-local&openMeldHome=%2Ftmp%2Fopenmeld+web+start+fresh' | sh -s -- setup --start-session preptok_demo --ott ott_demo --view human"
		);
	});

	it("keeps staging canary setup on the staging binary channel", () => {
		vi.stubGlobal("window", {
			location: { origin: "https://staging.openmeld.ai" },
		});

		expect(
			buildWebSetupCommand({
				localAgents: "none",
				oneTimeToken: "ott_staging_demo",
				startSession: "start_staging_demo",
				userFacingCommand: "openmeld-canary",
				view: "agent",
			})
		).toBe(
			"curl -fsSL 'https://staging.openmeld.ai/setup?dist=binary&lane=canary' | sh -s -- setup --start-session start_staging_demo --local-agents none --ott ott_staging_demo --view agent"
		);
	});

	it("defaults fresh Staging computers to the canary binary channel", async () => {
		vi.stubEnv("DEV", false);
		vi.stubEnv("PROD", true);
		vi.stubEnv("VITE_OPENMELD_SETUP_USER_FACING_COMMAND", "openmeld-canary");
		vi.stubGlobal("window", {
			location: { origin: "https://staging.openmeld.ai" },
		});
		vi.resetModules();
		const { buildWebSetupCommand: buildConfiguredSetupCommand } = await import(
			"./cli-entry-command"
		);

		expect(
			buildConfiguredSetupCommand({
				localAgents: "none",
				oneTimeToken: "ott_staging_demo",
				startSession: "start_staging_demo",
				view: "agent",
			})
		).toBe(
			"curl -fsSL 'https://staging.openmeld.ai/setup?dist=binary&lane=canary' | sh -s -- setup --start-session start_staging_demo --local-agents none --ott ott_staging_demo --view agent"
		);
	});

	it("builds a local Windows bootstrap for dev Prepare Session commands", () => {
		const command = buildWebSetupCommand({
			openMeldHome: "/tmp/openmeld web start fresh",
			gatewayUrl: "http://localhost:8080",
			oneTimeToken: "ott_demo",
			setupPlatform: "windows",
			startSession: "preptok_demo",
		});

		expect(command).toMatch(POWERSHELL_ENCODED_COMMAND_RE);
		expect(decodePowerShellCommand(command)).toBe(
			"& ([scriptblock]::Create((irm 'http://localhost:3000/setup?platform=windows&dist=npm&lane=dev-local&openMeldHome=%2Ftmp%2Fopenmeld+web+start+fresh'))) 'setup' '--start-session' 'preptok_demo' '--ott' 'ott_demo' '--view' 'human'"
		);
	});

	it("defaults the setup command platform from browser platform text", () => {
		expect(
			resolveBrowserSetupCommandPlatform({
				platform: "Win32",
				userAgent: "Mozilla/5.0",
			})
		).toBe("windows");
		expect(
			resolveBrowserSetupCommandPlatform({
				platform: "MacIntel",
				userAgent: "Mozilla/5.0",
			})
		).toBe("posix");
		expect(
			resolveBrowserSetupCommandPlatform({
				platform: "Linux x86_64",
				userAgent: "Mozilla/5.0",
			})
		).toBe("posix");
	});

	it("keeps npx for non-default production gateways", () => {
		vi.stubEnv("DEV", false);
		vi.stubEnv("PROD", true);

		expect(
			buildWebSetupCommand({
				gatewayUrl: "https://gateway-preview.openmeld.test",
				startSession: "preptok_demo",
				oneTimeToken: "ott_demo",
				userFacingCommand: "openmeld",
			})
		).toBe(
			"OPENMELD_GATEWAY_URL=https://gateway-preview.openmeld.test npx -y openmeld@latest setup --start-session preptok_demo --ott ott_demo --view human"
		);
	});

	it("omits default auth and gateway wiring for default production endpoints", () => {
		expect(
			resolveWebStartCommand({
				authUrl: "http://localhost:8788",
				gatewayUrl: "https://gateway.openmeld.ai",
			})
		).not.toContain("OPENMELD_GATEWAY_URL=");
		expect(
			resolveWebStartCommand({
				authUrl: "http://localhost:8788",
				gatewayUrl: "https://gateway.openmeld.ai",
			})
		).not.toContain("OPENMELD_AUTH_URL=");
		expect(
			resolveWebSetupCommand({
				authUrl: "http://localhost:8788",
				gatewayUrl: "https://gateway.openmeld.ai",
			})
		).not.toContain("OPENMELD_GATEWAY_URL=");
		expect(
			resolveWebSetupCommand({
				authUrl: "http://localhost:8788",
				gatewayUrl: "https://gateway.openmeld.ai",
			})
		).not.toContain("OPENMELD_AUTH_URL=");
		expect(
			resolveWebAgentsRepairCommand({
				agentIds: ["codex"],
				authUrl: "http://localhost:8788",
				gatewayUrl: "https://gateway.openmeld.ai",
			})
		).not.toContain("OPENMELD_GATEWAY_URL=");
		expect(
			resolveWebAgentsRepairCommand({
				agentIds: ["codex"],
				authUrl: "http://localhost:8788",
				gatewayUrl: "https://gateway.openmeld.ai",
			})
		).not.toContain("OPENMELD_AUTH_URL=");
	});

	it("builds a builtin-agent repair command without duplicate agent IDs", () => {
		expect(
			resolveWebAgentsRepairCommand({
				agentIds: ["codex", "claude-code", "codex"],
			})
		).toBe("openmeld-dev setup --agent codex claude-code --view human");
	});

	it("uses an OPENMELD_GATEWAY_URL prefix for builtin-agent repair commands in non-production Web environments", () => {
		expect(
			resolveWebAgentsRepairCommand({
				agentIds: ["codex", "claude-code", "codex"],
				authUrl: "https://auth-preview.openmeld.test",
				gatewayUrl: "https://gateway-preview.openmeld.test",
			})
		).toBe(
			"OPENMELD_GATEWAY_URL=https://gateway-preview.openmeld.test OPENMELD_AUTH_URL=https://auth-preview.openmeld.test openmeld-dev setup --agent codex claude-code --view human"
		);
	});

	it("builds an agent-profile setup command for an already connected space agent", () => {
		expect(
			resolveWebAgentProfileSetupCommand({
				agentProfileId: "agt_22222222-2222-4222-8222-222222222222",
				authUrl: "https://auth-preview.openmeld.test",
				gatewayUrl: "https://gateway-preview.openmeld.test",
				oneTimeToken: "ott_demo",
			})
		).toBe(
			"OPENMELD_GATEWAY_URL=https://gateway-preview.openmeld.test OPENMELD_AUTH_URL=https://auth-preview.openmeld.test openmeld-dev setup --profile agt_22222222-2222-4222-8222-222222222222 --ott ott_demo --view human"
		);
	});

	it("uses the selected canary execution target command for profile recovery", () => {
		expect(
			resolveWebAgentProfileSetupCommand({
				agentProfileId: "agt_22222222-2222-4222-8222-222222222222",
				gatewayUrl: "http://localhost:8080",
				oneTimeToken: "ott_demo",
				userFacingCommand: "openmeld-canary",
			})
		).toBe(
			"OPENMELD_GATEWAY_URL=http://localhost:8080 openmeld-canary setup --profile agt_22222222-2222-4222-8222-222222222222 --ott ott_demo --view human"
		);
	});

	it("uses the selected dev execution target command without OPENMELD_HOME lane overrides", () => {
		vi.stubEnv("VITE_OPENMELD_HOME", "/tmp/openmeld web start fresh");

		expect(
			buildWebSetupCommand({
				agentIds: ["codex"],
				gatewayUrl: "http://localhost:8080",
				oneTimeToken: "ott_demo",
				userFacingCommand: "openmeld-dev",
			})
		).toBe(
			"OPENMELD_GATEWAY_URL=http://localhost:8080 openmeld-dev setup --agent codex --ott ott_demo --view human"
		);
	});

	it("builds a single-command web bootstrap setup command with sign-in", () => {
		expect(
			buildWebSetupCommand({
				authUrl: "https://auth-preview.openmeld.test",
				gatewayUrl: "https://gateway-preview.openmeld.test",
				humanProfileId: "hum_demo",
				oneTimeToken: "ott_demo",
			})
		).toBe(
			"OPENMELD_GATEWAY_URL=https://gateway-preview.openmeld.test OPENMELD_AUTH_URL=https://auth-preview.openmeld.test openmeld-dev setup --human-profile hum_demo --ott ott_demo --view human"
		);
	});

	it("adds the reset flag for forgotten-computer setup commands", () => {
		expect(
			buildWebSetupCommand({
				humanProfileId: "hum_demo",
				oneTimeToken: "ott_demo",
				resetThisComputer: true,
			})
		).toBe(
			"openmeld-dev setup --human-profile hum_demo --reset-this-computer --ott ott_demo --view human"
		);
	});

	it("builds a start-session handoff command that also signs in first", () => {
		expect(
			buildWebSetupCommand({
				authUrl: "https://auth-preview.openmeld.test",
				gatewayUrl: "https://gateway-preview.openmeld.test",
				startSession: "starttok_demo",
				oneTimeToken: "ott_demo",
			})
		).toBe(
			"curl -fsSL 'http://localhost:3000/setup?lane=dev-local' | sh -s -- setup --start-session starttok_demo --ott ott_demo --view human"
		);
	});
});

function decodePowerShellCommand(command: string): string {
	const encoded = POWERSHELL_ENCODED_COMMAND_RE.exec(command)?.[1];
	if (!encoded) {
		throw new Error(`Expected an encoded PowerShell command: ${command}`);
	}
	return Buffer.from(encoded, "base64").toString("utf16le");
}
