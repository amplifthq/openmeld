import { buttonVariants } from "@openmeld/ui/components/button";
import { ArrowDown } from "lucide-react";
import { PublicPageHeader } from "#/components/app/public-page-header";
import type { DesktopDownloadRelease } from "#/lib/desktop-release";

export function DesktopDownloadPage({
	release,
	unavailable = "default",
}: {
	release: DesktopDownloadRelease | null;
	unavailable?: "default" | "candidate" | "invalid";
}) {
	return (
		<main className="min-h-svh bg-background">
			<PublicPageHeader appEntryLabel="Open OpenMeld Web" />
			<div className="mx-auto max-w-xl px-6 py-12 sm:py-20">
				<p className="font-medium text-muted-foreground text-sm">
					Preview · macOS
				</p>
				<h1 className="mt-3 font-geist-pixel-square text-3xl tracking-tight sm:text-4xl">
					OpenMeld Desktop
				</h1>
				<p className="mt-4 text-muted-foreground leading-7">
					Open your Spaces in a Mac app. Sign in with the same account you use
					on OpenMeld Web.
				</p>
				<section
					aria-label="Download"
					className="mt-8 border-border border-y py-6"
				>
					{release ? (
						<>
							<a
								className={buttonVariants({ className: "w-full sm:w-auto" })}
								href={release.downloadPath}
							>
								<ArrowDown aria-hidden="true" className="size-4" />
								Download for Mac (Apple silicon)
							</a>
							<p className="mt-3 text-muted-foreground text-sm">
								Version {release.version} · DMG
								{release.sizeBytes
									? ` · ${Math.round(release.sizeBytes / 1_000_000)} MB`
									: ""}
							</p>
							<p className="mt-3 text-muted-foreground text-sm leading-6">
								For Macs with an M-series chip. Intel Macs and Windows aren’t
								supported in this preview.
							</p>
							{release.message ? (
								<p className="mt-4 text-sm leading-6">{release.message}</p>
							) : null}
						</>
					) : (
						<>
							<h2 className="font-medium">
								{unavailable === "default"
									? "No default download yet"
									: "This preview is unavailable"}
							</h2>
							<p className="mt-2 text-muted-foreground text-sm leading-6">
								{unavailable === "default"
									? "Have a preview invitation? Open the full link you received to download that version."
									: "Check that you opened the full preview link, or ask the person who shared it for a new one."}
							</p>
						</>
					)}
				</section>
				{release ? (
					<section className="mt-8">
						<h2 className="font-medium">Install OpenMeld Desktop</h2>
						<ol className="mt-4 list-decimal space-y-3 pl-5 text-muted-foreground text-sm leading-6 marker:text-foreground">
							<li>
								Open the downloaded DMG and drag OpenMeld Desktop to
								Applications.
							</li>
							<li>Open OpenMeld Desktop from Applications.</li>
							<li>Sign in with your OpenMeld account.</li>
						</ol>
					</section>
				) : null}
			</div>
		</main>
	);
}
