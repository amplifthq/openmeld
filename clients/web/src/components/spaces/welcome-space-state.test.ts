import { beforeEach, expect, it } from "vitest";
import {
	buildWelcomeSpaceDraft,
	readWelcomeSpace,
	resumeWelcomeSpace,
	saveWelcomeSpace,
	welcomeStepStartedAt,
} from "./welcome-space-state";

beforeEach(() => localStorage.clear());
it("resumes the same send step without moving its message cutoff", () => {
	saveWelcomeSpace("account-a", "space-a", "send");
	const startedAt = welcomeStepStartedAt("account-a", "space-a");
	saveWelcomeSpace("account-a", "space-a", "paused");
	resumeWelcomeSpace("account-a", "space-a");
	expect(readWelcomeSpace("account-a", "space-a")).toBe("send");
	expect(welcomeStepStartedAt("account-a", "space-a")).toBe(startedAt);
});
it("keeps tutorial identity scoped to the account and Space, independently of its name", () => {
	saveWelcomeSpace("account-a", "space-a", "add");
	expect(readWelcomeSpace("account-a", "space-a")).toBe("add");
	expect(readWelcomeSpace("account-b", "space-a")).toBeNull();
	expect(readWelcomeSpace("account-a", "space-b")).toBeNull();
	saveWelcomeSpace("account-a", "space-a", "paused");
	expect(readWelcomeSpace("account-a", "space-a")).toBe("paused");
});
it("addresses the entire added batch and only wakes agents", () => {
	const draft = buildWelcomeSpaceDraft([
		{ profileId: "agent-a", profileName: "Code helper", profileKind: "agent" },
		{ profileId: "person-b", profileName: "Sam", profileKind: "human" },
		{ profileId: "agent-c", profileName: "Research", profileKind: "agent" },
	]);
	expect(
		draft.authoredMentions.map((mention) => [
			mention.profileId,
			mention.relation,
		])
	).toEqual([
		["agent-a", "wake"],
		["person-b", "mention"],
		["agent-c", "wake"],
	]);
	for (const mention of draft.authoredMentions) {
		expect(draft.text.slice(mention.start, mention.end)).toBe(mention.text);
	}
	expect(draft.selection.start).toBe(draft.text.length);
});
