import { expect, it, vi } from "vitest";

vi.mock("#/components/member-agents/use-member-agents", () => ({}));

it("labels each MemberAgent Session card with its Session title (R4-04)", async () => {
	const { withSessionTitle } = await import("./use-chats");
	expect(withSessionTitle("OpenCode", "Round 4 restored chat")).toBe(
		"OpenCode · Round 4 restored chat"
	);
	expect(withSessionTitle("OpenCode", "New chat")).toBe("OpenCode · New chat");
	// Other Direct Messages keep their name.
	expect(withSessionTitle("Tali Smoke", undefined)).toBe("Tali Smoke");
	expect(withSessionTitle(null, "Plan")).toBeNull();
});
