import { normalizeOrganizationList } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";

describe("normalizeOrganizationList", () => {
	it("detects a solo context from Better Auth string metadata", () => {
		expect(
			normalizeOrganizationList([
				createOrganizationRecord({
					metadata: '{"personal":true}',
				}),
			])[0]?.isPersonal
		).toBe(true);
	});

	it("detects a solo context from object metadata", () => {
		expect(
			normalizeOrganizationList([
				createOrganizationRecord({
					metadata: { personal: true },
				}),
			])[0]?.isPersonal
		).toBe(true);
	});

	it("treats null metadata as an organization context", () => {
		expect(
			normalizeOrganizationList([
				createOrganizationRecord({
					metadata: null,
				}),
			])[0]?.isPersonal
		).toBe(false);
	});

	it("treats malformed metadata as an organization context", () => {
		expect(
			normalizeOrganizationList([
				createOrganizationRecord({
					metadata: '{"personal":',
				}),
			])[0]?.isPersonal
		).toBe(false);
	});
});

function createOrganizationRecord(input: { metadata: unknown }) {
	return {
		id: "org_test",
		logo: null,
		metadata: input.metadata,
		name: "Felix",
		slug: "felix",
	};
}
