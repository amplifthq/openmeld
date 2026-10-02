import type { DesktopSession } from "@openmeld/schemas";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	type RouterHistory,
} from "@tanstack/react-router";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import {
	createComposerDraftRecord,
	EMPTY_COMPOSER_DRAFT_CONTENT,
	readComposerDraft,
	writeComposerDraft,
} from "../lib/composer-draft-storage";
import { SPACE_CONVERSATION_LAYOUT_BOOTSTRAP_SCRIPT } from "../lib/spaces/conversation-layout-preference";
import { SPACE_SELF_MESSAGE_ALIGNMENT_BOOTSTRAP_SCRIPT } from "../lib/spaces/self-message-alignment-preference";
import { completeAccountAuthChange } from "../query/auth-boundary";
import { userQueryKeys } from "../query/query-keys";
import { DesktopFrame } from "./desktop-frame";
import { useDesktopTitlebar } from "./titlebar-context";

const native = vi.hoisted(() => ({
	available: false,
	pathname: "/desktop-shell",
}));
const bridge = vi.hoisted(() => ({
	updaterState: vi.fn(async () => ({
		status: "unavailable",
		currentVersion: "0.1.1",
		version: null,
		percent: null,
		errorStage: null,
	})),
	onUpdaterChanged: vi.fn(() => () => undefined),
	onUpdaterPrepare: vi.fn(() => () => undefined),
	onSessionChanged: vi.fn<(callback: () => void) => () => void>(
		() => () => undefined
	),
	onNavigationRequest: vi.fn<(callback: (href: string) => void) => () => void>(
		() => () => undefined
	),
	session: vi.fn<() => Promise<DesktopSession>>(),
}));
const router = vi.hoisted(() => ({
	history: null as RouterHistory | null,
	invalidate: vi.fn(() => Promise.resolve()),
}));

vi.mock("./platform", async (importOriginal) => ({
	...(await importOriginal<typeof import("./platform")>()),
	getDesktopPlatform: () => (native.available ? bridge : null),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-router")>()),
	useRouter: () => router,
	useLocation: () => native.pathname,
}));

beforeEach(() => {
	router.history = createMemoryHistory({ initialEntries: ["/desktop-shell"] });
	router.invalidate.mockClear();
	bridge.onSessionChanged.mockClear();
	bridge.onNavigationRequest.mockClear();
	bridge.session.mockReset();
});
afterEach(() => {
	native.available = false;
	native.pathname = "/desktop-shell";
	cleanup();
	window.localStorage.clear();
});

describe("Desktop document hydration", () => {
	it("routes a native app navigation request without reloading the document", async () => {
		native.available = true;
		document.body.inert = false;
		const client = new QueryClient();
		render(
			<QueryClientProvider client={client}>
				<DesktopFrame>
					<main>Workspace</main>
				</DesktopFrame>
			</QueryClientProvider>
		);
		const navigate = bridge.onNavigationRequest.mock.calls.at(-1)?.[0];
		if (!navigate) {
			throw new Error("Missing native navigation listener");
		}
		await waitFor(() => expect(document.body.inert).toBe(false));

		act(() => navigate("/o/team/agents?profileId=agent-1#activity"));

		expect(router.history?.location.href).toBe(
			"/o/team/agents?profileId=agent-1#activity"
		);
		act(() => navigate("/v1/private"));
		expect(router.history?.location.href).toBe(
			"/o/team/agents?profileId=agent-1#activity"
		);
		client.clear();
	});

	it("preserves an unmounted Composer draft while native identity revalidation is pending and confirms the same account", async () => {
		native.available = true;
		native.pathname = "/o/team/spaces";
		const revalidation = createDeferred<DesktopSession>();
		bridge.session.mockReturnValueOnce(revalidation.promise);
		const scope = draftScope();
		writeComposerDraft(scope, privateDraft());
		const client = new QueryClient();
		seedAccountSession(client, "account-a");
		render(
			<QueryClientProvider client={client}>
				<DesktopFrame>
					<main>Workspace</main>
				</DesktopFrame>
			</QueryClientProvider>
		);
		const onSessionChanged = bridge.onSessionChanged.mock.calls.at(-1)?.[0];
		if (!onSessionChanged) {
			throw new Error("Missing native session listener");
		}
		act(onSessionChanged);
		await waitFor(() => expect(bridge.session).toHaveBeenCalledTimes(1));
		expect(readComposerDraft(scope)?.text).toBe("Private draft");
		await act(() =>
			revalidation.resolve({
				user: { id: "account-a", email: "a@example.com", name: "A" },
			})
		);
		expect(readComposerDraft(scope)?.text).toBe("Private draft");
		client.clear();
	});

	it("preserves an unmounted Composer draft when native identity revalidation fails", async () => {
		native.available = true;
		native.pathname = "/o/team/spaces";
		bridge.session.mockRejectedValueOnce(new Error("Auth unavailable"));
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		const scope = draftScope();
		writeComposerDraft(scope, privateDraft());
		const client = new QueryClient();
		seedAccountSession(client, "account-a");
		render(
			<QueryClientProvider client={client}>
				<DesktopFrame>
					<main>Workspace</main>
				</DesktopFrame>
			</QueryClientProvider>
		);
		const onSessionChanged = bridge.onSessionChanged.mock.calls.at(-1)?.[0];
		if (!onSessionChanged) {
			throw new Error("Missing native session listener");
		}
		act(onSessionChanged);
		await waitFor(() => expect(consoleError).toHaveBeenCalled());
		expect(readComposerDraft(scope)?.text).toBe("Private draft");
		client.clear();
	});

	it("clears private drafts before exposing a confirmed replacement account", async () => {
		native.available = true;
		native.pathname = "/o/team/spaces";
		bridge.session.mockResolvedValueOnce({
			user: { id: "account-b", email: "b@example.com", name: "B" },
		});
		const scope = draftScope();
		writeComposerDraft(scope, privateDraft());
		const client = new QueryClient();
		seedAccountSession(client, "account-a");
		render(
			<QueryClientProvider client={client}>
				<DesktopFrame>
					<main>Workspace</main>
				</DesktopFrame>
			</QueryClientProvider>
		);
		const onSessionChanged = bridge.onSessionChanged.mock.calls.at(-1)?.[0];
		if (!onSessionChanged) {
			throw new Error("Missing native session listener");
		}
		act(onSessionChanged);
		await waitFor(() => expect(router.invalidate).toHaveBeenCalledTimes(1));
		expect(readComposerDraft(scope)).toBeNull();
		client.clear();
	});

	it("ignores an older replacement-account read after a newer invalidation", async () => {
		native.available = true;
		native.pathname = "/o/team/spaces";
		const staleRead = createDeferred<DesktopSession>();
		bridge.session
			.mockReturnValueOnce(staleRead.promise)
			.mockResolvedValueOnce({
				user: { id: "account-a", email: "a@example.com", name: "A" },
			});
		const scope = draftScope();
		writeComposerDraft(scope, privateDraft());
		const client = new QueryClient();
		seedAccountSession(client, "account-a");
		render(
			<QueryClientProvider client={client}>
				<DesktopFrame>
					<main>Workspace</main>
				</DesktopFrame>
			</QueryClientProvider>
		);
		const onSessionChanged = bridge.onSessionChanged.mock.calls.at(-1)?.[0];
		if (!onSessionChanged) {
			throw new Error("Missing native session listener");
		}
		act(onSessionChanged);
		await waitFor(() => expect(bridge.session).toHaveBeenCalledTimes(1));
		act(onSessionChanged);
		await act(() =>
			staleRead.resolve({
				user: { id: "account-b", email: "b@example.com", name: "B" },
			})
		);
		await waitFor(() => expect(bridge.session).toHaveBeenCalledTimes(2));
		await waitFor(() => expect(router.invalidate).toHaveBeenCalledTimes(1));
		expect(readComposerDraft(scope)?.text).toBe("Private draft");
		client.clear();
	});

	it("keeps native invalidation authoritative when focus supersedes its pending session read", async () => {
		native.available = true;
		native.pathname = "/o/team/spaces";
		const staleRead = createDeferred<DesktopSession>();
		const replacementSession = {
			user: { id: "account-b", email: "b@example.com", name: "B" },
		};
		bridge.session
			.mockReturnValueOnce(staleRead.promise)
			.mockResolvedValueOnce(replacementSession);
		const scope = draftScope();
		writeComposerDraft(scope, privateDraft());
		const client = new QueryClient();
		seedAccountSession(client, "account-a");
		render(
			<QueryClientProvider client={client}>
				<DesktopFrame>
					<main>Workspace</main>
				</DesktopFrame>
			</QueryClientProvider>
		);
		const onSessionChanged = bridge.onSessionChanged.mock.calls.at(-1)?.[0];
		if (!onSessionChanged) {
			throw new Error("Missing native session listener");
		}

		act(onSessionChanged);
		await waitFor(() => expect(bridge.session).toHaveBeenCalledTimes(1));
		act(() => window.dispatchEvent(new Event("focus")));
		await act(() => staleRead.resolve(replacementSession));

		await waitFor(() => expect(bridge.session).toHaveBeenCalledTimes(2));
		await waitFor(() => expect(router.invalidate).toHaveBeenCalledTimes(1));
		expect(readComposerDraft(scope)).toBeNull();
		client.clear();
	});

	it("preserves new-account drafts after Desktop Entry completes the account handoff", async () => {
		native.available = true;
		native.pathname = "/o/team/spaces";
		const staleSignOutRead = createDeferred<DesktopSession>();
		const accountA = {
			user: { id: "account-a", email: "a@example.com", name: "A" },
		};
		const accountB = {
			user: { id: "account-b", email: "b@example.com", name: "B" },
		};
		bridge.session
			.mockResolvedValueOnce(accountA)
			.mockReturnValueOnce(staleSignOutRead.promise)
			.mockResolvedValueOnce(accountB);
		const client = new QueryClient();
		seedAccountSession(client, "account-a");
		const page = () => (
			<QueryClientProvider client={client}>
				<DesktopFrame>
					<main>Workspace</main>
				</DesktopFrame>
			</QueryClientProvider>
		);
		const view = render(page());

		act(() => window.dispatchEvent(new Event("focus")));
		await waitFor(() => expect(bridge.session).toHaveBeenCalledTimes(1));
		const onSessionChanged = bridge.onSessionChanged.mock.calls.at(-1)?.[0];
		if (!onSessionChanged) {
			throw new Error("Missing native session listener");
		}
		act(onSessionChanged);
		await waitFor(() => expect(bridge.session).toHaveBeenCalledTimes(2));

		await completeAccountAuthChange(client, "signed-out");
		native.pathname = "/desktop-shell";
		view.rerender(page());
		await act(() => staleSignOutRead.resolve({ user: null }));

		seedAccountSession(client, "account-b");
		native.pathname = "/o/team/spaces";
		view.rerender(page());
		const accountBDraft = {
			kind: "space" as const,
			ownerAccountId: "account-b",
			profileId: "human-b",
			spaceId: "account-b-space",
		};
		writeComposerDraft(accountBDraft, privateDraft());
		act(() => window.dispatchEvent(new Event("focus")));

		await waitFor(() => expect(bridge.session).toHaveBeenCalledTimes(3));
		expect(readComposerDraft(accountBDraft)?.text).toBe("Private draft");
		client.clear();
	});

	it("does not apply a replacement-account read after the Desktop frame is disposed", async () => {
		native.available = true;
		native.pathname = "/o/team/spaces";
		const revalidation = createDeferred<DesktopSession>();
		bridge.session.mockReturnValueOnce(revalidation.promise);
		const scope = draftScope();
		writeComposerDraft(scope, privateDraft());
		const client = new QueryClient();
		seedAccountSession(client, "account-a");
		const view = render(
			<QueryClientProvider client={client}>
				<DesktopFrame>
					<main>Workspace</main>
				</DesktopFrame>
			</QueryClientProvider>
		);
		const onSessionChanged = bridge.onSessionChanged.mock.calls.at(-1)?.[0];
		if (!onSessionChanged) {
			throw new Error("Missing native session listener");
		}
		act(onSessionChanged);
		await waitFor(() => expect(bridge.session).toHaveBeenCalledTimes(1));
		view.unmount();
		await act(() =>
			revalidation.resolve({
				user: { id: "account-b", email: "b@example.com", name: "B" },
			})
		);
		expect(readComposerDraft(scope)?.text).toBe("Private draft");
		expect(router.invalidate).not.toHaveBeenCalled();
		client.clear();
	});

	it("closes both history directions on native session invalidation before the new account read completes", async () => {
		const history = createMemoryHistory({ initialEntries: ["/o/team/spaces"] });
		router.history = history;
		native.available = true;
		native.pathname = "/o/team/spaces";
		let resolveSession!: (session: DesktopSession) => void;
		bridge.session.mockReturnValue(
			new Promise((resolve) => {
				resolveSession = resolve;
			})
		);
		const controls: { current: ReturnType<typeof useDesktopTitlebar> } = {
			current: null,
		};
		function Probe() {
			controls.current = useDesktopTitlebar();
			return null;
		}
		const client = new QueryClient();
		render(
			<QueryClientProvider client={client}>
				<DesktopFrame>
					<Probe />
				</DesktopFrame>
			</QueryClientProvider>
		);
		await waitFor(() => expect(controls.current).not.toBeNull());
		if (!controls.current) {
			throw new Error("Missing native titlebar context");
		}
		const navigation = controls.current.navigation;
		act(() => {
			navigation.identify("account-a");
			history.push("/o/team/people");
			history.push("/o/team/inbox");
			navigation.back();
		});
		expect(navigation.getSnapshot()).toEqual({ back: true, forward: true });
		const onSessionChanged = bridge.onSessionChanged.mock.calls.at(-1)?.[0];
		if (!onSessionChanged) {
			throw new Error("Missing native session listener");
		}
		act(onSessionChanged);
		expect(navigation.getSnapshot()).toEqual({ back: false, forward: false });
		await waitFor(() => expect(bridge.session).toHaveBeenCalled());
		await act(() =>
			resolveSession({
				user: { id: "account-b", email: "b@example.com", name: "B" },
			})
		);
		navigation.back();
		navigation.forward();
		expect(history.location.href).toBe("/o/team/people");
		client.clear();
	});
	it.each([
		[null, null, "full-width", "right"],
		["centered", "right", "centered", "right"],
		["full-width", "left", "full-width", "left"],
	])("preserves Appearance on first open and reopen with saved %s / %s", async (savedLayout, savedAlignment, layout, alignment) => {
		window.localStorage.clear();
		if (savedLayout) {
			window.localStorage.setItem(
				"openmeld.space.conversation-layout",
				savedLayout
			);
		}
		if (savedAlignment) {
			window.localStorage.setItem(
				"openmeld.space.self-message-alignment",
				savedAlignment
			);
		}
		const queryClient = new QueryClient();
		const page = (
			<QueryClientProvider client={queryClient}>
				<html lang="en" suppressHydrationWarning>
					<head />
					<body>
						<DesktopFrame>
							<main>Welcome Space</main>
						</DesktopFrame>
					</body>
				</html>
			</QueryClientProvider>
		);
		for (let open = 0; open < 2; open++) {
			native.available = false;
			document.open();
			document.write(`<!doctype html>${renderToString(page)}`);
			document.close();
			// Execute the same pre-paint scripts as the packaged document.
			const context = { window, document, console };
			runInNewContext(SPACE_CONVERSATION_LAYOUT_BOOTSTRAP_SCRIPT, context);
			runInNewContext(SPACE_SELF_MESSAGE_ALIGNMENT_BOOTSTRAP_SCRIPT, context);
			native.available = true;
			const onRecoverableError = vi.fn();
			let root: ReturnType<typeof hydrateRoot> | undefined;
			await act(() => {
				root = hydrateRoot(document, page, { onRecoverableError });
			});
			expect(onRecoverableError).not.toHaveBeenCalled();
			expect(document.querySelector(".desktop-content main")?.textContent).toBe(
				"Welcome Space"
			);
			expect(
				document.documentElement.getAttribute("data-space-conversation-layout")
			).toBe(layout);
			expect(
				document.documentElement.getAttribute(
					"data-space-self-message-alignment"
				)
			).toBe(alignment);
			expect(
				window.localStorage.getItem("openmeld.space.conversation-layout")
			).toBe(savedLayout);
			expect(
				window.localStorage.getItem("openmeld.space.self-message-alignment")
			).toBe(savedAlignment);
			await act(() => root?.unmount());
		}
		queryClient.clear();
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
	const promise = new Promise<T>((promiseResolve) => {
		resolve = promiseResolve;
	});
	return { promise, resolve };
}

function seedAccountSession(client: QueryClient, accountId: string) {
	client.setQueryData(userQueryKeys.session, {
		session: { id: "session-a" },
		user: {
			id: accountId,
			email: "a@example.com",
			name: "A",
			image: null,
			emailVerified: true,
			createdAt: "2026-09-16T00:00:00.000Z",
		},
	});
}

import { runInNewContext } from "node:vm";
