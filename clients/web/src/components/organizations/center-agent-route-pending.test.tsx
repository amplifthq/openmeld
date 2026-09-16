import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readCenterAgentPendingMessage } from "#/lib/organizations/center-agent-pending-message";
import {
	CenterAgentPendingConversation,
	CenterAgentRoutePendingPage,
} from "./center-agent-route-pending";

vi.mock("#/components/app/app-inner-sidebar", () => ({
	AppInnerSidebar: ({ children }: { children: ReactNode }) => (
		<aside>{children}</aside>
	),
}));

vi.mock("#/components/app/app-contextual-layout", () => ({
	AppContextualSidebarNav: ({ title }: { title: string }) => (
		<nav aria-label={title} />
	),
}));

describe("CenterAgentRoutePendingPage", () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	afterEach(cleanup);

	it("restores an unsent Center Agent draft after the pending composer remounts", () => {
		const queryClient = new QueryClient();
		const firstComposer = render(
			<QueryClientProvider client={queryClient}>
				<CenterAgentPendingConversation
					organizationId="organization-acme"
					organizationSlug="acme"
					ownerAccountId="account-1"
				/>
			</QueryClientProvider>
		);

		fireEvent.change(
			screen.getByRole("textbox", { name: "Message Center Agent" }),
			{ target: { value: "Keep this Center Agent draft" } }
		);
		firstComposer.unmount();

		render(
			<QueryClientProvider client={queryClient}>
				<CenterAgentPendingConversation
					organizationId="organization-acme"
					organizationSlug="acme"
					ownerAccountId="account-1"
				/>
			</QueryClientProvider>
		);

		expect(
			(
				screen.getByRole("textbox", {
					name: "Message Center Agent",
				}) as HTMLTextAreaElement
			).value
		).toBe("Keep this Center Agent draft");
	});

	it("restores a queued message after a full refresh before the canonical Space takes over", () => {
		const firstQueryClient = new QueryClient();
		const firstComposer = render(
			<QueryClientProvider client={firstQueryClient}>
				<CenterAgentPendingConversation
					organizationId="organization-acme"
					organizationSlug="acme"
					ownerAccountId="account-1"
				/>
			</QueryClientProvider>
		);

		fireEvent.change(
			screen.getByRole("textbox", { name: "Message Center Agent" }),
			{ target: { value: "Send this after the route resolves" } }
		);
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));
		firstComposer.unmount();

		render(
			<QueryClientProvider client={new QueryClient()}>
				<CenterAgentPendingConversation
					organizationId="organization-acme"
					organizationSlug="acme"
					ownerAccountId="account-1"
				/>
			</QueryClientProvider>
		);

		expect(
			(
				screen.getByRole("textbox", {
					name: "Message Center Agent",
				}) as HTMLTextAreaElement
			).value
		).toBe("Send this after the route resolves");
	});

	it("does not restore a private draft when another organization reuses the slug", () => {
		const queryClient = new QueryClient();
		const firstComposer = render(
			<QueryClientProvider client={queryClient}>
				<CenterAgentPendingConversation
					organizationId="organization-original"
					organizationSlug="acme"
					ownerAccountId="account-1"
				/>
			</QueryClientProvider>
		);

		fireEvent.change(
			screen.getByRole("textbox", { name: "Message Center Agent" }),
			{ target: { value: "Private draft for the original organization" } }
		);
		firstComposer.unmount();

		render(
			<QueryClientProvider client={queryClient}>
				<CenterAgentPendingConversation
					organizationId="organization-reusing-slug"
					organizationSlug="acme"
					ownerAccountId="account-1"
				/>
			</QueryClientProvider>
		);

		expect(
			(
				screen.getByRole("textbox", {
					name: "Message Center Agent",
				}) as HTMLTextAreaElement
			).value
		).toBe("");
	});

	it("renders an interactive composer before organization data is available", () => {
		const queryClient = new QueryClient();

		render(
			<QueryClientProvider client={queryClient}>
				<CenterAgentRoutePendingPage organizationSlug="acme" section="chat" />
			</QueryClientProvider>
		);

		const composer = screen.getByRole("textbox", {
			name: "Message Center Agent",
		});
		expect(
			document.querySelector('[data-slot="center-agent-pending-layout"]')
		).toBeTruthy();
		expect(
			screen.getAllByTestId("center-agent-conversation-skeleton")
		).toHaveLength(1);
		expect(screen.getByTestId("center-agent-pending-outer-rail")).toBeTruthy();
		expect(screen.queryByRole("navigation", { name: "Spaces" })).toBeNull();
		fireEvent.change(composer, { target: { value: "Hello from first paint" } });
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));

		expect(screen.getByText("Hello from first paint")).toBeTruthy();
		expect(screen.queryByText("Sending…")).toBeNull();
		expect(screen.getByRole("button", { name: "Sending…" })).toBeTruthy();
		expect(
			readCenterAgentPendingMessage(queryClient, {
				organizationSlug: "acme",
			})
		).toMatchObject({ text: "Hello from first paint" });
	});

	it("renders conversation-only pending content inside the resolved route layout", () => {
		const queryClient = new QueryClient();

		render(
			<QueryClientProvider client={queryClient}>
				<CenterAgentPendingConversation organizationSlug="acme" />
			</QueryClientProvider>
		);

		expect(
			screen.getByTestId("center-agent-conversation-skeleton")
		).toBeTruthy();
		expect(
			document.querySelector('[data-slot="center-agent-pending-layout"]')
		).toBeNull();
		expect(screen.queryByTestId("center-agent-pending-outer-rail")).toBeNull();
	});

	it("keeps the pending application rail fixed while restoring the middle-column width", () => {
		const queryClient = new QueryClient();

		render(
			<QueryClientProvider client={queryClient}>
				<CenterAgentRoutePendingPage
					initialOuterSidebarState={{ tier: "expanded", width: "10.5rem" }}
					organizationSlug="acme"
					section="chat"
				/>
			</QueryClientProvider>
		);

		const rail = screen.getByTestId("center-agent-pending-outer-rail");
		expect(rail.className).toContain("w-[4.75rem]");
		expect(screen.getByTestId("app-module-sidebar").style.width).toBe("168px");
		expect(
			screen.getByTestId("app-module-sidebar").getAttribute("data-state")
		).toBe("expanded");
	});

	it("keeps the pending application rail visible with a collapsed middle list", () => {
		const queryClient = new QueryClient();

		render(
			<QueryClientProvider client={queryClient}>
				<CenterAgentRoutePendingPage
					initialOuterSidebarState={{ tier: "icon", width: "10.5rem" }}
					organizationSlug="acme"
					section="chat"
				/>
			</QueryClientProvider>
		);

		const rail = screen.getByTestId("center-agent-pending-outer-rail");
		expect(rail.className).toContain("w-[4.75rem]");
		expect(
			screen.getByTestId("app-module-sidebar").getAttribute("data-state")
		).toBe("hidden");
	});
});
