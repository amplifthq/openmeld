import {
	QueryClient,
	QueryClientProvider,
	queryOptions,
} from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSpaceEntryConfirmed } from "./space-entry-confirmation";
import { SpaceEntryGate } from "./space-entry-gate";
import { SpaceEntryRecoveryNotice } from "./space-entry-recovery-notice";

const entryRequest = vi.hoisted(() =>
	vi.fn<({ signal }: { signal: AbortSignal }) => Promise<unknown>>()
);
beforeEach(() => {
	entryRequest
		.mockReset()
		.mockImplementation(() => new Promise(() => undefined));
});
vi.mock("#/query/spaces/entry-resolution", () => ({
	spaceEntryResolutionQueryOptions: () =>
		queryOptions({
			queryKey: ["entry"],
			queryFn: ({ signal }) => entryRequest({ signal }),
			retry: false,
		}),
}));
vi.mock("#/lib/spaces/protected-space-access", () => ({
	rememberProtectedSpaceAccess: vi.fn(),
}));
afterEach(cleanup);

it("restarts a stalled access request and preserves the draft until access is confirmed", async () => {
	let confirm: (value: unknown) => void = () => undefined;
	entryRequest
		.mockImplementationOnce(() => new Promise(() => undefined))
		.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					confirm = resolve;
				})
		);
	setup();
	const draft = screen.getByRole("textbox", { name: "Draft" });
	fireEvent.change(draft, { target: { value: "Unsent work" } });
	fireEvent.click(screen.getByRole("button", { name: "Check again" }));
	await waitFor(() => expect(entryRequest).toHaveBeenCalledTimes(2));
	expect(entryRequest.mock.calls[0]?.[0].signal.aborted).toBe(true);
	expect(
		(screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled
	).toBe(true);
	act(() => confirm({ view: { state: "allowed", experience: "member" } }));
	await waitFor(() =>
		expect(
			(screen.getByRole("button", { name: "Send" }) as HTMLButtonElement)
				.disabled
		).toBe(false)
	);
	expect(screen.getByRole("textbox", { name: "Draft" })).toBe(draft);
	expect((draft as HTMLInputElement).value).toBe("Unsent work");
	expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();
});

function Conversation() {
	return (
		<>
			<p>Saved conversation</p>
			<SpaceEntryRecoveryNotice />
			<button disabled={!useSpaceEntryConfirmed()} type="button">
				Send
			</button>
			<input aria-label="Draft" defaultValue="Keep my draft" />
		</>
	);
}
function setup(restored = true) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const rejected = vi.fn();
	render(
		<QueryClientProvider client={client}>
			<SpaceEntryGate
				onAccessRejected={rejected}
				renderFrame={(content) => content}
				restoredContent={restored ? <Conversation /> : undefined}
				signInHref="/login"
				spaceId="space-123"
			>
				{() => <Conversation />}
			</SpaceEntryGate>
		</QueryClientProvider>
	);
	return { client, rejected };
}
it("shows a saved conversation before entry resolves, without enabling Send or remounting the draft", async () => {
	const { client } = setup();
	expect(screen.getByText("Saved conversation")).toBeTruthy();
	expect(
		(screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled
	).toBe(true);
	const draft = screen.getByRole("textbox", { name: "Draft" });
	act(() => {
		client.setQueryData(["entry"], {
			view: { state: "allowed", experience: "member" },
		});
	});
	await waitFor(() =>
		expect(
			(screen.getByRole("button", { name: "Send" }) as HTMLButtonElement)
				.disabled
		).toBe(false)
	);
	expect(screen.getByRole("textbox", { name: "Draft" })).toBe(draft);
});
it("hides saved content on an explicit rejection and clears its owning segment", async () => {
	const { client, rejected } = setup();
	act(() => {
		client.setQueryData(["entry"], {
			view: { state: "unavailable" },
			safeContext: {},
			target: { spaceId: "space-123" },
		});
	});
	await waitFor(() =>
		expect(screen.queryByText("Saved conversation")).toBeNull()
	);
	expect(rejected).toHaveBeenCalledTimes(1);
});
it("uses the checking shell when no saved conversation exists", () => {
	setup(false);
	expect(screen.getByText("Checking Space access")).toBeTruthy();
	expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
});

it.each([
	"space.forbidden",
	"space.not_found",
	"space.password_required",
	"auth.unauthenticated",
])("removes cached content for an explicit %s error", async (code) => {
	const { client, rejected } = setup();
	act(() =>
		client
			.getQueryCache()
			.find({ queryKey: ["entry"] })
			?.setState({
				status: "error",
				error: Object.assign(new Error("Access unavailable"), {
					code,
					status: code === "auth.unauthenticated" ? 401 : 403,
				}),
				fetchStatus: "idle",
			})
	);
	await waitFor(() =>
		expect(screen.queryByText("Saved conversation")).toBeNull()
	);
	expect(rejected).toHaveBeenCalled();
});

it("keeps the saved draft and exposes retry for a transient entry failure", async () => {
	const { client, rejected } = setup();
	const draft = screen.getByRole("textbox", { name: "Draft" });
	act(() =>
		client
			.getQueryCache()
			.find({ queryKey: ["entry"] })
			?.setState({
				status: "error",
				error: Object.assign(new Error("Network unavailable"), {
					code: "network.request_failed",
					status: 502,
				}),
				fetchStatus: "idle",
			})
	);
	await waitFor(() =>
		expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy()
	);
	expect(screen.getByRole("textbox", { name: "Draft" })).toBe(draft);
	expect(rejected).not.toHaveBeenCalled();
});
