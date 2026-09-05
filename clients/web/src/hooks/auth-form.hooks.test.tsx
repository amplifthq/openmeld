import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authFormApiMocks = vi.hoisted(() => ({
	requestPasswordReset: vi.fn(),
	resetPassword: vi.fn(),
	sendVerificationEmail: vi.fn(),
	signInWithEmail: vi.fn(),
	signInWithMagicLink: vi.fn(),
	signOutSession: vi.fn(),
	signUpWithEmail: vi.fn(),
	verifyEmailToken: vi.fn(),
	verifyMagicLinkToken: vi.fn(),
}));
const authQueryMocks = vi.hoisted(() => ({
	getSession: vi.fn(),
	listDeviceSessions: vi.fn(),
	revokeDeviceSession: vi.fn(),
}));

vi.mock("#/lib/auth-form-api", () => authFormApiMocks);
vi.mock("#/query/auth-query", () => authQueryMocks);

import {
	useEmailSignIn,
	useEmailSignUp,
	useLogoutAction,
	useLogoutAllAccountsAction,
	useResendVerificationEmail,
} from "./auth-form.hooks";

function createQueryClient() {
	return new QueryClient({
		defaultOptions: {
			mutations: { retry: false },
			queries: { retry: false },
		},
	});
}

function createWrapper(queryClient: QueryClient) {
	return function Wrapper(input: PropsWithChildren) {
		return (
			<QueryClientProvider client={queryClient}>
				{input.children}
			</QueryClientProvider>
		);
	};
}

describe("auth-form hooks", () => {
	const originalUrl = window.location.href;

	beforeEach(() => {
		window.history.replaceState({}, "", "http://localhost:3000/login");
		for (const mock of Object.values(authFormApiMocks)) {
			mock.mockReset();
		}
		for (const mock of Object.values(authQueryMocks)) {
			mock.mockReset();
		}
		authQueryMocks.getSession.mockResolvedValue({
			session: { token: "session-a", userId: "user-a" },
			user: { email: "a@example.com", id: "user-a", name: "Account A" },
		});
		authQueryMocks.listDeviceSessions.mockResolvedValue([
			{
				session: { token: "session-a", userId: "user-a" },
				user: { email: "a@example.com", id: "user-a", name: "Account A" },
			},
		]);
		authQueryMocks.revokeDeviceSession.mockResolvedValue(undefined);
	});

	afterEach(() => {
		window.history.replaceState({}, "", originalUrl);
	});

	it("clears old account queries after email sign-in succeeds", async () => {
		const queryClient = createQueryClient();
		queryClient.setQueryData(["agents", "execution-readiness", "old-user"], {
			displayState: "checking",
		});
		authFormApiMocks.signInWithEmail.mockResolvedValue({
			data: {},
			error: null,
		});

		const { result } = renderHook(() => useEmailSignIn(), {
			wrapper: createWrapper(queryClient),
		});

		await act(async () => {
			await result.current.mutateAsync({
				email: "felix@example.com",
				password: "password",
			});
		});

		expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
	});

	it("revokes only the current account and clears its cached data", async () => {
		const queryClient = createQueryClient();
		queryClient.setQueryData(["spaces", "list", "signed-in-user"], {
			spaces: [],
		});

		const { result } = renderHook(() => useLogoutAction(), {
			wrapper: createWrapper(queryClient),
		});

		await act(async () => {
			await result.current.mutateAsync();
		});

		expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
		expect(authQueryMocks.revokeDeviceSession).toHaveBeenCalledWith(
			"session-a"
		);
		expect(authFormApiMocks.signOutSession).not.toHaveBeenCalled();
	});

	it("preserves logout for a session created before multi-session was enabled", async () => {
		authQueryMocks.listDeviceSessions.mockResolvedValue([]);
		authFormApiMocks.signOutSession.mockResolvedValue({
			data: {},
			error: null,
		});
		const queryClient = createQueryClient();
		const { result } = renderHook(() => useLogoutAction(), {
			wrapper: createWrapper(queryClient),
		});

		await act(async () => {
			await result.current.mutateAsync();
		});

		expect(authFormApiMocks.signOutSession).toHaveBeenCalledTimes(1);
		expect(authQueryMocks.revokeDeviceSession).not.toHaveBeenCalled();
	});

	it("logs out of every stored account only through the explicit action", async () => {
		authFormApiMocks.signOutSession.mockResolvedValue({
			data: {},
			error: null,
		});
		const queryClient = createQueryClient();
		const { result } = renderHook(() => useLogoutAllAccountsAction(), {
			wrapper: createWrapper(queryClient),
		});

		await act(async () => {
			await result.current.mutateAsync();
		});

		expect(authFormApiMocks.signOutSession).toHaveBeenCalledTimes(1);
		expect(authQueryMocks.listDeviceSessions).not.toHaveBeenCalled();
	});

	it("keeps the invitation accept redirect in sign-up verification emails", async () => {
		window.history.replaceState(
			{},
			"",
			"http://localhost:3000/sign-up?redirect=%2Faccept-invitation%3FinvitationId%3Dinv-123"
		);
		const queryClient = createQueryClient();
		authFormApiMocks.signUpWithEmail.mockResolvedValue({
			data: {},
			error: null,
		});

		const { result } = renderHook(() => useEmailSignUp(), {
			wrapper: createWrapper(queryClient),
		});

		await act(async () => {
			await result.current.mutateAsync({
				email: " Invitee@Example.com ",
				password: "password-123",
			});
		});

		expect(authFormApiMocks.signUpWithEmail).toHaveBeenCalledWith(
			expect.objectContaining({
				callbackURL:
					"http://localhost:3000/verify-email?redirect=%2Faccept-invitation%3FinvitationId%3Dinv-123",
				email: "invitee@example.com",
			})
		);
	});

	it("keeps the invitation accept redirect when resending verification email", async () => {
		window.history.replaceState(
			{},
			"",
			"http://localhost:3000/check-email?redirect=%2Faccept-invitation%3FinvitationId%3Dinv-456"
		);
		const queryClient = createQueryClient();
		authFormApiMocks.sendVerificationEmail.mockResolvedValue({
			data: {},
			error: null,
		});

		const { result } = renderHook(() => useResendVerificationEmail(), {
			wrapper: createWrapper(queryClient),
		});

		await act(async () => {
			await result.current.mutateAsync({
				email: " Invitee@Example.com ",
			});
		});

		expect(authFormApiMocks.sendVerificationEmail).toHaveBeenCalledWith({
			callbackURL:
				"http://localhost:3000/verify-email?redirect=%2Faccept-invitation%3FinvitationId%3Dinv-456",
			email: "invitee@example.com",
		});
	});
});
