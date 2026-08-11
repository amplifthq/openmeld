import { describe, expect, it } from "vitest";
import { buildOneTimeTokenCommandDisplay } from "./one-time-token-card";

describe("buildOneTimeTokenCommandDisplay", () => {
	it("uses the local openmeld-dev command on localhost", () => {
		expect(
			buildOneTimeTokenCommandDisplay("ott-123", {
				authUrl: "http://localhost:8788",
				origin: "http://localhost:3000",
			})
		).toMatchObject({
			primaryCommand: "openmeld-dev login --ott ott-123",
			alternateCommand: null,
		});
	});

	it("uses the published release command outside localhost", () => {
		expect(
			buildOneTimeTokenCommandDisplay("ott-123", {
				authUrl: "https://auth.openmeld.invalid",
				origin: "https://app.openmeld.invalid",
			})
		).toMatchObject({
			primaryCommand: "npx -y openmeld@latest login --ott ott-123",
			alternateCommand: null,
		});
	});

	it("uses the release command outside localhost even when Web has a non-default auth worker", () => {
		expect(
			buildOneTimeTokenCommandDisplay("ott-123", {
				authUrl: "https://auth-preview.openmeld.test",
				origin: "https://preview.openmeld.test",
			})
		).toMatchObject({
			primaryCommand: "npx -y openmeld@latest login --ott ott-123",
			alternateCommand: null,
		});
	});
});
