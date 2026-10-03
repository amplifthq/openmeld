import { buildPublicPageHead } from "@openmeld/product-catalog/site";
import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import { PublicPageHeader } from "#/components/public-page-header";
import css from "../styles.css?url";

export const Route = createRootRoute({
	head: () => ({
		links: [
			{ rel: "stylesheet", href: css },
			{ rel: "icon", href: "/favicon.ico" },
		],
		meta: [
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
