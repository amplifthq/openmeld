import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpaceNotificationMenu } from "./space-notification-menu";

const state = vi.hoisted(() => ({
	userId: "user-1",
	get: vi.fn(),
	update: vi.fn(),
	openSettings: vi.fn(),
}));
vi.mock("#/lib/organizations/organization-context", () => {
	const context = () => ({
		currentUserId: state.userId,
		currentOrganization: { id: "org-1" },
	});
	return { useAppOrganization: context, useOptionalAppOrganization: context };
});
vi.mock("#/components/inbox/use-inbox-browser-notification-settings", () => ({
	useInboxBrowserNotificationSettings: () => ({ settings: { enabled: false } }),
}));
vi.mock("#/components/settings/use-app-settings", () => ({
	useAppSettings: () => state.openSettings,
}));
vi.mock("#/lib/organizations/inbox", () => ({
	getCurrentInboxMessageNotificationPreferences: state.get,
	updateCurrentInboxMessageNotificationPreferences: state.update,
}));

const DEFAULT_BUTTON_PATTERN = /Conversation notifications: Use default/;
const DEFAULT_PATTERN = /Use default/;
const EMAIL_PATTERN = /Urgent email alerts are controlled in Settings/;
const inherited = {
	organizationId: "org-1",
	spaceId: "space-1",
	defaultMode: "mentions_and_replies",
	overrideMode: null,
	effectiveMode: "mentions_and_replies",
};

describe("Conversation notification menu", () => {
	beforeEach(() => {
		state.userId = "user-1";
		state.get.mockReset().mockResolvedValue(inherited);
		state.update.mockReset();
		state.openSettings.mockReset().mockResolvedValue(undefined);
	});
	afterEach(cleanup);

	it("saves a personal override, resets to live inheritance, and links to browser settings", async () => {
		const queryClient = new QueryClient({
			defaultOptions: {
				queries: { retry: false },
				mutations: { retry: false },
			},
		});
		render(
			<QueryClientProvider client={queryClient}>
				<SpaceNotificationMenu spaceId="space-1" />
			</QueryClientProvider>
		);
		fireEvent.click(
			await screen.findByRole("button", {
				name: DEFAULT_BUTTON_PATTERN,
			})
		);
		expect(
			await screen.findByText("Browser notifications are off in this browser.")
		).toBeTruthy();
		state.update.mockImplementationOnce(() => {
			state.get.mockResolvedValue({
				...inherited,
				overrideMode: "all_messages",
				effectiveMode: "all_messages",
			});
			return Promise.resolve();
		});
		fireEvent.click(
			screen.getByRole("menuitemradio", { name: "All new messages" })
		);
		await waitFor(() =>
			expect(
				screen.getByRole("button", {
					name: "Conversation notifications: All new messages",
				})
			).toBeTruthy()
		);
		expect(state.update).toHaveBeenLastCalledWith({
			organizationId: "org-1",
			preference: {
				scope: "conversation",
				spaceId: "space-1",
				mode: "all_messages",
			},
		});
		state.update.mockImplementationOnce(() => {
			state.get.mockResolvedValue({
				...inherited,
				defaultMode: "all_messages",
				effectiveMode: "all_messages",
			});
			return Promise.resolve();
		});
		fireEvent.click(
			screen.getByRole("menuitemradio", { name: DEFAULT_PATTERN })
		);
		await waitFor(() =>
			expect(
				screen.getByRole("button", {
					name: "Conversation notifications: Use default · All new messages",
				})
			).toBeTruthy()
		);
		expect(state.update).toHaveBeenLastCalledWith({
			organizationId: "org-1",
			preference: { scope: "conversation", spaceId: "space-1", mode: null },
		});
		fireEvent.click(
			screen.getByRole("button", { name: "Open notification settings" })
		);
		expect(state.openSettings).toHaveBeenCalledWith("notifications");
	});

	it("retains the saved choice when muting fails", async () => {
		state.update.mockRejectedValue(new Error("Could not save preference."));
		const queryClient = new QueryClient({
			defaultOptions: {
				queries: { retry: false },
				mutations: { retry: false },
			},
		});
		render(
			<QueryClientProvider client={queryClient}>
				<SpaceNotificationMenu spaceId="space-1" />
			</QueryClientProvider>
		);
		fireEvent.click(
			await screen.findByRole("button", {
				name: DEFAULT_BUTTON_PATTERN,
			})
		);
		fireEvent.click(
			await screen.findByRole("menuitemradio", {
				name: "Mute message notifications",
			})
		);
		expect(await screen.findByText("Could not save preference.")).toBeTruthy();
		expect(
			screen
				.getByRole("menuitemradio", { name: DEFAULT_PATTERN })
				.getAttribute("aria-checked")
		).toBe("true");
		expect(screen.getByText(EMAIL_PATTERN)).toBeTruthy();
	});
});
