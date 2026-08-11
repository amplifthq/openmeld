import type { LarkPlatformRegistrationAttemptProjection } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { resolveRegistrationPollInterval } from "./message-channels";

const NOW_MS = Date.parse("2026-07-18T00:00:00.000Z");

function createAttempt(
	overrides: Partial<LarkPlatformRegistrationAttemptProjection> = {}
): LarkPlatformRegistrationAttemptProjection {
	return {
		expiresAt: "2026-07-18T00:10:00.000Z",
		id: "attempt_1",
		nextPollAt: "2026-07-18T00:00:05.000Z",
		provider: "lark",
		reasonCode: null,
		registrationUrl: "https://open.larksuite.com/page/launcher",
		status: "pending_registration",
		...overrides,
	};
}

describe("resolveRegistrationPollInterval", () => {
	it("uses the next provider poll time from Core", () => {
		expect(resolveRegistrationPollInterval(createAttempt(), NOW_MS)).toBe(5000);
	});

	it("waits at least one second when Core's next poll time has passed", () => {
		expect(
			resolveRegistrationPollInterval(
				createAttempt({ nextPollAt: "2026-07-17T23:59:59.000Z" }),
				NOW_MS
			)
		).toBe(1000);
	});

	it("stops polling after the registration reaches a terminal state", () => {
		expect(
			resolveRegistrationPollInterval(
				createAttempt({ status: "connected" }),
				NOW_MS
			)
		).toBe(false);
	});
});
