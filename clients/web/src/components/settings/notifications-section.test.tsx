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
	let requestPermissionMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
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

	it("requests browser permission only after the user chooses Enable", async () => {
		renderNotificationsSection();

		expect(requestPermissionMock).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Enable" }));

		await waitFor(() => {
			expect(requestPermissionMock).toHaveBeenCalledOnce();
		});
		expect(
			screen
				.getByRole("switch", { name: "Browser notifications" })
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
