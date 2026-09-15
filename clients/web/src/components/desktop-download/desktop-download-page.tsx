import { buttonVariants } from "@openmeld/ui/components/button";
import { Link } from "@tanstack/react-router";
import { ArrowDown, Monitor, PanelsTopLeft } from "lucide-react";
import { PublicPageHeader } from "#/components/app/public-page-header";
import {
	APP_PAGE_FRAME_CLASS_NAME,
	APP_PAGE_FRAME_PADDING_CLASS_NAME,
} from "#/components/app/shell-layout";
import {
	DESKTOP_DOWNLOAD_ROUTE_PATH,
	type DesktopPreviewReleaseManifest,
} from "#/lib/desktop-release";

export function DesktopDownloadPage({
	release,
}: {
	release: DesktopPreviewReleaseManifest | null;
}) {
	return (
		<main className="min-h-svh bg-background">
			<PublicPageHeader appEntryLabel="Open OpenMeld Web" />
			<div
				className={`mx-auto w-full ${APP_PAGE_FRAME_PADDING_CLASS_NAME} ${APP_PAGE_FRAME_CLASS_NAME}`}
			>
				<div className="mx-auto max-w-5xl px-6 py-12 sm:px-10 lg:py-20">
					<section className="grid items-start gap-10 lg:grid-cols-[1.3fr_1fr] lg:gap-16">
						<div>
							<p className="font-medium text-muted-foreground text-sm">
								For macOS · Apple silicon
							</p>
							<h1 className="mt-3 font-geist-pixel-square text-4xl tracking-tight sm:text-5xl">
								OpenMeld Desktop
							</h1>
							<p className="mt-5 max-w-xl text-lg text-muted-foreground leading-8">
								Your Spaces and agents, in a Mac app.
							</p>
							<p className="mt-4 max-w-xl text-muted-foreground leading-7">
								Use the same OpenMeld account on Web and Desktop. Keep working
								in your Spaces, and connect your Mac so agents can work with
								local projects.
							</p>
						</div>
						<div className="rounded-lg border border-border bg-card p-6">
							<Monitor
								aria-hidden="true"
								className="size-6 text-muted-foreground"
							/>
							<h2 className="mt-4 font-semibold text-lg">
								Get OpenMeld for Mac
							</h2>
							<p className="mt-2 text-muted-foreground text-sm leading-6">
								For Macs with an M-series chip. Intel Macs and Windows aren’t
								supported in this release.
							</p>
							{release ? (
								<>
									<a
										className={buttonVariants({ className: "mt-5 w-full" })}
										href={DESKTOP_DOWNLOAD_ROUTE_PATH}
									>
										<ArrowDown aria-hidden="true" className="size-4" />
										Download for Apple silicon
									</a>
									<p className="mt-3 text-muted-foreground text-xs">
										Version {release.macosArm64.version} · DMG
										{release.macosArm64.sizeBytes
											? ` · ${Math.round(release.macosArm64.sizeBytes / 1_000_000)} MB`
											: ""}
									</p>
									{release.message ? (
										<p className="mt-4 text-muted-foreground text-sm leading-6">
											{release.message}
										</p>
									) : null}
								</>
							) : (
								<div className="mt-5 border-border border-t pt-4">
									<p className="font-medium text-sm">
										Download not available yet
									</p>
									<p className="mt-2 text-muted-foreground text-sm leading-6">
										You can use OpenMeld Web while the Mac app is being
										prepared.
									</p>
									<Link
										className={buttonVariants({
											className: "mt-4 w-full",
											variant: "outline",
										})}
										to="/login"
									>
										Open OpenMeld Web
									</Link>
								</div>
							)}
						</div>
					</section>
					<section className="mt-14 border-border border-t pt-8 sm:mt-16">
						<h2 className="font-semibold text-xl">
							One account, two ways to work
						</h2>
						<div className="mt-6 grid gap-8 sm:grid-cols-2">
							<div>
								<PanelsTopLeft
									aria-hidden="true"
									className="mb-3 size-5 text-muted-foreground"
								/>
								<h3 className="font-medium">Continue in Web or Desktop</h3>
								<p className="mt-2 text-muted-foreground text-sm leading-7">
									Open the same Spaces, follow conversations, and work with your
									team. Sign in with your existing account to pick up where you
									left off.
								</p>
							</div>
							<div>
								<Monitor
									aria-hidden="true"
									className="mb-3 size-5 text-muted-foreground"
								/>
								<h3 className="font-medium">Bring your Mac into the work</h3>
								<p className="mt-2 text-muted-foreground text-sm leading-7">
									Connect this computer and set up an agent for a local project.
									Wake that agent from a Space and follow its reply there. Your
									Mac needs to be awake and connected for local work.
								</p>
							</div>
						</div>
					</section>
					<section className="mt-10 border-border border-t pt-8">
						<h2 className="font-semibold text-xl">Getting started</h2>
						<ol className="mt-5 list-decimal space-y-3 pl-5 text-muted-foreground text-sm leading-7 marker:text-foreground">
							<li>Open the DMG and drag OpenMeld Desktop to Applications.</li>
							<li>
								Open the app and sign in with the account you use on OpenMeld
								Web.
							</li>
							<li>
								Open a Space to continue working. To use local agents, follow
								the computer setup guidance in OpenMeld.
							</li>
						</ol>
					</section>
				</div>
			</div>
		</main>
	);
}
