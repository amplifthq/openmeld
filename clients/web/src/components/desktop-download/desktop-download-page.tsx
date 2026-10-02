import {
	type DesktopReleasePlatform,
	desktopReleasePlatformSchema,
} from "@openmeld/schemas";
import { buttonVariants } from "@openmeld/ui/components/button";
import { ArrowDown } from "lucide-react";
import { PublicPageHeader } from "#/components/app/public-page-header";
import type { DesktopDownloadRelease } from "#/lib/desktop-release";

const platformLabels: Record<DesktopReleasePlatform, string> = {
	"macos-arm64": "Mac (Apple silicon)",
	"windows-x64": "Windows (x64)",
	"windows-arm64": "Windows (ARM64)",
};

export function DesktopDownloadPage({
	release,
	unavailable = "default",
	platform,
}: {
	release: DesktopDownloadRelease | null;
	unavailable?: "default" | "candidate" | "invalid";
	platform?: DesktopReleasePlatform;
}) {
	const selected = release?.platform ?? platform ?? "macos-arm64";
	const windows = selected !== "macos-arm64";
	return (
		<main className="min-h-svh bg-background">
			<PublicPageHeader appEntryLabel="Open OpenMeld Web" />
			<div className="mx-auto max-w-xl px-6 py-12 sm:py-20">
				<p className="font-medium text-muted-foreground text-sm">
					Preview · {platformLabels[selected]}
				</p>
				<h1 className="mt-3 font-geist-pixel-square text-3xl tracking-tight sm:text-4xl">
					OpenMeld Desktop
				</h1>
				<p className="mt-4 text-muted-foreground leading-7">
					Open your Spaces in a desktop app. Sign in with the same account you
					use on OpenMeld Web.
				</p>
				<nav
					aria-label="Download platform"
					className="mt-6 flex flex-wrap gap-2"
				>
					{desktopReleasePlatformSchema.options.map((value) => (
						<a
							aria-current={value === selected ? "page" : undefined}
							className={buttonVariants({
								variant: value === selected ? "secondary" : "outline",
								size: "sm",
							})}
							href={`/desktop?platform=${value}`}
							key={value}
						>
							{platformLabels[value]}
						</a>
					))}
				</nav>
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
								Download for {platformLabels[selected]}
							</a>
							<p className="mt-3 text-muted-foreground text-sm">
								Version {release.version} · {windows ? "EXE" : "DMG"}
								{release.sizeBytes
									? ` · ${Math.round(release.sizeBytes / 1_000_000)} MB`
									: ""}
							</p>
							<p className="mt-3 text-muted-foreground text-sm leading-6">
								{windows
									? "Installs for your Windows account. OpenMeld Tools download when you connect this computer; Node.js is not required."
									: "For Macs with an M-series chip. Choose a Windows build above for a Windows computer."}
							</p>
							{release.message ? (
								<p className="mt-4 text-sm leading-6">{release.message}</p>
							) : null}
						</>
					) : (
						<>
							<h2 className="font-medium">
								{unavailable === "default"
									? "Desktop downloads aren't available yet"
									: "This preview is unavailable"}
							</h2>
							<p className="mt-2 text-muted-foreground text-sm leading-6">
								{unavailable === "default"
									? "Please check back later. You can keep using OpenMeld Web."
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
								{windows
									? "Open the downloaded installer and install OpenMeld for your Windows account."
									: "Open the downloaded DMG and drag OpenMeld Desktop to Applications."}
							</li>
							<li>
								{windows
									? "Open OpenMeld from the Start menu."
									: "Open OpenMeld Desktop from Applications."}
							</li>
							<li>Sign in with your OpenMeld account.</li>
						</ol>
					</section>
				) : null}
			</div>
		</main>
	);
}
