import {
	createSpaceMemberHumanSnapshot,
	createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import { describe, expect, it } from "vitest";
import {
	buildAccountSpaceJoinedAsLabel,
	buildJoinedAsProfileLabel,
	resolveCurrentSpaceProfileName,
} from "./profile-display";

describe("space profile display helpers", () => {
	it("formats the shared Joined as label", () => {
		expect(buildJoinedAsProfileLabel({ profileName: " Mira " })).toEqual({
			prefix: "Joined as",
			profileName: "Mira",
			text: "Joined as Mira",
		});
	});

	it("labels the sidebar with the profile that will open the space", () => {
		expect(
			buildAccountSpaceJoinedAsLabel({
				openProfileName: "Mira",
			}).text
		).toBe("Joined as Mira");
	});

	it("resolves the current active profile name from the members snapshot", () => {
		const snapshot = createSpaceMembersSnapshot({
			humans: [
				createSpaceMemberHumanSnapshot({
					profileId: "human-default",
					profileName: "Mira",
				}),
			],
		});

		expect(
			resolveCurrentSpaceProfileName({
				currentProfileId: "human-default",
				snapshot,
			})
		).toBe("Mira");
	});
});
