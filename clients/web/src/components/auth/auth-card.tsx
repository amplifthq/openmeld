import { Button } from "@openmeld/ui/components/button";
import { Card, CardContent, CardFooter } from "@openmeld/ui/components/card";
import { Separator } from "@openmeld/ui/components/separator";
import { OPENMELD_LOGO_THEME_COLORS } from "@openmeld/ui/lib/openmeld-logo-theme";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { OpenMeldLogo } from "#/components/openmeld-logo-weak";
import { useRedirectQueryPath } from "#/hooks/auth-redirect.hooks";
import { openMeldAuthClient } from "#/lib/auth-client";
import { AuthForm } from "./auth-form";
import {
	AUTH_VIEWS_WITH_SOCIAL_SECTION,
	type AuthView,
	authViewSegments,
	getAuthViewMeta,
} from "./auth-views";
import { LastUsedBadge } from "./last-userd-badge";
import { MagicLinkButton } from "./magic-link-button";
import { PasskeyButton } from "./passkey-button";
import { ProviderButton } from "./provider-button";
import { socialProviders } from "./social-providers";

type AuthCardProps = {
	addingAccount?: boolean;
	view: AuthView;
	hasToken?: boolean;
	preferMagicLink?: boolean;
};

type AuthFooterProps = {
	hasToken: boolean;
	view: AuthView;
};

type AuthSocialSectionProps = {
	addingAccount: boolean;
	isSubmitting: boolean;
	moreAuthOptions: boolean;
	setIsSubmitting: (isSubmitting: boolean) => void;
	setMoreAuthOptions: (moreAuthOptions: boolean) => void;
	view: AuthView;
};

const AUTH_CARD_LOGO_SCALE = 0.2;

function getLastUsedLoginMethod(): string | undefined {
	const clientWithLastUsed = openMeldAuthClient as unknown as {
		getLastUsedLoginMethod?: () => string | undefined;
	};
	return clientWithLastUsed.getLastUsedLoginMethod?.();
}

function resolveSeparatorLabel(view: AuthView): string | null {
	switch (view) {
		case "login":
			return "Or continue with";
		case "signUp":
			return "Sign up below";
		case "magicLink":
			return "Or continue with magic link";
		default:
			return null;
	}
}

function AuthFooter({ hasToken, view }: AuthFooterProps) {
	const loginPath = useRedirectQueryPath(`/${authViewSegments.login}`);
	const signUpPath = useRedirectQueryPath(`/${authViewSegments.signUp}`);

	if (view === "login" || view === "magicLink") {
		if (view === "magicLink" && hasToken) {
			return null;
		}

		return (
			<>
				Don&apos;t have an account?
				<Link
					className="inline-flex min-h-11 items-center px-1 text-foreground underline hover:underline lg:min-h-0"
					to={signUpPath}
				>
					Sign up
				</Link>
			</>
		);
	}

	if (view === "signUp") {
		return (
			<>
				Already have an account?
				<Link
					className="inline-flex min-h-11 items-center px-1 text-foreground underline hover:underline lg:min-h-0"
					to={loginPath}
				>
					Sign in
				</Link>
			</>
		);
	}

	return (
		<>
			<ArrowLeftIcon className="size-3" />
			<Button
				className="px-0 text-muted-foreground hover:text-foreground hover:underline"
				onClick={() => window.history.back()}
				size="sm"
				type="button"
				variant="link"
			>
				Go back
			</Button>
		</>
	);
}

function AuthSocialSection({
	addingAccount,
	isSubmitting,
	moreAuthOptions,
	setIsSubmitting,
	setMoreAuthOptions,
	view,
}: AuthSocialSectionProps) {
	const lastUsedMethod = getLastUsedLoginMethod();
	const isPasskeyOrMagicLinkLastUsed =
		lastUsedMethod === "passkey" || lastUsedMethod === "magic-link";

	return (
		<div className="grid gap-2">
			<div className="flex w-full flex-col items-center justify-between gap-2">
				{socialProviders.map((provider) => (
					<ProviderButton
						isSubmitting={isSubmitting}
						key={provider.providerId}
						provider={provider}
						setIsSubmitting={setIsSubmitting}
					/>
				))}
			</div>

			{moreAuthOptions || view === "magicLink" ? (
				<>
					<PasskeyButton
						isSubmitting={isSubmitting}
						setIsSubmitting={setIsSubmitting}
					/>
					<MagicLinkButton
						addingAccount={addingAccount}
						isSubmitting={isSubmitting}
						view={view}
					/>
				</>
			) : (
				<Button
					className="group relative w-full"
					disabled={isSubmitting}
					onClick={() => setMoreAuthOptions(true)}
					type="button"
					variant="authButton"
				>
					<div className="flex items-center gap-2">Passkey or Magic Link</div>
					{isPasskeyOrMagicLinkLastUsed ? <LastUsedBadge /> : null}
				</Button>
			)}
		</div>
	);
}

function resolveTitleAndDescription(
	hasToken: boolean,
	meta: { description: string; title: string },
	view: AuthView
): { description: string; title: string } {
	if (view === "magicLink" && hasToken) {
		return {
			description: "Please wait while we sign you in via magic link.",
			title: "Signing you in...",
		};
	}

	return {
		description: meta.description,
		title: meta.title,
	};
}

function renderSeparator(label: string | null, show: boolean): ReactNode {
	if (!(show && label)) {
		return null;
	}

	return (
		<div className="flex items-center gap-2">
			<Separator className="!w-auto grow" />
			<span className="flex-shrink-0 text-muted-foreground text-sm">
				{label}
			</span>
			<Separator className="!w-auto grow" />
		</div>
	);
}

export function AuthCard({
	addingAccount = false,
	view,
	hasToken = false,
	preferMagicLink = false,
}: AuthCardProps) {
	const meta = getAuthViewMeta(view);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [moreAuthOptions, setMoreAuthOptions] = useState(
		view === "magicLink" || preferMagicLink
	);

	useEffect(() => {
		const onPageHide = () => {
			setIsSubmitting(false);
		};
		window.addEventListener("pagehide", onPageHide);
		return () => {
			setIsSubmitting(false);
			window.removeEventListener("pagehide", onPageHide);
		};
	}, []);

	if (view === "logout" || view === "callback") {
		return <AuthForm hasToken={hasToken} view={view} />;
	}

	const showSocialSection =
		AUTH_VIEWS_WITH_SOCIAL_SECTION.includes(view) &&
		!(view === "magicLink" && hasToken);
	const separatorLabel = resolveSeparatorLabel(view);
	const { description, title } = addingAccount
		? {
				description:
					"Your current accounts will stay signed in on this browser.",
				title: "Add another account",
			}
		: resolveTitleAndDescription(hasToken, meta, view);
	const footerContent =
		addingAccount || (view === "magicLink" && hasToken) ? null : (
			<AuthFooter hasToken={hasToken} view={view} />
		);

	return (
		<div className="w-full max-w-md md:w-md max-lg:[&_[data-slot=button]]:h-11">
			<div className="flex flex-col items-center gap-y-2">
				<div className="w-fit">
					<OpenMeldLogo
						colors={OPENMELD_LOGO_THEME_COLORS}
						scale={AUTH_CARD_LOGO_SCALE}
					/>
				</div>
				<span className="font-semibold text-3xl">{title}</span>
				<span className="my-2 select-none text-pretty text-center font-medium text-muted-foreground">
					{description}
				</span>
			</div>

			<Card className="w-full border-none">
				<CardContent className="grid gap-6">
					{showSocialSection ? (
						<AuthSocialSection
							addingAccount={addingAccount}
							isSubmitting={isSubmitting}
							moreAuthOptions={moreAuthOptions}
							setIsSubmitting={setIsSubmitting}
							setMoreAuthOptions={setMoreAuthOptions}
							view={view}
						/>
					) : null}

					{renderSeparator(separatorLabel, showSocialSection)}

					<div className="grid gap-4">
						<AuthForm
							hasToken={hasToken}
							isSubmitting={isSubmitting}
							setIsSubmitting={setIsSubmitting}
							view={view}
						/>
					</div>
				</CardContent>

				{footerContent ? (
					<CardFooter className="justify-center gap-1.5 text-muted-foreground text-sm">
						{footerContent}
					</CardFooter>
				) : null}
			</Card>
		</div>
	);
}
