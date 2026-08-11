import { describe, expect, it } from "vitest";
import { Route } from "./inbox.index";

describe("Inbox index route", () => {
	it("opens a valid item deep link in the canonical All view", () => {
		const validateSearch = Route.options.validateSearch as (
			search: Record<string, unknown>
		) => { item?: string; view?: string };

		expect(
			validateSearch({ item: "  inbox-item-123  ", view: "needs-action" })
		).toEqual({ item: "inbox-item-123", view: undefined });
	});

	it("drops invalid item and view search values", () => {
		const validateSearch = Route.options.validateSearch as (
			search: Record<string, unknown>
		) => { item?: string; view?: string };

		expect(validateSearch({ item: "  ", view: "urgent" })).toEqual({
			item: undefined,
			view: undefined,
		});
	});
});
