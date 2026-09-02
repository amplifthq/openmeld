import {
	normalizeSpacePasswordText,
	spaceAccessModeUsesPassword,
} from "@openmeld/schemas";
import type {
	SpaceAccessMode,
	SpaceOrganizationVisibility,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import { RadioGroup, RadioItem } from "@openmeld/ui/fluid/radio-group";
import { cn } from "@openmeld/ui/lib/utils";
import { ArrowRightIcon, PlusIcon } from "@phosphor-icons/react";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { ComputerSetupChoiceCard } from "#/components/connect/computer-setup-choice-card";
import { SpaceAccessModeRadioGroup } from "#/components/spaces/space-access-editor";
import { ScrollArea } from "#/components/ui/scroll-area";
import { WelcomeLayout } from "./welcome-layout";

const SPACE_NAME_INPUT_ID = "welcome-space-name-input";
const SPACE_PASSWORD_INPUT_ID = "welcome-space-password-input";
const SPACE_ORGANIZATION_VISIBILITY_ID =
	"welcome-space-organization-visibility";
const SPACE_EXPLANATION = "A Space is where people and agents work together.";
const CREATE_SPACE_DESCRIPTION = "Start new work with your team and agents";
const JOIN_SPACE_DESCRIPTION = "Use a Space your team already has";
// Only worth a filter once the list outgrows the viewport (~6 rows fit in
// max-h-80); below that the search box is just noise.
const SEARCH_VISIBLE_THRESHOLD = 6;

export type WelcomeJoinableSpace = {
	spaceId: string;
	name: string;
};

/** Settle state of the joinable-spaces query, so the Join choice can tell
 * "still loading" and "load failed" apart from "settled, nothing to join". */
export type WelcomeJoinableStatus = "loading" | "error" | "ready";

export type WelcomeSpaceScreenProps = {
	contextKind?: "organization" | "personal";
	computerSetupActions?: {
		centerAgentPath: string;
		onConnectComputer: () => void;
	};
	onCreate: (input: {
		accessMode: SpaceAccessMode;
		name: string;
		password?: string;
		visibility: SpaceOrganizationVisibility;
	}) => void;
	onJoin: (spaceId: string) => void;
	joinableSpaces: readonly WelcomeJoinableSpace[];
	joinableStatus: WelcomeJoinableStatus;
	onRetryJoinable: () => void;
	isPending: boolean;
	errorMessage?: string | null;
	onBack?: () => void;
};

/**
 * The first-run "where do you want to work?" screen: two choices first (Create
 * a Space / Join a Space), then the chosen path expands in place. The Join
 * choice reflects the joinable-spaces query state — checking, failed (tap to
 * retry), settled-empty (disabled), or ready — so a user is never offered a
 * dead, premature, or fail-silent action.
 */
type SpaceMode = "choices" | "create" | "join";

function resolveTitle(mode: SpaceMode): string {
	if (mode === "create") {
		return "Create a Space";
	}
	if (mode === "join") {
		return "Join a Space";
	}
	return "Where do you want to work?";
}

function joinDescriptionFor(
	status: WelcomeJoinableStatus,
	hasSpaces: boolean
): string {
	if (status === "loading") {
		return "Checking your spaces…";
	}
	if (status === "error") {
		return "Couldn't load your spaces — try again";
	}
	if (hasSpaces) {
		return JOIN_SPACE_DESCRIPTION;
	}
	return "No spaces to join yet";
}

export function WelcomeSpaceScreen(props: WelcomeSpaceScreenProps) {
	const [mode, setMode] = useState<SpaceMode>("choices");
	const [query, setQuery] = useState("");
	const hasJoinableSpaces = props.joinableSpaces.length > 0;
	// Loading and settled-empty are dead ends (disabled); an error is actionable
	// (clicking retries the query); ready-with-spaces opens the join list.
	const joinDisabled =
		props.joinableStatus === "loading" ||
		(props.joinableStatus === "ready" && !hasJoinableSpaces);
	const joinDescription = joinDescriptionFor(
		props.joinableStatus,
		hasJoinableSpaces
	);
	const handleJoinChoice =
		props.joinableStatus === "error"
			? props.onRetryJoinable
			: () => setMode("join");

	const showSearch = props.joinableSpaces.length > SEARCH_VISIBLE_THRESHOLD;
	// Gate the query on `showSearch` so a stale search term can never keep
	// filtering once the list shrinks below the threshold and the box is hidden.
	const normalizedQuery = showSearch ? query.trim().toLowerCase() : "";
	const filteredSpaces = normalizedQuery
		? props.joinableSpaces.filter((space) =>
				space.name.toLowerCase().includes(normalizedQuery)
			)
		: props.joinableSpaces;

	// Back returns to the two choices from a sub-view; from the choices it leaves
	// the flow (the controller decides where to).
	const handleBack =
		mode === "choices" ? props.onBack : () => setMode("choices");

	return (
		<WelcomeLayout
			onBack={handleBack}
			subtitle={mode === "choices" ? SPACE_EXPLANATION : undefined}
			title={resolveTitle(mode)}
		>
			<WelcomeSpaceModeContent
				filteredSpaces={filteredSpaces}
				handleJoinChoice={handleJoinChoice}
				joinDescription={joinDescription}
				joinDisabled={joinDisabled}
				mode={mode}
				props={props}
				query={query}
				setMode={setMode}
				setQuery={setQuery}
				showSearch={showSearch}
			/>
		</WelcomeLayout>
	);
}

function WelcomeSpaceModeContent(input: {
	filteredSpaces: readonly WelcomeJoinableSpace[];
	handleJoinChoice: () => void;
	joinDescription: string;
	joinDisabled: boolean;
	mode: SpaceMode;
	props: WelcomeSpaceScreenProps;
	query: string;
	setMode: (mode: SpaceMode) => void;
	setQuery: (query: string) => void;
	showSearch: boolean;
}) {
	if (input.mode === "create") {
		return (
			<CreateSpaceForm
				contextKind={input.props.contextKind ?? "organization"}
				errorMessage={input.props.errorMessage}
				isPending={input.props.isPending}
				onCreate={input.props.onCreate}
			/>
		);
	}
	if (input.mode === "join") {
		return <WelcomeJoinSpaceList {...input} />;
	}
	return (
		<div className="grid gap-3">
			{input.props.computerSetupActions ? (
				<AddComputerChoiceCard {...input.props.computerSetupActions} />
			) : null}
			<SpaceChoiceCard
				description={CREATE_SPACE_DESCRIPTION}
				disabled={input.props.isPending}
				icon={<PlusIcon aria-hidden="true" className="size-5 shrink-0" />}
				onClick={() => input.setMode("create")}
				title="Create a Space"
			/>
			<SpaceChoiceCard
				description={input.joinDescription}
				disabled={input.joinDisabled}
				icon={<ArrowRightIcon aria-hidden="true" className="size-5 shrink-0" />}
				onClick={input.handleJoinChoice}
				title="Join a Space"
			/>
		</div>
	);
}

function WelcomeJoinSpaceList(input: {
	filteredSpaces: readonly WelcomeJoinableSpace[];
	props: WelcomeSpaceScreenProps;
	query: string;
	setQuery: (query: string) => void;
	showSearch: boolean;
}) {
	return (
		<div className="grid gap-3">
			{input.showSearch ? (
				<Input
					aria-label="Search spaces"
					autoComplete="off"
					onChange={(event) => input.setQuery(event.target.value)}
					placeholder="Search spaces"
					type="text"
					value={input.query}
				/>
			) : null}
			{input.filteredSpaces.length > 0 ? (
				<ScrollArea className="w-full" viewportClassName="max-h-80">
					<ul className="grid gap-2">
						{input.filteredSpaces.map((space) => (
							<li key={space.spaceId}>
								<Button
									className="w-full justify-start"
									disabled={input.props.isPending}
									onClick={() => input.props.onJoin(space.spaceId)}
									size="lg"
									type="button"
									variant="outline"
								>
									{space.name}
								</Button>
							</li>
						))}
					</ul>
				</ScrollArea>
			) : (
				<p className="px-1 text-muted-foreground text-sm">
					No spaces match “{input.query}”.
				</p>
			)}
		</div>
	);
}

function CreateSpaceForm(props: {
	contextKind: "organization" | "personal";
	errorMessage?: string | null;
	isPending: boolean;
	onCreate: WelcomeSpaceScreenProps["onCreate"];
}) {
	const createStartedRef = useRef(false);
	const [name, setName] = useState("");
	const [accessMode, setAccessMode] = useState<SpaceAccessMode>("members_only");
	const [visibility, setVisibility] =
		useState<SpaceOrganizationVisibility>("private");
	const [password, setPassword] = useState("");
	const trimmedName = name.trim();
	const selectedModeNeedsPassword = spaceAccessModeUsesPassword(accessMode);
	const normalizedPassword = normalizeSpacePasswordText(password);
	const canCreate =
		trimmedName.length > 0 &&
		!props.isPending &&
		(!selectedModeNeedsPassword || normalizedPassword.length > 0);

	useEffect(() => {
		if (!props.isPending) {
			createStartedRef.current = false;
		}
	}, [props.isPending]);

	const handleCreate = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!canCreate || createStartedRef.current) {
			return;
		}
		createStartedRef.current = true;
		try {
			props.onCreate({
				accessMode,
				name: trimmedName,
				visibility: props.contextKind === "personal" ? "private" : visibility,
				...(selectedModeNeedsPassword && normalizedPassword.length > 0
					? { password: normalizedPassword }
					: {}),
			});
		} catch (error) {
			createStartedRef.current = false;
			throw error;
		}
	};

	return (
		<form className="grid gap-4" onSubmit={handleCreate}>
			<div className="grid gap-2">
				<Label htmlFor={SPACE_NAME_INPUT_ID}>Name</Label>
				<Input
					autoComplete="off"
					disabled={props.isPending}
					id={SPACE_NAME_INPUT_ID}
					onChange={(event) => setName(event.target.value)}
					placeholder="Design review"
					type="text"
					value={name}
				/>
			</div>
			{props.contextKind === "organization" ? (
				<div className="grid gap-2">
					<Label id={SPACE_ORGANIZATION_VISIBILITY_ID}>
						Organization directory listing
					</Label>
					<RadioGroup
						aria-disabled={props.isPending || undefined}
						aria-labelledby={SPACE_ORGANIZATION_VISIBILITY_ID}
						className={cn(
							"w-full gap-1",
							props.isPending && "pointer-events-none opacity-70"
						)}
						selectedIndex={visibility === "private" ? 0 : 1}
					>
						<RadioItem
							className="px-3 py-2.5"
							description="Only members you add can find and join this Space."
							index={0}
							label="Private"
							onSelect={() => setVisibility("private")}
							selected={visibility === "private"}
						/>
						<RadioItem
							className="px-3 py-2.5"
							description="Everyone in this organization can find and join this Space."
							index={1}
							label="Public"
							onSelect={() => setVisibility("public")}
							selected={visibility === "public"}
						/>
					</RadioGroup>
				</div>
			) : null}
			<div className="grid gap-2">
				<Label>Link access</Label>
				<SpaceAccessModeRadioGroup
					disabled={props.isPending}
					onChange={(nextAccessMode) => {
						setAccessMode(nextAccessMode);
						if (!spaceAccessModeUsesPassword(nextAccessMode)) {
							setPassword("");
						}
					}}
					value={accessMode}
				/>
			</div>
			{selectedModeNeedsPassword ? (
				<div className="grid gap-2">
					<Label htmlFor={SPACE_PASSWORD_INPUT_ID}>Set Space password</Label>
					<Input
						autoComplete="new-password"
						disabled={props.isPending}
						id={SPACE_PASSWORD_INPUT_ID}
						onChange={(event) => setPassword(event.target.value)}
						type="password"
						value={password}
					/>
				</div>
			) : null}
			<Button className="w-full" disabled={!canCreate} size="lg" type="submit">
				Create
			</Button>
			{props.errorMessage ? (
				<p aria-live="polite" className="text-destructive text-xs">
					{props.errorMessage}
				</p>
			) : null}
		</form>
	);
}

function AddComputerChoiceCard(props: {
	centerAgentPath: string;
	onConnectComputer: () => void;
}) {
	return (
		<ComputerSetupChoiceCard
			actionLabel="Connect Computer"
			centerAgentHref={props.centerAgentPath}
			iconContainerClassName="welcome-add-computer-icon-breathe"
			onAction={props.onConnectComputer}
			titleClassName="welcome-add-computer-title-breathe"
		/>
	);
}

function SpaceChoiceCard(props: {
	title: string;
	description: string;
	icon: ReactNode;
	onClick: () => void;
	disabled?: boolean;
}) {
	return (
		<button
			className="flex w-full items-start gap-3 rounded-md border border-border bg-muted/20 p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-muted/20"
			disabled={props.disabled}
			onClick={props.onClick}
			type="button"
		>
			<span className="mt-0.5 text-muted-foreground">{props.icon}</span>
			<span className="min-w-0">
				<span className="block font-medium text-foreground text-sm">
					{props.title}
				</span>
				<span className="block text-muted-foreground text-xs leading-5">
					{props.description}
				</span>
			</span>
		</button>
	);
}
