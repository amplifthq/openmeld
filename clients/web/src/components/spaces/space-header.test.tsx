import type {
	GetSpaceStatusResponse,
	SpaceAccessMode,
} from "@openmeld/schemas/types";
import {
	buildPublicSpaceEntryUrl,
	OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
} from "@openmeld/space";
import { TooltipProvider } from "@openmeld/ui/components/tooltip";
import { SparkleIcon } from "@phosphor-icons/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	PUBLIC_SPACE_ACCESS_DESCRIPTION,
	PUBLIC_SPACE_ACCESS_WARNING_TOOLTIP,
} from "./space-access-editor";
import { SpaceHeader, SpaceWindowHeader } from "./space-header";
import { SetupRecallButton } from "./space-onboarding-banner";

const JOINED_AS_LABEL_TEXT = /Joined as/;
const DELETE_CONFIRMATION_LABEL_TEXT = /Type DELETE to confirm/i;
const PASSWORD_TO_JOIN_LABEL_TEXT = /Password to join/;
const SHARE_PUBLIC_MODE_LABEL_TEXT = /Anyone can view and join/i;
const SHARE_JOIN_PASSWORD_MODE_LABEL_TEXT =
	/Anyone can view, password to join/i;
const SET_SPACE_PASSWORD_LABEL_TEXT = /Set Space password/;
const NEW_SPACE_PASSWORD_LABEL_TEXT = /New Space password/;
const REMOVE_PASSWORD_WARNING_TEXT = /Space password will be removed/i;

const { toastMock } = vi.hoisted(() => ({
	toastMock: Object.assign(vi.fn(), {
		error: vi.fn(),
		success: vi.fn(),
	}),
}));

vi.mock("sonner", () => ({
	toast: toastMock,
}));

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => vi.fn(),
	useRouterState: (input: {
		select: (state: { location: { pathname: string } }) => string;
	}) => input.select({ location: { pathname: "/app/spaces/space-123" } }),
}));

describe("SpaceHeader", () => {
	const clipboardWriteTextMock = vi.fn<(value: string) => Promise<void>>();
	const scrollIntoViewMock = vi.fn();

	beforeEach(() => {
		clipboardWriteTextMock.mockReset().mockResolvedValue(undefined);
		scrollIntoViewMock.mockReset();
		toastMock.mockReset();
		toastMock.error.mockReset();
		toastMock.success.mockReset();
		Object.defineProperty(window.navigator, "clipboard", {
			configurable: true,
			value: {
				writeText: clipboardWriteTextMock,
			},
		});
		Object.defineProperty(document, "execCommand", {
			configurable: true,
			value: undefined,
		});
		Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
			configurable: true,
			value: scrollIntoViewMock,
		});
	});

	afterEach(() => {
		cleanup();
		Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
		vi.unstubAllGlobals();
	});

	it("keeps setup commands out of the main header", () => {
		const { container } = render(createSpaceHeader());

		expect(
			screen.queryByText("npx -y openmeld@latest space join space-123")
		).toBeNull();
		expect(
			container
				.querySelector("header")
				?.classList.contains("h-[var(--space-conversation-header-height)]")
		).toBe(true);
		expect(screen.getByRole("button", { name: "Space settings" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Members" })).toBeTruthy();
		expect(
			screen.getByRole("heading", { level: 1, name: "Design Room" })
		).toBeTruthy();
	});

	it("can render only header content for the shared app main frame", () => {
		const { container } = render(createSpaceHeader({ renderFrame: false }));

		expect(container.querySelector("header")).toBeNull();
		expect(
			screen.getByRole("heading", { level: 1, name: "Design Room" })
		).toBeTruthy();
	});

	it("preserves caller-owned padding outside the authenticated Space frame", () => {
		render(<SpaceWindowHeader contentClassName="px-0" title="Public space" />);

		const title = screen.getByRole("heading", {
			level: 1,
			name: "Public space",
		});
		const frame = title.parentElement?.parentElement;

		expect(frame?.className).toContain("px-0");
		expect(frame?.className).not.toContain("px-4");
		expect(frame?.className).not.toContain(
			"px-[var(--app-page-inline-padding)]"
		);
	});

	it("aligns the Space view control with the leading icon below the title", () => {
		render(
			createSpaceHeader({
				viewControl: <div data-testid="space-view-control">Views</div>,
			})
		);

		const viewControl = screen.getByTestId("space-view-control");
		const navigationRow = viewControl.closest(
			'[data-slot="space-window-header-navigation"]'
		);
		const titleRow = screen
			.getByRole("heading", { level: 1, name: "Design Room" })
			.closest('[data-slot="space-window-header-title"]');
		const secondaryRow = navigationRow?.closest(
			'[data-slot="space-window-header-secondary"]'
		);
		const inlineFrame = titleRow?.parentElement;

		expect(inlineFrame).toBeTruthy();
		expect(inlineFrame?.className).not.toContain("px-4");
		expect(inlineFrame?.className).toContain(
			"px-[var(--app-page-inline-padding)]"
		);
		expect(viewControl.closest("header")).not.toBeNull();
		expect(navigationRow).not.toBeNull();
		expect(secondaryRow?.className).toContain("overflow-visible");
		expect(inlineFrame?.className).toContain(
			"grid-rows-[minmax(0,var(--space-conversation-title-height))_minmax(0,var(--space-conversation-navigation-height))]"
		);
		expect(secondaryRow?.className).toContain("col-start-1");
		expect(titleRow).not.toBeNull();
		expect(titleRow?.className).toContain("col-start-2");
		expect(within(titleRow as HTMLElement).getByText("Public")).toBeTruthy();
		expect(
			within(titleRow as HTMLElement).queryByTestId("space-live-status")
		).toBeNull();
	});

	it("only shows live connection problems and keeps manual reconnect available", () => {
		const onReconnectLiveUpdates = vi.fn();
		const view = render(
			createSpaceHeader({ liveState: "connecting", onReconnectLiveUpdates })
		);
		expect(screen.queryByTestId("space-live-status")).toBeNull();
		view.rerender(
			createSpaceHeader({ liveState: "degraded", onReconnectLiveUpdates })
		);
		expect(screen.getByText("Reconnecting…")).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: "Reconnect live updates now" })
		);
		expect(onReconnectLiveUpdates).toHaveBeenCalledOnce();
		view.rerender(
			createSpaceHeader({ liveState: "stale", onReconnectLiveUpdates })
		);
		expect(screen.getByText("Syncing…")).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "Reconnect live updates now" })
		).toBeNull();
		view.rerender(
			createSpaceHeader({ liveState: "connected", onReconnectLiveUpdates })
		);
		expect(screen.queryByTestId("space-live-status")).toBeNull();
	});

	it("renders space actions without the old app navigation tabs", () => {
		render(createSpaceHeader());

		expect(screen.queryByRole("tablist")).toBeNull();
		const notificationButton = screen.getByRole("button", {
			name: "Notifications",
		});
		const shareButton = screen.getByRole("button", { name: "Share space" });
		const membersButton = screen.getByRole("button", { name: "Members" });
		const spaceInformationButton = screen.getByRole("button", {
			name: "Space settings",
		});
		const primaryActions = membersButton.closest(
			'[data-slot="space-header-primary-actions"]'
		);

		expect(shareButton.getAttribute("data-slot")).toBe("tooltip-trigger");
		expect(spaceInformationButton.getAttribute("data-slot")).toBe(
			"tooltip-trigger"
		);
		expect(primaryActions).not.toBeNull();
		expect(primaryActions?.className).toContain("gap-1");
		expect(spaceInformationButton.className).toContain("size-7");
		expect(spaceInformationButton.className).toContain("hover:bg-muted");
		expect(spaceInformationButton.className).not.toContain("border-border");
		expect(spaceInformationButton.className).not.toContain("bg-background");
		expect(notificationButton.compareDocumentPosition(membersButton)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
		expect(membersButton.compareDocumentPosition(shareButton)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
		expect(shareButton.compareDocumentPosition(spaceInformationButton)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
	});

	it("places viewer access beside the title instead of the tabs", () => {
		render(
			createSpaceHeader({
				directMessageOwnerVisibilityLabel: "Mira can view",
				memberCount: 2,
				spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
			})
		);

		const directMessageLabel = screen.getByText("Mira can view");
		const titleRow = directMessageLabel.closest(
			'[data-slot="space-window-header-title"]'
		);

		expect(titleRow).not.toBeNull();
		expect(titleRow?.textContent).toContain("Mira can view");
		expect(screen.queryByText("Local Agent")).toBeNull();
		expect(screen.queryByText("Direct Message")).toBeNull();
		expect(screen.queryByText("2 members")).toBeNull();
		expect(screen.queryByText("1 human live")).toBeNull();
		expect(screen.queryByTestId("space-public-access-warning")).toBeNull();
	});

	it("does not label degraded Direct Message origin Spaces as current Direct Messages", () => {
		render(
			createSpaceHeader({
				memberCount: 3,
				spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
			})
		);

		expect(screen.queryByText("Direct Message")).toBeNull();
	});

	it("places the setup recall action before Members in the header actions", () => {
		const onRecall = vi.fn();
		render(
			createSpaceHeader({
				setupRecallAction: <SetupRecallButton onClick={onRecall} />,
				viewControl: <div data-testid="space-view-control">Views</div>,
			})
		);

		const recallButton = screen.getByRole("button", { name: "Get set up" });
		const membersButton = screen.getByRole("button", { name: "Members" });
		const primaryActions = recallButton.closest(
			'[data-slot="space-header-primary-actions"]'
		);
		const recallAction = recallButton.closest(
			'[data-slot="space-header-setup-recall-action"]'
		);
		const secondaryRow = screen
			.getByTestId("space-view-control")
			.closest('[data-slot="space-window-header-secondary"]');

		expect(primaryActions).not.toBeNull();
		expect(recallAction?.className).toContain("max-lg:absolute");
		expect(recallAction?.className).toContain(
			"max-lg:h-[var(--space-conversation-navigation-height)]"
		);
		expect(secondaryRow?.className).toContain("max-lg:pr-12");
		expect(recallButton.className).toContain("h-7");
		expect(recallButton.className).toContain("max-lg:min-h-11");
		expect(recallButton.className).toContain("max-lg:min-w-11");
		expect(recallButton.getAttribute("aria-label")).toBe("Get set up");
		expect(within(recallButton).getByText("Get set up").className).toContain(
			"hidden"
		);
		expect(within(recallButton).getByText("Get set up").className).toContain(
			"sm:inline"
		);
		expect(recallButton.compareDocumentPosition(membersButton)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);

		fireEvent.click(recallButton);
		expect(onRecall).toHaveBeenCalledOnce();
	});

	it("marks public Spaces with an amber warning label and hover detail", async () => {
		render(createSpaceHeader());

		const publicAccessWarning = screen.getByTestId(
			"space-public-access-warning"
		);
		expect(publicAccessWarning.textContent).toBe("Public");
		expect(publicAccessWarning.className).toContain("text-amber-600");
		expect(publicAccessWarning.className).toContain("dark:text-amber-400");
		expect(publicAccessWarning.querySelector("svg")).toBeTruthy();
		expect(publicAccessWarning.className).toContain("inline-flex");
		expect(within(publicAccessWarning).getByText("Public").className).toContain(
			"hidden"
		);
		expect(within(publicAccessWarning).getByText("Public").className).toContain(
			"sm:inline"
		);

		fireEvent.mouseEnter(publicAccessWarning);

		await waitFor(() => {
			expect(
				screen.getByText(PUBLIC_SPACE_ACCESS_WARNING_TOOLTIP)
			).toBeTruthy();
		});
	});

	it("does not expose the Web profile as Space metadata", () => {
		render(createSpaceHeader({ currentProfileName: "Codex" }));

		expect(screen.queryByText(JOINED_AS_LABEL_TEXT)).toBeNull();
		expect(screen.queryByText("Codex")).toBeNull();
		expect(screen.queryByText("1 other profile also joined")).toBeNull();
	});

	it("uses a decorative Space icon instead of a redundant back control", () => {
		const { container } = render(createSpaceHeader());

		expect(screen.queryByRole("button", { name: "Go back" })).toBeNull();
		expect(
			container.querySelector('[data-space-header-icon="channel"]')
		).toBeTruthy();
	});

	it("opens space information with the space id and CLI join command", () => {
		render(createSpaceHeader());

		fireEvent.click(screen.getByRole("button", { name: "Space settings" }));

		const dialog = screen.getByRole("dialog");
		expect(dialog).toBeTruthy();
		expect(dialog.className).toContain("h-[min(36rem,calc(100dvh-2rem))]");
		expect(dialog.className).toContain("overflow-hidden");
		expect(
			screen
				.getByTestId("space-info-dialog-scroll-area")
				.querySelector('[data-slot="scroll-area-viewport"]')
		).toBeTruthy();
		expect(screen.getByText("Space settings")).toBeTruthy();
		expect(screen.queryByText("Space ID")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
		expect(screen.getByText("Space ID")).toBeTruthy();
		expect(screen.getByText("space-123")).toBeTruthy();
		expect(screen.getByText("CLI join command")).toBeTruthy();
		expect(
			screen.getByText("npx -y openmeld@latest space join space-123")
		).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "Copy Space ID" })
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Access" }));
		fireEvent.click(screen.getByRole("button", { name: "Manage link access" }));
		expect(screen.getByRole("heading", { name: "Access" })).toBeTruthy();
		expect(screen.getByText("Link access is enabled")).toBeTruthy();
		expect(
			screen.getAllByText(PUBLIC_SPACE_ACCESS_DESCRIPTION).length
		).toBeGreaterThan(0);
		fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
		expect(screen.getByRole("button", { name: "Leave space" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Delete space" })).toBeTruthy();
	});

	it("consolidates Center Agent destinations and conversation information into one menu", async () => {
		render(
			createSpaceHeader({
				isCenterAgentDirectMessage: true,
				menuItems: [
					{
						icon: SparkleIcon,
						label: "Skills",
						to: "/o/acme/center-agent/skills",
					},
				],
			})
		);

		expect(screen.queryByRole("button", { name: "Space settings" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Center Agent menu" }));
		expect(
			await screen.findByRole("menuitem", { name: "Skills" })
		).toBeTruthy();
		fireEvent.click(screen.getByRole("menuitem", { name: "Chat settings" }));

		expect(await screen.findByRole("dialog")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
		expect(screen.getByText("Space ID")).toBeTruthy();
		expect(screen.queryByText("About")).toBeNull();
	});

	it("hides ordinary Space access and membership controls for Center Agent DMs", () => {
		render(
			createSpaceHeader({
				accessMode: "public",
				isCenterAgentDirectMessage: true,
				membersControl: null,
				spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
			})
		);

		expect(screen.queryByText("Direct Message")).toBeNull();
		expect(screen.queryByText("Public")).toBeNull();
		expect(screen.queryByTestId("space-public-access-warning")).toBeNull();
		expect(screen.queryByRole("button", { name: "Share space" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Members" })).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Space settings" }));
		fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
		const dialog = screen.getByRole("dialog");

		expect(within(dialog).getByText("Space ID")).toBeTruthy();
		expect(within(dialog).getByText("space-123")).toBeTruthy();
		expect(within(dialog).queryByText("CLI join command")).toBeNull();
		expect(within(dialog).queryByText("Access")).toBeNull();
		expect(within(dialog).queryByRole("button", { name: "Leave space" })).toBe(
			null
		);
		expect(within(dialog).queryByRole("button", { name: "Delete space" })).toBe(
			null
		);
		fireEvent.click(screen.getByRole("button", { name: "General" }));
		expect(within(dialog).getByText("Design Room")).toBeTruthy();
		expect(within(dialog).queryByLabelText("Space name")).toBeNull();
		expect(
			within(dialog).queryByRole("button", { name: "Save name" })
		).toBeNull();
	});

	it("keeps ordinary Direct Message metadata and lifecycle controls read-only", () => {
		render(
			createSpaceHeader({
				accessMode: "members_only",
				memberCount: 2,
				spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
			})
		);

		expect(screen.queryByText("Local Agent")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Space settings" }));
		fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
		const dialog = screen.getByRole("dialog");

		expect(within(dialog).getByText("Space ID")).toBeTruthy();
		expect(within(dialog).queryByText("CLI join command")).toBeNull();
		expect(within(dialog).queryByText("Access")).toBeNull();
		expect(within(dialog).queryByRole("button", { name: "Leave space" })).toBe(
			null
		);
		expect(within(dialog).queryByRole("button", { name: "Delete space" })).toBe(
			null
		);
		expect(within(dialog).queryByLabelText("Space name")).toBeNull();
	});

	it("copies a destination link without changing the existing access policy", async () => {
		render(createSpaceHeader());

		fireEvent.click(screen.getByRole("button", { name: "Share space" }));

		const dialog = screen.getByRole("dialog");
		const expectedShareUrl = buildPublicSpaceEntryUrl({
			origin: window.location.origin,
			target: { spaceId: "space-123" },
		});
		expect(dialog.className).toContain("max-h-[min(42rem,calc(100dvh-2rem))]");
		expect(dialog.className).toContain("overflow-hidden");
		expect(
			within(dialog)
				.getByTestId("space-share-dialog-scroll-area")
				.querySelector('[data-slot="scroll-area-viewport"]')
		).toBeTruthy();
		expect(within(dialog).getByText("Share Design Room")).toBeTruthy();
		expect(
			within(dialog).getByText(
				"Anyone with the link can view and join this Space."
			)
		).toBeTruthy();
		expect(within(dialog).queryByRole("radio")).toBeNull();
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Copy Space link" })
		);

		await waitFor(() => {
			expect(clipboardWriteTextMock).toHaveBeenCalledWith(expectedShareUrl);
			expect(toastMock.success).toHaveBeenCalledWith("Space link copied.");
		});
	});

	it("warns that protected Space share links require the password", () => {
		render(createSpaceHeader({ passwordProtected: true }));

		fireEvent.click(screen.getByRole("button", { name: "Share space" }));

		const dialog = screen.getByRole("dialog");
		expect(
			within(dialog).getByText(
				"People with the password can view and join this Space."
			)
		).toBeTruthy();
		expect(within(dialog).queryByRole("radio")).toBeNull();
	});

	it("shows the public view and password-gated join share mode", () => {
		render(createSpaceHeader({ accessMode: "public_view_join_password" }));

		expect(screen.getByText(PASSWORD_TO_JOIN_LABEL_TEXT)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Share space" }));

		const dialog = screen.getByRole("dialog");
		expect(
			within(dialog).getByText(
				"Anyone with the link can view. People outside the organization need a password to join."
			)
		).toBeTruthy();
		expect(within(dialog).queryByRole("radio")).toBeNull();
	});

	it("lets the Space owner require a password to join from access settings", async () => {
		const onSetAccessMode = vi.fn(async () => undefined);
		render(createSpaceHeader({ onSetAccessMode }));

		fireEvent.click(screen.getByRole("button", { name: "Space settings" }));
		fireEvent.click(screen.getByRole("button", { name: "Access" }));
		const dialog = screen.getByRole("dialog");
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Manage link access" })
		);

		fireEvent.click(
			within(dialog).getByRole("radio", {
				name: SHARE_JOIN_PASSWORD_MODE_LABEL_TEXT,
			})
		);
		fireEvent.change(
			within(dialog).getByLabelText(SET_SPACE_PASSWORD_LABEL_TEXT),
			{
				target: { value: "abc123" },
			}
		);
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Save access" })
		);

		await waitFor(() => {
			expect(onSetAccessMode).toHaveBeenCalledWith({
				accessMode: "public_view_join_password",
				password: "abc123",
			});
		});
	});

	it("lets the Space owner require a password to join from Space settings", async () => {
		const onSetAccessMode = vi.fn(async () => undefined);
		render(createSpaceHeader({ onSetAccessMode }));

		fireEvent.click(screen.getByRole("button", { name: "Space settings" }));
		fireEvent.click(screen.getByRole("button", { name: "Access" }));
		const dialog = screen.getByRole("dialog");
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Manage link access" })
		);

		fireEvent.click(
			within(dialog).getByRole("radio", {
				name: SHARE_JOIN_PASSWORD_MODE_LABEL_TEXT,
			})
		);
		fireEvent.change(
			within(dialog).getByLabelText(SET_SPACE_PASSWORD_LABEL_TEXT),
			{
				target: { value: "abc123" },
			}
		);
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Save access" })
		);

		await waitFor(() => {
			expect(onSetAccessMode).toHaveBeenCalledWith({
				accessMode: "public_view_join_password",
				password: "abc123",
			});
		});
	});

	it("asks before removing the Space password when access becomes public", async () => {
		const onSetAccessMode = vi.fn(async () => undefined);
		render(
			createSpaceHeader({
				accessMode: "public_view_join_password",
				onSetAccessMode,
			})
		);

		fireEvent.click(screen.getByRole("button", { name: "Space settings" }));
		fireEvent.click(screen.getByRole("button", { name: "Access" }));
		const spaceInfoDialog = screen.getByRole("dialog", {
			name: "Space settings",
		});

		fireEvent.click(
			within(spaceInfoDialog).getByRole("button", {
				name: "Manage link access",
			})
		);
		fireEvent.click(
			within(spaceInfoDialog).getByRole("radio", {
				name: SHARE_PUBLIC_MODE_LABEL_TEXT,
			})
		);
		fireEvent.click(
			within(spaceInfoDialog).getByRole("button", { name: "Save access" })
		);

		const confirmationDialog = screen.getByRole("dialog", {
			name: "Remove the Space password?",
		});
		expect(
			within(confirmationDialog).getByText(REMOVE_PASSWORD_WARNING_TEXT)
		).toBeTruthy();
		expect(onSetAccessMode).not.toHaveBeenCalled();

		fireEvent.click(
			within(confirmationDialog).getByRole("button", {
				name: "Keep password",
			})
		);
		expect(onSetAccessMode).not.toHaveBeenCalled();

		fireEvent.click(
			within(spaceInfoDialog).getByRole("button", { name: "Save access" })
		);
		fireEvent.click(
			within(
				screen.getByRole("dialog", {
					name: "Remove the Space password?",
				})
			).getByRole("button", { name: "Remove password" })
		);

		await waitFor(() => {
			expect(onSetAccessMode).toHaveBeenCalledWith({
				accessMode: "public",
			});
		});
	});

	it("reuses the current Space password unless the owner changes it", async () => {
		const onSetAccessMode = vi.fn(async () => undefined);
		render(
			createSpaceHeader({
				accessMode: "protected",
				onSetAccessMode,
			})
		);

		fireEvent.click(screen.getByRole("button", { name: "Space settings" }));
		fireEvent.click(screen.getByRole("button", { name: "Access" }));
		const dialog = screen.getByRole("dialog");
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Manage link access" })
		);

		fireEvent.click(
			within(dialog).getByRole("radio", {
				name: SHARE_JOIN_PASSWORD_MODE_LABEL_TEXT,
			})
		);

		expect(
			within(dialog).getByText("Using current Space password.")
		).toBeTruthy();
		expect(
			within(dialog).queryByLabelText(SET_SPACE_PASSWORD_LABEL_TEXT)
		).toBeNull();
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Save access" })
		);

		await waitFor(() => {
			expect(onSetAccessMode).toHaveBeenCalledWith({
				accessMode: "public_view_join_password",
			});
		});
	});

	it("lets the owner change the Space password while changing access", async () => {
		const onSetAccessMode = vi.fn(async () => undefined);
		render(
			createSpaceHeader({
				accessMode: "protected",
				onSetAccessMode,
			})
		);

		fireEvent.click(screen.getByRole("button", { name: "Space settings" }));
		fireEvent.click(screen.getByRole("button", { name: "Access" }));
		const dialog = screen.getByRole("dialog");
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Manage link access" })
		);

		fireEvent.click(
			within(dialog).getByRole("radio", {
				name: SHARE_JOIN_PASSWORD_MODE_LABEL_TEXT,
			})
		);
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Change password" })
		);
		fireEvent.change(
			within(dialog).getByLabelText(NEW_SPACE_PASSWORD_LABEL_TEXT),
			{
				target: { value: "newpass" },
			}
		);
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Save access" })
		);

		await waitFor(() => {
			expect(onSetAccessMode).toHaveBeenCalledWith({
				accessMode: "public_view_join_password",
				password: "newpass",
			});
		});
	});

	it("shows Space access as read-only in Space settings for non-owners", () => {
		render(createSpaceHeader({ showDeleteSpaceAction: false }));

		fireEvent.click(screen.getByRole("button", { name: "Space settings" }));
		fireEvent.click(screen.getByRole("button", { name: "Access" }));
		const dialog = screen.getByRole("dialog");
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Manage link access" })
		);

		expect(
			within(dialog).getByRole("heading", { name: "Access" })
		).toBeTruthy();
		expect(
			within(dialog).getByText("Only the Space owner can change this.")
		).toBeTruthy();
		expect(
			within(dialog).queryByRole("button", { name: "Save access" })
		).toBeNull();
	});

	it("lets the Space owner rename the Space from Space settings", async () => {
		const onUpdateSpaceName = vi.fn(async () => undefined);
		render(createSpaceHeader({ onUpdateSpaceName }));

		fireEvent.click(screen.getByRole("button", { name: "Space settings" }));
		const dialog = screen.getByRole("dialog");
		fireEvent.change(within(dialog).getByLabelText("Space name"), {
			target: { value: "  Launch Room  " },
		});
		fireEvent.click(within(dialog).getByRole("button", { name: "Save name" }));

		await waitFor(() => {
			expect(onUpdateSpaceName).toHaveBeenCalledWith("Launch Room");
		});
	});

	it("keeps the Space name read-only for people who cannot manage the Space", () => {
		render(createSpaceHeader({ showDeleteSpaceAction: false }));

		fireEvent.click(screen.getByRole("button", { name: "Space settings" }));
		const dialog = screen.getByRole("dialog");

		fireEvent.click(screen.getByRole("button", { name: "General" }));
		expect(within(dialog).getByText("Design Room")).toBeTruthy();
		expect(within(dialog).queryByLabelText("Space name")).toBeNull();
		expect(
			within(dialog).queryByRole("button", { name: "Save name" })
		).toBeNull();
	});

	it("does not submit a blank Space name", () => {
		const onUpdateSpaceName = vi.fn(async () => undefined);
		render(createSpaceHeader({ onUpdateSpaceName }));

		fireEvent.click(screen.getByRole("button", { name: "Space settings" }));
		const dialog = screen.getByRole("dialog");
		fireEvent.change(within(dialog).getByLabelText("Space name"), {
			target: { value: "   " },
		});

		expect(
			(
				within(dialog).getByRole("button", {
					name: "Save name",
				}) as HTMLButtonElement
			).disabled
		).toBe(true);
		expect(onUpdateSpaceName).not.toHaveBeenCalled();
	});

	it("does not treat a hidden password draft as a public access change", () => {
		render(createSpaceHeader());

		fireEvent.click(screen.getByRole("button", { name: "Space settings" }));
		fireEvent.click(screen.getByRole("button", { name: "Access" }));
		const dialog = screen.getByRole("dialog");
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Manage link access" })
		);
		fireEvent.click(
			within(dialog).getByRole("radio", {
				name: SHARE_JOIN_PASSWORD_MODE_LABEL_TEXT,
			})
		);
		fireEvent.change(
			within(dialog).getByLabelText(SET_SPACE_PASSWORD_LABEL_TEXT),
			{
				target: { value: "abc123" },
			}
		);
		fireEvent.click(
			within(dialog).getByRole("radio", { name: SHARE_PUBLIC_MODE_LABEL_TEXT })
		);

		const saveButton = within(dialog).getByRole("button", {
			name: "Save access",
		});
		expect((saveButton as HTMLButtonElement).disabled).toBe(true);
	});

	it("keeps long space information inside the dialog", () => {
		const longSpaceName = "A".repeat(96);
		const longSpaceId =
			"cf0d6e9a576c55587df7d77cf0bdc6bad64edb1b8676e18839c10330017ab53c";
		render(
			createSpaceHeader({ spaceId: longSpaceId, spaceName: longSpaceName })
		);

		fireEvent.click(screen.getByRole("button", { name: "Space settings" }));
		const dialog = screen.getByRole("dialog");

		const spaceNameInput = within(dialog).getByLabelText(
			"Space name"
		) as HTMLInputElement;
		expect(spaceNameInput.value).toBe(longSpaceName);
		expect(spaceNameInput.className).toContain("min-w-0");
		fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
		expect(
			within(dialog).getByRole("button", { name: "Copy Space ID" }).className
		).toContain("grid-cols-[minmax(0,1fr)_auto]");
		expect(within(dialog).getByText(longSpaceId).className).toContain(
			"[overflow-wrap:anywhere]"
		);
	});

	it("shows leave confirmation inside the information dialog", () => {
		const onLeaveSpace = vi.fn();
		render(createSpaceHeader({ onLeaveSpace }));

		fireEvent.click(screen.getByRole("button", { name: "Space settings" }));
		fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
		fireEvent.click(screen.getByRole("button", { name: "Leave space" }));

		expect(screen.getByText("Leave this space?")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Confirm leave" }));
		expect(onLeaveSpace).toHaveBeenCalledOnce();
	});

	it("requires typed confirmation before deleting a space", () => {
		const onDeleteSpace = vi.fn();
		render(createSpaceHeader({ onDeleteSpace }));

		fireEvent.click(screen.getByRole("button", { name: "Space settings" }));
		fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
		fireEvent.click(screen.getByRole("button", { name: "Delete space" }));

		const confirmButton = screen.getByRole("button", {
			name: "Delete permanently",
		});
		expect(screen.getByText("Delete this space permanently?")).toBeTruthy();
		expect((confirmButton as HTMLButtonElement).disabled).toBe(true);

		fireEvent.change(screen.getByLabelText(DELETE_CONFIRMATION_LABEL_TEXT), {
			target: { value: "DELETE" },
		});
		expect((confirmButton as HTMLButtonElement).disabled).toBe(false);
		fireEvent.click(confirmButton);
		expect(onDeleteSpace).toHaveBeenCalledOnce();
	});

	it("reveals and focuses the delete confirmation after it expands", () => {
		vi.stubGlobal("matchMedia", createMatchMediaMock(false));
		render(createSpaceHeader());

		fireEvent.click(screen.getByRole("button", { name: "Space settings" }));
		fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
		fireEvent.click(screen.getByRole("button", { name: "Delete space" }));

		const confirmationInput = screen.getByLabelText(
			DELETE_CONFIRMATION_LABEL_TEXT
		);
		expect(document.activeElement).toBe(confirmationInput);
		expect(scrollIntoViewMock).toHaveBeenCalledWith({
			behavior: "smooth",
			block: "nearest",
		});
	});

	it("reveals the delete confirmation without smooth scrolling for reduced motion", () => {
		vi.stubGlobal("matchMedia", createMatchMediaMock(true));
		render(createSpaceHeader());

		fireEvent.click(screen.getByRole("button", { name: "Space settings" }));
		fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
		fireEvent.click(screen.getByRole("button", { name: "Delete space" }));

		expect(scrollIntoViewMock).toHaveBeenCalledWith({
			behavior: "auto",
			block: "nearest",
		});
	});

	it("hides delete space when the current profile cannot delete the space", () => {
		render(createSpaceHeader({ showDeleteSpaceAction: false }));

		fireEvent.click(screen.getByRole("button", { name: "Space settings" }));
		fireEvent.click(screen.getByRole("button", { name: "Advanced" }));

		expect(screen.getByRole("button", { name: "Leave space" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Delete space" })).toBeNull();
		expect(screen.queryByText("Delete space")).toBeNull();
	});

	it("copies the space id from the information dialog", async () => {
		render(createSpaceHeader());

		fireEvent.click(screen.getByRole("button", { name: "Space settings" }));
		fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
		fireEvent.click(screen.getByRole("button", { name: "Copy Space ID" }));

		await waitFor(() => {
			expect(clipboardWriteTextMock).toHaveBeenCalledWith("space-123");
			expect(toastMock.success).toHaveBeenCalledWith("Space ID copied.");
		});
	});

	it("copies the CLI join command from the information dialog", async () => {
		render(createSpaceHeader());

		fireEvent.click(screen.getByRole("button", { name: "Space settings" }));
		fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
		fireEvent.click(
			screen.getByRole("button", { name: "Copy CLI join command" })
		);

		await waitFor(() => {
			expect(clipboardWriteTextMock).toHaveBeenCalledWith(
				"npx -y openmeld@latest space join space-123"
			);
			expect(toastMock.success).toHaveBeenCalledWith("CLI command copied.");
		});
	});

	it("shows an error toast when dialog clipboard write fails", async () => {
		clipboardWriteTextMock.mockRejectedValueOnce(
			new Error("Permission denied")
		);
		render(createSpaceHeader());

		fireEvent.click(screen.getByRole("button", { name: "Space settings" }));
		fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
		fireEvent.click(screen.getByRole("button", { name: "Copy Space ID" }));

		await waitFor(() => {
			expect(clipboardWriteTextMock).toHaveBeenCalledWith("space-123");
			expect(toastMock.error).toHaveBeenCalledWith(
				"OpenMeld could not copy this automatically. Select the text and copy it manually."
			);
		});
		expect(toastMock.success).not.toHaveBeenCalled();
	});

	it("copies from the information dialog with the fallback clipboard path", async () => {
		const execCommandMock = vi.fn().mockReturnValue(true);
		clipboardWriteTextMock.mockRejectedValueOnce(
			new Error("Permission denied")
		);
		Object.defineProperty(document, "execCommand", {
			configurable: true,
			value: execCommandMock,
		});
		render(createSpaceHeader());

		fireEvent.click(screen.getByRole("button", { name: "Space settings" }));
		fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
		fireEvent.click(screen.getByRole("button", { name: "Copy Space ID" }));

		await waitFor(() => {
			expect(clipboardWriteTextMock).toHaveBeenCalledWith("space-123");
			expect(execCommandMock).toHaveBeenCalledWith("copy");
			expect(toastMock.success).toHaveBeenCalledWith("Space ID copied.");
		});
		expect(toastMock.error).not.toHaveBeenCalled();
	});
});

function createSpaceHeader(
	input: {
		accessMode?: SpaceAccessMode;
		liveState?: ComponentProps<typeof SpaceHeader>["liveState"];
		onReconnectLiveUpdates?: () => void;
		currentProfileName?: string | null;
		directMessageOwnerVisibilityLabel?: string | null;
		onSetAccessMode?: (input: {
			accessMode: SpaceAccessMode;
			password?: string;
		}) => Promise<void>;
		onUpdateSpaceName?: (name: string) => Promise<void>;
		onDeleteSpace?: () => void;
		onLeaveSpace?: () => void;
		isCenterAgentDirectMessage?: boolean;
		memberCount?: number;
		menuItems?: ComponentProps<typeof SpaceHeader>["menuItems"];
		membersControl?: ReactNode;
		passwordProtected?: boolean;
		renderFrame?: boolean;
		showDeleteSpaceAction?: boolean;
		spaceId?: string;
		spaceName?: string;
		spacePurpose?: string;
		setupRecallAction?: ReactNode;
		viewControl?: ReactNode;
	} = {}
) {
	return (
		<QueryClientProvider client={new QueryClient()}>
			<TooltipProvider>
				<SpaceHeader
					accessModeErrorMessage={null}
					canManageSpaceAccess={input.showDeleteSpaceAction ?? true}
					canManageSpaceName={input.showDeleteSpaceAction ?? true}
					currentProfileName={input.currentProfileName ?? null}
					deleteSpaceErrorMessage={null}
					directMessageOwnerVisibilityLabel={
						input.directMessageOwnerVisibilityLabel
					}
					hideShareControl={input.isCenterAgentDirectMessage}
					isAccessModePending={false}
					isCenterAgentDirectMessage={input.isCenterAgentDirectMessage}
					isDeleteSpacePending={false}
					isLeaveSpacePending={false}
					isSpaceNamePending={false}
					leaveSpaceErrorMessage={null}
					liveState={input.liveState}
					membersControl={
						input.membersControl === undefined ? (
							<button type="button">Members</button>
						) : (
							input.membersControl
						)
					}
					menuItems={input.menuItems}
					menuLabel="Center Agent menu"
					notificationControl={<button type="button">Notifications</button>}
					onDeleteSpace={input.onDeleteSpace ?? vi.fn()}
					onLeaveSpace={input.onLeaveSpace ?? vi.fn()}
					onReconnectLiveUpdates={input.onReconnectLiveUpdates}
					onSetAccessMode={
						input.onSetAccessMode ?? vi.fn(async () => undefined)
					}
					onUpdateSpaceName={
						input.onUpdateSpaceName ?? vi.fn(async () => undefined)
					}
					renderFrame={input.renderFrame}
					setupRecallAction={input.setupRecallAction}
					showDeleteSpaceAction={input.showDeleteSpaceAction ?? true}
					spaceNameErrorMessage={null}
					status={createSpaceStatus({
						accessMode: input.accessMode,
						memberCount: input.memberCount,
						passwordProtected: input.passwordProtected,
						spaceId: input.spaceId,
						spaceName: input.spaceName,
						spacePurpose: input.spacePurpose,
					})}
					viewControl={input.viewControl}
				/>
			</TooltipProvider>
		</QueryClientProvider>
	);
}

function createSpaceStatus(
	input: {
		accessMode?: SpaceAccessMode;
		memberCount?: number;
		passwordProtected?: boolean;
		spaceId?: string;
		spaceName?: string;
		spacePurpose?: string;
	} = {}
): GetSpaceStatusResponse {
	const accessMode =
		input.accessMode ?? (input.passwordProtected ? "protected" : "public");
	return {
		spaceId: input.spaceId ?? "space-123",
		generatedAt: "2026-04-11T00:00:00.000Z",
		name: input.spaceName ?? "Design Room",
		...(input.spacePurpose ? { spacePurpose: input.spacePurpose } : {}),
		accessMode,
		passwordProtected: accessMode === "protected",
		dispatchPolicy: {
			mode: "mention_only",
		},
		publicationMode: "collaboration",
		allowedActions: ["post_message", "post_status", "stay_silent"],
		resultArchivePolicy: {
			mode: "all_final_results",
		},
		entryBrief: "default",
		dispatchBrief: "default",
		members: {
			totalCount: input.memberCount ?? 2,
			humanCount: 1,
			agentCount: 1,
			liveNowCount: 1,
			liveHumanCount: 1,
			liveAgentCount: 0,
		},
		latestVisibleUpdate: {
			signalId: "sig-last",
			signalType: "signal.text",
			createdAt: "2026-04-11T00:00:00.000Z",
			actorProfileId: "11111111-1111-1111-1111-111111111111",
			actorName: "Mira",
			previewText: "Recent update",
		},
	};
}

function createMatchMediaMock(
	prefersReducedMotion: boolean
): typeof window.matchMedia {
	return vi.fn((query: string) => ({
		matches:
			query === "(prefers-reduced-motion: reduce)" && prefersReducedMotion,
		media: query,
		onchange: null,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		addListener: vi.fn(),
		removeListener: vi.fn(),
		dispatchEvent: vi.fn(),
	})) as typeof window.matchMedia;
}
