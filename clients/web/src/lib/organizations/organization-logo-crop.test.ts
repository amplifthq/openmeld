import { describe, expect, it } from "vitest";
import {
	DEFAULT_ORGANIZATION_LOGO_CROP,
	resolveOrganizationLogoCropPlacement,
} from "./organization-logo-crop";

describe("Organization logo crop placement", () => {
	it("centers a landscape image with cover semantics", () => {
		expect(
			resolveOrganizationLogoCropPlacement({
				crop: DEFAULT_ORGANIZATION_LOGO_CROP,
				sourceHeight: 800,
				sourceWidth: 1200,
				viewportSize: 240,
			})
		).toEqual({ height: 240, left: -60, top: 0, width: 360 });
	});

	it("keeps every pan position inside the cropped viewport", () => {
		expect(
			resolveOrganizationLogoCropPlacement({
				crop: { positionX: 1, positionY: -1, zoom: 2 },
				sourceHeight: 800,
				sourceWidth: 1200,
				viewportSize: 240,
			})
		).toEqual({ height: 480, left: -480, top: 0, width: 720 });
	});

	it("rejects invalid decoded dimensions", () => {
		expect(() =>
			resolveOrganizationLogoCropPlacement({
				crop: DEFAULT_ORGANIZATION_LOGO_CROP,
				sourceHeight: 0,
				sourceWidth: 1200,
				viewportSize: 240,
			})
		).toThrow("Organization logo source height must be positive.");
	});
});
