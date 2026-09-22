import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inboxQueryKeys } from "#/query/organizations/inbox";
import { NotificationsSection } from "./notifications-section";

const getCurrentInboxNotificationPreferencesMock = vi.hoisted(() => vi.fn());
const updateCurrentInboxNotificationPreferencesMock = vi.hoisted(() => vi.fn());
const getMessagePreferencesMock = vi.hoisted(() => vi.fn());
const updateMessagePreferencesMock = vi.hoisted(() => vi.fn());
const ALL_MESSAGES_PATTERN = /All new messages/;
const MENTIONS_PATTERN = /Mentions and replies/;
const EXAMPLE_PATTERN = /Example requested/;
const desktopPlatformMock = vi.hoisted(() => vi.fn());
vi.mock("#/desktop/platform", () => ({
	getDesktopPlatform: desktopPlatformMock,
}));

const ACCOUNT_EMAIL_PATTERN = /felix@amplift\.ai/;

vi.mock("#/components/app/app-shell-account", () => ({
	useAppShellAccount: () => ({
		email: "felix@amplift.ai",
		name: "Felix",
	}),
}));

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		currentOrganization: {
			id: "organization-123",
			name: "Amplift",
			slug: "amplift",
		},
		currentUserId: "user-123",
	}),
}));

vi.mock("#/lib/organizations/inbox", () => ({
	getCurrentInboxMessageNotificationPreferences: getMessagePreferencesMock,
	updateCurrentInboxMessageNotificationPreferences:
		updateMessagePreferencesMock,
	getCurrentInboxNotificationPreferences:
		getCurrentInboxNotificationPreferencesMock,
	getCurrentInboxSummary: vi.fn(),
	listCurrentInboxItems: vi.fn(),
	markAllCurrentInboxItemsRead: vi.fn(),
	markCurrentInboxItemRead: vi.fn(),
	updateCurrentInboxNotificationPreferences:
		updateCurrentInboxNotificationPreferencesMock,
}));

describe("NotificationsSection", () => {
	it("shows Desktop delivery and a native test without requesting browser permission", async () => {
		const testNotification = vi.fn().mockResolvedValue("delivered");
		desktopPlatformMock.mockReturnValue({ testNotification });
		renderNotificationsSection();
		expect(
			screen
				.getByRole("switch", { name: "Desktop notifications" })
				.getAttribute("aria-checked")
		).toBe("true");
		expect(
			screen.queryByRole("switch", { name: "Browser notifications" })
		).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Show an example" }));
		await waitFor(() =>
			expect(testNotification).toHaveBeenCalledWith({
				userId: "user-123",
				soundEnabled: true,
			})
		);
		expect(requestPermissionMock).not.toHaveBeenCalled();
	});
	let requestPermissionMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		getMessagePreferencesMock.mockReset().mockResolvedValue({
			organizationId: "organization-123",
			spaceId: null,
			defaultMode: "mentions_and_replies",
			overrideMode: null,
			effectiveMode: "mentions_and_replies",
		});
		updateMessagePreferencesMock.mockReset().mockImplementation(() => {
			const response = {
				organizationId: "organization-123",
				spaceId: null,
				defaultMode: "all_messages",
				overrideMode: null,
				effectiveMode: "all_messages",
			};
			getMessagePreferencesMock.mockResolvedValue(response);
			return Promise.resolve(response);
		});
		desktopPlatformMock.mockReset().mockReturnValue(null);

		window.localStorage.clear();
		requestPermissionMock = vi.fn().mockResolvedValue("granted");
		installNotificationMock(requestPermissionMock);
		getCurrentInboxNotificationPreferencesMock.mockReset().mockResolvedValue({
			updatedAt: null,
			urgentEmailEnabled: true,
		});
		updateCurrentInboxNotificationPreferencesMock
			.mockReset()
			.mockImplementation(async (input: { urgentEmailEnabled: boolean }) => ({
				updatedAt: "2026-08-04T02:00:00.000Z",
				urgentEmailEnabled: input.urgentEmailEnabled,
			}));
	});

	afterEach(() => {
		cleanup();
		window.localStorage.clear();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("requests browser permission only after the user turns notifications on", async () => {
		renderNotificationsSection();

		expect(requestPermissionMock).not.toHaveBeenCalled();
		fireEvent.click(
			screen.getByRole("switch", { name: "Browser notifications" })
		);

		await waitFor(() => {
			expect(requestPermissionMock).toHaveBeenCalledOnce();
		});
		expect(
			screen
				.getByRole("switch", { name: "Browser notifications" })
				.getAttribute("aria-checked")
		).toBe("true");
	});

	it("saves the account message default independently and exposes the enabled example", async () => {
		renderNotificationsSection();
		expect(
			screen
				.getByRole("button", { name: "Show an example" })
				.hasAttribute("disabled")
		).toBe(true);
		fireEvent.click(
			await screen.findByRole("radio", { name: ALL_MESSAGES_PATTERN })
		);
		await waitFor(() =>
			expect(updateMessagePreferencesMock).toHaveBeenCalledWith({
				organizationId: "organization-123",
				preference: { scope: "account", mode: "all_messages" },
			})
		);
		await waitFor(() =>
			expect(
				screen
					.getByRole("radio", { name: ALL_MESSAGES_PATTERN })
					.getAttribute("aria-checked")
			).toBe("true")
		);
		expect(
			updateCurrentInboxNotificationPreferencesMock
		).not.toHaveBeenCalled();
		fireEvent.click(
			screen.getByRole("switch", { name: "Browser notifications" })
		);
		await waitFor(() =>
			expect(
				screen
					.getByRole("button", { name: "Show an example" })
					.hasAttribute("disabled")
			).toBe(false)
		);
		fireEvent.click(screen.getByRole("button", { name: "Show an example" }));
		expect(screen.getByText(EXAMPLE_PATTERN)).toBeTruthy();
	});

	it("keeps the confirmed default and shows a save failure", async () => {
		updateMessagePreferencesMock.mockRejectedValue(
			new Error("Could not save notification preferences.")
		);
		renderNotificationsSection();
		fireEvent.click(
			await screen.findByRole("radio", { name: ALL_MESSAGES_PATTERN })
		);
		expect(
			await screen.findByText("Could not save notification preferences.")
		).toBeTruthy();
		expect(
			screen
				.getByRole("radio", { name: MENTIONS_PATTERN })
				.getAttribute("aria-checked")
		).toBe("true");
	});

	it("lets the user turn urgent email alerts off for their account email", async () => {
		renderNotificationsSection();

		expect(screen.getByText(ACCOUNT_EMAIL_PATTERN)).toBeTruthy();
		const emailSwitch = screen.getByRole("switch", {
			name: "Urgent email alerts",
		});
		expect(emailSwitch.getAttribute("aria-checked")).toBe("true");

		fireEvent.click(emailSwitch);

		await waitFor(() => {
			expect(
				updateCurrentInboxNotificationPreferencesMock
			).toHaveBeenCalledWith({
				organizationId: "organization-123",
				urgentEmailEnabled: false,
			});
		});
	});

	it("lets the user turn OpenMeld notification sounds off on this device", async () => {
		renderNotificationsSection();
		const soundSwitch = screen.getByRole("switch", {
			name: "Play OpenMeld sounds",
		});
		expect(soundSwitch.getAttribute("aria-checked")).toBe("true");

		fireEvent.click(soundSwitch);

		await waitFor(() => {
			expect(soundSwitch.getAttribute("aria-checked")).toBe("false");
		});
		expect(
			window.localStorage.getItem(
				"openmeld.inbox.browser-notification-sounds.enabled:user-123"
			)
		).toBe("disabled");
	});
});

function renderNotificationsSection() {
	const queryClient = new QueryClient({
		defaultOptions: {
			mutations: { retry: false },
			queries: { retry: false },
		},
	});
	queryClient.setQueryData(inboxQueryKeys.preferences("user-123"), {
		updatedAt: null,
		urgentEmailEnabled: true,
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<NotificationsSection />
		</QueryClientProvider>
	);
}

function installNotificationMock(
	requestPermissionMock: ReturnType<typeof vi.fn>
) {
	const permissionRef: { value: NotificationPermission } = { value: "default" };
	class TestNotification {
		static get permission(): NotificationPermission {
			return permissionRef.value;
		}

		static async requestPermission(): Promise<NotificationPermission> {
			const permission =
				(await requestPermissionMock()) as NotificationPermission;
			permissionRef.value = permission;
			return permission;
		}

		onclick: (() => void) | null = null;

		constructor(_title: string, _options?: NotificationOptions) {
			return;
		}

		close() {
			return;
		}
	}

	Object.defineProperty(window, "Notification", {
		configurable: true,
		value: TestNotification,
	});
	vi.stubGlobal("Notification", TestNotification);
}
