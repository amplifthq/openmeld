import { describe, expect, it } from "vitest";
import { Route } from "./inbox.index";

describe("Inbox index route", () => {
	it("combines unread with review filters and accepts legacy unread links", () => {
		const validate = Route.options.validateSearch as (
			search: Record<string, unknown>
		) => Record<string, unknown>;
		expect(validate({ view: "needs-review", unread: "true" })).toMatchObject({
			view: "needs-review",
			unread: true,
		});
		expect(validate({ view: "unread" })).toMatchObject({
			view: undefined,
			unread: true,
		});
		expect(validate({ unread: "false" }).unread).toBeUndefined();
		expect(validate({ item: "item-1", unread: true }).unread).toBeUndefined();
	});
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
