import { describe, expect, it } from "vitest";
import { buildStartHandoffCommand } from "./local-handoff";

describe("local-handoff", () => {
	it("uses OPENMELD_AUTH_URL and OPENMELD_GATEWAY_URL for non-default setup handoff commands", () => {
		expect(
			buildStartHandoffCommand({
				authUrl: "https://auth-preview.openmeld.test",
				opaqueToken: "starttok_demo",
				gatewayUrl: "https://gateway-preview.openmeld.test",
				oneTimeToken: "ott_demo",
			})
		).toBe(
			"curl -fsSL 'http://localhost:3000/setup?lane=dev-local' | sh -s -- setup --start-session starttok_demo --ott ott_demo --view human"
		);
	});

	it("uses the selected canary execution target command for recovery handoff", () => {
		expect(
			buildStartHandoffCommand({
				opaqueToken: "starttok_demo",
				gatewayUrl: "http://localhost:8080",
				oneTimeToken: "ott_demo",
				userFacingCommand: "openmeld-canary",
			})
		).toBe(
			"curl -fsSL 'http://localhost:3000/setup?dist=binary&lane=canary' | sh -s -- setup --start-session starttok_demo --ott ott_demo --view human"
		);
	});
});
