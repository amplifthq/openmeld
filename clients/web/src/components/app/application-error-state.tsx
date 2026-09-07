"use client";

import { Button } from "@openmeld/ui/components/button";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { OPENMELD_LOGO_THEME_COLORS } from "@openmeld/ui/lib/openmeld-logo-theme";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArrowClockwiseIcon,
	ArrowLeftIcon,
	CaretDownIcon,
	CopyIcon,
	PaperPlaneTiltIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useRef, useState } from "react";
import { OpenMeldLogo } from "#/components/openmeld-logo-weak";

export function ApplicationErrorState(input: {
	actionLabel?: string;
	children?: ReactNode;
	className?: string;
	description?: string;
	details?: string;
	message: string;
	onAction?: () => Promise<void> | void;
	onReport?: () => Promise<string>;
}) {
	const [report, setReport] = useState<{
		status: "idle" | "sending" | "sent" | "failed";
		id?: string;
	}>({ status: "idle" });
	const [copyStatus, setCopyStatus] = useState("");
	const submitting = useRef(false);
	const details = input.details ?? input.message;

	const reportLabels = {
		idle: "Send error report",
		sending: "Sending report…",
		sent: "Report sent",
		failed: "Try sending again",
	};
	let reportMessage = "";
	if (report.status === "sent") {
		reportMessage = `Report ID: ${report.id}`;
	}
	if (report.status === "failed") {
		reportMessage =
			"The report could not be sent. Check your connection and try again.";
	}
	async function submitReport() {
		if (!input.onReport || submitting.current || report.status === "sent") {
			return;
		}
		submitting.current = true;
		setReport({ status: "sending" });
		try {
			setReport({ status: "sent", id: await input.onReport() });
		} catch {
			setReport({ status: "failed" });
		} finally {
			submitting.current = false;
		}
	}
	return (
		<section className={cn("w-full max-w-xl space-y-6", input.className)}>
			<div className="flex flex-col items-center gap-5 text-center">
				<div className="px-6 py-5">
					<OpenMeldLogo colors={OPENMELD_LOGO_THEME_COLORS} scale={0.5} />
				</div>
				<div className="space-y-2">
					<p className="text-muted-foreground text-xs">It's not your fault</p>
					<h1 className="font-medium text-2xl tracking-tight">
						This page couldn’t load.
					</h1>
					<p className="mx-auto max-w-sm text-muted-foreground text-sm leading-6">
						{input.description ??
							"Try refreshing the page, or go back to where you left off."}
					</p>
				</div>
			</div>
			<div className="flex flex-wrap justify-center gap-2">
				<Button
					onClick={() => {
						if (window.history.length > 1) {
							window.history.back();
						} else {
							window.location.assign("/");
						}
					}}
					size="sm"
					type="button"
					variant="outline"
				>
					<ArrowLeftIcon aria-hidden="true" /> Go back
				</Button>
				{input.onAction ? (
					<Button onClick={input.onAction} size="sm" type="button">
						<ArrowClockwiseIcon aria-hidden="true" />
						{input.actionLabel ?? "Refresh page"}
					</Button>
				) : null}
			</div>
			<div className="overflow-hidden rounded-md border border-border bg-card text-left">
				<details className="peer group">
					<summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-xs marker:content-none focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
						Error details
						<CaretDownIcon
							aria-hidden="true"
							className="size-3.5 group-open:rotate-180"
						/>
					</summary>
					<div className="space-y-3 border-border border-t p-4">
						<ScrollArea className="max-h-72" orientation="both">
							<pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5">
								{details}
							</pre>
						</ScrollArea>
						{input.children}
						<Button
							onClick={async () => {
								try {
									await navigator.clipboard.writeText(details);
									setCopyStatus("Copied");
								} catch {
									setCopyStatus(
										"Could not copy. Select the details and copy them manually."
									);
								}
							}}
							size="sm"
							type="button"
							variant="outline"
						>
							<CopyIcon aria-hidden="true" /> Copy details
						</Button>
						<p aria-live="polite" className="text-muted-foreground text-xs">
							{copyStatus}
						</p>
					</div>
				</details>
				<div
					aria-hidden="true"
					className="pointer-events-none h-14 overflow-hidden px-4 pb-3 peer-open:hidden"
					data-error-preview=""
				>
					<pre className="h-full whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground leading-5 [mask-image:linear-gradient(to_bottom,black,transparent)]">
						{input.message.slice(0, 360)}
					</pre>
				</div>
			</div>
			{input.onReport ? (
				<div className="space-y-2 text-center">
					<Button
						disabled={report.status === "sending" || report.status === "sent"}
						onClick={submitReport}
						size="sm"
						type="button"
						variant="ghost"
					>
						<PaperPlaneTiltIcon aria-hidden="true" />
						{reportLabels[report.status]}
					</Button>
					<p className="text-muted-foreground text-xs">
						Sends technical diagnostics, without your messages or account
						details.
					</p>
					<p
						aria-live="polite"
						className="break-words text-muted-foreground text-xs"
					>
						{reportMessage}
					</p>
				</div>
			) : null}
		</section>
	);
}
