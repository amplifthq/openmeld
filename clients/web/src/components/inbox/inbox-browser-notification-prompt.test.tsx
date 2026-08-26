import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readInboxBrowserNotificationSettings } from "#/lib/inbox/browser-notifications";
import { InboxBrowserNotificationPrompt } from "./inbox-browser-notification-prompt";

const USER_ID = "user-123";

describe("InboxBrowserNotificationPrompt", () => {
	let requestPermissionMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		window.localStorage.clear();
		requestPermissionMock = vi.fn().mockResolvedValue("granted");
		installNotificationMock({
			permission: "default",
			requestPermissionMock,
		});
	});

	afterEach(() => {
		cleanup();
		window.localStorage.clear();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("explains the value before a user gesture requests browser permission", async () => {
		render(<InboxBrowserNotificationPrompt userId={USER_ID} />);

		expect(
			await screen.findByRole("heading", {
				name: "Stay on top of important work",
			})
		).toBeTruthy();
		expect(requestPermissionMock).not.toHaveBeenCalled();

		fireEvent.click(
			screen.getByRole("button", { name: "Enable notifications" })
		);

		await waitFor(() => {
			expect(requestPermissionMock).toHaveBeenCalledOnce();
			expect(
				screen.queryByRole("heading", {
					name: "Stay on top of important work",
				})
			).toBeNull();
		});
		expect(readInboxBrowserNotificationSettings({ userId: USER_ID })).toEqual({
			enabled: true,
			permission: "granted",
		});
	});

	it("respects Not now for this user in this browser", async () => {
		const firstView = render(
			<InboxBrowserNotificationPrompt userId={USER_ID} />
		);
		await screen.findByRole("heading", {
			name: "Stay on top of important work",
		});

		fireEvent.click(screen.getByRole("button", { name: "Not now" }));

		await waitFor(() => {
			expect(
				screen.queryByRole("heading", {
					name: "Stay on top of important work",
				})
			).toBeNull();
			expect(
				document.querySelector('[data-slot="alert-dialog-portal"]')
			).toBeNull();
		});
		expect(
			window.localStorage.getItem(
				`openmeld.inbox.browser-notifications.prompt-dismissed:${USER_ID}`
			)
		).toBe("dismissed");
		firstView.unmount();
		render(<InboxBrowserNotificationPrompt userId={USER_ID} />);

		await waitFor(() => {
			expect(
				screen
					.queryAllByRole("alertdialog")
					.filter((dialog) => dialog.hasAttribute("data-open"))
			).toHaveLength(0);
		});
		expect(requestPermissionMock).not.toHaveBeenCalled();
	});

	it("does not interrupt users whose browser permission is already decided", () => {
		installNotificationMock({
			permission: "granted",
			requestPermissionMock,
		});

		render(<InboxBrowserNotificationPrompt userId={USER_ID} />);

		expect(
			screen.queryByRole("heading", {
				name: "Stay on top of important work",
			})
		).toBeNull();
		expect(requestPermissionMock).not.toHaveBeenCalled();
	});
});

function installNotificationMock(input: {
	permission: NotificationPermission;
	requestPermissionMock: ReturnType<typeof vi.fn>;
}) {
	const permissionRef = { value: input.permission };
	class TestNotification {
		static get permission(): NotificationPermission {
			return permissionRef.value;
		}

		static async requestPermission(): Promise<NotificationPermission> {
			const permission =
				(await input.requestPermissionMock()) as NotificationPermission;
			permissionRef.value = permission;
			return permission;
		}

		onclick: (() => void) | null = null;

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
