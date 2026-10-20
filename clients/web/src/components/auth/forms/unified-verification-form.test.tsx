import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authFormHookMocks = vi.hoisted(() => ({
	resendVerificationEmailMutateAsync: vi.fn(),
	verifyEmailMutateAsync: vi.fn(),
	verifyMagicLinkMutateAsync: vi.fn(),
}));

const authSessionMock = vi.hoisted(() => ({
	data: null as null | {
		session: { id: string };
		user: { email?: string; id: string };
	},
	refetch: vi.fn(),
}));

const resolveActiveOrganizationEntryPathMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}));

vi.mock("#/hooks/auth.hooks", () => ({
	useAuthSession: () => authSessionMock,
}));

vi.mock("#/hooks/auth-form.hooks", () => ({
	useResendVerificationEmail: () => ({
		isPending: false,
		mutateAsync: authFormHookMocks.resendVerificationEmailMutateAsync,
	}),
	useVerifyEmailToken: () => ({
		mutateAsync: authFormHookMocks.verifyEmailMutateAsync,
	}),
	useVerifyMagicLinkToken: () => ({
		mutateAsync: authFormHookMocks.verifyMagicLinkMutateAsync,
	}),
}));

vi.mock("#/lib/organizations/organization-scope", () => ({
	resolveActiveOrganizationEntryPath: resolveActiveOrganizationEntryPathMock,
}));

vi.mock("sonner", () => ({
	toast: {
		error: toastErrorMock,
		success: toastSuccessMock,
	},
}));

import { UnifiedVerificationForm } from "./unified-verification-form";

describe("UnifiedVerificationForm magic-link session confirmation", () => {
	beforeEach(() => {
		cleanup();
		window.history.replaceState(
			{},
			"",
			"http://localhost:3000/magic-link?token=token-123"
		);
		authSessionMock.data = null;
		authSessionMock.refetch.mockReset();
		resolveActiveOrganizationEntryPathMock.mockReset();
		toastSuccessMock.mockReset();
		toastErrorMock.mockReset();
		for (const mock of Object.values(authFormHookMocks)) {
			mock.mockReset();
		}
	});

	afterEach(() => {
		vi.useRealTimers();
		cleanup();
	});

	it("shows magic-link success only after a fresh session is confirmed", async () => {
		authFormHookMocks.verifyMagicLinkMutateAsync.mockResolvedValue({
			redirectTo: "/login",
		});
		authSessionMock.refetch.mockResolvedValue({
			data: {
				session: { id: "session-123" },
				user: { id: "user-123" },
			},
		});
		resolveActiveOrganizationEntryPathMock.mockResolvedValue(
			"/o/acme/new-space"
		);

		render(<UnifiedVerificationForm verificationKind="magic-link" />);

		await screen.findByText("You're signed in.");

		expect(authFormHookMocks.verifyMagicLinkMutateAsync).toHaveBeenCalledWith(
			expect.objectContaining({
				token: "token-123",
			})
		);
		expect(authSessionMock.refetch).toHaveBeenCalledTimes(1);
		expect(resolveActiveOrganizationEntryPathMock).toHaveBeenCalledWith({
			data: { routeFamily: "/magic-link" },
		});
		const continueLink = screen.getByRole("link", {
			name: "Continue to OpenMeld",
		});
		expect(continueLink.getAttribute("href")).toBe("/o/acme/new-space");
		expect(screen.queryByText("Go to sign in")).toBeNull();
		expect(toastSuccessMock).toHaveBeenCalledWith("You're signed in.");
	});

	it("waits for the new magic-link session to become readable", async () => {
		vi.useFakeTimers();
		authFormHookMocks.verifyMagicLinkMutateAsync.mockResolvedValue({
			redirectTo: "/login",
		});
		authSessionMock.refetch
			.mockResolvedValueOnce({ data: null })
			.mockResolvedValueOnce({
				data: {
					session: { id: "session-123" },
					user: { id: "user-123" },
				},
			});
		resolveActiveOrganizationEntryPathMock.mockResolvedValue(
			"/o/acme/new-space"
		);

		render(<UnifiedVerificationForm verificationKind="magic-link" />);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
		expect(authSessionMock.refetch).toHaveBeenCalledTimes(1);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(250);
		});

		expect(screen.getByText("You're signed in.")).toBeTruthy();

		expect(authSessionMock.refetch).toHaveBeenCalledTimes(2);
		expect(screen.queryByText("Sign-in Not Completed")).toBeNull();
		expect(resolveActiveOrganizationEntryPathMock).toHaveBeenCalledWith({
			data: { routeFamily: "/magic-link" },
		});
	});

	it("does not show success when verification completes without a session", async () => {
		vi.useFakeTimers();
		authFormHookMocks.verifyMagicLinkMutateAsync.mockResolvedValue({
			redirectTo: "/login",
		});
		authSessionMock.refetch.mockResolvedValue({ data: null });

		render(<UnifiedVerificationForm verificationKind="magic-link" />);
		await act(async () => {
			await vi.runAllTimersAsync();
		});

		expect(screen.getByText("Sign-in Not Completed")).toBeTruthy();

		expect(screen.queryByText("You're signed in.")).toBeNull();
		expect(
			screen.queryByRole("link", { name: "Continue to OpenMeld" })
		).toBeNull();
		expect(
			screen.getByRole("button", { name: "Request New Magic Link" })
		).toBeTruthy();
		expect(authSessionMock.refetch).toHaveBeenCalledTimes(5);
		expect(resolveActiveOrganizationEntryPathMock).not.toHaveBeenCalled();
		expect(toastSuccessMock).not.toHaveBeenCalled();
	});

	it("does not show success when a redirect verification error has no session", async () => {
		vi.useFakeTimers();
		authFormHookMocks.verifyMagicLinkMutateAsync.mockRejectedValue(
			Object.assign(
				new Error(
					"Authentication redirected before OpenMeld confirmed a signed-in session."
				),
				{ code: "session_not_established" }
			)
		);
		authSessionMock.refetch.mockResolvedValue({ data: null });

		render(<UnifiedVerificationForm verificationKind="magic-link" />);
		await act(async () => {
			await vi.runAllTimersAsync();
		});

		expect(screen.getByText("Sign-in Not Completed")).toBeTruthy();

		expect(screen.queryByText("You're signed in.")).toBeNull();
		expect(
			screen.queryByRole("link", { name: "Continue to OpenMeld" })
		).toBeNull();
		expect(resolveActiveOrganizationEntryPathMock).not.toHaveBeenCalled();
		expect(toastSuccessMock).not.toHaveBeenCalled();
	});

	it.each([
		"/accept-invitation?invitationId=inv-1",
		"/accept-space-invitation?invitationId=inv-1",
		"/join-organization?token=joinlink_123",
		"/desktop-sign-in?client_id=electron&code_challenge=test-challenge&code_challenge_method=S256&state=test-state",
		// A signed-out deep link returns to the page that asked for sign-in.
		"/o/acme/agents?memberAgentId=agent-1",
	])("returns a magic-link visitor to %s", async (redirectTarget) => {
		window.history.replaceState(
			{},
			"",
			`http://localhost:3000/magic-link?token=token-123&redirect=${encodeURIComponent(redirectTarget)}`
		);
		authFormHookMocks.verifyMagicLinkMutateAsync.mockResolvedValue({
			redirectTo: "/login",
		});
		authSessionMock.refetch.mockResolvedValue({
			data: { session: { id: "session-1" }, user: { id: "user-1" } },
		});

		render(<UnifiedVerificationForm verificationKind="magic-link" />);

		await screen.findByText("You're signed in.");

		const continueLink = screen.getByRole("link", {
			name: "Continue to OpenMeld",
		});
		expect(continueLink.getAttribute("href")).toBe(redirectTarget);
		expect(resolveActiveOrganizationEntryPathMock).not.toHaveBeenCalled();
	});

	it.each([
		[
			"/accept-invitation?invitationId=inv-1",
			"Continue to accept the invitation",
		],
		[
			"/accept-space-invitation?invitationId=inv-1",
			"Continue to accept the invitation",
		],
		[
			"/desktop-sign-in?client_id=electron&code_challenge=test-challenge&state=test-state",
			"Continue to OpenMeld",
		],
	])("returns a verified-email visitor to %s", async (redirectTarget, label) => {
		window.history.replaceState(
			{},
			"",
			`http://localhost:3000/verify-email?token=token-123&redirect=${encodeURIComponent(redirectTarget)}`
		);
		authFormHookMocks.verifyEmailMutateAsync.mockResolvedValue(undefined);

		render(<UnifiedVerificationForm verificationKind="email" />);

		const continueLink = await screen.findByRole("link", {
			name: label,
		});
		expect(continueLink.getAttribute("href")).toBe(redirectTarget);
		expect(authFormHookMocks.verifyEmailMutateAsync).toHaveBeenCalledWith({
			callbackURL: `http://localhost:3000/verify-email?redirect=${encodeURIComponent(redirectTarget)}`,
			token: "token-123",
		});
	});

	it("lands a verified-email visitor in the app when auto sign-in succeeds", async () => {
		window.history.replaceState(
			{},
			"",
			"http://localhost:3000/verify-email?token=token-123"
		);
		authFormHookMocks.verifyEmailMutateAsync.mockResolvedValue(undefined);
		authSessionMock.refetch.mockResolvedValue({
			data: { session: { id: "session-1" }, user: { id: "user-1" } },
		});
		resolveActiveOrganizationEntryPathMock.mockResolvedValue("/o/acme/spaces");

		render(<UnifiedVerificationForm verificationKind="email" />);

		const continueLink = await screen.findByRole("link", {
			name: "Continue to OpenMeld",
		});
		expect(continueLink.getAttribute("href")).toBe("/o/acme/spaces");
		expect(resolveActiveOrganizationEntryPathMock).toHaveBeenCalledWith({
			data: { routeFamily: "/verify-email" },
		});
	});

	it("falls back to sign-in when the verified-email session is missing", async () => {
		window.history.replaceState(
			{},
			"",
			"http://localhost:3000/verify-email?token=token-123"
		);
		authFormHookMocks.verifyEmailMutateAsync.mockResolvedValue(undefined);
		authSessionMock.refetch.mockResolvedValue({ data: null });

		render(<UnifiedVerificationForm verificationKind="email" />);

		const signInLink = await screen.findByRole("link", {
			name: "Sign in to OpenMeld",
		});
		expect(signInLink.getAttribute("href")).toBe("/login");
		expect(resolveActiveOrganizationEntryPathMock).not.toHaveBeenCalled();
	});
});
