import { describe, expect, it } from "vitest";
import { formatDirectoryActivity } from "./directory-human-profile-format";

describe("formatDirectoryActivity", () => {
	const nowMs = Date.parse("2026-08-20T12:00:00.000Z");

	it("keeps recent profile use scannable without implying live presence", () => {
		expect(formatDirectoryActivity(null, nowMs)).toBe("Activity unavailable");
		expect(formatDirectoryActivity("2026-08-20T11:59:40.000Z", nowMs)).toBe(
			"Last used just now"
		);
		expect(formatDirectoryActivity("2026-08-20T11:46:00.000Z", nowMs)).toBe(
			"Last used 14 minutes ago"
		);
		expect(formatDirectoryActivity("2026-08-19T12:00:00.000Z", nowMs)).toBe(
			"Last used yesterday"
		);
	});

	it("uses an exact date once relative activity is no longer recent", () => {
		expect(formatDirectoryActivity("2026-08-12T12:00:00.000Z", nowMs)).toBe(
			"Last used Aug 12, 2026"
		);
	});
});
