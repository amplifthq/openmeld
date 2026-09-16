import type { DesktopSession } from "@openmeld/schemas";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createComposerDraftRecord,
	EMPTY_COMPOSER_DRAFT_CONTENT,
	readComposerDraft,
	writeComposerDraft,
} from "#/lib/composer-draft-storage";
import { DesktopEntry } from "./desktop-entry";

const bridge = vi.hoisted(() => ({
	onSessionChanged: vi.fn<(callback: () => void) => () => void>(
		() => () => undefined
	),
	session: vi.fn<() => Promise<DesktopSession>>(),
	signIn: vi.fn(async () => undefined),
}));
const router = vi.hoisted(() => ({
	navigate: vi.fn(async () => undefined),
	state: { location: { pathname: "/desktop-shell" } },
}));

vi.mock("./platform", () => ({ getDesktopPlatform: () => bridge }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-router")>()),
	useRouter: () => router,
	useSearch: () => ({}),
}));
vi.mock("#/lib/organizations/organization-scope", () => ({
	resolveOptionalActiveOrganizationEntryPath: vi.fn(async () => undefined),
}));

beforeEach(() => {
	window.localStorage.clear();
	bridge.onSessionChanged.mockClear();
	bridge.session.mockReset();
	router.navigate.mockClear();
});

afterEach(() => {
	cleanup();
	window.localStorage.clear();
	vi.restoreAllMocks();
});

describe("Desktop entry session revalidation", () => {
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
