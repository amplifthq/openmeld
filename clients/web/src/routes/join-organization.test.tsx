import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";

const acceptOrganizationJoinLinkMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
const previewOrganizationJoinLinkMock = vi.hoisted(() => vi.fn());
let sessionQuery = vi.hoisted(() => ({
	data: { user: { email: "member@example.com", id: "user-1" } } as {
		user: { email: string; id: string };
	} | null,
	isPending: false,
}));

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (config: unknown) => ({
		...(config as Record<string, unknown>),
		useSearch: () => ({}),
	}),
	Link: ({
		children,
		search,
		to,
	}: {
		children: ReactNode;
		search?: { redirect?: unknown };
		to: string;
	}) => (
		<a data-redirect={search?.redirect} href={to}>
			{children}
		</a>
	),
	useLocation: () => ({ href: "/join-organization" }),
	useNavigate: () => navigateMock,
}));

vi.mock("#/components/auth/auth-page-shell", () => ({
	AuthPageShell: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
}));

vi.mock("#/hooks/auth.hooks", () => ({
	useAuthSession: () => sessionQuery,
}));

vi.mock("#/lib/organizations/auth-organizations", () => ({
	acceptOrganizationJoinLink: acceptOrganizationJoinLinkMock,
	previewOrganizationJoinLink: previewOrganizationJoinLinkMock,
}));

import { JoinOrganizationPage, Route } from "./join-organization";

const TOKEN = `joinlink_${"a".repeat(64)}`;
const FULL_HREF = `https://app.openmeld.ai/join-organization?token=${TOKEN}`;
const FULL_HREF_WITH_AUTH = `${FULL_HREF}&via=auth`;
const ENCODED_TOKEN = "joinlink_a+b/c=";
const ENCODED_TOKEN_HREF =
	"https://app.openmeld.ai/join-organization?token=joinlink_a%2Bb%2Fc%3D";

function activePreview() {
	return {
		active: true as const,
		ok: true as const,
		organizationName: "Acme Research",
		organizationSlug: "acme-research",
	};
}

function acceptedJoinLink(alreadyMember = false) {
	return {
		alreadyMember,
		ok: true as const,
		organizationId: "org-acme",
		organizationName: "Acme Research",
		organizationSlug: "acme-research",
		role: "member" as const,
	};
}

function renderPage(
	token: string | null = TOKEN,
	queryClient = createTestQueryClient(),
	options?: {
		locationHref?: string;
	}
) {
	const pageProps = {
		locationHref: options?.locationHref ?? FULL_HREF,
		token,
	} as Parameters<typeof JoinOrganizationPage>[0];
	return render(
		<TestQueryClientProvider queryClient={queryClient}>
			<JoinOrganizationPage {...pageProps} />
		</TestQueryClientProvider>
	);
}

describe("join organization search", () => {
	const validateSearch = (
		Route as unknown as {
			validateSearch: (search: unknown) => {
				token?: string;
			};
		}
	).validateSearch;

	it("ignores caller-controlled markers without dropping a valid token", () => {
		expect(validateSearch({ token: TOKEN, via: "auth" })).toEqual({
			token: TOKEN,
		});
		expect(validateSearch({ token: TOKEN, via: "unexpected" })).toEqual({
			token: TOKEN,
		});
	});
});

describe("JoinOrganizationPage", () => {
	beforeEach(() => {
		acceptOrganizationJoinLinkMock
			.mockReset()
			.mockResolvedValue(acceptedJoinLink());
		navigateMock.mockReset().mockResolvedValue(undefined);
		previewOrganizationJoinLinkMock
			.mockReset()
			.mockResolvedValue(activePreview());
		sessionQuery = {
			data: { user: { email: "member@example.com", id: "user-1" } },
			isPending: false,
		};
	});

	afterEach(cleanup);

	it("fails closed without accepting when the token is missing", () => {
		renderPage(null);

		expect(
			screen.getByText("This invite link is missing its token.")
		).toBeTruthy();
		expect(previewOrganizationJoinLinkMock).not.toHaveBeenCalled();
		expect(acceptOrganizationJoinLinkMock).not.toHaveBeenCalled();
	});

	it("explains an inactive link without accepting it", async () => {
		previewOrganizationJoinLinkMock.mockResolvedValue({
			active: false,
			ok: true,
		});

		renderPage();

		expect(
			await screen.findByText(
				"This invite link is no longer active. Ask an OpenMeld admin for a new one."
			)
		).toBeTruthy();
		expect(screen.queryByRole("button")).toBeNull();
		expect(screen.queryByRole("link", { name: "Sign in to join" })).toBeNull();
		expect(acceptOrganizationJoinLinkMock).not.toHaveBeenCalled();
	});

	it("sends signed-out visitors to login with the intact token", async () => {
		sessionQuery = { data: null, isPending: false };

		renderPage(TOKEN, undefined, { locationHref: ENCODED_TOKEN_HREF });

		const signInLink = await screen.findByRole("link", {
			name: "Sign in to join",
		});
		expect(signInLink.getAttribute("href")).toBe("/login");
		expect(typeof signInLink.getAttribute("data-redirect")).toBe("string");
		expect(signInLink.getAttribute("data-redirect")).toBe(ENCODED_TOKEN_HREF);
		expect(
			new URL(signInLink.getAttribute("data-redirect") ?? "").searchParams.get(
				"token"
			)
		).toBe(ENCODED_TOKEN);
		expect(acceptOrganizationJoinLinkMock).not.toHaveBeenCalled();
	});

	it("requires explicit confirmation for a caller-controlled auth marker", async () => {
		renderPage(TOKEN, undefined, { locationHref: FULL_HREF_WITH_AUTH });

		expect(
			await screen.findByRole("button", { name: "Join Acme Research" })
		).toBeTruthy();
		expect(acceptOrganizationJoinLinkMock).not.toHaveBeenCalled();
		expect(navigateMock).not.toHaveBeenCalled();
	});

	it("accepts and opens the URL organization for a signed-in user", async () => {
		const queryClient = createTestQueryClient();
		const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");
		renderPage(TOKEN, queryClient);

		const joinButton = await screen.findByRole("button", {
			name: "Join Acme Research",
		});
		expect(acceptOrganizationJoinLinkMock).not.toHaveBeenCalled();
		fireEvent.click(joinButton);

		await waitFor(() => {
			expect(acceptOrganizationJoinLinkMock).toHaveBeenCalledWith({
				token: TOKEN,
			});
		});
		expect(invalidateQueriesSpy).toHaveBeenCalledWith({
			queryKey: organizationQueryKeys.all,
		});
		expect(navigateMock).toHaveBeenCalledWith({
			to: "/o/acme-research",
		});
		expect(
			acceptOrganizationJoinLinkMock.mock.invocationCallOrder[0]
		).toBeLessThan(navigateMock.mock.invocationCallOrder[0] ?? 0);
	});

	it("treats an already-member response as success", async () => {
		acceptOrganizationJoinLinkMock.mockResolvedValue(acceptedJoinLink(true));

		renderPage();
		fireEvent.click(
			await screen.findByRole("button", { name: "Join Acme Research" })
		);

		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith({
				to: "/o/acme-research",
			});
		});
	});

	it("keeps a successful join and retries only opening the organization", async () => {
		navigateMock
			.mockRejectedValueOnce(new Error("route transition failed"))
			.mockResolvedValueOnce(undefined);

		renderPage();
		fireEvent.click(
			await screen.findByRole("button", { name: "Join Acme Research" })
		);

		expect(
			await screen.findByText(
				"You joined Acme Research, but OpenMeld could not open it."
			)
		).toBeTruthy();
		expect(acceptOrganizationJoinLinkMock).toHaveBeenCalledTimes(1);

		fireEvent.click(screen.getByRole("button", { name: "Open Acme Research" }));

		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledTimes(2);
		});
		expect(acceptOrganizationJoinLinkMock).toHaveBeenCalledTimes(1);
	});

	it("offers a manual retry when acceptance fails", async () => {
		acceptOrganizationJoinLinkMock.mockRejectedValueOnce(
			new Error("OpenMeld could not join this organization.")
		);

		renderPage();
		fireEvent.click(
			await screen.findByRole("button", { name: "Join Acme Research" })
		);

		expect(
			await screen.findByText("OpenMeld could not join this organization.")
		).toBeTruthy();
		expect(acceptOrganizationJoinLinkMock).toHaveBeenCalledTimes(1);

		acceptOrganizationJoinLinkMock.mockResolvedValue(acceptedJoinLink());
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));

		await waitFor(() => {
			expect(acceptOrganizationJoinLinkMock).toHaveBeenCalledTimes(2);
			expect(navigateMock).toHaveBeenCalledWith({
				to: "/o/acme-research",
			});
		});
	});

	it("returns to explicit confirmation after magic-link verification", async () => {
		acceptOrganizationJoinLinkMock.mockRejectedValue(
			Object.assign(new Error("Verify your email to join this organization."), {
				code: "organization.join_link.email_verification_required",
			})
		);

		renderPage();
		fireEvent.click(
			await screen.findByRole("button", { name: "Join Acme Research" })
		);

		expect(
			await screen.findByText(
				"Your email address is not verified yet. Sign in once with a magic link to verify it, then you can join Acme Research."
			)
		).toBeTruthy();
		const magicLink = screen.getByRole("link", {
			name: "Continue with a magic link",
		});
		expect(magicLink.getAttribute("href")).toBe("/login");
		expect(magicLink.getAttribute("data-redirect")).toBe(FULL_HREF);
		expect(acceptOrganizationJoinLinkMock).toHaveBeenCalledTimes(1);
		expect(navigateMock).not.toHaveBeenCalled();
	});

	it("shows a clear retry state when join acceptance is rate limited", async () => {
		acceptOrganizationJoinLinkMock.mockRejectedValue(
			Object.assign(
				new Error("Too many join attempts. Try again in a minute."),
				{
					code: "organization.join_link.accept.rate_limited",
					status: 429,
				}
			)
		);

		renderPage();
		fireEvent.click(
			await screen.findByRole("button", { name: "Join Acme Research" })
		);

		expect(
			await screen.findByText("Too many join attempts. Try again in a minute.")
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
		expect(navigateMock).not.toHaveBeenCalled();
	});
});
