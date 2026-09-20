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
		expect(validate({ item: "item-1", unread: true }).unread).toBe(true);
	});
	it("retains the selected category and independent filters around an exact item deep link", () => {
		const validateSearch = Route.options.validateSearch as (
			search: Record<string, unknown>
		) => { item?: string; view?: string };

		expect(
			validateSearch({ item: "  inbox-item-123  ", view: "needs-action" })
		).toMatchObject({ item: "inbox-item-123", view: "needs-action" });
		expect(
			validateSearch({
				item: "item-1",
				view: "mentions",
				unread: "true",
				agents: "true",
			})
		).toMatchObject({
			item: "item-1",
			view: "mentions",
			unread: true,
			agents: true,
		});
		expect(validateSearch({ agents: "false" })).toHaveProperty(
			"agents",
			undefined
		);
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
