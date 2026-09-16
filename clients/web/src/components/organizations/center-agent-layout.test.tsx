import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CenterAgentLayout } from "./center-agent-layout";
import { CenterAgentRoutePendingPage } from "./center-agent-route-pending";

const appOuterRailSpy = vi.hoisted(() => vi.fn());
vi.mock("../spaces/conversations-sidebar", () => ({
	ConversationsSidebar: () => (
		<nav aria-label="Conversations">Existing conversations</nav>
	),
}));

vi.mock("#/components/app/app-global-controls", () => ({
	AppGlobalControls: () => <div data-testid="global-controls" />,
}));

vi.mock("#/components/app/app-outer-rail", () => ({
	AppOuterRail: (props: unknown) => {
		appOuterRailSpy(props);
		return <aside data-slot="app-outer-rail" />;
	},
}));

vi.mock("#/components/app/app-shell-account", () => ({
	useAppShellAccount: () => ({
		email: "felix@example.com",
		image: null,
		name: "Felix",
	}),
}));

afterEach(cleanup);

describe("CenterAgentLayout", () => {
	it("renders Center Agent content beside the shared Spaces list", () => {
		render(
			<CenterAgentLayout>
				<div>Organization Center Agent</div>
			</CenterAgentLayout>
		);

		expect(screen.getByText("Organization Center Agent")).toBeTruthy();
		expect(
			document.querySelector('[data-slot="app-inline-contextual-navigation"]')
		).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "Open Center Agent navigation" })
		).toBeNull();
	});

	it("keeps one middle column through pending-to-ready rendering", async () => {
		appOuterRailSpy.mockReset();
		const queryClient = new QueryClient();
		const initialOuterSidebarState = {
			tier: "expanded" as const,
			width: "10.5rem",
		};
		const host = document.createElement("div");
		document.body.appendChild(host);
		const secondarySidebarMounts: Element[] = [];
		const observer = new MutationObserver((records) => {
			recordSecondarySidebarMounts(records, secondarySidebarMounts);
		});
		observer.observe(host, { childList: true, subtree: true });

		const rendered = render(
			<QueryClientProvider client={queryClient}>
				<CenterAgentRoutePendingPage
					initialOuterSidebarState={initialOuterSidebarState}
					organizationSlug="acme"
					section="chat"
				/>
			</QueryClientProvider>,
			{ container: host }
		);
		await act(async () => undefined);
		recordSecondarySidebarMounts(
			observer.takeRecords(),
			secondarySidebarMounts
		);
		expect(
			host.querySelector('[data-slot="center-agent-pending-layout"]')
		).toBeTruthy();
		expect(
			screen.getByRole("textbox", { name: "Message Center Agent" })
		).toBeTruthy();

		rendered.rerender(
			<QueryClientProvider client={queryClient}>
				<CenterAgentLayout initialOuterSidebarState={initialOuterSidebarState}>
					<div>Center Agent ready</div>
				</CenterAgentLayout>
			</QueryClientProvider>
		);
		await act(async () => undefined);
		recordSecondarySidebarMounts(
			observer.takeRecords(),
			secondarySidebarMounts
		);
		observer.disconnect();

		expect(
			host.querySelector('[data-slot="center-agent-layout"]')
		).toBeTruthy();
		expect(screen.getByText("Center Agent ready")).toBeTruthy();
		expect(secondarySidebarMounts.length).toBeGreaterThan(0);
		expect(
			host.querySelectorAll('[data-slot="app-inline-contextual-navigation"]')
		).toHaveLength(1);
		expect(appOuterRailSpy).toHaveBeenCalled();
	});
});

function recordSecondarySidebarMounts(
	records: readonly MutationRecord[],
	mounts: Element[]
): void {
	for (const record of records) {
		for (const node of record.addedNodes) {
			if (!(node instanceof Element)) {
				continue;
			}
			if (node.matches('[data-slot="app-inline-contextual-navigation"]')) {
				mounts.push(node);
			}
			mounts.push(
				...node.querySelectorAll(
					'[data-slot="app-inline-contextual-navigation"]'
				)
			);
		}
	}
}
