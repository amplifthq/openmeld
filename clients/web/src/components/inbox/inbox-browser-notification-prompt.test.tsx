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
	let notificationPermissionRef: { value: NotificationPermission };
	let notificationPermissionStatus: TestPermissionStatus;
	let permissionsQueryMock: ReturnType<typeof vi.fn>;
	let requestPermissionMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		window.localStorage.clear();
		requestPermissionMock = vi.fn().mockResolvedValue("granted");
		notificationPermissionRef = installNotificationMock({
			permission: "default",
			requestPermissionMock,
		});
		notificationPermissionStatus = new TestPermissionStatus("prompt");
		permissionsQueryMock = vi
			.fn()
			.mockResolvedValue(notificationPermissionStatus);
		Object.defineProperty(navigator, "permissions", {
			configurable: true,
			value: { query: permissionsQueryMock },
		});
	});

	afterEach(() => {
		cleanup();
		window.localStorage.clear();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("closes when browser permission is granted outside the dialog", async () => {
		render(<InboxBrowserNotificationPrompt userId={USER_ID} />);

		expect(
			await screen.findByRole("heading", {
				name: "Stay on top of important work",
			})
		).toBeTruthy();
		await waitFor(() => {
			expect(permissionsQueryMock).toHaveBeenCalledWith({
				name: "notifications",
			});
		});

		notificationPermissionRef.value = "granted";
		notificationPermissionStatus.setState("granted");

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
			soundEnabled: true,
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

	it("offers an explicit close button that remembers dismissal", async () => {
		render(<InboxBrowserNotificationPrompt userId={USER_ID} />);
		await screen.findByRole("heading", {
			name: "Stay on top of important work",
		});

		fireEvent.click(
			screen.getByRole("button", { name: "Close notification setup" })
		);

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
	return permissionRef;
}

class TestPermissionStatus extends EventTarget {
	state: PermissionState;

	constructor(state: PermissionState) {
		super();
		this.state = state;
	}

	setState(state: PermissionState) {
		this.state = state;
		this.dispatchEvent(new Event("change"));
	}
}
