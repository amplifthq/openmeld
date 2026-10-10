"use client";

import { postSpaceWorkHandoff } from "@openmeld/api-client";
import {
	type SpaceCodeWorkHandoff,
	spaceCodeWorkHandoffSchema,
} from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { Textarea } from "@openmeld/ui/components/textarea";
import { useQuery } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { createUnscopedWebSpaceApi } from "#/lib/spaces/api";
import { readCodeHandoffSource } from "#/lib/spaces/code-handoff";
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

export function SpaceCodeHandoffAction(input: HandoffProps) {
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
			<Button onClick={() => setOpen(true)} size="sm" variant="outline">
				Hand off
			</Button>
			{open ? (
				<CodeHandoffContent
					{...input}
					onClose={() => setOpen(false)}
					organizationId={organization.currentOrganization.id}
				/>
			) : null}
		</section>
	);
}

function CodeHandoffContent(
	input: HandoffProps & { onClose(): void; organizationId: string }
) {
	const [api] = useState(() =>
		createUnscopedWebSpaceApi({ openMeldProfileId: input.profileId })
	);
	const source = useQuery({
		queryKey: [
			"code-handoff-source",
			input.spaceId,
			input.profileId,
			input.sourceSignalId,
		],
		queryFn: () => readCodeHandoffSource(api, input),
		staleTime: 0,
		refetchOnWindowFocus: false,
		retry: false,
	});
	let content = <output>Loading the original result…</output>;
	if (source.isError) {
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
	} else if (source.data && !source.isFetching) {
		content = (
			<CodeHandoffForm
				{...input}
				api={api}
				key={source.data.sourceRevision}
				source={source.data}
			/>
		);
	}
	return (
		<div className="mt-4 grid gap-4">
			<h3 className="font-medium">Hand off</h3>
			<p className="text-muted-foreground text-sm">
				Choose a Project and published commit for this handoff. The receiving
				Agent uses its own Project connection and replies in this conversation.
			</p>
			{content}
		</div>
	);
}

function CodeHandoffForm(
	input: HandoffProps & {
		api: ReturnType<typeof createUnscopedWebSpaceApi>;
		source: Awaited<ReturnType<typeof readCodeHandoffSource>>;
		organizationId: string;
		onClose(): void;
	}
) {
	const formId = useId();
	const members = useQuery(
		spaceMembersQueryOptions({
			spaceId: input.spaceId,
			openMeldProfileId: input.profileId,
			enabled: true,
		})
	);
	const agents = [
		...buildSpaceMemberDirectoryEntryByProfileId(members.data ?? null).values(),
	].filter(
		(entry) =>
			entry.profileKind === "agent" &&
			(entry.agentControllerRef === "builtin:codex" ||
				entry.agentControllerRef === "builtin:claude-code")
	);
	const [target, setTarget] = useState("");
	const [project, setProject] = useState<SelectedProjectWork | null>(null);
	const [commit, setCommit] = useState("");
	const [access, setAccess] = useState<"" | "workspace" | "read_only">("");
	const [goal, setGoal] = useState(
		"Continue the work described in this result."
	);
	const [completed, setCompleted] = useState(input.source.text);
	const [nextSteps, setNextSteps] = useState("");
	const [criteria, setCriteria] = useState("");
	const [brief, setBrief] = useState({
		evidence: "",
		attemptedApproaches: "",
		decisions: "",
		constraints: "",
		openQuestions: "",
	});
	const [files, setFiles] = useState<string[]>([]);
	const [filePaths, setFilePaths] = useState<Record<string, string>>({});
	const [clientMessageId] = useState(() => crypto.randomUUID());
	const acceptedInput = useRef<{
		handoff: SpaceCodeWorkHandoff;
		targetProfileId: string;
	} | null>(null);
	const sending = useRef(false);
	const [pending, setPending] = useState(false);
	const [requested, setRequested] = useState(false);
	const [error, setError] = useState("");
	function readSubmission() {
		const receiver = agents.find((agent) => agent.profileId === target);
		if (!(project && receiver)) {
			setError("Choose a Project and an Agent who is currently in this Space.");
			return null;
		}
		if (
			access === "read_only" &&
			receiver.agentControllerRef !== "builtin:codex"
		) {
			setError(
				"Read files only requires a Codex Agent. Choose Codex or a supported access setting."
			);
			return null;
		}
		const parsed = spaceCodeWorkHandoffSchema.safeParse({
			schemaVersion: 2,
			sourceSignalId: input.source.sourceSignalId,
			sourceRevision: input.source.sourceRevision,
			code: {
				projectId: project.projectId,
				repositoryFingerprint: project.repositoryFingerprint,
				commit: commit.trim().toLowerCase(),
			},
			execution: { workspace: "isolated", ...(access ? { access } : {}) },
			files: input.source.files
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
						<SpaceProjectRepositoryFields
							onChange={setProject}
							organizationId={input.organizationId}
						/>
						<label className="grid gap-1 text-sm" htmlFor={`${formId}-commit`}>
							Published commit SHA
							<Input
								id={`${formId}-commit`}
								onChange={(event) => setCommit(event.target.value)}
								placeholder="Full commit SHA, including a PR's published head"
								value={commit}
							/>
						</label>
						<p className="text-muted-foreground text-sm">
							A separate copy starts at this exact commit. If it is missing on
							the receiving computer, the task stops with guidance; it does not
							use a different revision.
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
						{input.source.files.length ? (
							<div className="grid gap-2 text-sm">
								<p>Shared files (optional; exact displayed revisions)</p>
								{input.source.files.map((file) => (
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
						Only this brief, the published revision, and selected shared files
						are handed off. The receiving Agent keeps its own credentials and
						approvals.
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
