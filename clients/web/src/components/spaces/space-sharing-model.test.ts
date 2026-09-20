import { describe, expect, it } from "vitest";
import {
	createSpaceSharingDraft,
	describeSpaceJoining,
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
				allowGuests: true,
				linkJoinPolicy: "invite_only",
				visibility: "public",
			}),
			"anyone"
		);

		expect(draft).toEqual({
			accessMode: "public",
			allowGuests: true,
			linkJoinPolicy: "invite_only",
			visibility: "public",
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
			allowGuests: false,
			linkJoinPolicy: "invite_only",
			visibility: "private",
		});
	});

	it.each([
		{
			accessMode: "public" as const,
			allowGuests: false,
			expected: "People at Northstar",
			visibility: "private" as const,
		},
		{
			accessMode: "public" as const,
			allowGuests: true,
			expected: "Anyone, including external guests",
			visibility: "private" as const,
		},
		{
			accessMode: "public_view_join_password" as const,
			allowGuests: false,
			expected: "People at Northstar with the password",
			visibility: "private" as const,
		},
		{
			accessMode: "public_view_join_password" as const,
			allowGuests: true,
			expected: "Anyone with the password, including guests",
			visibility: "private" as const,
		},
		{
			accessMode: "public_view_join_password" as const,
			allowGuests: true,
			expected: "People at Northstar; guests need a password",
			visibility: "public" as const,
		},
	])("describes the effective joining audience instead of the raw link rule", ({
		accessMode,
		allowGuests,
		expected,
		visibility,
	}) => {
		const presentation = describeSpaceJoining({
			draft: createSpaceSharingDraft({
				accessMode,
				allowGuests,
				linkJoinPolicy: "access_mode",
				visibility,
			}),
			organizationName: "Northstar",
		});

		expect(presentation.label).toBe(expected);
	});
});
