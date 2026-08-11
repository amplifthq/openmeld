"use client";

import {
	createFeedbackApi,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import type { SubmitFeedbackIssueRequest } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import { Textarea } from "@openmeld/ui/components/textarea";
import { TabsSubtle, TabsSubtleItem } from "@openmeld/ui/fluid/tabs-subtle";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { OPENMELD_OFFICIAL_FEEDBACK_INBOX_KEY } from "#/lib/feedback/config";
import { createWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

const SUMMARY_MAX_LENGTH = 200;
const DETAILS_MAX_LENGTH = 4000;
const FEEDBACK_ISSUE_PREFIX = "feedback_issue_";
const SHORT_ISSUE_ID_LENGTH = 8;

type FeedbackCategory = SubmitFeedbackIssueRequest["category"];

const FEEDBACK_CATEGORY_OPTIONS = [
	{ label: "Bug", value: "bug" },
	{ label: "Experience", value: "experience" },
	{ label: "Idea", value: "idea" },
	{ label: "Question", value: "question" },
] as const satisfies readonly {
	label: string;
	value: FeedbackCategory;
}[];

export function SendFeedbackDialog(input: {
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	const [category, setCategory] = useState<FeedbackCategory>("experience");
	const [summary, setSummary] = useState("");
	const [details, setDetails] = useState("");
	const normalizedSummary = summary.trim();
	const normalizedDetails = details.trim();
	const isSummaryInvalid =
		normalizedSummary.length === 0 || summary.length > SUMMARY_MAX_LENGTH;
	const isDetailsInvalid = details.length > DETAILS_MAX_LENGTH;

	const resetForm = () => {
		setCategory("experience");
		setSummary("");
		setDetails("");
	};

	const submitFeedbackMutation = useMutation({
		mutationFn: async () => {
			const feedbackApi = createFeedbackApi(createWebOpenMeldApiFoundation());
			return await feedbackApi.submitFeedbackIssue({
				inboxKey: OPENMELD_OFFICIAL_FEEDBACK_INBOX_KEY,
				request: {
					category,
					summary: normalizedSummary,
					...(normalizedDetails ? { details: normalizedDetails } : {}),
					submitterKind: "human",
					clientContext: { clientKind: "web" },
				},
			});
		},
		onError: (error) => {
			toast.error(resolveFeedbackSubmissionErrorMessage(error));
		},
		onSuccess: (result) => {
			toast.success(
				`Feedback sent. Issue ${formatFeedbackIssueReference(result.issueId)}.`
			);
			resetForm();
			input.onOpenChange(false);
		},
	});
	const isPending = submitFeedbackMutation.isPending;
	const canSubmit = !(isPending || isSummaryInvalid || isDetailsInvalid);

	return (
		<Dialog
			onOpenChange={(nextOpen) => {
				if (isPending) {
					return;
				}
				if (!nextOpen) {
					resetForm();
				}
				input.onOpenChange(nextOpen);
			}}
			open={input.open}
		>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Send feedback</DialogTitle>
					<DialogDescription>
						Share a bug, experience, idea, or question with the OpenMeld team.
					</DialogDescription>
				</DialogHeader>
				<form
					className="grid gap-6"
					onSubmit={(event) => {
						event.preventDefault();
						if (canSubmit) {
							submitFeedbackMutation.mutate();
						}
					}}
				>
					<fieldset className="grid gap-3" disabled={isPending}>
						<legend className="font-medium text-foreground text-xs">
							Category
						</legend>
						<TabsSubtle
							aria-label="Feedback category"
							className="w-full"
							onSelect={(index) => {
								const option = FEEDBACK_CATEGORY_OPTIONS[index];
								if (option && !isPending) {
									setCategory(option.value);
								}
							}}
							selectedIndex={FEEDBACK_CATEGORY_OPTIONS.findIndex(
								(option) => option.value === category
							)}
						>
							{FEEDBACK_CATEGORY_OPTIONS.map((option, index) => (
								<TabsSubtleItem
									className="flex-1 justify-center"
									disabled={isPending}
									index={index}
									key={option.value}
									label={option.label}
								/>
							))}
						</TabsSubtle>
					</fieldset>

					<div className="grid gap-2">
						<div className="flex items-center justify-between gap-3">
							<label
								className="font-medium text-foreground text-xs"
								htmlFor="feedback-summary"
							>
								Summary
							</label>
							<span
								className={
									summary.length > SUMMARY_MAX_LENGTH
										? "text-destructive text-xs tabular-nums"
										: "text-muted-foreground text-xs tabular-nums"
								}
							>
								{summary.length}/{SUMMARY_MAX_LENGTH}
							</span>
						</div>
						<Input
							aria-invalid={summary.length > SUMMARY_MAX_LENGTH || undefined}
							disabled={isPending}
							id="feedback-summary"
							onChange={(event) => setSummary(event.target.value)}
							placeholder="What happened, or what could be better?"
							value={summary}
						/>
					</div>

					<div className="grid gap-2">
						<div className="flex items-center justify-between gap-3">
							<label
								className="font-medium text-foreground text-xs"
								htmlFor="feedback-details"
							>
								Details (optional)
							</label>
							<span
								className={
									details.length > DETAILS_MAX_LENGTH
										? "text-destructive text-xs tabular-nums"
										: "text-muted-foreground text-xs tabular-nums"
								}
							>
								{details.length}/{DETAILS_MAX_LENGTH}
							</span>
						</div>
						<Textarea
							aria-invalid={details.length > DETAILS_MAX_LENGTH || undefined}
							className="min-h-28 resize-y text-xs"
							disabled={isPending}
							id="feedback-details"
							onChange={(event) => setDetails(event.target.value)}
							placeholder="Add any context that would help us understand."
							value={details}
						/>
					</div>

					<DialogFooter>
						<Button
							disabled={isPending}
							onClick={() => {
								resetForm();
								input.onOpenChange(false);
							}}
							type="button"
							variant="outline"
						>
							Cancel
						</Button>
						<Button disabled={!canSubmit} type="submit">
							{isPending ? "Sending feedback…" : "Send feedback"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function resolveFeedbackSubmissionErrorMessage(error: unknown): string {
	const failure = toStructuredApiClientFailure(error);
	switch (failure.code) {
		case "feedback.submit.rate_limited":
			return "Too much feedback was sent recently. Please wait a minute and try again.";
		case "feedback.submit.inbox_not_found":
		case "feedback.submit.disabled":
			return "Feedback is temporarily unavailable. Please try again later.";
		case "network.timeout":
			return "Your feedback took too long to send. Please try again.";
		case "network.request_failed":
			return "OpenMeld couldn't reach the feedback service. Check your connection and try again.";
		default:
			return (
				failure.message ||
				"OpenMeld couldn't send your feedback. Please try again."
			);
	}
}

function formatFeedbackIssueReference(issueId: string): string {
	const withoutPrefix = issueId.startsWith(FEEDBACK_ISSUE_PREFIX)
		? issueId.slice(FEEDBACK_ISSUE_PREFIX.length)
		: issueId;
	return `#${withoutPrefix.slice(0, SHORT_ISSUE_ID_LENGTH)}`;
}
