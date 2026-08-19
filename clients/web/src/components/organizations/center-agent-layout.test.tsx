import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveCenterAgentSectionId } from "#/lib/organizations/center-agent-navigation";
import { CenterAgentLayout } from "./center-agent-layout";
import { CenterAgentRoutePendingPage } from "./center-agent-route-pending";

const appOuterRailSpy = vi.hoisted(() => vi.fn());
const contextualNavSpy = vi.hoisted(() => vi.fn());

vi.mock("#/components/app/app-global-controls", () => ({
	AppGlobalControls: () => <div data-testid="global-controls" />,
}));

vi.mock("#/components/app/app-outer-rail", () => ({
	AppOuterRail: (props: unknown) => {
		appOuterRailSpy(props);
		return <aside data-slot="app-outer-rail" />;
	},
}));

vi.mock("#/components/app/app-inner-sidebar", () => ({
	AppInnerSidebar: ({ children }: { children: ReactNode }) => (
		<aside>{children}</aside>
	),
}));

vi.mock("#/components/app/app-contextual-layout", () => ({
	AppContextualSidebarNav: (props: { title: string }) => {
		contextualNavSpy(props);
		return <nav aria-label={props.title} />;
	},
}));

vi.mock("#/components/app/app-shell-account", () => ({
	useAppShellAccount: () => ({
		email: "felix@example.com",
		image: null,
		name: "Felix",
	}),
}));

vi.mock("#/components/app/use-computer-attention-tone", () => ({
	useComputerAttentionTone: () => null,
}));

afterEach(cleanup);

describe("CenterAgentLayout", () => {
	it("keeps Tasks beside Chat in the Center Agent work navigation", () => {
		contextualNavSpy.mockReset();
		const rendered = render(
			<CenterAgentLayout organizationSlug="acme">
				<div>Organization Center Agent</div>
			</CenterAgentLayout>
		);

		expect(resolveLastContextualItems()).toEqual([
			["Chat", "/o/acme/center-agent/chat"],
			["Tasks", "/o/acme/center-agent/tasks"],
			["Routines", "/o/acme/center-agent/routines"],
			["Skills", "/o/acme/center-agent/skills"],
			["Channels", "/o/acme/center-agent/channels"],
			["Apps", "/o/acme/center-agent/apps"],
			["Memory", "/o/acme/center-agent/memory"],
			["Center Agent settings", "/o/acme/center-agent/settings"],
		]);
		expect(resolveLastContextualGroupLabels()).toEqual([
			"Work",
			"Capabilities",
			"Manage",
		]);
		rendered.rerender(
			<CenterAgentLayout organizationSlug="felix">
				<div>Personal Center Agent</div>
			</CenterAgentLayout>
		);
		expect(resolveLastContextualItems()).toEqual([
			["Chat", "/o/felix/center-agent/chat"],
			["Tasks", "/o/felix/center-agent/tasks"],
			["Routines", "/o/felix/center-agent/routines"],
			["Skills", "/o/felix/center-agent/skills"],
			["Channels", "/o/felix/center-agent/channels"],
			["Apps", "/o/felix/center-agent/apps"],
			["Memory", "/o/felix/center-agent/memory"],
			["Center Agent settings", "/o/felix/center-agent/settings"],
		]);
		expect(
			resolveCenterAgentSectionId(
				"/o/felix/center-agent/apps/google-drive/connections"
			)
		).toBe("apps");
		expect(
			resolveCenterAgentSectionId("/o/felix/center-agent/tasks/task-123")
		).toBe("tasks");
		expect(
			resolveCenterAgentSectionId("/o/center-agent/center-agent/memory")
		).toBe("memory");
	});

	it("never mounts the Spaces secondary sidebar during pending-to-ready rendering", async () => {
		appOuterRailSpy.mockReset();
		const queryClient = new QueryClient();
		const initialOuterSidebarState = {
			tier: "full" as const,
			width: "10.5rem",
		};
		const host = document.createElement("div");
		document.body.appendChild(host);
		const secondarySidebarMounts: Element[] = [];
		const observer = new MutationObserver((records) => {
			recordSpacesSecondarySidebarMounts(records, secondarySidebarMounts);
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
		recordSpacesSecondarySidebarMounts(
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
				<CenterAgentLayout
					initialOuterSidebarState={initialOuterSidebarState}
					organizationSlug="acme"
				>
					<div>Center Agent ready</div>
				</CenterAgentLayout>
			</QueryClientProvider>
		);
		await act(async () => undefined);
		recordSpacesSecondarySidebarMounts(
			observer.takeRecords(),
			secondarySidebarMounts
		);
		observer.disconnect();

		expect(
			host.querySelector('[data-slot="center-agent-layout"]')
		).toBeTruthy();
		expect(screen.getByText("Center Agent ready")).toBeTruthy();
		expect(secondarySidebarMounts).toEqual([]);
		expect(appOuterRailSpy).toHaveBeenCalledWith(
			expect.objectContaining({ initialState: initialOuterSidebarState })
		);
	});
});

function resolveLastContextualItems(): [string, string][] {
	const props = contextualNavSpy.mock.calls.at(-1)?.[0] as
		| {
				groups: readonly {
					items: readonly { label: string; to: string }[];
				}[];
		  }
		| undefined;
	return (
		props?.groups.flatMap((group) =>
			group.items.map((item) => [item.label, item.to] as [string, string])
		) ?? []
	);
}

function resolveLastContextualGroupLabels(): string[] {
	const props = contextualNavSpy.mock.calls.at(-1)?.[0] as
		| { groups: readonly { label: string }[] }
		| undefined;
	return props?.groups.map((group) => group.label) ?? [];
}

function recordSpacesSecondarySidebarMounts(
	records: readonly MutationRecord[],
	mounts: Element[]
): void {
	for (const record of records) {
		for (const node of record.addedNodes) {
			if (!(node instanceof Element)) {
				continue;
			}
			if (node.matches('nav[aria-label="Spaces"]')) {
				mounts.push(node);
			}
			mounts.push(...node.querySelectorAll('nav[aria-label="Spaces"]'));
		}
	}
}
