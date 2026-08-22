import { describe, expect, it } from "vitest";
import {
	formatDirectoryActivity,
	resolveDirectoryIdentityAccountCardLabel,
	resolveDirectoryIdentityAccountIdentity,
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

describe("Message Channel identity labels", () => {
	it("keeps setup and unavailable copy off the profile card", () => {
		expect(
			resolveDirectoryIdentityAccountCardLabel({
				accountEmail: null,
				accountName: null,
				action: {
					kind: "authorize",
					label: "Connect Slack",
					path: "/api/openmeld/slack/identity/start?organization_slug=acme",
				},
				canDisconnect: false,
				channelsPath: "/o/acme/channels",
				id: null,
				provider: "slack",
				providerLabel: "Slack",
				state: "not_connected",
			})
		).toBeNull();
	});

	it("keeps an unconnected provider as a logo-only card state", () => {
		expect(
			resolveDirectoryIdentityAccountCardLabel({
				accountEmail: null,
				accountName: null,
				action: null,
				canDisconnect: false,
				channelsPath: null,
				id: null,
				provider: "lark",
				providerLabel: "Lark",
				state: "not_connected",
			})
		).toBeNull();
	});

	it("combines a provider handle and verified email without duplicating legacy email-shaped names", () => {
		expect(
			resolveDirectoryIdentityAccountIdentity({
				accountEmail: "felix@amplift.ai",
				accountName: "@felix",
			})
		).toBe("@felix · felix@amplift.ai");
		expect(
			resolveDirectoryIdentityAccountIdentity({
				accountEmail: null,
				accountName: "felix@amplift.ai",
			})
		).toBeNull();
	});
});
