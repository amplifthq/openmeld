import { describe, expect, it } from "vitest";
import { applyInboxTabTitle } from "./browser-tab";

describe("Inbox browser tab title", () => {
	it("follows route titles without stacking prefixes and restores the current route on exit", async () => {
		document.title = "Inbox | OpenMeld";
		const clear = applyInboxTabTitle("2 needs action");
		try {
			expect(document.title).toBe("2 needs action · Inbox | OpenMeld");
			document.title = "Team | OpenMeld";
			await Promise.resolve();
			await Promise.resolve();
			expect(document.title).toBe("2 needs action · Team | OpenMeld");
		} finally {
			clear();
		}
		expect(document.title).toBe("Team | OpenMeld");
		const clearNext = applyInboxTabTitle("127 unread");
		expect(document.title).toBe("127 unread · Team | OpenMeld");
		clearNext();
		expect(document.title).toBe("Team | OpenMeld");
	});
});
