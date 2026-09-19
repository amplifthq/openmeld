import {
	accountOrganizationContextSchema,
	type DesktopSession,
} from "@openmeld/schemas";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import {
	createComposerDraftRecord,
	EMPTY_COMPOSER_DRAFT_CONTENT,
	readComposerDraft,
	writeComposerDraft,
} from "#/lib/composer-draft-storage";
import { readCurrentAccountOrganizationContext } from "#/lib/organizations/account-organization-context";
import { DesktopEntry } from "./desktop-entry";

const bridge = vi.hoisted(() => ({
	onSessionChanged: vi.fn<(callback: () => void) => () => void>(
		() => () => undefined
	),
	platform: vi.fn(),
	session: vi.fn<() => Promise<DesktopSession>>(),
	signIn: vi.fn<() => Promise<void>>(async () => undefined),
	signOut: vi.fn(),
}));
const search = vi.hoisted(() => ({
	redirect: undefined as string | undefined,
}));
const router = vi.hoisted(() => ({
	navigate: vi.fn(async () => undefined),
	state: { location: { pathname: "/desktop-shell" } },
}));

vi.mock("./platform", () => ({ getDesktopPlatform: () => bridge }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-router")>()),
	useRouter: () => router,
	useSearch: () => search,
}));
vi.mock("#/lib/organizations/account-organization-context", () => ({
	readCurrentAccountOrganizationContext: vi.fn(async () => null),
}));

beforeEach(() => {
	window.localStorage.clear();
	bridge.onSessionChanged.mockClear();
	bridge.platform.mockReset().mockResolvedValue({
		platform: "desktop",
		lane: "dev-local",
		webOrigin: "http://lane.localhost:3000",
		webBuild: "a".repeat(64),
	});
	bridge.session.mockReset();
	bridge.signIn.mockReset().mockResolvedValue(undefined);
	bridge.signOut.mockReset();
	search.redirect = undefined;
	router.state.location.pathname = "/desktop-shell";
	router.navigate.mockClear();
	vi.mocked(readCurrentAccountOrganizationContext)
		.mockReset()
		.mockResolvedValue(null);
});

afterEach(() => {
	cleanup();
	window.localStorage.clear();
	vi.restoreAllMocks();
});

describe("Desktop entry session revalidation", () => {
	it.each([
		{
			name: "installed macOS Desktop",
			nativePlatform: "MacIntel",
			installedTarget: {
				kind: "production" as const,
				webOrigin: "https://openmeld.ai" as const,
				authScheme: "sh.openmeld.desktop" as const,
				clientId: "openmeld-desktop" as const,
				appId: "sh.openmeld.desktop" as const,
				dataDirectory: "OpenMeld Desktop" as const,
			},
			visible: true,
		},
		{
			name: "localhost mock-Keychain Desktop",
			nativePlatform: "MacIntel",
			installedTarget: undefined,
			visible: false,
		},
		{
			name: "installed Windows Desktop",
			nativePlatform: "Win32",
			installedTarget: {
				kind: "production" as const,
				webOrigin: "https://openmeld.ai" as const,
				authScheme: "sh.openmeld.desktop" as const,
				clientId: "openmeld-desktop" as const,
				appId: "sh.openmeld.desktop" as const,
				dataDirectory: "OpenMeld Desktop" as const,
			},
			visible: false,
		},
	])("shows the Keychain note only for $name", async (testCase) => {
		vi.spyOn(window.navigator, "platform", "get").mockReturnValue(
			testCase.nativePlatform
		);
		bridge.platform.mockResolvedValue({
			platform: "desktop",
			lane: testCase.installedTarget ? "prod" : "dev-local",
			webOrigin:
				testCase.installedTarget?.webOrigin ?? "http://lane.localhost:3000",
			webBuild: "a".repeat(64),
			...(testCase.installedTarget
				? { installedTarget: testCase.installedTarget }
				: {}),
		});
		bridge.session.mockResolvedValue({ user: null });
		const client = new QueryClient();
		render(
			<QueryClientProvider client={client}>
				<DesktopEntry />
			</QueryClientProvider>
		);
		await screen.findByRole("button", { name: "Sign in with browser" });
		const note = screen.queryByText(
			"macOS may ask for Keychain access to securely remember your sign-in."
		);
		if (testCase.visible) {
			expect(note).toBeTruthy();
		} else {
			expect(note).toBeNull();
		}
		client.clear();
	});

	it("retries temporary session failures without signing in or clearing same-account data", async () => {
		const first = createDeferred<DesktopSession>();
		bridge.session
			.mockReturnValueOnce(first.promise)
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValue({
				user: { id: "account-a", email: "a@example.com", name: "A" },
			});
		search.redirect = "/o/acme/spaces/a?threadId=b#message-c";
		const scope = draftScope();
		writeComposerDraft(scope, privateDraft());
		const client = new QueryClient();
		client.setQueryData(["private-data"], "preserved");
		render(
			<QueryClientProvider client={client}>
				<DesktopEntry />
			</QueryClientProvider>
		);
		expect(screen.getByText("Checking your sign-in…")).toBeTruthy();
		expect(screen.queryByText("Sign in to Desktop")).toBeNull();
		// An unknown read is an error, not an authoritative signed-out response.
		await act(() => first.reject(new Error("offline")));
		fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
		expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
		fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
		await waitFor(() =>
			expect(router.navigate).toHaveBeenCalledWith({
				to: search.redirect,
				replace: true,
			})
		);
		expect(bridge.signIn).not.toHaveBeenCalled();
		expect(bridge.signOut).not.toHaveBeenCalled();
		expect(client.getQueryData(["private-data"])).toBe("preserved");
		expect(readComposerDraft(scope)?.text).toBe("Private draft");
		client.clear();
	});

	it("retries workspace resolution through the existing organization owner", async () => {
		bridge.session.mockResolvedValue({
			user: { id: "account-a", email: "a@example.com", name: "A" },
		});
		vi.mocked(readCurrentAccountOrganizationContext)
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValue(
				accountOrganizationContextSchema.parse({
					currentUserId: "account-a",
					account: { email: null, image: null, name: null },
					organizations: [{ id: "org-a", slug: "acme", name: "Acme" }],
					defaultOrganizationId: "org-a",
				})
			);
		const client = new QueryClient();
		render(
			<QueryClientProvider client={client}>
				<DesktopEntry />
			</QueryClientProvider>
		);
		fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
		await waitFor(() =>
			expect(router.navigate).toHaveBeenCalledWith({
				to: "/o/acme/spaces",
				replace: true,
			})
		);
		expect(bridge.signIn).not.toHaveBeenCalled();
		expect(bridge.session).toHaveBeenCalledTimes(2);
		client.clear();
	});

	it.each([
		"completed",
		"unmounted",
	] as const)("keeps explicit browser sign-in separate from authentication: %s", async (outcome) => {
		bridge.session.mockResolvedValue({ user: null });
		const opening = createDeferred<void>();
		bridge.signIn.mockReturnValue(opening.promise);
		const client = new QueryClient();
		writeComposerDraft(draftScope(), privateDraft());
		const view = render(
			<QueryClientProvider client={client}>
				<DesktopEntry />
			</QueryClientProvider>
		);
		const button = await screen.findByRole("button", {
			name: "Sign in with browser",
		});
		expect(readComposerDraft(draftScope())).toBeNull();
		fireEvent.click(button);
		fireEvent.click(button);
		expect(bridge.signIn).toHaveBeenCalledTimes(1);
		expect(screen.getByText("Opening your browser")).toBeTruthy();
		if (outcome === "unmounted") {
			view.unmount();
		}
		await act(() => opening.resolve());
		expect(router.navigate).not.toHaveBeenCalled();
		if (outcome === "completed") {
			expect(screen.getByText("Continue in your browser")).toBeTruthy();
			search.redirect = undefined;
			bridge.session.mockResolvedValue({
				user: { id: "account-a", email: "a@example.com", name: "A" },
			});
			vi.mocked(readCurrentAccountOrganizationContext).mockResolvedValue(
				accountOrganizationContextSchema.parse({
					currentUserId: "account-a",
					account: { email: null, image: null, name: null },
					organizations: [{ id: "org-a", slug: "acme", name: "Acme" }],
					defaultOrganizationId: "org-a",
				})
			);
			act(() => bridge.onSessionChanged.mock.calls.at(-1)?.[0]());
			await waitFor(() => expect(router.navigate).toHaveBeenCalledTimes(1));
		}
		client.clear();
	});

	it.each([
		"session-changed",
		"left-page",
	] as const)("rejects an old retry after %s", async (event) => {
		bridge.session.mockRejectedValueOnce(new Error("offline"));
		const old = createDeferred<DesktopSession>();
		bridge.session
			.mockReturnValueOnce(old.promise)
			.mockResolvedValue({ user: null });
		search.redirect = "/o/acme/spaces/a";
		const client = new QueryClient();
		render(
			<QueryClientProvider client={client}>
				<DesktopEntry />
			</QueryClientProvider>
		);
		const retry = await screen.findByRole("button", { name: "Retry" });
		fireEvent.click(retry);
		fireEvent.click(retry);
		act(() => window.dispatchEvent(new Event("focus")));
		await waitFor(() => expect(bridge.session).toHaveBeenCalledTimes(2));
		if (event === "session-changed") {
			act(() => bridge.onSessionChanged.mock.calls.at(-1)?.[0]());
		} else {
			router.state.location.pathname = "/o/other/spaces";
		}
		await act(() =>
			old.resolve({
				user: { id: "old-account", email: "old@example.com", name: "Old" },
			})
		);
		if (event === "session-changed") {
			await screen.findByRole("button", { name: "Sign in with browser" });
		}
		expect(router.navigate).not.toHaveBeenCalled();
		expect(bridge.signIn).not.toHaveBeenCalled();
		expect(bridge.signOut).not.toHaveBeenCalled();
		client.clear();
	});

	it("keeps confirmed missing membership terminal instead of retrying or choosing an organization", async () => {
		bridge.session.mockResolvedValue({
			user: { id: "account-a", email: "a@example.com", name: "A" },
		});
		vi.mocked(readCurrentAccountOrganizationContext).mockResolvedValue(
			accountOrganizationContextSchema.parse({
				currentUserId: "account-a",
				account: { email: null, image: null, name: null },
				organizations: [],
				defaultOrganizationId: null,
			})
		);
		const client = new QueryClient();
		render(
			<QueryClientProvider client={client}>
				<DesktopEntry />
			</QueryClientProvider>
		);
		await screen.findByText("No organization is available for this account.");
		act(() => window.dispatchEvent(new Event("focus")));
		expect(screen.queryByRole("button")).toBeNull();
		expect(bridge.session).toHaveBeenCalledTimes(1);
		expect(router.navigate).not.toHaveBeenCalled();
		client.clear();
	});
	it("preserves an unmounted Composer draft while the same account is revalidated", async () => {
		bridge.session.mockResolvedValueOnce({
			user: { id: "account-a", email: "a@example.com", name: "A" },
		});
		const revalidation = createDeferred<DesktopSession>();
		bridge.session.mockReturnValueOnce(revalidation.promise);
		const scope = draftScope();
		writeComposerDraft(scope, privateDraft());
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		const client = new QueryClient();
		render(
			<QueryClientProvider client={client}>
				<DesktopEntry />
			</QueryClientProvider>
		);
		await waitFor(() => expect(bridge.session).toHaveBeenCalledTimes(1));
		const onSessionChanged = bridge.onSessionChanged.mock.calls.at(-1)?.[0];
		if (!onSessionChanged) {
			throw new Error("Missing native session listener");
		}
		act(onSessionChanged);
		await waitFor(() => expect(bridge.session).toHaveBeenCalledTimes(2));
		expect(readComposerDraft(scope)?.text).toBe("Private draft");
		await act(() =>
			revalidation.resolve({
				user: { id: "account-a", email: "a@example.com", name: "A" },
			})
		);
		expect(readComposerDraft(scope)?.text).toBe("Private draft");
		expect(consoleError).toHaveBeenCalled();
		client.clear();
	});

	it("clears private drafts when entry revalidation confirms a replacement account", async () => {
		bridge.session
			.mockResolvedValueOnce({
				user: { id: "account-a", email: "a@example.com", name: "A" },
			})
			.mockResolvedValueOnce({
				user: { id: "account-b", email: "b@example.com", name: "B" },
			});
		const scope = draftScope();
		writeComposerDraft(scope, privateDraft());
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		const client = new QueryClient();
		render(
			<QueryClientProvider client={client}>
				<DesktopEntry />
			</QueryClientProvider>
		);
		await waitFor(() => expect(bridge.session).toHaveBeenCalledTimes(1));
		const onSessionChanged = bridge.onSessionChanged.mock.calls.at(-1)?.[0];
		if (!onSessionChanged) {
			throw new Error("Missing native session listener");
		}
		act(onSessionChanged);
		await waitFor(() => expect(bridge.session).toHaveBeenCalledTimes(2));
		await waitFor(() => expect(readComposerDraft(scope)).toBeNull());
		client.clear();
	});

	it("keeps same-tick native invalidation when focus requests the latest session read", async () => {
		bridge.session
			.mockResolvedValueOnce({
				user: { id: "account-a", email: "a@example.com", name: "A" },
			})
			.mockResolvedValueOnce({
				user: { id: "account-a", email: "a@example.com", name: "A" },
			});
		const scope = draftScope();
		writeComposerDraft(scope, privateDraft());
		const client = new QueryClient();
		const privateQueryKey = ["private-account-state"] as const;
		client.setQueryData(privateQueryKey, "stale");
		render(
			<QueryClientProvider client={client}>
				<DesktopEntry />
			</QueryClientProvider>
		);
		await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
		const onSessionChanged = bridge.onSessionChanged.mock.calls.at(-1)?.[0];
		if (!onSessionChanged) {
			throw new Error("Missing native session listener");
		}

		act(() => {
			onSessionChanged();
			window.dispatchEvent(new Event("focus"));
		});

		await waitFor(() => expect(bridge.session).toHaveBeenCalledTimes(2));
		await waitFor(() =>
			expect(client.getQueryData(privateQueryKey)).toBeUndefined()
		);
		expect(readComposerDraft(scope)?.text).toBe("Private draft");
		// Workspace failure does not keep replaying an already handled native invalidation.
		const retry = await screen.findByRole("button", { name: "Retry" });
		client.setQueryData(privateQueryKey, "fresh same-account data");
		bridge.session.mockResolvedValue({
			user: { id: "account-a", email: "a@example.com", name: "A" },
		});
		fireEvent.click(retry);
		await screen.findByRole("button", { name: "Retry" });
		expect(client.getQueryData(privateQueryKey)).toBe(
			"fresh same-account data"
		);
		client.clear();
	});
});

function draftScope() {
	return {
		kind: "space" as const,
		ownerAccountId: "account-a",
		profileId: "human-a",
		spaceId: "unmounted-space",
	};
}

function privateDraft() {
	return createComposerDraftRecord({
		...EMPTY_COMPOSER_DRAFT_CONTENT,
		text: "Private draft",
	});
}

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve;
		reject = promiseReject;
	});
	return { promise, resolve, reject };
}
