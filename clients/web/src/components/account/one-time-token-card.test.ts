import { describe, expect, it } from "vitest";
import { buildOneTimeTokenCommandDisplay } from "./one-time-token-card";

describe("buildOneTimeTokenCommandDisplay", () => {
	it("keeps worktree hostnames on the local CLI lane", () => {
		expect(
			buildOneTimeTokenCommandDisplay("ott-123", {
				authUrl: "http://wt-example.localhost:31002",
				userFacingCommand: "openmeld-dev",
				openMeldHome: "",
			}).primaryCommand
		).toBe(
			"OPENMELD_AUTH_URL=http://wt-example.localhost:31002 openmeld-dev login --ott ott-123"
		);
	});

	it("uses the local openmeld-dev command on localhost", () => {
		expect(
			buildOneTimeTokenCommandDisplay("ott-123", {
				authUrl: "http://localhost:8788",
				userFacingCommand: "openmeld-dev",
				openMeldHome: "",
			})
		).toMatchObject({
			primaryCommand: "openmeld-dev login --ott ott-123",
			alternateCommand: null,
		});
	});

	it("uses the explicitly selected published release target", () => {
		expect(
			buildOneTimeTokenCommandDisplay("ott-123", {
				authUrl: "https://auth.openmeld.ai",
				userFacingCommand: "openmeld",
			})
		).toMatchObject({
			primaryCommand: "npx -y openmeld@latest login --ott ott-123",
			alternateCommand: null,
		});
	});

	it("preserves a custom auth target instead of silently dropping it", () => {
		expect(
			buildOneTimeTokenCommandDisplay("ott-123", {
				authUrl: "https://auth-preview.openmeld.test",
				userFacingCommand: "openmeld",
			})
		).toMatchObject({
			primaryCommand:
				"OPENMELD_AUTH_URL=https://auth-preview.openmeld.test npx -y openmeld@latest login --ott ott-123",
			alternateCommand: null,
		});
	});
});
