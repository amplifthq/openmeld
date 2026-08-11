import { OPENMELD_HEADER_REQUESTED_ORGANIZATION_ID } from "@openmeld/gateway-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	removeCurrentOrganizationLogo,
	updateCurrentOrganizationLogo,
} from "./organization-logo";

describe("Organization logo requests", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("binds an upload to the Organization selected by the page", async () => {
		const fetchMock = createOrganizationLogoFetchMock();
		vi.stubGlobal("fetch", fetchMock);

		await updateCurrentOrganizationLogo({
			bytes: new Uint8Array([1]),
			mimeType: "image/png",
			organizationId: "org-acme",
		});

		expect(fetchMock).toHaveBeenCalledWith(
			`${window.location.origin}/v1/organizations/current/logo`,
			expect.objectContaining({ method: "PUT" })
		);
		expect(readRequestedOrganization(fetchMock)).toBe("org-acme");
	});

	it("binds a removal to the Organization selected by the page", async () => {
		const fetchMock = createOrganizationLogoFetchMock();
		vi.stubGlobal("fetch", fetchMock);

		await removeCurrentOrganizationLogo({
			organizationId: "org-acme",
		});

		expect(fetchMock).toHaveBeenCalledWith(
			`${window.location.origin}/v1/organizations/current/logo`,
			expect.objectContaining({ method: "DELETE" })
		);
		expect(readRequestedOrganization(fetchMock)).toBe("org-acme");
	});
});

function createOrganizationLogoFetchMock() {
	return vi.fn<typeof fetch>(() =>
		Promise.resolve(
			new Response(
				JSON.stringify({
					logo: "https://gateway.example/v1/organization-logos/org-acme/logo.webp",
					ok: true,
				}),
				{
					headers: { "content-type": "application/json" },
					status: 200,
				}
			)
		)
	);
}

function readRequestedOrganization(
	fetchMock: ReturnType<typeof createOrganizationLogoFetchMock>
) {
	const headers = fetchMock.mock.calls[0]?.[1]?.headers;
	if (!(headers instanceof Headers)) {
		return null;
	}
	return headers.get(OPENMELD_HEADER_REQUESTED_ORGANIZATION_ID);
}
