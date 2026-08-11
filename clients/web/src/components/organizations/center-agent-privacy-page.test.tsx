import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppOrganizationProvider } from "#/lib/organizations/organization-context";
import { CenterAgentPrivacyPage } from "./center-agent-privacy-page";

const readLocalRuntimesMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/connect/local-runtimes", () => ({
	readCurrentLocalRuntimeReplyReadiness: vi.fn(),
	readLocalRuntimes: readLocalRuntimesMock,
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		search,
		to,
		...props
	}: {
		"aria-label"?: string;
		children: ReactNode;
		search?: { focus?: string };
		to: string;
	}) => {
		const focus = search?.focus;
		return (
			<a href={focus ? `${to}?focus=${focus}` : to} {...props}>
				{children}
			</a>
		);
	},
}));

describe("CenterAgentPrivacyPage", () => {
	beforeEach(() => {
		readLocalRuntimesMock.mockResolvedValue(createLocalRuntimes());
	});

	it("makes personal memory and Computer file access easy to find", async () => {
		const queryClient = new QueryClient({
			defaultOptions: {
				mutations: { retry: false },
				queries: { retry: false },
			},
		});
		render(
			<QueryClientProvider client={queryClient}>
				<AppOrganizationProvider
					scope={{
						access: "authorized",
						account: {
							email: "mira@example.com",
							image: null,
							name: "Mira",
						},
						activeOrganization: {
							id: "org-acme",
							name: "Acme",
							slug: "acme",
						},
						currentOrganization: {
							id: "org-acme",
							name: "Acme",
							slug: "acme",
						},
						currentUserId: "user-1",
						organizations: [
							{
								id: "org-acme",
								name: "Acme",
								slug: "acme",
							},
						],
						storageScope: "test-scope",
					}}
				>
					<CenterAgentPrivacyPage />
				</AppOrganizationProvider>
			</QueryClientProvider>
		);

		const pageHeading = screen.getByRole("heading", {
			name: "Privacy & Safety",
		});
		expect(screen.getByText("Personal")).toBeTruthy();
		expect(pageHeading.tagName).toBe("H1");
		expect(pageHeading.closest('[data-slot="app-page-header"]')).toBeTruthy();
		expect(
			screen
				.getByRole("link", { name: "Open Center Agent Memory" })
				.getAttribute("href")
		).toBe("/o/acme/center-agent/memory");
		expect(screen.queryByRole("button", { name: "Erase memory" })).toBeNull();
		const memoryCard = screen
			.getByRole("heading", { name: "Center Agent memory" })
			.closest("section");
		expect(memoryCard?.className).toContain("rounded-md");
		expect(memoryCard?.className).toContain("bg-card");

		expect(
			await screen.findByRole("heading", { name: "Computer file access" })
		).toBeTruthy();
		expect(
			screen.getByText(
				"Choose which folders OpenMeld-started local agents can use on each of your computers."
			)
		).toBeTruthy();
		expect(
			(
				await screen.findByRole("link", {
					name: "Manage file access on Office Mac mini",
				})
			).getAttribute("href")
		).toBe("/o/acme/computers/device-office?focus=file-access");
		expect(
			screen.queryByRole("link", {
				name: "Manage file access on Travel MacBook",
			})
		).toBeNull();
		expect(screen.getByText("Travel MacBook")).toBeTruthy();
		expect(
			screen.getByText("Open OpenMeld on this computer to manage")
		).toBeTruthy();
	});
});

function createLocalRuntimes() {
	return {
		currentDeviceId: "device-office",
		currentRuntimeLane: "prod",
		localRuntimes: [
			createComputer({
				deviceDisplayName: "Office Mac mini",
				deviceId: "device-office",
				isCurrent: true,
			}),
			createComputer({
				deviceDisplayName: "Travel MacBook",
				deviceId: "device-travel",
				isCurrent: false,
			}),
		],
	};
}

function createComputer(input: {
	deviceDisplayName: string;
	deviceId: string;
	isCurrent: boolean;
}) {
	return {
		computerFileAccess: { readPolicy: true, updatePolicy: true },
		deviceDisplayName: input.deviceDisplayName,
		deviceDisplayNameSource: "observed",
		deviceId: input.deviceId,
		deviceType: "laptop",
		executionTargets: [],
		firstSeenAtMs: 1_700_000_000_000,
		isCurrent: input.isCurrent,
		lastObservedAtMs: 1_700_000_020_000,
		osVersion: "15.4",
		platformFamily: "macOS",
	};
}
