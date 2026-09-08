import { TooltipProvider } from "@openmeld/ui/components/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalCenterAgentLauncher } from "./global-center-agent-launcher";

const prefetchCenterAgentConversationMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		...props
	}: {
		children: ReactNode;
		to: string;
	} & AnchorHTMLAttributes<HTMLAnchorElement>) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}));

vi.mock("./center-agent-compact-conversation", () => ({
	CenterAgentCompactConversation: ({
		organizationId,
	}: {
		organizationId: string;
	}) => (
		<section aria-label="Compact Center Agent conversation">
			Canonical conversation for {organizationId}
		</section>
	),
}));

vi.mock("./use-center-agent-conversation-intent-prefetch", () => ({
	useCenterAgentConversationIntentPrefetch: () =>
		prefetchCenterAgentConversationMock,
}));

vi.mock("#/lib/organizations/organization-context", () => ({
	useOptionalAppOrganization: () => ({
		currentOrganization: {
			id: "organization-1",
			name: "Amplift",
			slug: "amplift",
		},
	}),
}));

describe("GlobalCenterAgentLauncher", () => {
	beforeEach(() => {
		prefetchCenterAgentConversationMock.mockReset();
	});

	afterEach(cleanup);

	it("opens the canonical Center Agent conversation in a compact view", async () => {
		renderLauncher();

		fireEvent.click(screen.getByRole("button", { name: "Open Center Agent" }));

		expect(
			(
				await screen.findByRole("region", {
					name: "Compact Center Agent conversation",
				})
			).textContent
		).toContain("Canonical conversation for organization-1");
		expect(
			screen
				.getByRole("link", { name: "Open full Center Agent Chat" })
				.getAttribute("href")
		).toBe("/o/amplift/chats/center-agent");
		expect(
			screen.queryByRole("button", { name: "Continue in Chat" })
		).toBeNull();
	});

	it("warms the existing conversation when the launcher receives intent", () => {
		renderLauncher();

		fireEvent.pointerEnter(
			screen.getByRole("button", { name: "Open Center Agent" })
		);

		expect(prefetchCenterAgentConversationMock).toHaveBeenCalledOnce();
	});

	it.each([
		"/o/amplift",
		"/o/amplift/chats/center-agent",
	])("hides the redundant shortcut while the conversation is open at %s", (pathname) => {
		renderLauncher(pathname);

		expect(
			screen.queryByRole("button", { name: "Open Center Agent" })
		).toBeNull();
	});
});

function renderLauncher(currentPathname = "/o/amplift/projects") {
	const queryClient = new QueryClient({
		defaultOptions: {
			mutations: { retry: false },
			queries: { retry: false },
		},
	});
	return {
		...render(
			<QueryClientProvider client={queryClient}>
				<TooltipProvider>
					<GlobalCenterAgentLauncher currentPathname={currentPathname} />
				</TooltipProvider>
			</QueryClientProvider>
		),
		queryClient,
	};
}
