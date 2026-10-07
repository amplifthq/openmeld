import type {
	DesktopUpdaterAction,
	DesktopUpdaterState,
} from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import { Progress } from "@openmeld/ui/components/progress";
import { CircleNotchIcon } from "@phosphor-icons/react";
import { useId } from "react";
import { AppPageHeader } from "#/components/app/app-page-header";
import { desktopUpdaterPresentation } from "../../../desktop/src/shared/updater-presentation";

/** Layout only. Native facts and action ownership remain with DesktopUpdater. */
export function DesktopUpdaterView(input: {
	state: DesktopUpdaterState | null;
	presentation: "notice" | "settings";
	pending: boolean;
	actionError: string | null;
	readError: boolean;
	onAction: (action: DesktopUpdaterAction) => void;
	onDismiss?: () => void;
}) {
	const headingId = useId();
	const view = desktopUpdaterPresentation(input.state);
	const headline = input.readError
		? "Couldn't read update status"
		: view.headline;
	const description = input.readError
		? "Editing is paused until Desktop can confirm the update state. Choose Quit from the app menu, then reopen Desktop."
		: view.description;
	const settings = input.presentation === "settings";
	const action =
		view.action && !input.readError ? (
			<UpdateAction
				action={view.action}
				label={view.label}
				onAction={input.onAction}
				pending={input.pending && view.action !== "cancel"}
				settings={settings}
			/>
		) : null;
	const progress =
		input.state?.status === "downloading" ? (
			<DownloadProgress percent={input.state.percent} />
		) : null;
	const error = input.actionError ? (
		<p className="text-destructive text-sm leading-6" role="alert">
			{input.actionError}
		</p>
	) : null;
	if (settings) {
		return (
			<section
				aria-labelledby={headingId}
				className="@container/desktop-update min-w-0"
			>
				<AppPageHeader
					description={
						input.state
							? `OpenMeld Desktop · Version ${input.state.currentVersion}`
							: "OpenMeld Desktop"
					}
					eyebrow="Personal"
					id={headingId}
					title="Updates"
				/>
				<div
					className="mt-6 flex min-w-0 @lg/desktop-update:flex-row flex-col @lg/desktop-update:items-start @lg/desktop-update:gap-6 gap-4 border-border border-t pt-6"
					data-slot="desktop-update-status"
				>
					<div className="min-w-0 flex-1 space-y-3">
						<div aria-atomic="true" aria-live="polite" className="space-y-2">
							<h2 className="font-medium text-base text-foreground">
								{headline}
							</h2>
							<p className="break-words text-muted-foreground text-sm leading-6">
								{description}
							</p>
						</div>
						{error}
					</div>
					{action || progress || (view.busy && !input.readError) ? (
						<div
							className="@lg/desktop-update:w-auto w-full @lg/desktop-update:min-w-36 shrink-0 space-y-3"
							data-slot="desktop-update-action"
						>
							{progress}
							{action || (!progress && <BusyStatus label={headline} />)}
						</div>
					) : null}
				</div>
			</section>
		);
	}
	return (
		<section aria-labelledby={headingId} className="space-y-4">
			<div className="flex items-center justify-between gap-3">
				<h2 className="font-bold text-unread text-xl" id={headingId}>
					Updates
				</h2>
				{input.onDismiss ? (
					<Button
						className="text-muted-foreground hover:text-foreground focus-visible:text-foreground"
						onClick={input.onDismiss}
						variant="ghost"
					>
						Later
					</Button>
				) : null}
			</div>
			<p
				aria-live="polite"
				className="break-words text-muted-foreground text-sm leading-6"
			>
				{input.readError ? `${headline}. ${description}` : view.noticeMessage}
			</p>
			{progress}
			{error}
			{action}
		</section>
	);
}

function UpdateAction(input: {
	action: DesktopUpdaterAction;
	label: string | undefined;
	pending: boolean;
	settings: boolean;
	onAction: (action: DesktopUpdaterAction) => void;
}) {
	return (
		<Button
			aria-busy={input.pending || undefined}
			className={input.settings ? "@lg/desktop-update:w-auto w-full" : "w-full"}
			disabled={input.pending}
			onClick={() => input.onAction(input.action)}
			size={input.settings ? "default" : "lg"}
			variant="default"
		>
			{input.pending ? <BusyIcon /> : null}
			{input.label}
		</Button>
	);
}

function BusyIcon() {
	return (
		<CircleNotchIcon
			aria-hidden="true"
			className="size-4 shrink-0 motion-safe:animate-spin"
		/>
	);
}

function BusyStatus(input: { label: string }) {
	return (
		<output
			aria-label={input.label}
			className="flex min-h-8 items-center gap-2 text-muted-foreground text-sm"
		>
			<BusyIcon />
			<span>In progress</span>
		</output>
	);
}

function DownloadProgress(input: { percent: number | null }) {
	if (input.percent === null) {
		return (
			<div
				aria-label="Download progress"
				aria-valuetext="Downloading; progress is not available"
				className="flex min-h-8 items-center gap-2 text-muted-foreground text-sm"
				role="progressbar"
			>
				<BusyIcon />
				<span>Downloading…</span>
			</div>
		);
	}
	const percent = Math.round(input.percent);
	return (
		<div className="space-y-2">
			<p
				aria-hidden="true"
				className="text-right text-muted-foreground text-xs tabular-nums"
			>
				{percent}%
			</p>
			<Progress
				aria-label="Download progress"
				className="rounded-full [&>div]:motion-reduce:transition-none"
				value={percent}
			/>
		</div>
	);
}
