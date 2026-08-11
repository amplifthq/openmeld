import { describe, expect, it } from "vitest";
import {
	DEFAULT_IDENTITY_IMAGE_CROP,
	resolveIdentityImageCropPlacement,
} from "./identity-image-crop";

describe("identity image crop placement", () => {
	it("centers a landscape image with cover semantics", () => {
		expect(
			resolveIdentityImageCropPlacement({
				crop: DEFAULT_IDENTITY_IMAGE_CROP,
				sourceHeight: 800,
				sourceWidth: 1200,
				subject: "Profile photo",
				viewportSize: 240,
			})
		).toEqual({ height: 240, left: -60, top: 0, width: 360 });
	});

	it("keeps every pan position inside the cropped viewport", () => {
		expect(
			resolveIdentityImageCropPlacement({
				crop: { positionX: 1, positionY: -1, zoom: 2 },
				sourceHeight: 800,
				sourceWidth: 1200,
				subject: "Profile photo",
				viewportSize: 240,
			})
		).toEqual({ height: 480, left: -480, top: 0, width: 720 });
	});

	it("keeps validation copy specific to the identity image surface", () => {
		expect(() =>
			resolveIdentityImageCropPlacement({
				crop: DEFAULT_IDENTITY_IMAGE_CROP,
				sourceHeight: 0,
				sourceWidth: 1200,
				subject: "Profile photo",
				viewportSize: 240,
			})
		).toThrow("Profile photo source height must be positive.");
	});
});
