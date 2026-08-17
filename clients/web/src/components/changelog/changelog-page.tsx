import type {
	ChangelogEntry,
	ChangelogEntryKind,
	ChangelogQueryResponse,
} from "@openmeld/schemas/types";
import { buttonVariants } from "@openmeld/ui/components/button";
import { cn } from "@openmeld/ui/lib/utils";
import { ArrowClockwiseIcon, ArrowRightIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { MessageResponse } from "#/components/ai/message-response";
import { PublicPageHeader } from "#/components/app/public-page-header";
import {
	APP_PAGE_FRAME_CLASS_NAME,
	APP_PAGE_FRAME_PADDING_CLASS_NAME,
} from "#/components/app/shell-layout";
import { readPublishedChangelog } from "#/lib/changelog/read-changelog";

const PAGE_SIZE = 10;
const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
	day: "numeric",
	month: "long",
	timeZone: "UTC",
	year: "numeric",
});
const KIND_LABELS = {
	breaking: "Breaking",
	deprecated: "Deprecated",
	fixed: "Fixed",
	improved: "Improved",
	new: "New",
	removed: "Removed",
	security: "Security",
} satisfies Record<ChangelogEntryKind, string>;
const KIND_STYLES = {
	breaking: "bg-destructive/10 text-destructive",
	deprecated: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
	fixed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
	improved: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
	new: "bg-foreground text-background",
	removed: "bg-muted text-muted-foreground",
	security: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
} satisfies Record<ChangelogEntryKind, string>;

type ChangelogPageProps = {
	initialPage: ChangelogQueryResponse | null;
};

export function ChangelogPage({ initialPage }: ChangelogPageProps) {
	const readPage = useServerFn(readPublishedChangelog);
	const [entries, setEntries] = useState(initialPage?.entries ?? []);
	const [hasMore, setHasMore] = useState(initialPage?.hasMore ?? false);
	const [isLoading, setIsLoading] = useState(false);
	const [loadError, setLoadError] = useState(false);

	async function loadOlderUpdates() {
		setIsLoading(true);
		setLoadError(false);
		try {
			const page = await readPage({
				data: { limit: PAGE_SIZE, offset: entries.length },
			});
			setEntries((current) => [...current, ...page.entries]);
			setHasMore(page.hasMore);
		} catch {
			setLoadError(true);
		} finally {
			setIsLoading(false);
		}
	}

	return (
		<main className="min-h-svh bg-background">
			<PublicPageHeader />
			<section
				className={`mx-auto w-full ${APP_PAGE_FRAME_PADDING_CLASS_NAME} ${APP_PAGE_FRAME_CLASS_NAME}`}
			>
				<div className="relative min-h-[calc(100svh-3.5rem)] px-6 py-14 sm:px-10 sm:py-16 lg:px-14 lg:py-20">
					<div
						aria-hidden
						className="absolute inset-y-0 start-0 w-px bg-foreground/10"
					/>
					<div
						aria-hidden
						className="absolute inset-y-0 end-0 w-px bg-foreground/10"
					/>

					<header className="max-w-3xl">
						<p className="font-geist-pixel-line text-muted-foreground text-xs uppercase tracking-normal">
							Changelog
						</p>
						<h1 className="mt-4 text-balance font-semibold text-4xl tracking-normal sm:text-5xl lg:text-6xl">
							What&apos;s new in OpenMeld
						</h1>
						<p className="mt-5 max-w-2xl text-base text-muted-foreground leading-7 sm:text-lg sm:leading-8">
							Official product updates, published from the same Git-backed
							Changelog used by OpenMeld and the Center Agent.
						</p>
					</header>

					{initialPage ? (
						<ChangelogEntries entries={entries} />
					) : (
						<UnavailableState />
					)}

					{initialPage && hasMore ? (
						<div className="mt-14 md:ms-44">
							<button
								className={buttonVariants({
									className: "min-w-40 gap-2 rounded-md",
									variant: "outline",
								})}
								disabled={isLoading}
								onClick={loadOlderUpdates}
								type="button"
							>
								{isLoading ? "Loading…" : "Show older updates"}
							</button>
						</div>
					) : null}

					{loadError ? (
						<div className="mt-6 md:ms-44" role="alert">
							<p className="text-muted-foreground text-sm">
								Older updates could not be loaded.
							</p>
							<button
								className="mt-3 inline-flex items-center gap-2 font-medium text-sm hover:underline"
								onClick={loadOlderUpdates}
								type="button"
							>
								<ArrowClockwiseIcon aria-hidden className="size-4" />
								Try again
							</button>
						</div>
					) : null}

					<footer className="mt-20 flex flex-col gap-4 border-foreground/10 border-t pt-6 text-muted-foreground text-sm sm:flex-row sm:items-center sm:justify-between">
						<p>Published from OpenMeld&apos;s canonical Git-backed record.</p>
						<Link
							className="inline-flex items-center gap-2 font-medium text-foreground hover:underline"
							to="/"
						>
							Explore OpenMeld
							<ArrowRightIcon aria-hidden className="size-4" />
						</Link>
					</footer>
				</div>
			</section>
		</main>
	);
}

function ChangelogEntries({ entries }: { entries: ChangelogEntry[] }) {
	if (entries.length === 0) {
		return (
			<section aria-labelledby="no-updates-title" className="mt-16 max-w-2xl">
				<h2 className="font-medium text-xl" id="no-updates-title">
					No published updates yet
				</h2>
				<p className="mt-3 text-muted-foreground text-sm leading-7">
					Updates will appear here after their delivery evidence is verified.
				</p>
			</section>
		);
	}

	return (
		<div className="mt-16 space-y-14 sm:mt-20 sm:space-y-16">
			{entries.map((entry) => (
				<ChangelogEntryView entry={entry} key={entry.id} />
			))}
		</div>
	);
}

function ChangelogEntryView({ entry }: { entry: ChangelogEntry }) {
	return (
		<article className="grid gap-5 md:grid-cols-[9rem_minmax(0,1fr)] md:gap-8">
			<div>
				<time
					className="text-muted-foreground text-sm"
					dateTime={entry.publishedAt}
				>
					{formatPublishedDate(entry.publishedAt)}
				</time>
			</div>
			<div className="min-w-0 max-w-3xl">
				<div className="flex flex-wrap items-center gap-2">
					<span
						className={cn(
							"rounded-full px-2.5 py-1 font-medium text-xs",
							KIND_STYLES[entry.kind]
						)}
					>
						{KIND_LABELS[entry.kind]}
					</span>
					{entry.release ? (
						<span className="text-muted-foreground text-xs">
							Release {entry.release}
						</span>
					) : null}
				</div>
				<h2 className="mt-4 text-balance font-semibold text-2xl tracking-normal sm:text-3xl">
					{entry.title}
				</h2>
				<MessageResponse
					className="mt-4 text-muted-foreground"
					isStreaming={false}
				>
					{entry.body}
				</MessageResponse>
				<ul aria-label="Product areas" className="mt-5 flex flex-wrap gap-2">
					{entry.areas.map((area) => (
						<li
							className="rounded-full bg-muted px-2.5 py-1 text-muted-foreground text-xs"
							key={area}
						>
							{formatArea(area)}
						</li>
					))}
				</ul>
			</div>
		</article>
	);
}

function UnavailableState() {
	return (
		<section aria-labelledby="updates-unavailable" className="mt-16 max-w-xl">
			<h2 className="font-medium text-xl" id="updates-unavailable">
				Updates are temporarily unavailable
			</h2>
			<p className="mt-3 text-muted-foreground text-sm leading-7">
				OpenMeld could not read the official Changelog. No cached or guessed
				updates are being shown.
			</p>
			<button
				className={buttonVariants({
					className: "mt-6 gap-2 rounded-md",
					variant: "outline",
				})}
				onClick={() => window.location.reload()}
				type="button"
			>
				<ArrowClockwiseIcon aria-hidden className="size-4" />
				Try again
			</button>
		</section>
	);
}

function formatPublishedDate(publishedAt: string): string {
	return DATE_FORMATTER.format(new Date(`${publishedAt}T00:00:00Z`));
}

function formatArea(area: string): string {
	return area
		.split("-")
		.map((word, index) =>
			index === 0 ? `${word.charAt(0).toUpperCase()}${word.slice(1)}` : word
		)
		.join(" ");
}
