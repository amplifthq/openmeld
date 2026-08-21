import { describe, expect, it } from "vitest";
import {
	formatDirectoryActivity,
	resolveDirectoryIdentityAccountCardLabel,
} from "./directory-human-profile-format";

describe("formatDirectoryActivity", () => {
	const nowMs = Date.parse("2026-08-20T12:00:00.000Z");

	it("keeps recent profile use scannable without implying live presence", () => {
		expect(formatDirectoryActivity(null, nowMs)).toBeNull();
		expect(formatDirectoryActivity("not-a-date", nowMs)).toBeNull();
		expect(formatDirectoryActivity("2026-08-20T11:59:40.000Z", nowMs)).toBe(
			"Last active just now"
		);
		expect(formatDirectoryActivity("2026-08-20T11:46:00.000Z", nowMs)).toBe(
			"Last active 14 minutes ago"
		);
		expect(formatDirectoryActivity("2026-08-19T12:00:00.000Z", nowMs)).toBe(
			"Last active yesterday"
		);
	});

	it("uses an exact date once relative activity is no longer recent", () => {
		expect(formatDirectoryActivity("2026-08-12T12:00:00.000Z", nowMs)).toBe(
			"Last active Aug 12, 2026"
		);
	});
});

describe("resolveDirectoryIdentityAccountCardLabel", () => {
	it("offers the current member a provider-specific connect action", () => {
		expect(
			resolveDirectoryIdentityAccountCardLabel({
				action: {
					kind: "authorize",
					label: "Connect Slack",
					path: "/api/openmeld/slack/identity/start?organization_slug=acme",
				},
				canDisconnect: false,
				channelsPath: "/o/acme/channels",
				id: null,
				provider: "slack",
				accountEmail: null,
				providerLabel: "Slack",
				state: "not_connected",
			})
		).toBe("Connect Slack");
	});

	it("describes an unconnected account without inventing an action", () => {
		expect(
			resolveDirectoryIdentityAccountCardLabel({
				action: null,
				canDisconnect: false,
				channelsPath: null,
				id: null,
				provider: "lark",
				accountEmail: null,
				providerLabel: "Lark",
				state: "not_connected",
			})
		).toBe("No account connected");
	});
});
