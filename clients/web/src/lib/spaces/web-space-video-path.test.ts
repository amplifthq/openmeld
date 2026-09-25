import { describe, expect, it } from "vitest";
import { buildWebSpaceVideoPath } from "./web-space-video-path";

describe("Space video URLs", () => {
	it("pins the immutable file revision and uses the existing non-secret Organization selector", () => {
		expect(
			buildWebSpaceVideoPath({
				spaceId: "a/b",
				fileId: "c d",
				revision: 7,
				organizationSlug: "acme&co",
			})
		).toBe(
			"/v1/spaces/a%2Fb/files/c%20d/content?revision=7&__openmeld_organization_slug=acme%26co"
		);
		expect(
			buildWebSpaceVideoPath({
				spaceId: "public",
				fileId: "video",
				revision: 1,
			})
		).toBe("/v1/spaces/public/files/video/content?revision=1");
	});
});
