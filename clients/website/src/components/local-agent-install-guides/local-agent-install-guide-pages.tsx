import {
	LOCAL_AGENTS_GUIDE_PATH,
	type LocalAgentInstallGuide,
	listLocalAgentInstallGuides,
} from "@openmeld/product-catalog/local-agent-install-guides";
import { buttonVariants } from "@openmeld/ui/components/button";
import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import {
	APP_PAGE_FRAME_CLASS_NAME,
	APP_PAGE_FRAME_PADDING_CLASS_NAME,
} from "@openmeld/ui/lib/page-frame";
import { PublicPageHeader } from "#/components/public-page-header";
import { appUrl } from "#/lib/app-url";

const CONFIG_DIRECTORY_NOTE =
	"OpenMeld checks supported local agents on this computer and only lists installations it can control. Sign in to an agent before checking again.";

export function LocalAgentInstallGuideIndexPage() {
	const guides = listLocalAgentInstallGuides();

	return (
		<main className="min-h-svh bg-background">
			<PublicPageHeader />

			<section
				className={`mx-auto w-full ${APP_PAGE_FRAME_PADDING_CLASS_NAME} ${APP_PAGE_FRAME_CLASS_NAME}`}
			>
				<div className="flex min-h-[calc(100svh-3.5rem)] flex-col gap-10 px-6 py-12 sm:px-10 lg:px-14 lg:py-16">
					<div className="flex max-w-4xl flex-1 flex-col justify-center">
						<p className="font-medium font-mono text-muted-foreground text-sm uppercase tracking-[0.18em]">
							Local agent setup
						</p>
						<h1 className="mt-3 max-w-2xl font-geist-pixel-square text-4xl text-foreground sm:text-5xl">
							Connect a local agent
						</h1>
						<p className="mt-5 max-w-2xl text-base text-muted-foreground leading-7">
							OpenMeld connects agents that run on your computer. It can use
							Codex included with ChatGPT, or a supported command-line agent.
							Open an agent once, sign in, then ask OpenMeld to check again.
						</p>

						<div className="mt-8 flex flex-wrap gap-3">
							<a
								className={buttonVariants({
									className: "h-10 px-4 text-sm",
								})}
								href={appUrl("/login")}
							>
								Open OpenMeld
							</a>
							<a
								className={buttonVariants({
									className: "h-10 px-4 text-sm",
									variant: "outline",
								})}
								href={appUrl("/login")}
							>
								Open settings
							</a>
						</div>

						<p className="mt-5 max-w-2xl border-border border-l px-4 text-muted-foreground text-sm leading-6">
							Already installed one? Re-run your setup command, or go to
							Connect.
						</p>
					</div>

					<div
						className="grid auto-rows-fr gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3"
						data-testid="local-agent-guide-grid"
					>
						{guides.map((guide) => (
							<a
								className="group flex h-full flex-col rounded-md border border-border bg-card p-5 transition-colors hover:border-foreground/25 hover:bg-muted/40"
								href={`${LOCAL_AGENTS_GUIDE_PATH}/${guide.agentId}`}
								key={guide.agentId}
							>
								<span className="flex items-center gap-3">
									<LocalAgentLogo
										agentId={`builtin:${guide.agentId}`}
										className="h-9 w-9"
										size="md"
									/>
									<span>
										<span className="block font-semibold text-foreground">
											{guide.displayName}
										</span>
										<span className="mt-1 block text-muted-foreground leading-6">
											{guide.summary}
										</span>
									</span>
								</span>
								<span className="mt-auto block pt-4 font-medium text-foreground/80 text-xs uppercase tracking-[0.16em] group-hover:text-foreground">
									View setup steps
								</span>
							</a>
						))}
					</div>
				</div>
			</section>
		</main>
	);
}

export function LocalAgentInstallGuideDetailPage({
	guide,
}: {
	guide: LocalAgentInstallGuide;
}) {
	return (
		<main className="min-h-svh bg-background">
			<PublicPageHeader />

			<section
				className={`mx-auto w-full ${APP_PAGE_FRAME_PADDING_CLASS_NAME} ${APP_PAGE_FRAME_CLASS_NAME}`}
			>
				<div className="flex min-h-[calc(100svh-3.5rem)] flex-col gap-10 px-6 py-12 sm:px-10 lg:px-14 lg:py-16">
					<div className="flex max-w-4xl flex-1 flex-col justify-center">
						<a
							className="mb-8 text-muted-foreground text-sm hover:text-foreground"
							href={LOCAL_AGENTS_GUIDE_PATH}
						>
							Back to local agents
						</a>
						<div className="flex items-center gap-4">
							<LocalAgentLogo
								agentId={`builtin:${guide.agentId}`}
								className="h-12 w-12"
								size="md"
							/>
							<div>
								<p className="font-medium font-mono text-muted-foreground text-sm uppercase tracking-[0.18em]">
									Local agent
								</p>
								<h1 className="mt-2 font-geist-pixel-square text-4xl text-foreground sm:text-5xl">
									{guide.displayName}
								</h1>
							</div>
						</div>
						<p className="mt-6 max-w-2xl text-base text-muted-foreground leading-7">
							{guide.summary} Set it up on the computer where you want OpenMeld
							to run local work.
						</p>

						<div className="mt-8 flex flex-wrap gap-3">
							<a
								className={buttonVariants({
									className: "h-10 px-4 text-sm",
								})}
								href={guide.officialInstallUrl}
								rel="noopener"
								target="_blank"
							>
								Open official setup guide
							</a>
							<a
								className={buttonVariants({
									className: "h-10 px-4 text-sm",
									variant: "outline",
								})}
								href={appUrl("/login")}
							>
								Return to OpenMeld
							</a>
						</div>

						<p className="mt-5 max-w-2xl border-border border-l px-4 text-muted-foreground text-sm leading-6">
							{CONFIG_DIRECTORY_NOTE}
						</p>
					</div>

					<div
						className="grid gap-4 text-sm md:grid-cols-2"
						data-testid="local-agent-detail-grid"
					>
						<section className="rounded-md border border-border bg-card p-5">
							<h2 className="font-semibold text-foreground">Install</h2>
							<ol className="mt-4 grid gap-3 text-muted-foreground">
								{guide.installSteps.map((step) => (
									<li className="leading-6" key={step}>
										{step}
									</li>
								))}
							</ol>
						</section>

						{guide.verifyCommand ? (
							<section className="rounded-md border border-border bg-card p-5">
								<h2 className="font-semibold text-foreground">Verify</h2>
								<p className="mt-4 text-muted-foreground leading-6">
									Run this command in Terminal:
								</p>
								<ScrollArea className="" orientation="horizontal">
									<code className="mt-3 block whitespace-nowrap rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-foreground text-xs">
										{guide.verifyCommand}
									</code>
								</ScrollArea>
							</section>
						) : null}

						<section className="rounded-md border border-border bg-card p-5 md:col-span-2">
							<h2 className="font-semibold text-foreground">Next step</h2>
							<p className="mt-4 text-muted-foreground leading-6">
								Re-run the setup command from OpenMeld Web. If this computer is
								already set up, open Settings, go to Computers, and choose Check
								Local Agents.
							</p>
							<p className="mt-3 text-muted-foreground leading-6">
								{guide.postInstallNote}
							</p>
							{guide.officialDocsUrl ? (
								<a
									className="mt-4 inline-flex font-medium text-foreground hover:text-foreground/80"
									href={guide.officialDocsUrl}
									rel="noopener"
									target="_blank"
								>
									Read official documentation
								</a>
							) : null}
						</section>
					</div>
				</div>
			</section>
		</main>
	);
}
