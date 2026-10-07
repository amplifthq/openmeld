import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ComponentProps, ComponentType, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InboxPage } from "#/components/inbox/inbox-page";
import { Route } from "./inbox.index";

vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-router")>()),
	useNavigate: () => () =>
		new Promise(() => {
			// Hold navigation open to exercise immediate control feedback.
		}),
}));
vi.mock("#/components/inbox/inbox-avatars", () => ({
	InboxAvatarProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("#/components/inbox/inbox-page", () => ({
	InboxPage: (props: ComponentProps<typeof InboxPage>) => (
		<>
			<output>
				{JSON.stringify({
					view: props.view,
					unread: props.unreadOnly,
					agents: props.agentsOnly,
					people: props.peopleOnly,
					conversation: props.conversationType,
					item: props.itemId,
				})}
			</output>
			<button onClick={() => props.onViewChange("mentions")} type="button">
				Mentions
			</button>
			<button
				onClick={() => props.onUnreadOnlyChange?.(!props.unreadOnly)}
				type="button"
			>
				Toggle unread
			</button>
			<button
				onClick={() =>
					props.onFiltersChange?.({
						agentsOnly: false,
						peopleOnly: true,
						conversationType: "spaces",
					})
				}
				type="button"
			>
				People in Spaces
			</button>
		</>
	),
}));

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("Inbox navigation feedback", () => {
	it.each([
		"",
		"?view=unread&item=item-1",
	])("updates the feed filters before route navigation finishes (%s)", (searchParams) => {
		// Keep route state at its initial snapshot: a slow navigation must not
		// delay the props that select the visible feed and its query.
		vi.spyOn(Route, "useSearch").mockReturnValue(
			searchParams ? { unread: true, item: "item-1" } : {}
		);
		const Component = Route.options.component as ComponentType;
		render(
			<NuqsTestingAdapter hasMemory searchParams={searchParams}>
				<Component />
			</NuqsTestingAdapter>
		);
		const read = () =>
			JSON.parse(screen.getByRole("status").textContent ?? "{}");
		expect(read().unread).toBe(Boolean(searchParams));
		fireEvent.click(screen.getByRole("button", { name: "Mentions" }));
		expect(read()).toMatchObject({
			view: "mentions",
			unread: Boolean(searchParams),
		});
		expect(read().item).toBeUndefined();
		fireEvent.click(screen.getByRole("button", { name: "Toggle unread" }));
		expect(read()).toMatchObject({ view: "mentions", unread: !searchParams });
		fireEvent.click(screen.getByRole("button", { name: "People in Spaces" }));
		expect(read()).toMatchObject({
			view: "mentions",
			unread: !searchParams,
			agents: false,
			people: true,
			conversation: "spaces",
		});
	});
});
