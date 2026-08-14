import { Link } from "@tanstack/react-router";
import { PublicPageHeader } from "#/components/app/public-page-header";
import {
	APP_PAGE_FRAME_CLASS_NAME,
	APP_PAGE_FRAME_PADDING_CLASS_NAME,
} from "#/components/app/shell-layout";

type LegalPolicySummaryItem = {
	label: string;
	text: string;
};

type LegalPolicySection = {
	paragraphs: readonly string[];
	title: string;
};

type LegalPolicyPageProps = {
	intro: string;
	lastUpdated: string;
	sections: readonly LegalPolicySection[];
	summaryItems: readonly LegalPolicySummaryItem[];
	title: string;
};

export function LegalPolicyPage({
	intro,
	lastUpdated,
	sections,
	summaryItems,
	title,
}: LegalPolicyPageProps) {
	return (
		<main className="min-h-svh bg-background">
			<PublicPageHeader />

			<section
				className={`mx-auto w-full ${APP_PAGE_FRAME_PADDING_CLASS_NAME} ${APP_PAGE_FRAME_CLASS_NAME}`}
			>
				<div className="relative px-6 py-14 sm:px-10 sm:py-16 lg:px-14">
					<div
						aria-hidden
						className="absolute inset-y-0 left-0 w-px bg-foreground/10"
					/>
					<div
						aria-hidden
						className="absolute inset-y-0 right-0 w-px bg-foreground/10"
					/>

					<div className="max-w-3xl">
						<p className="font-geist-pixel-line text-muted-foreground text-xs uppercase tracking-normal">
							Last updated {lastUpdated}
						</p>
						<h1 className="mt-4 text-balance font-semibold text-4xl tracking-normal sm:text-5xl">
							{title}
						</h1>
						<p className="mt-5 max-w-2xl text-base text-muted-foreground leading-7">
							{intro}
						</p>

						<div className="mt-10 grid gap-4 border-foreground/10 border-y py-6 sm:grid-cols-2">
							{summaryItems.map((item) => (
								<section className="space-y-2" key={item.label}>
									<h2 className="font-medium text-sm">{item.label}</h2>
									<p className="text-muted-foreground text-sm leading-6">
										{item.text}
									</p>
								</section>
							))}
						</div>

						<div className="mt-10 space-y-10">
							{sections.map((section) => (
								<section className="space-y-4" key={section.title}>
									<h2 className="font-semibold text-xl">{section.title}</h2>
									{section.paragraphs.map((paragraph) => (
										<p
											className="text-muted-foreground text-sm leading-7"
											key={paragraph}
										>
											{paragraph}
										</p>
									))}
								</section>
							))}
						</div>

						<div className="mt-12 border-foreground/10 border-t pt-6">
							<Link
								className="text-muted-foreground text-sm transition-colors hover:text-foreground"
								to="/login"
							>
								Back to login
							</Link>
						</div>
					</div>
				</div>
			</section>
		</main>
	);
}
