import type {
	AgentControllerPermissionMode,
	AgentInteractionQuestion,
	AgentInteractionRequest,
	AgentInteractionResponse,
	RespondToSpaceAgentInteractionBody,
	WakeProgressItem,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { Textarea } from "@openmeld/ui/components/textarea";
import { CheckboxGroup, CheckboxItem } from "@openmeld/ui/fluid/checkbox-group";
import { RadioGroup, RadioItem } from "@openmeld/ui/fluid/radio-group";
import { cn } from "@openmeld/ui/lib/utils";
import { type ReactNode, useId, useState } from "react";
import { MessageResponse } from "#/components/ai/message-response";

export type SpaceAgentInteractionResponseHandler = (
	input: RespondToSpaceAgentInteractionBody
) => Promise<void>;

export type SpaceAgentProfileEditHandler = (profileId: string) => void;

export type SpaceAgentPermissionModeShortcut = {
	description: string;
	label: string;
	permissionMode: AgentControllerPermissionMode;
};

export type SpaceAgentPermissionModeUpdateHandler = (input: {
	permissionMode: AgentControllerPermissionMode;
	profileId: string;
}) => void;

type QuestionDraft = {
	otherText: string;
	selectedOptionIds: ReadonlySet<string>;
	useOther: boolean;
};

const EMPTY_QUESTION_DRAFT: QuestionDraft = {
	otherText: "",
	selectedOptionIds: new Set(),
	useOther: false,
};

export function SpaceAgentInteractionCard(input: {
	item: WakeProgressItem;
	onEditAgentProfile?: SpaceAgentProfileEditHandler;
	onPermissionModeUpdate?: SpaceAgentPermissionModeUpdateHandler;
	onRespond?: SpaceAgentInteractionResponseHandler;
	permissionModeShortcut?: SpaceAgentPermissionModeShortcut;
	presentation?: "surface" | "timeline";
}) {
	const pendingInteraction = input.item.pendingInteraction;
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [submitted, setSubmitted] = useState(false);

	if (!pendingInteraction) {
		return null;
	}

	const request = pendingInteraction.request;
	const canRespond =
		pendingInteraction.canRespond && request !== null && input.onRespond;

	const respond = async (
		response: AgentInteractionResponse,
		permissionMode?: AgentControllerPermissionMode
	) => {
		if (!(request && canRespond)) {
			return;
		}
		const runtimeCoordinatorExecutionId =
			input.item.runtimeCoordinatorExecutionId;
		if (!runtimeCoordinatorExecutionId) {
			setErrorMessage(
				"OpenMeld cannot send this response because the Wake is missing its execution reference. Refresh the Space or open Wake details."
			);
			return;
		}

		setErrorMessage(null);
		setIsSubmitting(true);
		try {
			await canRespond({
				interactionId: pendingInteraction.interactionId,
				response,
				runtimeCoordinatorExecutionId,
			});
			setSubmitted(true);
			if (permissionMode) {
				input.onPermissionModeUpdate?.({
					permissionMode,
					profileId: input.item.targetProfileId,
				});
			}
		} catch (error) {
			setErrorMessage(
				error instanceof Error
					? error.message
					: "OpenMeld couldn't send this response. Try again."
			);
		} finally {
			setIsSubmitting(false);
		}
	};

	if (submitted) {
		return (
			<InteractionShell
				kind={pendingInteraction.kind}
				presentation={input.presentation}
				targetLabel={input.item.targetLabel}
				title="Response sent"
			>
				<p aria-live="polite" className="text-muted-foreground text-sm">
					Waiting for {input.item.targetLabel} to continue.
				</p>
			</InteractionShell>
		);
	}

	if (!canRespond) {
		return (
			<InteractionShell
				kind={pendingInteraction.kind}
				presentation={input.presentation}
				targetLabel={input.item.targetLabel}
				title="Waiting for the local agent owner"
			>
				<p className="text-muted-foreground text-sm leading-6">
					This Wake is paused until the person who owns this local agent
					responds. You can keep using this Space while it waits.
				</p>
			</InteractionShell>
		);
	}

	return (
		<InteractionShell
			kind={request.kind}
			presentation={input.presentation}
			targetLabel={input.item.targetLabel}
			title={request.title}
		>
			{request.description ? (
				<p className="text-muted-foreground text-sm leading-6">
					{request.description}
				</p>
			) : null}
			{request.kind === "permission" ? (
				<PermissionInteraction
					disabled={isSubmitting}
					onEditAgentProfile={
						input.onEditAgentProfile
							? () => input.onEditAgentProfile?.(input.item.targetProfileId)
							: undefined
					}
					onRespond={respond}
					permissionModeShortcut={input.permissionModeShortcut}
					request={request}
				/>
			) : null}
			{request.kind === "question" ? (
				<QuestionInteraction
					disabled={isSubmitting}
					onRespond={respond}
					request={request}
				/>
			) : null}
			{request.kind === "plan_review" ? (
				<PlanReviewInteraction
					disabled={isSubmitting}
					onRespond={respond}
					request={request}
				/>
			) : null}
			{isSubmitting ? (
				<p aria-live="polite" className="text-muted-foreground text-xs">
					Sending response…
				</p>
			) : null}
			{errorMessage ? (
				<p
					aria-live="assertive"
					className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-destructive text-sm"
					role="alert"
				>
					{errorMessage}
				</p>
			) : null}
		</InteractionShell>
	);
}

function InteractionShell(input: {
	children: ReactNode;
	kind: AgentInteractionRequest["kind"];
	presentation?: "surface" | "timeline";
	targetLabel: string;
	title: string;
}) {
	return (
		<section
			aria-label={`Request from ${input.targetLabel}`}
			className={cn(
				"flex w-full max-w-2xl flex-col gap-4 bg-background text-left",
				input.presentation === "surface"
					? "p-0"
					: "my-2 rounded-lg border border-border p-4"
			)}
			data-agent-interaction-kind={input.kind}
		>
			<header className="flex min-w-0 flex-col gap-1">
				<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
					<span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
						{resolveInteractionKindLabel(input.kind)}
					</span>
					<span aria-hidden="true" className="text-muted-foreground text-xs">
						·
					</span>
					<span className="min-w-0 truncate text-muted-foreground text-xs">
						{input.targetLabel}
					</span>
				</div>
				<h3 className="font-semibold text-base text-foreground leading-6">
					{input.title}
				</h3>
			</header>
			{input.children}
		</section>
	);
}

function PermissionInteraction(input: {
	disabled: boolean;
	onEditAgentProfile?: () => void;
	onRespond: (
		response: AgentInteractionResponse,
		permissionMode?: AgentControllerPermissionMode
	) => Promise<void>;
	permissionModeShortcut?: SpaceAgentPermissionModeShortcut;
	request: Extract<AgentInteractionRequest, { kind: "permission" }>;
}) {
	const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
	const [updatePermissionMode, setUpdatePermissionMode] = useState(false);
	const selectedIndex = input.request.options.findIndex(
		(option) => option.optionId === selectedOptionId
	);
	const selectedOption = input.request.options.find(
		(option) => option.optionId === selectedOptionId
	);
	const selectedOptionAllows =
		selectedOption !== undefined && selectedOption.intent !== "deny";

	return (
		<>
			<PermissionSubject request={input.request} />
			<RadioGroup
				aria-label="Permission choices"
				className="w-full"
				selectedIndex={selectedIndex}
			>
				{input.request.options.map((option, index) => (
					<RadioItem
						index={index}
						key={option.optionId}
						label={option.label}
						onSelect={() => setSelectedOptionId(option.optionId)}
					/>
				))}
			</RadioGroup>
			{input.permissionModeShortcut && selectedOptionAllows ? (
				<CheckboxGroup
					aria-label="Future Agent permissions"
					checkedIndices={updatePermissionMode ? new Set([0]) : new Set()}
					className="w-full"
				>
					<CheckboxItem
						checked={updatePermissionMode}
						description={`After this response is sent, OpenMeld will save ${input.permissionModeShortcut.label} for future requests. This does not delay the current Wake.`}
						index={0}
						label={`Also use ${input.permissionModeShortcut.label} for future requests`}
						onToggle={() => setUpdatePermissionMode((current) => !current)}
					/>
				</CheckboxGroup>
			) : null}
			{input.onEditAgentProfile ? (
				<div className="grid gap-2 border-border border-t pt-3">
					<p className="text-muted-foreground text-xs leading-5">
						New permission settings can affect later tool requests in this Wake
						when the local agent supports live updates. This request was already
						waiting, so respond to it separately.
					</p>
					<div>
						<Button
							disabled={input.disabled}
							onClick={input.onEditAgentProfile}
							type="button"
							variant="outline"
						>
							Edit Agent Profile
						</Button>
					</div>
				</div>
			) : null}
			<div className="flex justify-end">
				<Button
					disabled={input.disabled || !selectedOptionId}
					onClick={() => {
						if (!selectedOptionId) {
							return;
						}
						input.onRespond(
							{
								kind: "permission",
								optionId: selectedOptionId,
							},
							updatePermissionMode && selectedOptionAllows
								? input.permissionModeShortcut?.permissionMode
								: undefined
						);
					}}
					type="button"
					variant={selectedOption?.intent === "deny" ? "outline" : "default"}
				>
					{selectedOption?.intent === "deny"
						? "Deny and continue"
						: "Approve and continue"}
				</Button>
			</div>
		</>
	);
}

function PermissionSubject(input: {
	request: Extract<AgentInteractionRequest, { kind: "permission" }>;
}) {
	const subject = input.request.subject;
	if (!(subject.command || subject.cwd || subject.resource)) {
		return null;
	}

	return (
		<div className="grid gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
			{subject.command ? (
				<pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5">
					<code>{subject.command}</code>
				</pre>
			) : null}
			{subject.cwd ? (
				<SubjectFact label="Working directory" value={subject.cwd} />
			) : null}
			{subject.resource ? (
				<SubjectFact label="Resource" value={subject.resource} />
			) : null}
		</div>
	);
}

function SubjectFact(input: { label: string; value: string }) {
	return (
		<div className="grid min-w-0 gap-1">
			<span className="font-medium text-muted-foreground text-xs">
				{input.label}
			</span>
			<code className="break-all text-foreground text-xs">{input.value}</code>
		</div>
	);
}

function QuestionInteraction(input: {
	disabled: boolean;
	onRespond: (response: AgentInteractionResponse) => Promise<void>;
	request: Extract<AgentInteractionRequest, { kind: "question" }>;
}) {
	const [questionIndex, setQuestionIndex] = useState(0);
	const [drafts, setDrafts] = useState<Readonly<Record<string, QuestionDraft>>>(
		{}
	);
	const question = input.request.questions[questionIndex];
	const draft = question
		? (drafts[question.questionId] ?? EMPTY_QUESTION_DRAFT)
		: EMPTY_QUESTION_DRAFT;
	const values = question ? resolveQuestionDraftValues(question, draft) : [];
	const canContinue = values.length > 0;
	const isLastQuestion = questionIndex === input.request.questions.length - 1;

	const updateDraft = (nextDraft: QuestionDraft) => {
		if (!question) {
			return;
		}
		setDrafts((current) => ({
			...current,
			[question.questionId]: nextDraft,
		}));
	};

	if (!question) {
		return null;
	}

	const submitAnswers = () => {
		const answers = input.request.questions.map((candidate) => ({
			questionId: candidate.questionId,
			values: resolveQuestionDraftValues(
				candidate,
				candidate.questionId === question.questionId
					? draft
					: (drafts[candidate.questionId] ?? EMPTY_QUESTION_DRAFT)
			),
		}));
		input.onRespond({
			answers,
			kind: "question",
		});
	};

	return (
		<div className="grid gap-4">
			<div className="flex items-center justify-between gap-3">
				{question.header ? (
					<p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
						{question.header}
					</p>
				) : (
					<span />
				)}
				{input.request.questions.length > 1 ? (
					<p className="shrink-0 text-muted-foreground text-xs">
						{questionIndex + 1} of {input.request.questions.length}
					</p>
				) : null}
			</div>
			<p className="font-medium text-foreground text-sm leading-6">
				{question.prompt}
			</p>
			<QuestionOptions
				draft={draft}
				onChange={updateDraft}
				question={question}
			/>
			<div className="flex items-center justify-between gap-3">
				{questionIndex > 0 ? (
					<Button
						disabled={input.disabled}
						onClick={() => setQuestionIndex((current) => current - 1)}
						type="button"
						variant="ghost"
					>
						Previous
					</Button>
				) : (
					<span />
				)}
				<Button
					disabled={input.disabled || !canContinue}
					onClick={() => {
						if (isLastQuestion) {
							submitAnswers();
							return;
						}
						setQuestionIndex((current) => current + 1);
					}}
					type="button"
				>
					{isLastQuestion ? "Submit answers" : "Next"}
				</Button>
			</div>
		</div>
	);
}

function QuestionOptions(input: {
	draft: QuestionDraft;
	onChange: (draft: QuestionDraft) => void;
	question: AgentInteractionQuestion;
}) {
	if (input.question.multiple) {
		const checkedIndices = new Set<number>();
		input.question.options.forEach((option, index) => {
			if (input.draft.selectedOptionIds.has(option.optionId)) {
				checkedIndices.add(index);
			}
		});
		if (input.question.allowOther && input.draft.useOther) {
			checkedIndices.add(input.question.options.length);
		}

		return (
			<div className="grid gap-3">
				<CheckboxGroup
					aria-label={input.question.prompt}
					checkedIndices={checkedIndices}
					className="w-full"
				>
					{input.question.options.map((option, index) => (
						<CheckboxItem
							checked={input.draft.selectedOptionIds.has(option.optionId)}
							description={option.description}
							index={index}
							key={option.optionId}
							label={option.label}
							onToggle={() => {
								const nextIds = new Set(input.draft.selectedOptionIds);
								if (nextIds.has(option.optionId)) {
									nextIds.delete(option.optionId);
								} else {
									nextIds.add(option.optionId);
								}
								input.onChange({
									...input.draft,
									selectedOptionIds: nextIds,
								});
							}}
						/>
					))}
					{input.question.allowOther ? (
						<CheckboxItem
							checked={input.draft.useOther}
							index={input.question.options.length}
							label="Other"
							onToggle={() =>
								input.onChange({
									...input.draft,
									useOther: !input.draft.useOther,
								})
							}
						/>
					) : null}
				</CheckboxGroup>
				<OtherAnswerInput
					draft={input.draft}
					onChange={input.onChange}
					secret={input.question.secret === true}
				/>
			</div>
		);
	}

	const selectedOptionId = input.draft.selectedOptionIds.values().next()
		.value as string | undefined;
	const selectedIndex = input.draft.useOther
		? input.question.options.length
		: input.question.options.findIndex(
				(option) => option.optionId === selectedOptionId
			);

	return (
		<div className="grid gap-3">
			<RadioGroup
				aria-label={input.question.prompt}
				className="w-full"
				selectedIndex={selectedIndex}
			>
				{input.question.options.map((option, index) => (
					<RadioItem
						description={option.description}
						index={index}
						key={option.optionId}
						label={option.label}
						onSelect={() =>
							input.onChange({
								...input.draft,
								selectedOptionIds: new Set([option.optionId]),
								useOther: false,
							})
						}
					/>
				))}
				{input.question.allowOther ? (
					<RadioItem
						index={input.question.options.length}
						label="Other"
						onSelect={() =>
							input.onChange({
								...input.draft,
								selectedOptionIds: new Set(),
								useOther: true,
							})
						}
					/>
				) : null}
			</RadioGroup>
			<OtherAnswerInput
				draft={input.draft}
				onChange={input.onChange}
				secret={input.question.secret === true}
			/>
		</div>
	);
}

function OtherAnswerInput(input: {
	draft: QuestionDraft;
	onChange: (draft: QuestionDraft) => void;
	secret: boolean;
}) {
	const inputId = useId();
	if (!input.draft.useOther) {
		return null;
	}
	return (
		<label className="grid gap-2 text-sm" htmlFor={inputId}>
			<span className="font-medium text-foreground">Your answer</span>
			{input.secret ? (
				<Input
					autoComplete="off"
					autoFocus={true}
					id={inputId}
					maxLength={4000}
					onChange={(event) =>
						input.onChange({
							...input.draft,
							otherText: event.target.value,
						})
					}
					placeholder="Type your answer"
					type="password"
					value={input.draft.otherText}
				/>
			) : (
				<Textarea
					autoFocus={true}
					id={inputId}
					maxLength={4000}
					onChange={(event) =>
						input.onChange({
							...input.draft,
							otherText: event.target.value,
						})
					}
					placeholder="Type your answer"
					value={input.draft.otherText}
				/>
			)}
		</label>
	);
}

function resolveQuestionDraftValues(
	question: AgentInteractionQuestion,
	draft: QuestionDraft
): string[] {
	const knownOptionIds = new Set(
		question.options.map((option) => option.optionId)
	);
	const values = [...draft.selectedOptionIds].filter((optionId) =>
		knownOptionIds.has(optionId)
	);
	const otherText = draft.otherText.trim();
	if (question.allowOther && draft.useOther && otherText) {
		values.push(otherText);
	}
	return values;
}

function PlanReviewInteraction(input: {
	disabled: boolean;
	onRespond: (response: AgentInteractionResponse) => Promise<void>;
	request: Extract<AgentInteractionRequest, { kind: "plan_review" }>;
}) {
	const [showFeedback, setShowFeedback] = useState(false);
	const [feedback, setFeedback] = useState("");
	const feedbackId = useId();
	const canRequestChanges =
		input.request.allowFeedback && feedback.trim().length > 0;
	let feedbackAction: ReactNode = null;
	if (showFeedback) {
		feedbackAction = (
			<Button
				disabled={input.disabled}
				onClick={() => {
					setFeedback("");
					setShowFeedback(false);
				}}
				type="button"
				variant="ghost"
			>
				Cancel
			</Button>
		);
	} else if (input.request.allowFeedback) {
		feedbackAction = (
			<Button
				disabled={input.disabled}
				onClick={() => setShowFeedback(true)}
				type="button"
				variant="outline"
			>
				Request changes
			</Button>
		);
	}

	return (
		<>
			<div className="max-h-80 overflow-auto rounded-md border border-border bg-muted/40 p-3">
				<MessageResponse variant="space-message">
					{input.request.plan}
				</MessageResponse>
			</div>
			{showFeedback ? (
				<label className="grid gap-2 text-sm" htmlFor={feedbackId}>
					<span className="font-medium text-foreground">
						What should change?
					</span>
					<Textarea
						autoFocus={true}
						id={feedbackId}
						maxLength={8000}
						onChange={(event) => setFeedback(event.target.value)}
						placeholder="Describe the changes you want the agent to make"
						value={feedback}
					/>
				</label>
			) : null}
			<div
				className={cn(
					"flex flex-wrap items-center gap-2",
					showFeedback ? "justify-between" : "justify-end"
				)}
			>
				{feedbackAction}
				<div className="flex items-center gap-2">
					{showFeedback ? (
						<Button
							disabled={input.disabled || !canRequestChanges}
							onClick={() =>
								input.onRespond({
									action: "request_changes",
									feedback: feedback.trim(),
									kind: "plan_review",
								})
							}
							type="button"
							variant="outline"
						>
							Send feedback
						</Button>
					) : null}
					<Button
						disabled={input.disabled || showFeedback}
						onClick={() =>
							input.onRespond({
								action: "approve",
								kind: "plan_review",
							})
						}
						type="button"
					>
						Approve plan
					</Button>
				</div>
			</div>
		</>
	);
}

function resolveInteractionKindLabel(
	kind: AgentInteractionRequest["kind"]
): string {
	switch (kind) {
		case "permission":
			return "Permission needed";
		case "question":
			return "Question";
		case "plan_review":
			return "Plan review";
		default:
			return "Local agent request";
	}
}
