import { buttonVariants } from "@openmeld/ui/components/button";
import { OpenMeldLogoStrong } from "@openmeld/ui/components/openmeld-logo-strong";
import { Link } from "@tanstack/react-router";
import { PublicPageHeader } from "#/components/app/public-page-header";
import {
	APP_PAGE_FRAME_CLASS_NAME,
	APP_PAGE_FRAME_PADDING_CLASS_NAME,
} from "#/components/app/shell-layout";
import { DESKTOP_DOWNLOAD_ROUTE_PATH } from "#/lib/desktop-release";

const SETUP_STEPS = [
	"Download the DMG, open it, and drag OpenMeld Desktop to Applications.",
	"Open OpenMeld Desktop. If macOS blocks the first launch, approve it in Privacy & Security or Control-click the app and choose Open.",
	"If Node.js is missing, install Node.js LTS and retry.",
	"Let OpenMeld Desktop install or update the OpenMeld CLI, then choose Set Up This Mac.",
	"Open Spaces on OpenMeld Web, create a Space, add Profiles, and wake your local agents.",
] as const;

const REQUIREMENTS = [
	"macOS on Apple silicon",
	"Node.js LTS with npm",
	"OpenMeld account access on openmeld.ai",
] as const;

export function DesktopDownloadPage() {
	return (
		<main className="min-h-svh bg-background">
			<PublicPageHeader />

			<section
				className={`mx-auto w-full ${APP_PAGE_FRAME_PADDING_CLASS_NAME} ${APP_PAGE_FRAME_CLASS_NAME}`}
			>
				<div className="flex min-h-[calc(100svh-3.5rem)] flex-col gap-10 px-6 py-12 sm:px-10 lg:px-14 lg:py-16">
					<div className="flex max-w-4xl flex-1 flex-col justify-center">
						<OpenMeldLogoStrong
							className="mx-0 text-foreground"
							size="clamp(0.45rem,1.8vw,1.2rem)"
						/>

						<p className="mt-8 font-medium font-mono text-muted-foreground text-sm uppercase tracking-[0.18em]">
							Unsigned Apple silicon preview
						</p>
						<h1 className="mt-3 max-w-2xl font-geist-pixel-square text-4xl text-foreground sm:text-5xl">
							OpenMeld Desktop for macOS
						</h1>
						<p className="mt-5 max-w-2xl text-base text-muted-foreground leading-7">
							Download the first OpenMeld Desktop preview, set up this Mac, and
							keep the local OpenMeld Service running without typing CLI
							commands.
						</p>

						<div className="mt-8 flex flex-wrap gap-3">
							<a
								className={buttonVariants({
									className: "h-10 px-4 text-sm",
								})}
								href={DESKTOP_DOWNLOAD_ROUTE_PATH}
							>
								Download OpenMeld Desktop
							</a>
							<Link
								className={buttonVariants({
									className: "h-10 px-4 text-sm",
									variant: "outline",
								})}
								to="/login"
							>
								Open OpenMeld Web
							</Link>
						</div>

						<p className="mt-5 max-w-2xl border-border border-l px-4 text-muted-foreground text-sm leading-6">
							This preview is unsigned and not notarized. macOS may say Apple
							cannot verify the developer. Only install it if you trust
							OpenMeld.
						</p>
					</div>

					<div
						className="grid gap-4 text-sm md:grid-cols-2"
						data-testid="desktop-detail-grid"
					>
						<section className="rounded-md border border-border bg-card p-5">
							<h2 className="font-semibold text-foreground">Preview build</h2>
							<dl className="mt-4 grid gap-3 text-muted-foreground">
								<div>
									<dt className="text-foreground/80">Build</dt>
									<dd>Latest uploaded preview</dd>
								</div>
								<div>
									<dt className="text-foreground/80">Architecture</dt>
									<dd>Apple silicon only</dd>
								</div>
							</dl>
						</section>

						<section className="rounded-md border border-border bg-card p-5">
							<h2 className="font-semibold text-foreground">Requirements</h2>
							<ul className="mt-4 grid gap-2 text-muted-foreground">
								{REQUIREMENTS.map((requirement) => (
									<li key={requirement}>{requirement}</li>
								))}
							</ul>
						</section>

						<section className="rounded-md border border-border bg-card p-5 md:col-span-2">
							<h2 className="font-semibold text-foreground">First run</h2>
							<ol className="mt-4 grid gap-3 text-muted-foreground">
								{SETUP_STEPS.map((step) => (
									<li className="leading-6" key={step}>
										{step}
									</li>
								))}
							</ol>
						</section>
					</div>
				</div>
			</section>
		</main>
	);
}
