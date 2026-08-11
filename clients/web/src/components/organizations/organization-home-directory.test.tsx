import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { startQueryKeys } from "#/query/query-keys";
import { OrganizationHomeDirectory } from "./organization-home-directory";

const readCurrentOrganizationDirectoryMock = vi.hoisted(() => vi.fn());
const readLocalRuntimesMock = vi.hoisted(() => vi.fn());

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

vi.mock("#/components/profiles/dither-profile-avatar", () => ({
	DitherProfileAvatar: ({ profileName }: { profileName: string }) => (
		<span data-profile-name={profileName} />
	),
}));

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		currentOrganization: {
			id: "organization-1",
			name: "Amplift",
			slug: "amplift",
		},
		currentUserId: "user-1",
		storageScope: "user-1",
	}),
}));

vi.mock(
	"#/lib/organizations/organization-directory",
	async (importOriginal) => ({
		...(await importOriginal()),
		readCurrentOrganizationDirectory: readCurrentOrganizationDirectoryMock,
	})
);

vi.mock("#/lib/connect/local-runtimes", async (importOriginal) => ({
	...(await importOriginal()),
	readLocalRuntimes: readLocalRuntimesMock,
}));

describe("OrganizationHomeDirectory", () => {
	beforeEach(() => {
		readCurrentOrganizationDirectoryMock
			.mockReset()
			.mockResolvedValue(createDirectory());
		readLocalRuntimesMock.mockReset().mockResolvedValue(createLocalRuntimes());
	});

	afterEach(cleanup);

	it("keeps People and Agents visible when the Directory refresh fails", async () => {
		const { queryClient } = renderDirectory();

		expect(await screen.findByRole("heading", { name: "Team" })).toBeTruthy();
		expect(await screen.findByText("Felix Lee")).toBeTruthy();
		expect(screen.getByText("Scout")).toBeTruthy();

		readCurrentOrganizationDirectoryMock.mockRejectedValue(
			new Error("Directory refresh failed.")
		);
		await queryClient.refetchQueries({
			queryKey: organizationQueryKeys.directory("organization-1"),
		});

		expect(
			await screen.findByText("Team details may be out of date.")
		).toBeTruthy();
		expect(screen.getByText("Felix Lee")).toBeTruthy();
		expect(screen.getByText("Scout")).toBeTruthy();
		expect(screen.queryByText("No Computers yet")).toBeNull();

		readCurrentOrganizationDirectoryMock.mockResolvedValue(createDirectory());
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));

		await waitFor(() =>
			expect(screen.queryByText("Team details may be out of date.")).toBeNull()
		);
	});

	it("keeps Computers visible when their runtime refresh fails", async () => {
		const { queryClient } = renderDirectory();

		expect(await screen.findByText("Felix’s Mac")).toBeTruthy();

		readLocalRuntimesMock.mockRejectedValue(
			new Error("Computer refresh failed.")
		);
		await queryClient.refetchQueries({
			queryKey: startQueryKeys.localRuntimes("user-1"),
		});

		expect(
			await screen.findByText("Team details may be out of date.")
		).toBeTruthy();
		expect(screen.getByText("Felix’s Mac")).toBeTruthy();

		readLocalRuntimesMock.mockResolvedValue(createLocalRuntimes());
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));

		await waitFor(() =>
			expect(screen.queryByText("Team details may be out of date.")).toBeNull()
		);
	});
});

function renderDirectory() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return {
		queryClient,
		...render(
			<QueryClientProvider client={queryClient}>
				<OrganizationHomeDirectory />
			</QueryClientProvider>
		),
	};
}

function createDirectory() {
	return {
		agentProfiles: [
			{
				managedRole: null,
				ownerUserId: "user-1",
				profileId: "agent-1",
				profileName: "Scout",
				readiness: {
					routeDeviceId: "device-1",
					runtimeDeviceDisplayName: "Felix’s Mac",
				},
				status: "active",
			},
		],
		generatedAt: "2026-08-10T00:00:00.000Z",
		members: [
			{
				humanProfile: { profileId: "human-1" },
				memberId: "member-1",
				role: "owner",
				user: {
					email: "felix@example.com",
					id: "user-1",
					image: null,
					name: "Felix Lee",
				},
				userId: "user-1",
			},
		],
		organizationId: "organization-1",
	};
}

function createLocalRuntimes() {
	return {
		currentDeviceId: "device-1",
		currentRuntimeLane: "prod",
		localRuntimes: [
			{
				deviceDisplayName: "Felix’s Mac",
				deviceId: "device-1",
				executionTargets: [],
			},
		],
	};
}
