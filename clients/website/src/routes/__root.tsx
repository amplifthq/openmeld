import { buildPublicPageHead } from "@openmeld/product-catalog/site";
import { FAVICON_ICO_URL } from "@openmeld/ui/lib/favicon";
import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import { PublicPageHeader } from "#/components/public-page-header";
import css from "../styles.css?url";

declare const __OPENMELD_WEBSITE_BUILD__: {
	id: string;
	sha: string;
	dirty: boolean;
};

export const Route = createRootRoute({
	head: () => ({
		links: [
			{ rel: "stylesheet", href: css },
			{ rel: "icon", href: FAVICON_ICO_URL },
		],
		meta: [
			{ name: "openmeld-source-sha", content: __OPENMELD_WEBSITE_BUILD__.sha },
			{ name: "openmeld-build-id", content: __OPENMELD_WEBSITE_BUILD__.id },
			{
				name: "openmeld-build-dirty",
				content: String(__OPENMELD_WEBSITE_BUILD__.dirty),
			},
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			...buildPublicPageHead({ includeCanonical: false }).meta,
		],
	}),
	shellComponent: ({ children }) => (
		<html lang="en" suppressHydrationWarning>
			<head>
				<HeadContent />
			</head>
			<body className="font-geist-vars antialiased">
				<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
					{children}
				</ThemeProvider>
				<Scripts />
			</body>
		</html>
	),
	notFoundComponent: () => (
		<>
			<PublicPageHeader />
			<main className="mx-auto max-w-3xl px-6 py-24">
				<h1 className="text-2xl">Page not found</h1>
				<a className="mt-4 inline-block underline" href="/">
					Go to the homepage
				</a>
			</main>
		</>
	),
});
