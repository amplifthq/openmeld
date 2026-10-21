import type { StructuredApiClientFailure } from "@openmeld/api-client";
import { normalizeSpacePasswordText } from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { cn } from "@openmeld/ui/lib/utils";
import type { CSSProperties, ReactNode } from "react";
import { SessionExpiredCard } from "#/components/auth/session-expired-card";
import { getDesktopPlatform } from "#/desktop/platform";
import { toSessionExpiredState } from "#/lib/session-expired";
import { readSpaceMembersPanelOpen } from "#/lib/spaces/members-panel-storage";
import { SPACE_PANEL_WIDTH_METRICS } from "#/lib/spaces/panel-width-storage";
import { useDelayedPending } from "#/lib/use-delayed-pending";
import { DesktopProtectedSpaceHandoff } from "./desktop-protected-space-handoff";
import { SpaceConversationSkeleton } from "./space-conversation-skeleton";
import { SpaceWindowHeader } from "./space-header";
import { SpaceThreadLoadingPanel } from "./space-thread-loading";

export function SpaceLandingLoadingShell(
	input: {
		composer?: ReactNode;
		membersPanelWidth?: string;
		membersOpen?: boolean;
		spaceId?: string;
		threadOpen?: boolean;
		title?: string;
	} = {}
) {
	const showPendingVisual = useDelayedPending(true);
	const membersOpen =
		input.membersOpen ??
		(input.spaceId
			? readSpaceMembersPanelOpen({ spaceId: input.spaceId }) === true
			: false);
	return (
		<div
			className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col"
			data-space-members-panel-open={membersOpen}
			data-space-thread-panel-open={input.threadOpen}
			style={
				{
					"--space-members-panel-width":
						input.membersPanelWidth ??
						SPACE_PANEL_WIDTH_METRICS.members.defaultWidth,
				} as CSSProperties
			}
		>
			<SpaceWindowHeader
				navigation={<span className="text-sm">Messages</span>}
				title={input.title ?? ""}
				titleAdornment={
					input.title || !showPendingVisual ? undefined : (
						<Skeleton className="h-5 w-40 motion-reduce:animate-none" />
					)
				}
			/>
			<div
				className="relative flex min-h-0 flex-1 overflow-hidden"
				data-space-inline-panels=""
			>
				<section
					className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden"
					data-space-history-rail="true"
				>
					<div aria-busy="true" className="min-h-0 flex-1 overflow-hidden">
						<output className="sr-only">Loading messages…</output>
						{showPendingVisual ? (
							<div className="py-4" data-space-conversation-content-width="">
								<SpaceConversationSkeleton />
							</div>
						) : null}
					</div>
					<footer className="shrink-0 bg-background">
						<div className="py-4" data-space-conversation-content-width="">
							{input.composer ?? (
								// Keeps the composer's height from the first frame so the
								// footer does not grow when the delayed skeleton appears.
								<Skeleton
									className={cn(
										"h-[98px] w-full rounded-2xl motion-reduce:animate-none",
										!showPendingVisual && "invisible"
									)}
								/>
							)}
						</div>
					</footer>
				</section>
				{input.threadOpen && showPendingVisual ? (
					<SpaceThreadLoadingPanel />
				) : null}
				{membersOpen ? (
					<aside
						aria-busy="true"
						aria-label="Members"
						className="hidden h-full shrink-0 flex-col gap-4 border-l p-4 xl:flex"
						style={{ width: "min(var(--space-members-panel-width), 100vw)" }}
					>
						<span className="font-medium text-base">Members</span>
						{showPendingVisual ? (
							<>
								<Skeleton className="h-10 w-full motion-reduce:animate-none" />
								<Skeleton className="h-10 w-full motion-reduce:animate-none" />
							</>
						) : null}
					</aside>
				) : null}
			</div>
		</div>
	);
}

export function SpacePasswordRecoverySurface(input: {
	spaceId: string;
	password: string;
	isSubmitting: boolean;
	inlineErrorMessage: string | null;
	onPasswordChange: (value: string) => void;
	onSubmit: () => Promise<void>;
	onRefresh: () => Promise<void>;
}) {
	if (getDesktopPlatform()) {
		return <DesktopProtectedSpaceHandoff spaceId={input.spaceId} />;
	}
	return (
		<ScrollArea
			className="h-full min-h-0 w-full min-w-0 flex-1"
			orientation="vertical"
		>
			<section className="flex flex-col p-4 sm:p-6">
				<header className="flex shrink-0 flex-col gap-1 border-border border-b pb-4">
					<h1 className="font-medium text-2xl">Open This Protected Space</h1>
					<p className="text-muted-foreground text-sm">
						Enter the current password to continue.
					</p>
				</header>

				<div className="flex min-h-[28rem] flex-1 items-center justify-center py-8 sm:py-10">
					<Card className="w-full max-w-xl border-border bg-card">
						<CardHeader className="gap-3 border-border border-b px-6 pb-5">
							<CardTitle className="text-2xl">Space Password</CardTitle>
							<CardDescription className="max-w-none text-sm/6">
								This space is protected. Enter the password for{" "}
								<span className="break-all font-mono text-foreground">
									{input.spaceId}
								</span>
								.
							</CardDescription>
						</CardHeader>
						<CardContent className="flex flex-col gap-5 px-6 pt-5">
							<div className="grid gap-2.5">
								<Label className="text-sm" htmlFor="space-password">
									Password
								</Label>
								<Input
									autoComplete="current-password"
									className="h-11 px-3 text-sm md:text-sm"
									disabled={input.isSubmitting}
									id="space-password"
									name="space-password"
									onChange={(event) => {
										input.onPasswordChange(event.target.value);
									}}
									placeholder="Enter the current space password…"
									type="password"
									value={input.password}
								/>
							</div>
							{input.inlineErrorMessage ? (
								<div className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-destructive text-sm">
									{input.inlineErrorMessage}
								</div>
							) : null}
							<div className="flex flex-wrap gap-2.5">
								<Button
									className="h-10 px-4 text-sm"
									disabled={
										input.isSubmitting ||
										normalizeSpacePasswordText(input.password).length === 0
									}
									onClick={input.onSubmit}
									type="button"
								>
									{input.isSubmitting ? "Opening…" : "Open Space"}
								</Button>
								<Button
									className="h-10 px-4 text-sm"
									onClick={input.onRefresh}
									type="button"
									variant="outline"
								>
									Refresh
								</Button>
							</div>
						</CardContent>
					</Card>
				</div>
			</section>
		</ScrollArea>
	);
}

export function SpaceLandingFailureSurface(input: {
	spaceId: string;
	error: StructuredApiClientFailure | null;
	onRetry: () => Promise<void>;
}) {
	const sessionExpiredState = toSessionExpiredState(input.error);
	const needsAppRefresh = isInvalidApiResponse(input.error);
	let title = "Couldn't Load This Space";
	let description: string | null = null;
	if (sessionExpiredState) {
		title = "Sign in again";
		description = "Sign in again, then OpenMeld will return you to this space.";
	} else if (needsAppRefresh) {
		title = "Refresh OpenMeld";
		description =
			"OpenMeld updated while this page was open. Refresh the app so it can read the latest Space data.";
	}
	const cardTitle = needsAppRefresh ? "Refresh the app" : "Try Again";
	const cardDescription = needsAppRefresh
		? "Refresh OpenMeld to load the current app version and reconnect to this Space."
		: "Reload the current space state and retry the connection.";
	const buttonLabel = needsAppRefresh ? "Refresh" : "Try Again";
	const onRecover = needsAppRefresh
		? () => {
				window.location.reload();
			}
		: input.onRetry;

	return (
		<ScrollArea
			className="h-full min-h-0 w-full min-w-0 flex-1"
			orientation="vertical"
		>
			<section className="flex flex-col p-4">
				<header className="flex shrink-0 flex-col gap-1 border-border border-b pb-4">
					<h1 className="font-medium text-2xl">{title}</h1>
					<p className="text-muted-foreground text-sm">
						{description ?? (
							<>
								OpenMeld couldn&apos;t load the current space state for{" "}
								<span className="font-mono text-foreground">
									{input.spaceId}
								</span>
								.
							</>
						)}
					</p>
				</header>

				<div className="flex min-h-0 flex-1 items-center justify-center py-8">
					{sessionExpiredState ? (
						<SessionExpiredCard
							className="w-full max-w-md"
							requestId={input.error?.requestId}
							state={sessionExpiredState}
						/>
					) : (
						<Card className="w-full max-w-md border-destructive bg-destructive/10">
							<CardHeader className="gap-2 border-border border-b pb-4">
								<CardTitle className="text-xl">{cardTitle}</CardTitle>
								<CardDescription className="max-w-xl">
									{cardDescription}
								</CardDescription>
							</CardHeader>
							<CardContent className="flex flex-col gap-4 pt-4">
								{input.error?.requestId ? (
									<p className="text-muted-foreground text-xs">
										Request ID: {input.error.requestId}
									</p>
								) : null}
								<Button onClick={onRecover} size="sm" type="button">
									{buttonLabel}
								</Button>
							</CardContent>
						</Card>
					)}
				</div>
			</section>
		</ScrollArea>
	);
}

function isInvalidApiResponse(
	error: StructuredApiClientFailure | null
): boolean {
	return error?.code === "gateway.invalid_response";
}
