import { describe, expect, it } from "vitest";
import {
	createSpaceSharingDraft,
	resolveSpaceLinkJoining,
	resolveSpaceLinkReading,
	setSpaceLinkJoining,
	setSpaceLinkReading,
} from "./space-sharing-model";

describe("Space sharing model", () => {
	it("enables reading without also enabling link joining", () => {
		const draft = setSpaceLinkReading(
			createSpaceSharingDraft({
				accessMode: "members_only",
				linkJoinPolicy: "invite_only",
			}),
			"anyone"
		);

		expect(draft).toEqual({
			accessMode: "public",
			linkJoinPolicy: "invite_only",
		});
		expect(resolveSpaceLinkReading(draft)).toBe("anyone");
		expect(resolveSpaceLinkJoining(draft)).toBe("invite_only");
	});

	it("preserves legacy link joining when the policy field is absent", () => {
		const draft = createSpaceSharingDraft({ accessMode: "public" });

		expect(draft.linkJoinPolicy).toBe("access_mode");
		expect(resolveSpaceLinkJoining(draft)).toBe("anyone");
	});

	it("can make a legacy password-to-join Space invitation-only", () => {
		const draft = setSpaceLinkJoining(
			createSpaceSharingDraft({
				accessMode: "public_view_join_password",
				linkJoinPolicy: "access_mode",
			}),
			"invite_only"
		);

		expect(draft).toEqual({
			accessMode: "public",
			linkJoinPolicy: "invite_only",
		});
	});
});
