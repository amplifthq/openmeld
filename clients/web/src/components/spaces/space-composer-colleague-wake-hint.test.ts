import { describe, expect, it } from "vitest";
import {
	hasBlockedColleagueWake,
	isColleagueAgentTarget,
	resolveSpaceComposerBlockedWakeHint,
} from "./space-composer";
import type { SpaceComposerAddressingTarget } from "./use-space-mention-authoring";

const OWNER_USER_ID = "owner-user";
const VIEWER_USER_ID = "viewer-user";

function blockedTarget(ownerUserId: string): SpaceComposerAddressingTarget {
	return {
		agentControllerRef: "builtin:grok",
		allowedRelations: { mention: false, reference: true, wake: true },
		ownerUserId,
		primaryMentionLabel: "Wake",
		profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
		profileName: "Grok Build",
		relation: "wake",
		wakeAvailability: {
			reasonCodes: ["profile.workspace.missing"],
			reasonText: "Choose a working folder for this Agent.",
			status: "blocked",
		},
	};
}

describe("blocked wake hint for a colleague's Agent", () => {
	it("shows only the neutral public reason to a person who does not own it", () => {
		const hint = resolveSpaceComposerBlockedWakeHint(
			[blockedTarget(OWNER_USER_ID)],
			undefined,
			{ publicReasonText: "No working folder", userId: VIEWER_USER_ID }
		);

		expect(hint).toBe(
			"Grok Build can’t start work right now · No working folder"
		);
		expect(hint).not.toContain("Choose");
		expect(hint).not.toContain("missing");
	});

	it("stays generic when no public reason is known", () => {
		expect(
			resolveSpaceComposerBlockedWakeHint(
				[blockedTarget(OWNER_USER_ID)],
				undefined,
				{ publicReasonText: null, userId: VIEWER_USER_ID }
			)
		).toBe("Grok Build can’t start work right now");
	});

	it("keeps the owner's own setup copy", () => {
		const hint = resolveSpaceComposerBlockedWakeHint(
			[blockedTarget(OWNER_USER_ID)],
			undefined,
			{ publicReasonText: "No working folder", userId: OWNER_USER_ID }
		);

		expect(hint).not.toContain("can’t start work right now");
	});

	it("treats only another person's Agent as a colleague's", () => {
		const target = blockedTarget(OWNER_USER_ID);
		expect(isColleagueAgentTarget(target, VIEWER_USER_ID)).toBe(true);
		expect(isColleagueAgentTarget(target, OWNER_USER_ID)).toBe(false);
		expect(isColleagueAgentTarget(target, null)).toBe(false);
		expect(isColleagueAgentTarget({ ownerUserId: null }, VIEWER_USER_ID)).toBe(
			false
		);
	});

	it("blocks sending to a colleague's unavailable Agent, not to your own", () => {
		const targets = [blockedTarget(OWNER_USER_ID)];
		expect(hasBlockedColleagueWake(targets, VIEWER_USER_ID)).toBe(true);
		expect(hasBlockedColleagueWake(targets, OWNER_USER_ID)).toBe(false);
	});
});
