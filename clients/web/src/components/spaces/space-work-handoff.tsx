"use client";

import { supportsSpaceWorkHandoff } from "@openmeld/agent-runtime";
import { postSpaceWorkHandoff } from "@openmeld/api-client";
import {
	type SpaceWorkHandoffV2,
	spaceCodeWorkHandoffSchema,
	spaceContextWorkHandoffSchema,
} from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { Switch } from "@openmeld/ui/components/switch";
import { Textarea } from "@openmeld/ui/components/textarea";
import { useQuery } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { createUnscopedWebSpaceApi } from "#/lib/spaces/api";
import { readWorkHandoffSource } from "#/lib/spaces/work-handoff";
import { spaceMembersQueryOptions } from "#/query/spaces/members";
import { buildSpaceMemberDirectoryEntryByProfileId } from "./space-collaboration-profile";
import {
	type SelectedProjectWork,
	SpaceProjectRepositoryFields,
} from "./space-project-repository-fields";

type HandoffProps = {
	spaceId: string;
	sourceSignalId: string;
	profileId: string;
	threadId?: string;
	spacePassword?: string;
};
const briefFields = [
	["evidence", "Verified evidence"],
	["attemptedApproaches", "Approaches already tried"],
	["decisions", "Accepted decisions"],
	["constraints", "Constraints"],
	["openQuestions", "Open questions"],
] as const;
const lines = (value: string) =>
	value
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);

export function SpaceWorkHandoffAction(input: HandoffProps) {
	const organization = useOptionalAppOrganization();
	const [open, setOpen] = useState(false);
	if (!organization) {
		return null;
	}
	return (
		<section className="mb-5 rounded-lg border p-3">
			<p className="mb-2 text-muted-foreground text-sm">
				Ask another Agent in this Space to continue this work.
			</p>
			{open ? null : (
				<Button onClick={() => setOpen(true)} size="sm" variant="outline">
					Hand off
				</Button>
			)}
			{open ? (
				<WorkHandoffContent
					{...input}
					key={`${input.spaceId}:${input.sourceSignalId}:${input.profileId}:${input.threadId ?? ""}`}
					onClose={() => setOpen(false)}
					organizationId={organization.currentOrganization.id}
				/>
			) : null}
		</section>
	);
}

function WorkHandoffContent(
	input: HandoffProps & { onClose(): void; organizationId: string }
) {
	const [api] = useState(() =>
		createUnscopedWebSpaceApi({ openMeldProfileId: input.profileId })
	);
	const source = useQuery({
		queryKey: [
			"work-handoff-source",
			input.spaceId,
			input.profileId,
			input.sourceSignalId,
		],
		queryFn: () => readWorkHandoffSource(api, input),
		staleTime: 0,
		refetchOnWindowFocus: false,
		retry: false,
	});
	let content = <output>Loading the original result…</output>;
	if (source.data) {
		content = <WorkHandoffForm {...input} api={api} source={source.data} />;
	} else if (source.isError) {
		content = (
			<div role="alert">
				<p>{source.error.message}</p>
				<Button
					onClick={async () => {
						await source.refetch();
					}}
					variant="outline"
				>
					Retry
				</Button>
			</div>
		);
	}
	return (
		<div className="mt-4 grid gap-4">
			<h3 className="font-medium">Hand off</h3>
			<p className="text-muted-foreground text-sm">
				Share the goal, progress, and next steps. Add shared files or a
				repository if needed. The receiving Agent replies in this conversation.
			</p>
			{content}
			{source.data && source.isError ? (
				<p role="alert">
					The original result could not be refreshed. Your draft and any pending
					request are preserved.
				</p>
			) : null}
		</div>
	);
}

function HandoffSourceChangeNotice(input: {
	uncertain: boolean;
	onReview(): void;
}) {
	return (
		<div role="alert">
			<p>
				{input.uncertain
					? "The original result changed. Retry will resend the original handoff so it can be confirmed without creating a second request."
					: "The original result changed. Your instructions are preserved. Review the updated result and select any shared files again before sending."}
			</p>
			{input.uncertain ? null : (
				<Button onClick={input.onReview} variant="outline">
					Review latest result
				</Button>
			)}
		</div>
	);
}

function WorkHandoffForm(
	input: HandoffProps & {
		api: ReturnType<typeof createUnscopedWebSpaceApi>;
		source: Awaited<ReturnType<typeof readWorkHandoffSource>>;
		organizationId: string;
		onClose(): void;
	}
) {
	const formId = useId();
	const [reviewedSource, setReviewedSource] = useState(input.source);
	const sourceChanged =
		input.source.sourceRevision !== reviewedSource.sourceRevision;
	const members = useQuery(
		spaceMembersQueryOptions({
			spaceId: input.spaceId,
			openMeldProfileId: input.profileId,
			enabled: true,
		})
	);
	const [includeRepository, setIncludeRepository] = useState(false);
	const [files, setFiles] = useState<string[]>([]);
	const agents = [
		...buildSpaceMemberDirectoryEntryByProfileId(members.data ?? null).values(),
	].filter(
		(entry) =>
			entry.profileKind === "agent" &&
			supportsSpaceWorkHandoff({
				agentControllerRef: entry.agentControllerRef,
				hasRepository: includeRepository,
				hasFiles: files.length > 0,
			})
	);
	const [target, setTarget] = useState("");
	const [project, setProject] = useState<SelectedProjectWork | null>(null);
	const [commit, setCommit] = useState("");
	const [access, setAccess] = useState<"" | "workspace" | "read_only">("");
	const [goal, setGoal] = useState(
		"Continue the work described in this result."
	);
	const [completed, setCompleted] = useState(reviewedSource.text);
	const [nextSteps, setNextSteps] = useState("");
	const [criteria, setCriteria] = useState("");
	const [brief, setBrief] = useState({
		evidence: "",
		attemptedApproaches: "",
		decisions: "",
		constraints: "",
		openQuestions: "",
	});
	const [filePaths, setFilePaths] = useState<Record<string, string>>({});
	const [clientMessageId] = useState(() => crypto.randomUUID());
	const acceptedInput = useRef<{
		handoff: SpaceWorkHandoffV2;
		targetProfileId: string;
	} | null>(null);
	const sending = useRef(false);
	const [pending, setPending] = useState(false);
	const [requested, setRequested] = useState(false);
	const [error, setError] = useState("");
	function readSubmission() {
		if (sourceChanged) {
			setError(
				"Review the updated original result before sending this handoff."
			);
			return null;
		}
		const receiver = agents.find((agent) => agent.profileId === target);
		if (!receiver) {
			setError(
				"Choose an Agent in this Space that supports the selected materials."
			);
			return null;
		}
		if (includeRepository && !project) {
			setError(
				"Choose a Project and repository, or remove the repository from this handoff."
			);
			return null;
		}
		if (
			includeRepository &&
			access === "read_only" &&
			receiver.agentControllerRef !== "builtin:codex"
		) {
			setError(
				"Read files only requires a Codex Agent. Choose Codex or a supported access setting."
			);
			return null;
		}
		const schema = includeRepository
			? spaceCodeWorkHandoffSchema
			: spaceContextWorkHandoffSchema;
		const parsed = schema.safeParse({
			schemaVersion: 2,
			sourceSignalId: reviewedSource.sourceSignalId,
			sourceRevision: reviewedSource.sourceRevision,
			...(includeRepository && project
				? {
						code: {
							projectId: project.projectId,
							repositoryFingerprint: project.repositoryFingerprint,
							commit: commit.trim().toLowerCase(),
						},
						execution: { workspace: "isolated", ...(access ? { access } : {}) },
					}
				: {
						execution: { workspace: "isolated", access: "space_context" },
					}),
			files: reviewedSource.files
				.filter((file) => files.includes(file.fileId))
				.map((file) => ({
					fileId: file.fileId,
					revision: file.revision,
					relativePath: filePaths[file.fileId] ?? file.name,
				})),
			skills: [],
			requirements: [],
			work: {
				goal: goal.trim(),
				completed,
				nextSteps: nextSteps.trim(),
				...Object.fromEntries(
					briefFields.map(([key]) => [key, lines(brief[key])])
				),
				completionCriteria: lines(criteria),
			},
		});
		if (!parsed.success) {
			setError(
				parsed.error.issues
					.map((issue) =>
						issue.path.join(".") === "code.commit"
							? "Enter a complete 40- or 64-character commit SHA."
							: issue.message
					)
					.join("; ")
			);
			return null;
		}
		return { handoff: parsed.data, targetProfileId: target };
	}
	async function submit() {
		if (sending.current || requested) {
			return;
		}
		setError("");
		const submission = acceptedInput.current ?? readSubmission();
		if (!submission) {
			return;
		}
		acceptedInput.current = submission;
		sending.current = true;
		setPending(true);
		try {
			await postSpaceWorkHandoff(input.api, {
				...input,
				...acceptedInput.current,
				clientMessageId,
			});
			setRequested(true);
		} catch (failure) {
			setError(
				failure instanceof Error
					? failure.message
					: "The handoff could not be confirmed. Retry the same request."
			);
		} finally {
			sending.current = false;
			setPending(false);
		}
	}
	let submitLabel = "Hand off";
	if (pending) {
		submitLabel = "Requesting handoff…";
	} else if (acceptedInput.current) {
		submitLabel = "Retry same handoff";
	}
	return (
		<>
			{sourceChanged && !requested ? (
				<HandoffSourceChangeNotice
					onReview={() => {
						setReviewedSource(input.source);
						setCompleted(input.source.text);
						setFiles([]);
						setFilePaths({});
						setError("");
					}}
					uncertain={acceptedInput.current !== null}
				/>
			) : null}
			{requested ? (
				<output>
					Handoff requested. Follow the handoff message for progress and the
					Agent's result.
				</output>
			) : (
				<>
					<fieldset
						className="grid min-w-0 gap-4"
						disabled={pending || acceptedInput.current !== null}
					>
						<label className="grid gap-1 text-sm">
							Receiving Agent
							<select
								className="h-9 rounded-md border bg-background px-3"
								disabled={members.isPending || members.isError}
								onChange={(event) => setTarget(event.target.value)}
								value={target}
							>
								<option value="">Choose an Agent</option>
								{agents.map((agent) => (
									<option key={agent.profileId} value={agent.profileId}>
										{agent.profileName}
									</option>
								))}
							</select>
						</label>
						{members.isError ? (
							<p role="alert">
								Space members could not load. Reopen this handoff to retry.
							</p>
						) : null}
						<p className="text-muted-foreground text-sm">
							Agents are listed according to the materials selected for this
							handoff. Shared files without a repository require Codex or a
							Remote Agent.
						</p>
						<label
							className="flex gap-2 text-sm"
							htmlFor={`${formId}-repository`}
						>
							<Switch
								checked={includeRepository}
								disabled={pending || acceptedInput.current !== null}
								id={`${formId}-repository`}
								onCheckedChange={setIncludeRepository}
							/>
							Include a repository
						</label>
						{includeRepository ? (
							<>
								<SpaceProjectRepositoryFields
									onChange={setProject}
									organizationId={input.organizationId}
								/>
								<label
									className="grid gap-1 text-sm"
									htmlFor={`${formId}-commit`}
								>
									Published commit SHA
									<Input
										id={`${formId}-commit`}
										onChange={(event) => setCommit(event.target.value)}
										placeholder="Full commit SHA, including a PR's published head"
										value={commit}
									/>
								</label>
								<p className="text-muted-foreground text-sm">
									A separate copy starts at this exact commit. If it is missing
									on the receiving computer, the task stops with guidance; it
									does not use a different revision.
								</p>
								<label className="grid gap-1 text-sm">
									Access
									<select
										className="h-9 rounded-md border bg-background px-3"
										onChange={(event) =>
											setAccess(event.target.value as typeof access)
										}
										value={access}
									>
										<option value="">Use Agent settings</option>
										<option value="workspace">Project files only</option>
										<option value="read_only">Read files only (Codex)</option>
									</select>
								</label>
							</>
						) : (
							<p className="text-muted-foreground text-sm">
								The handoff includes your brief and selected Space files. No
								repository is attached.
							</p>
						)}
						<label className="grid gap-1 text-sm" htmlFor={`${formId}-goal`}>
							Goal
							<Input
								id={`${formId}-goal`}
								onChange={(event) => setGoal(event.target.value)}
								value={goal}
							/>
						</label>
						<label
							className="grid gap-1 text-sm"
							htmlFor={`${formId}-completed`}
						>
							Original result and current state
							<Textarea
								id={`${formId}-completed`}
								onChange={(event) => setCompleted(event.target.value)}
								rows={5}
								value={completed}
							/>
						</label>
						<label
							className="grid gap-1 text-sm"
							htmlFor={`${formId}-nextSteps`}
						>
							Next steps
							<Textarea
								id={`${formId}-nextSteps`}
								onChange={(event) => setNextSteps(event.target.value)}
								rows={3}
								value={nextSteps}
							/>
						</label>
						<label
							className="grid gap-1 text-sm"
							htmlFor={`${formId}-criteria`}
						>
							Completion criteria (one per line)
							<Textarea
								id={`${formId}-criteria`}
								onChange={(event) => setCriteria(event.target.value)}
								rows={2}
								value={criteria}
							/>
						</label>
						<details>
							<summary className="cursor-pointer text-sm">
								Evidence, decisions, and constraints
							</summary>
							<div className="mt-3 grid gap-3">
								{briefFields.map(([key, label]) => (
									<label
										className="grid gap-1 text-sm"
										htmlFor={`${formId}-${key}`}
										key={key}
									>
										{label}
										<Textarea
											id={`${formId}-${key}`}
											onChange={(event) =>
												setBrief({ ...brief, [key]: event.target.value })
											}
											rows={2}
											value={brief[key]}
										/>
									</label>
								))}
							</div>
						</details>
						{reviewedSource.files.length ? (
							<div className="grid gap-2 text-sm">
								<p>Shared files (optional; exact displayed revisions)</p>
								{reviewedSource.files.map((file) => (
									<div className="grid gap-2" key={file.fileId}>
										<label className="flex gap-2">
											<input
												checked={files.includes(file.fileId)}
												onChange={(event) =>
													setFiles(
														event.target.checked
															? [...files, file.fileId]
															: files.filter((id) => id !== file.fileId)
													)
												}
												type="checkbox"
											/>
											{file.name} · revision {file.revision}
										</label>
										{files.includes(file.fileId) ? (
											<Input
												aria-label={`Path for ${file.name}`}
												onChange={(event) =>
													setFilePaths({
														...filePaths,
														[file.fileId]: event.target.value,
													})
												}
												value={filePaths[file.fileId] ?? file.name}
											/>
										) : null}
									</div>
								))}
							</div>
						) : null}
					</fieldset>
					<p className="text-muted-foreground text-sm">
						Only this brief and the materials you select are handed off. The
						receiving Agent keeps its own credentials and approvals.
					</p>
				</>
			)}
			{error ? (
				<p className="break-words text-destructive text-sm" role="alert">
					{error}
				</p>
			) : null}
			<div className="mt-4 flex justify-end gap-2">
				<Button onClick={input.onClose} variant="outline">
					{requested ? "Done" : "Close"}
				</Button>
				{requested ? null : (
					<Button disabled={pending} onClick={submit}>
						{submitLabel}
					</Button>
				)}
			</div>
		</>
	);
}
