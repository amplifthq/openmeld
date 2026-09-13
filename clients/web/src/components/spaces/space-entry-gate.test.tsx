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
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSpaceEntryConfirmation } from "./space-entry-confirmation";
import { SpaceEntryGate } from "./space-entry-gate";

const entryRequest = vi.hoisted(() =>
	vi.fn<({ signal }: { signal: AbortSignal }) => Promise<unknown>>()
);
const joinRequest = vi.hoisted(() => vi.fn());
vi.mock("#/lib/organizations/organization-spaces", () => ({
	joinOrganizationSpace: joinRequest,
}));
beforeEach(() => {
	joinRequest.mockReset();
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

it("offers a colleague Join without exposing messages and preserves the server's rejection reason", async () => {
	entryRequest.mockResolvedValue({
		target: { spaceId: "space-123" },
		view: { state: "membership_required" },
		participation: { state: "self_join_available" },
		safeContext: {
			organizationId: "org-acme",
			organizationSlug: "acme",
			spaceName: "Team feedback",
		},
		recovery: null,
	});
	joinRequest.mockRejectedValue({
		code: "space.membership_required",
		status: 403,
		message: "This Space is now invite-only. Ask its owner to add you.",
		requestId: "join-check",
	});
	setup(false);
	fireEvent.click(await screen.findByRole("button", { name: "Join Space" }));
	expect(screen.queryByText("Saved conversation")).toBeNull();
	expect(await screen.findByRole("alert")).toHaveProperty(
		"textContent",
		"This Space is now invite-only. Ask its owner to add you."
	);
	expect(joinRequest).toHaveBeenCalledWith({
		organizationId: "org-acme",
		spaceId: "space-123",
	});
});

it("lets Send await the current access request without exposing a retry control", async () => {
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
	fireEvent.click(screen.getByRole("button", { name: "Send" }));
	expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();
	expect(screen.queryByText("Sent")).toBeNull();
	await waitFor(() => expect(entryRequest).toHaveBeenCalledTimes(2));
	expect(entryRequest.mock.calls[0]?.[0].signal.aborted).toBe(true);
	act(() =>
		confirm({
			view: { state: "allowed", experience: "member" },
			safeContext: {},
		})
	);
	await waitFor(() => expect(screen.getByText("Sent")).toBeTruthy());
	expect(screen.getByRole("textbox", { name: "Draft" })).toBe(draft);
	expect((draft as HTMLInputElement).value).toBe("Unsent work");
});

function Conversation() {
	const confirmation = useSpaceEntryConfirmation();
	const [sent, setSent] = useState(false);
	return (
		<>
			<p>Saved conversation</p>
			{sent ? <p>Sent</p> : null}
			<button
				onClick={async () => {
					if (await confirmation.ensureConfirmed()) {
						setSent(true);
					}
				}}
				type="button"
			>
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
it("shows a saved conversation and keeps Send available before entry resolves", async () => {
	const { client } = setup();
	expect(screen.getByText("Saved conversation")).toBeTruthy();
	expect(
		(screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled
	).toBe(false);
	const draft = screen.getByRole("textbox", { name: "Draft" });
	act(() => {
		client.setQueryData(["entry"], {
			view: { state: "allowed", experience: "member" },
			safeContext: {},
		});
	});
	await waitFor(() =>
		expect(screen.getByText("Saved conversation")).toBeTruthy()
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
	expect(screen.getByText("Opening Space")).toBeTruthy();
	expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();
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

it("keeps the saved draft without exposing access controls after a transient failure", async () => {
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
		expect(screen.getByText("Saved conversation")).toBeTruthy()
	);
	expect(screen.getByRole("textbox", { name: "Draft" })).toBe(draft);
	expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
	expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();
	expect(rejected).not.toHaveBeenCalled();
});
