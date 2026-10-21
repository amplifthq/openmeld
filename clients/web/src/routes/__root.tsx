import {
	buildPublicPageHead,
	siteConfig,
} from "@openmeld/product-catalog/site";
import { buttonVariants } from "@openmeld/ui/components/button";
import { TooltipProvider } from "@openmeld/ui/components/tooltip";
import { FAVICON_32_URL, FAVICON_VERSION } from "@openmeld/ui/lib/favicon";
import { OPENMELD_LOGO_THEME_COLORS } from "@openmeld/ui/lib/openmeld-logo-theme";
import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	type ErrorComponentProps,
	HeadContent,
	Link,
	Scripts,
	useRouter,
} from "@tanstack/react-router";
import { ThemeProvider, useTheme } from "next-themes";
import { NuqsAdapter } from "nuqs/adapters/tanstack-router";
import { useEffect } from "react";
import {
	isClientAssetLoadError,
	useClientVersionRecovery,
} from "#/client-version-recovery";
import { ApplicationErrorState } from "#/components/app/application-error-state";
import { FullPagePending } from "#/components/app/full-page-pending";
import { PublicPageHeader } from "#/components/app/public-page-header";
import { AppearanceShapeProvider } from "#/components/appearance/appearance-shape-provider";
import { GlobalThemeShortcut } from "#/components/global-theme-shortcut";
import { OpenMeldLogo } from "#/components/openmeld-logo-weak";
import { Toaster } from "#/components/ui/sonner";
import { beforeDesktopLoad } from "#/desktop/auth-boundary";
import { DesktopFrame } from "#/desktop/desktop-frame";
import { TanStackDevtoolsSlot } from "#/integrations/tanstack-devtools/devtools-slot";
import { readAppShellPendingSidebarState } from "#/lib/app-shell-pending-sidebar";
import { APPEARANCE_SHAPE_BOOTSTRAP_SCRIPT } from "#/lib/appearance/shape-preference";
import { SIDEBAR_PREFERENCE_BOOTSTRAP_SCRIPT } from "#/lib/appearance/sidebar-preference";
import { TOOLBAR_PREFERENCE_BOOTSTRAP_SCRIPT } from "#/lib/appearance/toolbar-preference";
import {
	readApplicationErrorRequestFailure,
	summarizeApplicationError,
	WEB_ERROR_BUILD,
} from "#/lib/observability/application-error";
import { submitApplicationErrorReport } from "#/lib/observability/application-error-client";
import { SPACE_CONVERSATION_LAYOUT_BOOTSTRAP_SCRIPT } from "#/lib/spaces/conversation-layout-preference";
import { HISTORY_SLIDER_BOOTSTRAP_SCRIPT } from "#/lib/spaces/history-slider-preference";
import { SPACE_SELF_MESSAGE_ALIGNMENT_BOOTSTRAP_SCRIPT } from "#/lib/spaces/self-message-alignment-preference";
import type { BrowserQueryPersistenceController } from "#/query/persistence/browser-query-persistence";
import appCss from "../styles.css?url";

type RouterContext = {
	queryClient: QueryClient;
	queryPersistence: BrowserQueryPersistenceController;
};

const FONT_PRELOAD_LINKS = [
	"/fonts/Geist-Variable.woff2",
	"/fonts/GeistMono-Variable.woff2",
	"/fonts/GeistPixel-Square.woff2",
	"/fonts/GeistPixel-Line.woff2",
] as const;
const DARK_THEME_COLOR = "#111110";
const LIGHT_THEME_COLOR = "#ffffff";
const THEME_STORAGE_KEY = "theme";
const THEME_BOOTSTRAP_SCRIPT = `(() => {
	const root = document.documentElement;
	const themes = ["light", "dark"];
	try {
		const storedTheme = localStorage.getItem("${THEME_STORAGE_KEY}") || "system";
		const resolvedTheme = storedTheme === "system"
			? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
			: storedTheme;
		root.classList.remove(...themes);
		root.classList.add(resolvedTheme);
		if (themes.includes(resolvedTheme)) {
			root.style.colorScheme = resolvedTheme;
		}
	} catch {}
})();`;

const NOT_FOUND_LOGO_SCALE = 0.72;

export const Route = createRootRouteWithContext<RouterContext>()({
	beforeLoad: ({ location, context }) =>
		beforeDesktopLoad(location.pathname, location.href, context.queryClient),
	// The client-only Organization route paints its pending shell during SSR.
	loader: async () => ({
		appShellSidebarState: await readAppShellPendingSidebarState(),
	}),
	headers: () => ({
		"Cache-Control": "no-cache",
	}),
	head: () => {
		const defaultPublicPageHead = buildPublicPageHead({
			includeCanonical: false,
			includeRobots: false,
		});

		return {
			meta: [
				{
					name: "openmeld-source-sha",
					content: WEB_ERROR_BUILD.sha ?? "local",
				},
				{
					name: "openmeld-build-id",
					content: WEB_ERROR_BUILD.id ?? "development",
				},
				{
					name: "openmeld-build-dirty",
					content: String(WEB_ERROR_BUILD.dirty),
				},
				{
					charSet: "utf-8",
				},
				{
					name: "viewport",
					content: "width=device-width, initial-scale=1",
				},
				{
					name: "application-name",
					content: siteConfig.name,
				},
				{
					name: "theme-color",
					content: DARK_THEME_COLOR,
				},
				{
					name: "keywords",
					content: siteConfig.keywords,
				},
				{
					property: "og:type",
					content: "website",
				},
				{
					property: "og:locale",
					content: "en_US",
				},
				{
					property: "og:site_name",
					content: siteConfig.name,
				},
				...defaultPublicPageHead.meta,
			],
			links: [
				...FONT_PRELOAD_LINKS.map((href) => ({
					as: "font" as const,
					crossOrigin: "anonymous" as const,
					href,
					rel: "preload" as const,
					type: "font/woff2" as const,
				})),
				{
					rel: "stylesheet",
					href: appCss,
				},
				{
					rel: "icon",
					type: "image/png",
					sizes: "32x32",
					href: FAVICON_32_URL,
				},
				{
					rel: "icon",
					type: "image/png",
					sizes: "16x16",
					href: `/favicon-16x16.png?v=${FAVICON_VERSION}`,
				},
				{
					rel: "shortcut icon",
					href: `/favicon.ico?v=${FAVICON_VERSION}`,
				},
				{
					rel: "apple-touch-icon",
					sizes: "180x180",
					href: `/apple-touch-icon.png?v=${FAVICON_VERSION}`,
				},
				{
					rel: "manifest",
					href: `/manifest.webmanifest?v=${FAVICON_VERSION}`,
				},
			],
		};
	},
	errorComponent: RootErrorComponent,
	notFoundComponent: RootNotFoundComponent,
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<script
					dangerouslySetInnerHTML={{
						__html: APPEARANCE_SHAPE_BOOTSTRAP_SCRIPT,
					}}
					suppressHydrationWarning
				/>
				<script
					dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }}
					suppressHydrationWarning
				/>
				<script
					dangerouslySetInnerHTML={{
						__html: SPACE_CONVERSATION_LAYOUT_BOOTSTRAP_SCRIPT,
					}}
					suppressHydrationWarning
				/>
				<script
					dangerouslySetInnerHTML={{ __html: HISTORY_SLIDER_BOOTSTRAP_SCRIPT }}
					suppressHydrationWarning
				/>
				<script
					dangerouslySetInnerHTML={{
						__html: SPACE_SELF_MESSAGE_ALIGNMENT_BOOTSTRAP_SCRIPT,
					}}
					suppressHydrationWarning
				/>
				<script
					dangerouslySetInnerHTML={{
						__html: TOOLBAR_PREFERENCE_BOOTSTRAP_SCRIPT,
					}}
					suppressHydrationWarning
				/>
				<script
					dangerouslySetInnerHTML={{
						__html: SIDEBAR_PREFERENCE_BOOTSTRAP_SCRIPT,
					}}
					suppressHydrationWarning
				/>
				<HeadContent />
			</head>
			<body className="font-geist-vars antialiased">
				<ThemeProvider
					attribute="class"
					defaultTheme="system"
					disableTransitionOnChange
					enableColorScheme
					enableSystem
					storageKey={THEME_STORAGE_KEY}
				>
					<AppearanceShapeProvider>
						<ThemeColorMeta />
						<GlobalThemeShortcut />
						<TooltipProvider>
							<NuqsAdapter>
								<DesktopFrame>
									<ClientVersionRecovery>{children}</ClientVersionRecovery>
								</DesktopFrame>
							</NuqsAdapter>
						</TooltipProvider>
						<Toaster position="bottom-right" />
						<TanStackDevtoolsSlot />
					</AppearanceShapeProvider>
					<Scripts />
				</ThemeProvider>
			</body>
		</html>
	);
}

export function ThemeColorMeta() {
	const { resolvedTheme } = useTheme();

	useEffect(() => {
		if (resolvedTheme !== "light" && resolvedTheme !== "dark") {
			return;
		}

		const themeColorMeta = document.querySelector<HTMLMetaElement>(
			'meta[name="theme-color"]'
		);
		themeColorMeta?.setAttribute(
			"content",
			resolvedTheme === "light" ? LIGHT_THEME_COLOR : DARK_THEME_COLOR
		);
	}, [resolvedTheme]);

	return null;
}

export function RootErrorComponent({ error }: ErrorComponentProps) {
	const router = useRouter();
	// Retry loaders and reset their boundary without document navigation, which
	// Desktop intentionally blocks. Failed assets still need a document reload.
	return (
		<PageError
			error={error}
			onRetry={
				isClientAssetLoadError(error) ? undefined : () => router.invalidate()
			}
		/>
	);
}

export function ClientVersionRecovery({
	children,
}: {
	children: React.ReactNode;
}) {
	const recovery = useClientVersionRecovery();
	if (recovery.status === "reloading") {
		return (
			<FullPagePending
				className="flex-col"
				label="Updating this page"
				showLabel
			/>
		);
	}
	if (recovery.status === "failed") {
		return <PageError error={recovery.error} />;
	}
	return children;
}

function PageError({
	error,
	onRetry,
}: {
	error: unknown;
	onRetry?: () => Promise<void>;
}) {
	let message = "Unexpected runtime error";
	if (error instanceof Error) {
		message = error.message;
	} else if (typeof error === "string") {
		message = error;
	}

	const isEnvError =
		message.includes("[env]") ||
		message.includes("Invalid environment variables");
	const isAssetLoadError = isClientAssetLoadError(error);
	let description =
		"Try refreshing the page, or go back to where you left off.";
	let displayMessage = message;
	if (isEnvError) {
		description = "OpenMeld could not start this page. Try again in a moment.";
	} else if (isAssetLoadError) {
		description = "Some files needed for this page couldn’t load.";
		displayMessage = "Refresh the page to try again.";
	}

	const errorDetails =
		error instanceof Error ? (error.stack ?? message) : message;
	const requestId = readApplicationErrorRequestFailure(error).requestId;
	const diagnosticDetails = isAssetLoadError
		? JSON.stringify(summarizeApplicationError(error), null, 2)
		: errorDetails;

	return (
		<div className="min-h-svh bg-background">
			<PublicPageHeader />
			<main className="flex min-h-[calc(100svh-3.5rem)] w-full items-center justify-center px-4 py-6 sm:px-6">
				<ApplicationErrorState
					description={description}
					details={`${diagnosticDetails}${requestId ? `\n\nRequest ID: ${requestId}` : ""}\n\nBuild: ${WEB_ERROR_BUILD.id ?? "development"}\nSource: ${WEB_ERROR_BUILD.sha ?? "local"}`}
					message={displayMessage}
					onAction={
						onRetry ??
						(() => {
							if (typeof window !== "undefined") {
								window.location.reload();
							}
						})
					}
					onReport={() => submitApplicationErrorReport(error)}
				>
					{isEnvError && import.meta.env.DEV ? (
						<div className="space-y-1 text-left text-muted-foreground text-xs">
							<p>Quick fix checklist:</p>
							<p>
								1. `clients/web/wrangler.jsonc` has `OPENMELD_GATEWAY_URL`,
								`WEB_APP_URL`, and `BETTER_AUTH_URL`.
							</p>
							<p>
								2. `clients/web/.dev.vars` or `.dev.vars.prod` has
								`WEB_OPENMELD_SPACE_ACCESS_COOKIE_SECRET`.
							</p>
							<p>3. Restart `pnpm dev` after changing env files.</p>
						</div>
					) : null}
				</ApplicationErrorState>
			</main>
		</div>
	);
}

export function RootNotFoundComponent() {
	return (
		<div className="min-h-svh bg-background">
			<PublicPageHeader />
			<main className="flex min-h-[calc(100svh-3.5rem)] w-full items-center justify-center px-4 py-6 sm:px-6">
				<section className="w-fit text-center">
					<OpenMeldLogo
						colors={OPENMELD_LOGO_THEME_COLORS}
						scale={NOT_FOUND_LOGO_SCALE}
					/>

					<div className="mt-6 space-y-2">
						<p className="font-geist-pixel-square text-[clamp(0.8rem,2vw,1.4rem)]">
							OPENMELD
						</p>
						<p className="font-geist-pixel-square text-[clamp(1.2rem,4vw,2.6rem)]">
							404
						</p>
						<p className="text-muted-foreground text-sm">
							This page does not exist.
						</p>
					</div>

					<div className="mt-4 flex justify-center">
						<Link
							className={buttonVariants({ size: "sm", variant: "outline" })}
							to="/"
						>
							Back to home
						</Link>
					</div>
				</section>
			</main>
		</div>
	);
}
