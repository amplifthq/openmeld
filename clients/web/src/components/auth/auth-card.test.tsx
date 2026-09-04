import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthCard } from "./auth-card";
import { CheckEmailCard } from "./check-email-card";

const PASSKEY_MAGIC_LINK_PATTERN = /Passkey or Magic Link/;

const openMeldLogoMock = vi.hoisted(() =>
	vi.fn(
		(props: {
			colors?: readonly string[];
			lines?: readonly string[];
			scale?: number;
		}) => (
			<div
				aria-label="OpenMeld logo"
				data-has-custom-lines={props.lines ? "true" : "false"}
				data-scale={props.scale}
				role="img"
			/>
		)
	)
);

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
	useRouterState: (input: {
		select: (state: { location: { search: Record<string, never> } }) => unknown;
	}) => input.select({ location: { search: {} } }),
}));

vi.mock("#/components/openmeld-logo-weak", () => ({
	OpenMeldLogo: openMeldLogoMock,
}));

vi.mock("./auth-form", () => ({
	AuthForm: () => <div data-testid="auth-form" />,
}));

vi.mock("./magic-link-button", () => ({
	MagicLinkButton: () => <button type="button">Magic link</button>,
}));

vi.mock("./passkey-button", () => ({
	PasskeyButton: () => <button type="button">Passkey</button>,
}));

vi.mock("./provider-button", () => ({
	ProviderButton: () => <button type="button">Provider</button>,
}));

vi.mock("#/hooks/auth-form.hooks", () => ({
	useResendVerificationEmail: () => ({
		isPending: false,
		mutateAsync: vi.fn(),
	}),
}));

vi.mock("#/hooks/auth.hooks", () => ({
	useSocialSignIn: () => ({
		isPending: false,
		mutateAsync: vi.fn(),
	}),
}));

vi.mock("#/lib/auth-client", () => ({
	openMeldAuthClient: {
		getLastUsedLoginMethod: () => undefined,
	},
}));

describe("Auth brand logo", () => {
	afterEach(() => {
		cleanup();
		openMeldLogoMock.mockClear();
	});

	it("uses the shared OpenMeld wordmark on the login and magic-link cards", () => {
		render(<AuthCard view="login" />);
		render(<AuthCard view="magicLink" />);

		expect(openMeldLogoMock).toHaveBeenCalledTimes(2);
		for (const [props] of openMeldLogoMock.mock.calls) {
			expect(props.lines).toBeUndefined();
			expect(props.scale).toBe(0.2);
		}
	});

	it("uses the same shared OpenMeld wordmark on the check-email card", () => {
		render(<CheckEmailCard email="felix@example.com" />);

		expect(openMeldLogoMock).toHaveBeenCalledTimes(1);
		expect(openMeldLogoMock.mock.calls[0]?.[0].lines).toBeUndefined();
		expect(openMeldLogoMock.mock.calls[0]?.[0].scale).toBe(0.2);
	});

	it("does not render an empty footer after magic-link verification", () => {
		const { container } = render(<AuthCard hasToken view="magicLink" />);

		expect(container.querySelector('[data-slot="card-footer"]')).toBeNull();
	});
});

describe("Auth card magic link default", () => {
	afterEach(cleanup);

	it("expands magic link by default when arriving from an invitation", () => {
		const { getByRole } = render(<AuthCard preferMagicLink view="login" />);

		expect(getByRole("button", { name: "Magic link" })).toBeTruthy();
	});

	it("keeps magic link collapsed on a plain login", () => {
		const { getByRole, queryByRole } = render(<AuthCard view="login" />);

		expect(queryByRole("button", { name: "Magic link" })).toBeNull();
		expect(
			getByRole("button", { name: PASSKEY_MAGIC_LINK_PATTERN })
		).toBeTruthy();
	});

	it("explains that existing sessions stay signed in when adding an account", () => {
		const { getByText, queryByText } = render(
			<AuthCard addingAccount view="login" />
		);

		expect(getByText("Add another account")).toBeTruthy();
		expect(
			getByText("Your current accounts will stay signed in on this browser.")
		).toBeTruthy();
		expect(queryByText("Don't have an account?")).toBeNull();
	});
});
