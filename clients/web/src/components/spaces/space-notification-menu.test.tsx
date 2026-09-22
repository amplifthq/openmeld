import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	renderHook,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useInboxNotificationSettings } from "#/components/inbox/use-inbox-notification-settings";
import { SpaceNotificationMenu } from "./space-notification-menu";

const state = vi.hoisted(() => ({
	userId: "user-1",
	get: vi.fn(),
	update: vi.fn(),
	openSettings: vi.fn(),
	permission: "default" as NotificationPermission,
	requestPermission: vi.fn<() => Promise<NotificationPermission>>(),
}));
vi.mock("#/lib/organizations/organization-context", () => {
	const context = () => ({
		currentUserId: state.userId,
		currentOrganization: { id: "org-1" },
	});
	return { useAppOrganization: context, useOptionalAppOrganization: context };
});
vi.mock("#/desktop/platform", () => ({
	getDesktopPlatform: () => null,
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
const inherited = {
	organizationId: "org-1",
	spaceId: "space-1",
	defaultMode: "mentions_and_replies",
	overrideMode: null,
	effectiveMode: "mentions_and_replies",
};

describe("Conversation notification menu", () => {
	beforeEach(() => {
		window.localStorage.clear();
		state.permission = "default";
		state.requestPermission.mockReset().mockResolvedValue("granted");
		vi.stubGlobal("Notification", {
			get permission() {
				return state.permission;
			},
			async requestPermission() {
				state.permission = await state.requestPermission();
				return state.permission;
			},
		} satisfies Pick<typeof Notification, "permission" | "requestPermission">);
		state.userId = "user-1";
		state.get.mockReset().mockResolvedValue(inherited);
		state.update.mockReset();
		state.openSettings.mockReset().mockResolvedValue(undefined);
	});
	afterEach(() => {
		cleanup();
		window.localStorage.clear();
		vi.unstubAllGlobals();
	});

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
			screen
				.getByRole("switch", { name: "Browser notifications" })
				.getAttribute("aria-checked")
		).toBe("false");
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

	it("waits for permission and shares the delivery switch with other settings consumers", async () => {
		let finishPermission:
			| ((permission: NotificationPermission) => void)
			| undefined;
		state.requestPermission.mockReturnValue(
			new Promise((resolve) => {
				finishPermission = resolve;
			})
		);
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		render(
			<QueryClientProvider client={queryClient}>
				<SpaceNotificationMenu spaceId="space-1" />
			</QueryClientProvider>
		);
		const otherSettings = renderHook(() =>
			useInboxNotificationSettings("user-1")
		);
		fireEvent.click(
			await screen.findByRole("button", { name: DEFAULT_BUTTON_PATTERN })
		);
		const toggle = screen.getByRole("switch", {
			name: "Browser notifications",
		});
		expect(state.requestPermission).not.toHaveBeenCalled();
		fireEvent.click(toggle);
		expect(state.requestPermission).toHaveBeenCalledOnce();
		expect(toggle.getAttribute("aria-checked")).toBe("false");
		expect(toggle.getAttribute("aria-disabled")).toBe("true");
		await act(() => {
			finishPermission?.("granted");
		});
		await waitFor(() =>
			expect(toggle.getAttribute("aria-checked")).toBe("true")
		);
		expect(otherSettings.result.current.settings?.enabled).toBe(true);
		await act(async () => {
			await otherSettings.result.current.setEnabled(false);
		});
		expect(toggle.getAttribute("aria-checked")).toBe("false");
		fireEvent.click(toggle);
		await waitFor(() =>
			expect(otherSettings.result.current.settings?.enabled).toBe(true)
		);
		fireEvent.click(toggle);
		await waitFor(() =>
			expect(otherSettings.result.current.settings?.enabled).toBe(false)
		);
		expect(state.update).not.toHaveBeenCalled();
	});

	it("keeps the switch off and shows recovery guidance when permission is denied", async () => {
		state.requestPermission.mockResolvedValue("denied");
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		render(
			<QueryClientProvider client={queryClient}>
				<SpaceNotificationMenu spaceId="space-1" />
			</QueryClientProvider>
		);
		fireEvent.click(
			await screen.findByRole("button", { name: DEFAULT_BUTTON_PATTERN })
		);
		fireEvent.click(
			screen.getByRole("switch", { name: "Browser notifications" })
		);
		await screen.findByText(
			"Notifications are blocked. Allow them in your browser’s site settings, then return here."
		);
		const toggle = screen.getByRole("switch", {
			name: "Browser notifications",
		});
		expect(toggle.getAttribute("aria-checked")).toBe("false");
		expect(toggle.getAttribute("aria-disabled")).toBe("true");
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
	});
});
