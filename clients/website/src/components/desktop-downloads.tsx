import type {
	DesktopDownloadRelease,
	DesktopDownloads,
	DesktopReleasePlatform,
} from "@openmeld/schemas";
import { buttonVariants } from "@openmeld/ui/components/button";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@openmeld/ui/fluid/accordion";
import {
	AppleLogoIcon,
	DownloadSimpleIcon,
	WindowsLogoIcon,
} from "@phosphor-icons/react";
import { PublicPageHeader } from "#/components/public-page-header";

export function DesktopDownloadsPage({
	downloads,
	candidate = false,
	unavailable = false,
}: {
	downloads: DesktopDownloads | null;
	candidate?: boolean;
	unavailable?: boolean;
}) {
	const releases = downloads?.releases ?? [];
	const mac = releases.find((release) => release.platform === "macos-arm64");
	const windows = releases.filter(
		(release) => release.platform !== "macos-arm64"
	);
	return (
		<div className="min-h-svh bg-background text-foreground">
			<PublicPageHeader />
			<main className="mx-auto max-w-4xl px-6 py-16 sm:py-24">
				<h1 className="font-semibold text-4xl tracking-tight sm:text-5xl">
					Download OpenMeld
				</h1>
				<p className="mt-5 max-w-2xl text-muted-foreground leading-7">
					Your Spaces, people, and agents in a desktop app. Sign in with the
					same account you use on OpenMeld Web.
				</p>
				{unavailable || (candidate && releases.length === 0) ? (
					<section className="mt-10 rounded-xl border border-border p-6">
						<h2 className="font-medium">
							{candidate
								? "This build is unavailable"
								: "Unable to load desktop downloads"}
						</h2>
						<p className="mt-2 text-muted-foreground text-sm leading-6">
							{candidate
								? "Check that you opened the full download link, or ask the person who shared it for a new one."
								: "Reload this page to try again. You can keep using OpenMeld Web."}
						</p>
					</section>
				) : (
					<div className="mt-10 grid auto-rows-fr gap-6 sm:grid-cols-2">
						{!candidate || mac ? (
							<PlatformCard
								platform="macos-arm64"
								releases={mac ? [mac] : []}
							/>
						) : null}
						{!candidate || windows.length ? (
							<PlatformCard platform="windows-x64" releases={windows} />
						) : null}
					</div>
				)}
			</main>
		</div>
	);
}

function PlatformCard({
	platform,
	releases,
}: {
	platform: DesktopReleasePlatform;
	releases: DesktopDownloadRelease[];
}) {
	const mac = platform === "macos-arm64";
	return (
		<section className="flex h-full min-w-0 flex-col rounded-xl border border-border p-6">
			{mac ? (
				<AppleLogoIcon aria-hidden size={28} />
			) : (
				<WindowsLogoIcon aria-hidden size={28} />
			)}
			<div className="mt-5 flex items-center gap-2">
				<h2 className="font-medium text-xl">{mac ? "macOS" : "Windows"}</h2>
				{mac ? null : (
					<span className="rounded-md bg-muted px-2 py-0.5 text-muted-foreground text-xs">
						Preview
					</span>
				)}
			</div>
			<p className="mt-2 text-muted-foreground text-sm">
				{mac
					? "For Macs with an Apple silicon chip."
					: "Choose the build for your Windows processor."}
			</p>
			{releases.length ? (
				releases.map((release) => (
					<div className="mt-6" key={release.platform}>
						<a
							className={buttonVariants({ className: "w-full" })}
							href={release.downloadPath}
						>
							<DownloadSimpleIcon aria-hidden size={18} />
							{mac
								? "Download for macOS"
								: `Download for Windows (${release.platform === "windows-x64" ? "x64" : "ARM64"})`}
						</a>
						<p className="mt-3 text-muted-foreground text-sm">
							Version {release.version} · {mac ? "DMG" : "EXE"}
							{release.sizeBytes
								? ` · ${Math.round(release.sizeBytes / 1_000_000)} MB`
								: ""}
						</p>
					</div>
				))
			) : (
				<p className="mt-6 text-muted-foreground text-sm">
					This download is not available yet.
				</p>
			)}
			{releases.length ? (
				<Accordion className="mt-6">
					<AccordionItem
						className="border-border border-t"
						value="installation"
					>
						<AccordionTrigger
							aria-label={`Installation details for ${mac ? "macOS" : "Windows"}`}
							chevronClassName="motion-reduce:transition-none"
							className="min-h-11 py-3 font-medium text-sm motion-reduce:transition-none"
						>
							Installation details
						</AccordionTrigger>
						<AccordionContent className="motion-reduce:transition-none">
							{releases.map((release) =>
								release.message ? (
									<p
										className="mb-4 text-muted-foreground text-sm leading-6"
										key={release.platform}
									>
										{release.message}
									</p>
								) : null
							)}
							{mac ||
							releases.some(
								(release) => release.platform === "windows-arm64"
							) ? null : (
								<p className="mb-4 text-muted-foreground text-sm leading-6">
									Windows ARM64 is not available yet.
								</p>
							)}
							<h3 className="font-medium text-sm">Install OpenMeld Desktop</h3>
							<ol className="mt-3 list-decimal space-y-2 pl-5 text-muted-foreground text-sm leading-6 marker:text-foreground">
								<li>
									{mac
										? "Open the downloaded DMG and drag OpenMeld Desktop to Applications."
										: "Open the downloaded installer and install OpenMeld for your Windows account."}
								</li>
								<li>
									{mac
										? "Open OpenMeld Desktop from Applications."
										: "Open OpenMeld from the Start menu."}
								</li>
								<li>Sign in with your OpenMeld account.</li>
							</ol>
							{mac ? null : (
								<p className="mt-4 text-muted-foreground text-sm leading-6">
									OpenMeld Tools download when you connect this computer.
									Node.js is not required.
								</p>
							)}
						</AccordionContent>
					</AccordionItem>
				</Accordion>
			) : null}
		</section>
	);
}
