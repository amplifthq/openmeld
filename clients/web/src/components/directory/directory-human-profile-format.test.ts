import { describe, expect, it } from "vitest";
import {
	formatDirectoryActivity,
	resolveDirectoryHumanProfileActivityLabel,
} from "./directory-human-profile-format";

describe("directory Human Profile activity copy", () => {
	it("shows only the relative time in the compact People sidebar", () => {
		const nowMs = Date.parse("2026-08-28T03:00:00.000Z");

		expect(formatDirectoryActivity("2026-08-28T00:00:00.000Z", nowMs)).toBe(
			"3 hours ago"
		);
		expect(formatDirectoryActivity("2026-08-28T02:59:30.000Z", nowMs)).toBe(
			"just now"
		);
	});

	it("keeps exceptional Human Profile states explicit", () => {
		expect(
			resolveDirectoryHumanProfileActivityLabel({
				lastActiveAt: "2026-08-28T00:00:00.000Z",
				nowMs: Date.parse("2026-08-28T03:00:00.000Z"),
				profileStatus: "disabled",
			})
		).toBe("Profile disabled");
	});
});
