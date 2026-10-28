import { defaultParseSearch } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { buildOrganizationNewDocumentPath } from "#/lib/organizations/organization-routes";
import { Route } from "./files";

describe("Team Knowledge creation links", () => {
	it("retains a desk's shared-file selection in the Team location", () => {
		const validateSearch = Route.options.validateSearch as (
			search: Record<string, unknown>
		) => Record<string, unknown>;
		expect(
			validateSearch(defaultParseSearch("?view=team&file=shared-diff"))
		).toMatchObject({ view: "team", file: "shared-diff" });
		expect(validateSearch({ file: { id: "bad" } }).file).toBeUndefined();
	});
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
