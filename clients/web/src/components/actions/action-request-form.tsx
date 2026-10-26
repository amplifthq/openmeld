import { isWorkingFolderRecoveryQuestion } from "@openmeld/schemas";
import type {
	AgentControllerPermissionMode,
	AgentInteractionQuestion,
	AgentInteractionRequest,
	AgentInteractionResponse,
} from "@openmeld/schemas/types";
import {
	ApprovalCardBody,
	ApprovalCardFooter,
} from "@openmeld/ui/components/approval-card";
import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { Textarea } from "@openmeld/ui/components/textarea";
import { CheckboxGroup, CheckboxItem } from "@openmeld/ui/fluid/checkbox-group";
import { RadioGroup, RadioItem } from "@openmeld/ui/fluid/radio-group";
import { cn } from "@openmeld/ui/lib/utils";
import { type ReactNode, useId, useState } from "react";
import { MessageResponse } from "#/components/ai/message-response";

export type ActionPermissionModeOption = {
	description: string;
	label: string;
	permissionMode: AgentControllerPermissionMode;
	requiresExplicitConfirmation?: boolean;
};

/** Typed input UI only; the caller owns authorization, persistence, and transport. */
export function ActionRequestForm(input: {
	request: AgentInteractionRequest;
	disabled: boolean;
	onRespond: (
		response: AgentInteractionResponse,
		permissionMode?: AgentControllerPermissionMode
	) => Promise<void>;
	permissionModeOptions?: readonly ActionPermissionModeOption[];
}) {
	switch (input.request.kind) {
		case "permission":
			return <PermissionInteraction {...input} request={input.request} />;
		case "question":
			return <QuestionInteraction {...input} request={input.request} />;
		case "plan_review":
			return <PlanReviewInteraction {...input} request={input.request} />;
		default: {
			const unsupported: never = input.request;
			throw new Error(`Unsupported action request: ${String(unsupported)}`);
		}
	}
}

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

function PermissionInteraction(input: {
	disabled: boolean;
	onRespond: (
		response: AgentInteractionResponse,
		permissionMode?: AgentControllerPermissionMode
	) => Promise<void>;
	permissionModeOptions?: readonly ActionPermissionModeOption[];
	request: Extract<AgentInteractionRequest, { kind: "permission" }>;
}) {
	const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
	const [permissionModeIndex, setPermissionModeIndex] = useState(-1);
	const [modeConfirmed, setModeConfirmed] = useState(false);
	const selectedMode = input.permissionModeOptions?.[permissionModeIndex];
	const selectedIndex = input.request.options.findIndex(
		(option) => option.optionId === selectedOptionId
	);
	const selectedOption = input.request.options.find(
		(option) => option.optionId === selectedOptionId
	);
	const selectedOptionAllows =
		selectedOption !== undefined && selectedOption.intent !== "deny";
	const offersApproval = input.request.options.some(
		(option) => option.intent !== "deny"
	);

	return (
		<>
			<ApprovalCardBody>
				<InteractionDescription request={input.request} />
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
							onSelect={() => {
								if (input.disabled) {
									return;
								}
								setSelectedOptionId(option.optionId);
								if (option.intent === "deny") {
									setPermissionModeIndex(-1);
									setModeConfirmed(false);
								}
							}}
						/>
					))}
				</RadioGroup>
				{input.request.supportsPermissionModeUpdate &&
				input.permissionModeOptions?.length &&
				offersApproval &&
				selectedOption?.intent !== "deny" ? (
					<div className="grid gap-2">
						<p className="text-muted-foreground text-xs leading-5">
							Choose how this Agent handles future approval requests. A mode
							change is saved only when you approve this request. Allow once by
							itself does not change future permissions.
						</p>
						<RadioGroup
							aria-label="Agent permissions after this request"
							className="w-full"
							selectedIndex={permissionModeIndex + 1}
						>
							<RadioItem
								index={0}
								label="Keep current permissions"
								onSelect={() => {
									if (input.disabled || selectedOption?.intent === "deny") {
										return;
									}
									setPermissionModeIndex(-1);
									setModeConfirmed(false);
								}}
								selected={permissionModeIndex === -1}
							/>
							{input.permissionModeOptions.map((option, index) => (
								<RadioItem
									description={option.description}
									index={index + 1}
									key={option.permissionMode}
									label={option.label}
									onSelect={() => {
										if (input.disabled || selectedOption?.intent === "deny") {
											return;
										}
										setPermissionModeIndex(index);
										setModeConfirmed(false);
									}}
									selected={permissionModeIndex === index}
								/>
							))}
						</RadioGroup>
						{selectedMode?.requiresExplicitConfirmation ? (
							<CheckboxGroup
								aria-label="Confirm permission change"
								checkedIndices={modeConfirmed ? new Set([0]) : new Set()}
							>
								<CheckboxItem
									checked={modeConfirmed}
									index={0}
									label={`I trust this Agent to use ${selectedMode.label}.`}
									onToggle={() => setModeConfirmed((current) => !current)}
								/>
							</CheckboxGroup>
						) : null}
					</div>
				) : null}
			</ApprovalCardBody>
			<ApprovalCardFooter>
				<Button
					disabled={
						input.disabled ||
						!selectedOptionId ||
						(selectedOptionAllows &&
							input.request.supportsPermissionModeUpdate &&
							selectedMode?.requiresExplicitConfirmation &&
							!modeConfirmed)
					}
					onClick={() => {
						if (!selectedOptionId) {
							return;
						}
						input.onRespond(
							{
								kind: "permission",
								optionId: selectedOptionId,
							},
							selectedOptionAllows && input.request.supportsPermissionModeUpdate
								? selectedMode?.permissionMode
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
			</ApprovalCardFooter>
		</>
	);
}

function InteractionDescription({
	request,
}: {
	request: AgentInteractionRequest;
}) {
	return request.description ? (
		<p className="text-muted-foreground text-sm leading-6">
			{request.description}
		</p>
	) : null;
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
				<pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5">
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
	const questionSubmitLabel = isLastQuestion ? "Submit answers" : "Next";
	const isFolderRecovery = isWorkingFolderRecoveryQuestion(input.request);
	const submitLabel = isFolderRecovery
		? resolveFolderChoiceLabel(values[0])
		: questionSubmitLabel;

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
		<>
			<ApprovalCardBody
				className={isFolderRecovery ? "max-h-none" : undefined}
				key={question.questionId}
			>
				<InteractionDescription request={input.request} />
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
			</ApprovalCardBody>
			<ApprovalCardFooter className="justify-between">
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
					{submitLabel}
				</Button>
			</ApprovalCardFooter>
		</>
	);
}

function resolveFolderChoiceLabel(choice: string | undefined): string {
	return choice === "leave_task" ? "Stop task" : "Continue task";
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
			<ApprovalCardBody>
				<InteractionDescription request={input.request} />
				<div className="min-w-0 rounded-lg bg-muted/40 p-3">
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
			</ApprovalCardBody>
			<ApprovalCardFooter
				className={cn(showFeedback ? "justify-between" : "justify-end")}
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
			</ApprovalCardFooter>
		</>
	);
}
