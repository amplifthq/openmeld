import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
	WelcomeSpaceScreen,
	type WelcomeSpaceScreenProps,
} from "./welcome-space-screen";

const CREATE_CHOICE = /Create a Space/;
const JOIN_CHOICE = /Join a Space/;
const CONNECT_COMPUTER_CHOICE = /Connect Computer/;
const CREATE_SUBMIT = /^Create$/;
const JOIN_ERROR_COPY = /Couldn't load your spaces/;
const NO_MATCH_COPY = /No spaces match/;
const EVERYONE_OPTION = /Everyone/;

beforeAll(() => {
	// jsdom lacks matchMedia; the Fluid ScrollArea's touch-primary hook needs it.
	if (typeof window.matchMedia !== "function") {
		Object.defineProperty(window, "matchMedia", {
			configurable: true,
			value: (query: string) => ({
				addEventListener: () => undefined,
				addListener: () => undefined,
				dispatchEvent: () => false,
				matches: false,
				media: query,
				onchange: null,
				removeEventListener: () => undefined,
				removeListener: () => undefined,
			}),
			writable: true,
		});
	}

	if (typeof globalThis.ResizeObserver === "undefined") {
		globalThis.ResizeObserver = class {
			disconnect() {
				return undefined;
			}
			observe() {
				return undefined;
			}
			unobserve() {
				return undefined;
			}
		} as unknown as typeof ResizeObserver;
	}
});

afterEach(cleanup);

function renderScreen(overrides: Partial<WelcomeSpaceScreenProps> = {}) {
	const props: WelcomeSpaceScreenProps = {
		onCreate: vi.fn(),
		onJoin: vi.fn(),
		joinableSpaces: [],
		joinableStatus: "ready",
		onRetryJoinable: vi.fn(),
		isPending: false,
		...overrides,
	};
	render(<WelcomeSpaceScreen {...props} />);
	return props;
}

describe("WelcomeSpaceScreen", () => {
	it("offers create and join as the two choices, form hidden until chosen", () => {
		renderScreen({
			joinableSpaces: [{ spaceId: "space-1", name: "Existing room" }],
		});
		const welcomeLayout = screen
			.getByRole("heading", { name: "Where do you want to work?" })
			.closest("section");
		expect(welcomeLayout?.className).toContain("max-lg:px-4");
		expect(welcomeLayout?.className).toContain("max-lg:pb-4");

		expect(
			screen.getByText("A Space is where people and agents work together.")
		).toBeTruthy();
		expect(screen.getByRole("button", { name: CREATE_CHOICE })).toBeTruthy();
		expect(
			screen.getByText("Start new work with your team and agents")
		).toBeTruthy();
		expect(screen.getByRole("button", { name: JOIN_CHOICE })).toBeTruthy();
		expect(screen.getByText("Use a Space your team already has")).toBeTruthy();
		expect(screen.queryByPlaceholderText("Design review")).toBeNull();
	});

	it("offers computer setup before space choices without gating them", () => {
		const onConnectComputer = vi.fn();
		renderScreen({
			computerSetupActions: {
				centerAgentPath: "/o/acme",
				onConnectComputer,
			},
			joinableSpaces: [{ spaceId: "space-1", name: "Existing room" }],
		});

		const connectComputerChoice = screen.getByRole("button", {
			name: CONNECT_COMPUTER_CHOICE,
		});
		const connectComputerCard = connectComputerChoice.parentElement;
		const addComputerIcon = connectComputerCard?.querySelector(
			".welcome-add-computer-icon-breathe"
		);
		expect(connectComputerChoice).toBeTruthy();
		expect(addComputerIcon).toBeTruthy();
		expect(addComputerIcon?.parentElement?.className).toContain("flex-col");
		expect(addComputerIcon?.parentElement?.className).toContain("items-center");
		expect(
			screen.getByText("Connect Computer", {
				selector: ".welcome-add-computer-title-breathe",
			}).className
		).toContain("welcome-add-computer-title-breathe");
		expect(connectComputerCard?.textContent).toContain(
			"Or ask a Center Agent to walk you through."
		);
		const centerAgentLink = screen.getByRole("link", {
			name: "Center Agent",
		});
		expect(centerAgentLink.getAttribute("href")).toBe("/o/acme");
		expect(centerAgentLink.className).toContain("underline");
		expect(
			screen.queryByRole("button", { name: "Open Center Agent" })
		).toBeNull();

		const choiceButtons = screen.getAllByRole("button");
		const createChoice = screen.getByRole("button", { name: CREATE_CHOICE });
		const joinChoice = screen.getByRole("button", { name: JOIN_CHOICE });
		expect(choiceButtons.indexOf(connectComputerChoice)).toBeLessThan(
			choiceButtons.indexOf(createChoice)
		);
		expect((createChoice as HTMLButtonElement).disabled).toBe(false);
		expect((joinChoice as HTMLButtonElement).disabled).toBe(false);

		fireEvent.click(connectComputerChoice);
		expect(onConnectComputer).toHaveBeenCalledTimes(1);

		fireEvent.click(createChoice);
		expect(screen.getByPlaceholderText("Design review")).toBeTruthy();
	});

	it("creates a private organization Space with members-only access by default", () => {
		const onCreate = vi.fn();
		renderScreen({ onCreate });

		fireEvent.click(screen.getByRole("button", { name: CREATE_CHOICE }));
		expect(
			screen.getByRole("combobox", { name: "General access" }).textContent
		).toBe("Only invited people");
		expect(
			screen.queryByRole("radiogroup", { name: "Space access" })
		).toBeNull();
		expect(screen.queryByLabelText("Set Space password")).toBeNull();
		fireEvent.change(screen.getByPlaceholderText("Design review"), {
			target: { value: "Private room" },
		});
		fireEvent.click(screen.getByRole("button", { name: CREATE_SUBMIT }));

		expect(onCreate).toHaveBeenCalledWith({
			accessMode: "members_only",
			name: "Private room",
			visibility: "private",
		});
	});

	it("creates a public organization Space when Public visibility is selected", () => {
		const onCreate = vi.fn();
		renderScreen({ onCreate });

		fireEvent.click(screen.getByRole("button", { name: CREATE_CHOICE }));
		fireEvent.click(screen.getByRole("combobox", { name: "General access" }));
		fireEvent.click(screen.getByRole("option", { name: EVERYONE_OPTION }));
		fireEvent.change(screen.getByPlaceholderText("Design review"), {
			target: { value: "Team room" },
		});
		fireEvent.click(screen.getByRole("button", { name: CREATE_SUBMIT }));

		expect(onCreate).toHaveBeenCalledWith({
			accessMode: "members_only",
			name: "Team room",
			visibility: "public",
		});
	});

	it("submits one create request until the pending request settles", () => {
		const onCreate = vi.fn();
		const props: WelcomeSpaceScreenProps = {
			isPending: false,
			joinableSpaces: [],
			joinableStatus: "ready",
			onCreate,
			onJoin: vi.fn(),
			onRetryJoinable: vi.fn(),
		};
		const view = render(<WelcomeSpaceScreen {...props} />);

		fireEvent.click(screen.getByRole("button", { name: CREATE_CHOICE }));
		fireEvent.change(screen.getByPlaceholderText("Design review"), {
			target: { value: "Product & Design" },
		});
		const createButton = screen.getByRole("button", { name: CREATE_SUBMIT });
		fireEvent.click(createButton);
		fireEvent.click(createButton);

		expect(onCreate).toHaveBeenCalledTimes(1);

		view.rerender(<WelcomeSpaceScreen {...props} isPending />);
		view.rerender(<WelcomeSpaceScreen {...props} />);
		fireEvent.click(createButton);

		expect(onCreate).toHaveBeenCalledTimes(2);
	});

	it("keeps a personal Space private without link access choices", () => {
		const onCreate = vi.fn();
		renderScreen({ contextKind: "personal", onCreate });

		fireEvent.click(screen.getByRole("button", { name: CREATE_CHOICE }));
		expect(screen.queryByText("Organization directory listing")).toBeNull();
		expect(
			screen.queryByRole("combobox", { name: "General access" })
		).toBeNull();
		fireEvent.change(screen.getByPlaceholderText("Design review"), {
			target: { value: "Solo room" },
		});
		fireEvent.click(screen.getByRole("button", { name: CREATE_SUBMIT }));

		expect(onCreate).toHaveBeenCalledWith({
			accessMode: "members_only",
			name: "Solo room",
			visibility: "private",
		});
	});

	it("disables the join choice when there are no joinable spaces", () => {
		renderScreen({ joinableSpaces: [] });

		const joinChoice = screen.getByRole("button", { name: JOIN_CHOICE });
		expect((joinChoice as HTMLButtonElement).disabled).toBe(true);
		expect(screen.getByText("No spaces to join yet")).toBeTruthy();
	});

	it("reads as checking, not empty, while joinable spaces load", () => {
		renderScreen({ joinableSpaces: [], joinableStatus: "loading" });

		const joinChoice = screen.getByRole("button", { name: JOIN_CHOICE });
		expect((joinChoice as HTMLButtonElement).disabled).toBe(true);
		expect(screen.getByText("Checking your spaces…")).toBeTruthy();
	});

	it("surfaces an error and retries when the spaces query fails", () => {
		const onRetryJoinable = vi.fn();
		renderScreen({ joinableStatus: "error", onRetryJoinable });

		const joinChoice = screen.getByRole("button", { name: JOIN_CHOICE });
		expect((joinChoice as HTMLButtonElement).disabled).toBe(false);
		expect(screen.getByText(JOIN_ERROR_COPY)).toBeTruthy();

		fireEvent.click(joinChoice);
		expect(onRetryJoinable).toHaveBeenCalled();
	});

	it("does not enter the join view while the join choice is disabled", () => {
		const onJoin = vi.fn();
		renderScreen({ joinableSpaces: [], onJoin });

		fireEvent.click(screen.getByRole("button", { name: JOIN_CHOICE }));

		// Still on the two-choice screen (the create choice is only rendered there).
		expect(screen.getByRole("button", { name: CREATE_CHOICE })).toBeTruthy();
		expect(onJoin).not.toHaveBeenCalled();
	});

	it("joins when a space row is chosen", () => {
		const onJoin = vi.fn();
		renderScreen({
			joinableSpaces: [{ spaceId: "space-1", name: "Existing room" }],
			onJoin,
		});

		fireEvent.click(screen.getByRole("button", { name: JOIN_CHOICE }));
		fireEvent.click(screen.getByRole("button", { name: "Existing room" }));
		expect(onJoin).toHaveBeenCalledWith("space-1");
	});

	it("filters the join list with the search box when the list is long", () => {
		const many = Array.from({ length: 8 }, (_, index) => ({
			spaceId: `room-${index}`,
			name: `Room ${index}`,
		}));
		many.push({ spaceId: "design", name: "Design review" });
		renderScreen({ joinableSpaces: many });

		fireEvent.click(screen.getByRole("button", { name: JOIN_CHOICE }));
		const search = screen.getByPlaceholderText("Search spaces");

		fireEvent.change(search, { target: { value: "design" } });
		expect(screen.getByRole("button", { name: "Design review" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Room 0" })).toBeNull();

		fireEvent.change(search, { target: { value: "zzzz" } });
		expect(screen.getByText(NO_MATCH_COPY)).toBeTruthy();
	});

	it("hides search and drops a stale query at or below the threshold", () => {
		const many = Array.from({ length: 8 }, (_, index) => ({
			spaceId: `room-${index}`,
			name: `Room ${index}`,
		}));
		const view = render(
			<WelcomeSpaceScreen
				isPending={false}
				joinableSpaces={many}
				joinableStatus="ready"
				onCreate={vi.fn()}
				onJoin={vi.fn()}
				onRetryJoinable={vi.fn()}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: JOIN_CHOICE }));
		fireEvent.change(screen.getByPlaceholderText("Search spaces"), {
			target: { value: "zzzz" },
		});
		expect(screen.getByText(NO_MATCH_COPY)).toBeTruthy();

		// The list shrinks below the threshold: search hides and the stale "zzzz"
		// must not keep filtering the now-short list.
		view.rerender(
			<WelcomeSpaceScreen
				isPending={false}
				joinableSpaces={many.slice(0, 6)}
				joinableStatus="ready"
				onCreate={vi.fn()}
				onJoin={vi.fn()}
				onRetryJoinable={vi.fn()}
			/>
		);

		expect(screen.queryByPlaceholderText("Search spaces")).toBeNull();
		expect(screen.getByRole("button", { name: "Room 0" })).toBeTruthy();
	});

	it("returns to the two choices from a sub-view via back", () => {
		renderScreen({
			joinableSpaces: [{ spaceId: "space-1", name: "Existing room" }],
		});

		fireEvent.click(screen.getByRole("button", { name: CREATE_CHOICE }));
		expect(screen.getByPlaceholderText("Design review")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "back" }));
		expect(screen.getByRole("button", { name: CREATE_CHOICE })).toBeTruthy();
		expect(screen.queryByPlaceholderText("Design review")).toBeNull();
	});

	it("leaves the flow via back from the two choices", () => {
		const onBack = vi.fn();
		renderScreen({ onBack });

		fireEvent.click(screen.getByRole("button", { name: "back" }));
		expect(onBack).toHaveBeenCalled();
	});
});
