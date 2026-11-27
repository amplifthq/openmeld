import type {
	OrganizationDashboard,
	OrganizationDashboardArtifact,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { type FormEvent, useId, useState } from "react";
import type { DashboardChange } from "#/lib/organizations/dashboards";
import {
	buildDashboardArtifactLink,
	parseDashboardArtifactLink,
} from "./dashboard-artifact";

const REPOSITORY_PATTERN = "^[A-Za-z0-9\\-]+/[A-Za-z0-9_.\\-]+$";
type DashboardKind = OrganizationDashboard["kind"];
export type DashboardPrefill = Pick<OrganizationDashboard, "kind" | "name"> & {
	repository?: string;
	artifact?: OrganizationDashboardArtifact;
};

export function DashboardEditor({
	dashboard,
	busy,
	onCancel,
	onSave,
	prefill,
	orgSlug,
}: {
	dashboard?: OrganizationDashboard;
	busy: boolean;
	onCancel: () => void;
	onSave: (mutation: DashboardChange) => void;
	prefill?: DashboardPrefill;
	orgSlug: string;
}) {
	const [kind, setKind] = useState<DashboardKind>(
		dashboard?.kind ?? prefill?.kind ?? "github_issues"
	);
	const initialArtifact = dashboard?.artifact ?? prefill?.artifact;
	const [artifact, setArtifact] = useState(
		initialArtifact ? buildDashboardArtifactLink(initialArtifact, orgSlug) : ""
	);
	const fieldId = useId();
	const parsedArtifact = artifact.trim()
		? parseDashboardArtifactLink(
				artifact,
				orgSlug,
				typeof window === "undefined" ? undefined : window.location.origin
			)
		: null;
	const invalidArtifact =
		kind !== "github_issues" && Boolean(artifact.trim()) && !parsedArtifact;
	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const fields = new FormData(event.currentTarget);
		const name = String(fields.get("name") ?? "").trim();
		if (!name || invalidArtifact || busy) {
			return;
		}
		const values = {
			name,
			kind,
			...(kind === "github_issues"
				? { repository: String(fields.get("repository") ?? "").trim() }
				: { artifact: parsedArtifact }),
		};
		onSave(
			dashboard
				? { operation: "update", id: dashboard.id, ...values }
				: { operation: "create", ...values }
		);
	};
	return (
		<form
			className="grid max-w-xl gap-4 rounded-md border p-4"
			onSubmit={submit}
		>
			<h2 className="font-semibold">
				{dashboard ? "Edit dashboard" : "Create dashboard"}
			</h2>
			<label className="grid gap-1.5 text-sm" htmlFor={`${fieldId}-name`}>
				Name
				<Input
					defaultValue={dashboard?.name ?? prefill?.name}
					id={`${fieldId}-name`}
					maxLength={100}
					name="name"
					required
				/>
			</label>
			<label className="grid gap-1.5 text-sm">
				Template
				<select
					className="h-9 rounded-md border bg-background px-3"
					onChange={(event) => {
						const next = event.currentTarget.value;
						if (
							next === "ugc" ||
							next === "traffic" ||
							next === "github_issues"
						) {
							setKind(next);
						}
					}}
					value={kind}
				>
					<option value="github_issues">GitHub Issues</option>
					<option value="ugc">UGC</option>
					<option value="traffic">Traffic</option>
				</select>
			</label>
			{kind === "github_issues" ? (
				<label className="grid gap-1.5 text-sm" htmlFor={`${fieldId}-repo`}>
					Repository
					<Input
						autoComplete="off"
						defaultValue={dashboard?.repository ?? prefill?.repository ?? ""}
						id={`${fieldId}-repo`}
						maxLength={140}
						name="repository"
						pattern={REPOSITORY_PATTERN}
						placeholder="owner/repository"
						required
					/>
				</label>
			) : (
				<>
					<p className="text-muted-foreground text-sm">
						Link an existing dashboard from this workspace. Viewers still need
						access to the original.
					</p>
					<label
						className="grid gap-1.5 text-sm"
						htmlFor={`${fieldId}-artifact`}
					>
						Existing dashboard link
						<Input
							id={`${fieldId}-artifact`}
							maxLength={2048}
							onChange={(event) => setArtifact(event.currentTarget.value)}
							placeholder="Paste an OpenMeld link"
							value={artifact}
						/>
					</label>
					{invalidArtifact && (
						<p role="alert">
							Use a supported OpenMeld artifact link from this workspace.
						</p>
					)}
					{parsedArtifact && (
						<a
							className="w-fit text-sm underline underline-offset-4"
							href={buildDashboardArtifactLink(parsedArtifact, orgSlug)}
							rel="noopener noreferrer"
							target="_blank"
						>
							Preview linked dashboard
						</a>
					)}
				</>
			)}
			<div className="flex gap-2">
				<Button disabled={busy || invalidArtifact} type="submit">
					{dashboard ? "Save changes" : "Create dashboard"}
				</Button>
				<Button
					disabled={busy}
					onClick={onCancel}
					type="button"
					variant="secondary"
				>
					Cancel
				</Button>
			</div>
		</form>
	);
}
