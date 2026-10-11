import { defaultParseSearch } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { buildOrganizationNewDocumentPath } from "#/lib/organizations/organization-routes";
import { Route } from "./files";

describe("Team Knowledge creation links", () => {
	it("opens the Team Brief form from the Center Agent settings link", () => {
		const href = buildOrganizationNewDocumentPath({
			kind: "brief",
			orgSlug: "acme",
		});
		const validateSearch = Route.options.validateSearch as (
			search: Record<string, unknown>
		) => Record<string, unknown>;
		const search = defaultParseSearch(
			new URL(href, "https://openmeld.ai").search
		);
		expect(validateSearch(search)).toMatchObject({
			create: "1",
			kind: "brief",
			view: "knowledge",
		});
	});
});
