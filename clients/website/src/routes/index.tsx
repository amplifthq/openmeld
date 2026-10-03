import { buildPublicPageHead } from "@openmeld/product-catalog/site";
import { buttonVariants } from "@openmeld/ui/components/button";
import { createFileRoute } from "@tanstack/react-router";
import { LandingPage } from "#/components/landing-page/landing-page";
import { appUrl } from "#/lib/app-url";

export const Route = createFileRoute("/")({
	head: () => buildPublicPageHead(),
	component: WebsiteHome,
});

function WebsiteHome() {
	return (
		<>
			<main className="hidden min-h-svh items-center justify-center bg-background px-6 py-12 [@media(display-mode:standalone)]:flex">
				<div className="w-full max-w-md space-y-4">
					<h1 className="font-medium text-2xl tracking-tight">
						OpenMeld has moved
					</h1>
					<p className="text-muted-foreground text-sm leading-relaxed">
						Open the app at its new address. To update this installed shortcut,
						open the new app in your browser and install it again.
					</p>
					<a
						className={buttonVariants()}
						href={appUrl("/")}
						rel="noopener"
						target="_blank"
					>
						Open new app
					</a>
					<p className="text-muted-foreground text-sm leading-relaxed">
						Your account, Spaces, and sent messages are still there. Unsent
						drafts do not move automatically. If the old app is still open, copy
						anything you need before closing it.
					</p>
				</div>
			</main>
			<div className="[@media(display-mode:standalone)]:hidden">
				<LandingPage />
			</div>
		</>
	);
}
