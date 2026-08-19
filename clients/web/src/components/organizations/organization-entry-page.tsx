"use client";

import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import { SettingsAddComputerCardContent } from "@openmeld/ui/components/settings-computers";
import {
	ADD_CARD_PICKER_CLASS_NAME,
	CARD_PICKER_GRID_CLASS_NAME,
	cardPickerCardClassName,
} from "@openmeld/ui/lib/card-picker-contract";
import {
	ArrowLeftIcon,
	ArrowRightIcon,
	BuildingsIcon,
	PlusIcon,
} from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useNavigate } from "@tanstack/react-router";
import {
	type FormEvent,
	type MouseEvent as ReactMouseEvent,
	useState,
} from "react";
import { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
import { AppGlobalControls } from "#/components/app/app-global-controls";
import { AppMainContent } from "#/components/app/app-main-content";
import { AppOuterRail } from "#/components/app/app-outer-rail";
import { useAppShellAccount } from "#/components/app/app-shell-account";
import { AppSurfaceLayout } from "#/components/app/app-surface-layout";
import { useComputerAttentionTone } from "#/components/app/use-computer-attention-tone";
import { WelcomeLayout } from "#/components/welcome/welcome-layout";
import { createOrganization } from "#/lib/organizations/auth-organizations";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	type OrganizationEntryIntent,
	SLACK_INSTALL_INTENT,
} from "#/lib/organizations/organization-entry-intent";
import {
	buildOrganizationChannelsPath,
	buildOrganizationDefaultPath,
	buildOrganizationNewOrganizationPath,
	buildOrganizationOrganizationsPath,
	buildOrganizationSpacesPath,
} from "#/lib/organizations/organization-routes";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";
import { prepareOrganizationDestination } from "#/lib/organizations/prepare-organization-destination";
import { organizationScopeQueryKeys } from "#/query/organizations/organization-scope";

type OrganizationSetupStep = "creating_organization" | "opening_organization";

type AsyncActionState<TInput> =
	| { error: null; status: "idle"; variables: null }
	| { error: null; status: "pending" | "success"; variables: TInput }
	| { error: Error; status: "error"; variables: TInput };

export function OrganizationEntryPage(
	input: { intent?: OrganizationEntryIntent } = {}
) {
	return <OrganizationEntryPageContent intent={input.intent} mode="picker" />;
}

export function NewOrganizationPage(
	input: { intent?: OrganizationEntryIntent } = {}
) {
	return <OrganizationEntryPageContent intent={input.intent} mode="create" />;
}

function OrganizationEntryPageContent(input: {
	intent?: OrganizationEntryIntent;
	mode: "create" | "picker";
}) {
	const account = useAppShellAccount();
	const { currentOrganization, organizations } = useAppOrganization();
	const computerAttentionTone = useComputerAttentionTone();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [organizationName, setOrganizationName] = useState("");
	const [createdOrganization, setCreatedOrganization] =
		useState<OrganizationSummary | null>(null);
	const [setupStep, setSetupStep] = useState<OrganizationSetupStep | null>(
		null
	);
	const normalizedName = organizationName.trim();
	const isSlackInstallIntent = input.intent === SLACK_INSTALL_INTENT;
	const intentSearch = input.intent ? { intent: input.intent } : {};
	const createOrganizationMutation = useMutation({
		mutationFn: (organizationInput: { name: string }) =>
			createOrganization(organizationInput),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: organizationScopeQueryKeys.all,
			});
		},
	});
	const openCreatedOrganizationAction = useAsyncAction(
		async (organization: OrganizationSummary) => {
			await prepareOrganizationDestination({
				organizationId: organization.id,
				queryClient,
			});
			await openOrganization(organization);
		}
	);
	const openOrganizationAction = useAsyncAction(openOrganization);
	const organizationSetupIsPending =
		createOrganizationMutation.isPending ||
		openCreatedOrganizationAction.isPending;
	async function openOrganization(organization: OrganizationSummary) {
		await navigate({
			to: isSlackInstallIntent
				? buildOrganizationChannelsPath(organization.slug)
				: buildOrganizationDefaultPath(organization.slug),
		});
	}

	const joinableOrganizations = organizations.filter(
		(organization) => organization.isPersonal !== true
	);
	const selectableOrganizations = joinableOrganizations;
	const canCreateOrganization =
		normalizedName.length > 0 && !organizationSetupIsPending;
	const returnsToOrganizationPicker = selectableOrganizations.length > 0;
	const backLabel = returnsToOrganizationPicker
		? "Back to Organizations"
		: "Back to Spaces";

	const handleCreateOrganization = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!canCreateOrganization) {
			return;
		}
		continueOrganizationCreation().catch(() => undefined);
	};
	async function continueOrganizationCreation() {
		if (!canCreateOrganization) {
			return;
		}
		if (!createdOrganization) {
			createOrganizationMutation.reset();
		}
		openCreatedOrganizationAction.reset();
		let organization = createdOrganization;
		try {
			if (!organization) {
				setSetupStep("creating_organization");
				organization = await createOrganizationMutation.mutateAsync({
					name: normalizedName,
				});
				setCreatedOrganization(organization);
			}
			setSetupStep("opening_organization");
			await openCreatedOrganizationAction.run(organization);
		} catch (error) {
			// The mutation owns visible error state.
			console.error("Organization setup did not finish.", {
				cause: error,
				organizationId: organization?.id ?? null,
			});
		}
	}
	const handleBack = () => {
		navigate({
			...(returnsToOrganizationPicker && input.intent
				? { search: intentSearch }
				: {}),
			to: returnsToOrganizationPicker
				? buildOrganizationOrganizationsPath(currentOrganization.slug)
				: buildOrganizationSpacesPath(currentOrganization.slug),
		}).catch(() => undefined);
	};
	let setupErrorMessage: string | null = null;
	let setupErrorTitle: string | null = null;
	if (createOrganizationMutation.isError) {
		setupErrorTitle = "OpenMeld could not create this organization.";
		setupErrorMessage = createOrganizationMutation.error.message;
	} else if (openCreatedOrganizationAction.isError) {
		setupErrorTitle =
			"OpenMeld created this organization but could not open it.";
		setupErrorMessage =
			"Try again. OpenMeld will continue from the organization it already created.";
	}
	const createForm = (
		<OrganizationCreateForm
			canCreateOrganization={canCreateOrganization}
			createdOrganization={createdOrganization}
			errorMessage={setupErrorMessage}
			errorTitle={setupErrorTitle}
			isPending={organizationSetupIsPending}
			onNameChange={setOrganizationName}
			onSubmit={handleCreateOrganization}
			organizationName={organizationName}
			setupStep={setupStep}
		/>
	);

	if (input.mode === "picker") {
		return (
			<AppFullWidthLayout>
				{selectableOrganizations.length > 0 ? (
					<OrganizationPicker
						createOrganizationPath={buildOrganizationNewOrganizationPath(
							currentOrganization.slug
						)}
						errorMessage={openOrganizationAction.error?.message ?? null}
						intent={input.intent}
						isOpeningOrganization={openOrganizationAction.isPending}
						onOpenOrganization={(organization) => {
							openOrganizationAction.run(organization).catch(() => undefined);
						}}
						openingOrganizationId={openOrganizationAction.variables?.id ?? null}
						organizations={selectableOrganizations}
					/>
				) : (
					<Navigate
						replace
						search={intentSearch}
						to={buildOrganizationNewOrganizationPath(currentOrganization.slug)}
					/>
				)}
			</AppFullWidthLayout>
		);
	}

	return (
		<AppSurfaceLayout
			globalControls={<AppGlobalControls />}
			outerRail={
				<AppOuterRail
					account={account}
					computerAttentionTone={computerAttentionTone}
				/>
			}
		>
			<AppMainContent
				bodySlotName="organization-entry-content-scroll"
				header={
					<div className="flex h-full items-center px-4">
						<Button
							aria-label={backLabel}
							onClick={handleBack}
							size="icon-sm"
							title={backLabel}
							variant="ghost"
						>
							<ArrowLeftIcon aria-hidden="true" />
						</Button>
					</div>
				}
				headerClassName="border-b-0"
				headerSlotName="organization-entry-content-header"
				scroll
			>
				<div className="mx-auto min-h-full w-full max-w-7xl px-4 pb-6 sm:px-6 lg:px-8">
					<WelcomeLayout
						subtitle="When you're ready to work with other people, create an organization to share agents, see people and agents in one directory, and let a Center Agent coordinate the loop."
						title="Create an organization"
					>
						{createForm}
					</WelcomeLayout>
				</div>
			</AppMainContent>
		</AppSurfaceLayout>
	);
}

function OrganizationPicker(input: {
	createOrganizationPath: string;
	errorMessage: string | null;
	intent?: OrganizationEntryIntent;
	isOpeningOrganization: boolean;
	onOpenOrganization: (organization: OrganizationSummary) => void;
	openingOrganizationId: string | null;
	organizations: OrganizationSummary[];
}) {
	return (
		<>
			<section className="flex flex-col gap-1">
				<h1 className="font-medium text-2xl text-foreground">Organizations</h1>
				<p className="max-w-2xl text-muted-foreground text-sm leading-6">
					{input.intent === SLACK_INSTALL_INTENT
						? "Choose the organization to connect to your Slack workspace — usually your team's organization. Or create a new one."
						: "Choose an organization to work with, or create a new one for shared agents and teammates."}
				</p>
			</section>
			{input.errorMessage ? (
				<p className="text-destructive text-sm" role="alert">
					{input.errorMessage}
				</p>
			) : null}
			<ul
				className={CARD_PICKER_GRID_CLASS_NAME}
				data-testid="organization-picker-list"
			>
				{input.organizations.map((organization) => (
					<li className="h-full" key={organization.id}>
						<OrganizationPickerCard
							intent={input.intent}
							isOpening={input.openingOrganizationId === organization.id}
							isOpeningOrganization={input.isOpeningOrganization}
							onOpen={input.onOpenOrganization}
							organization={organization}
						/>
					</li>
				))}
				<li className="h-full">
					<Link
						className={ADD_CARD_PICKER_CLASS_NAME}
						search={input.intent ? { intent: input.intent } : {}}
						to={input.createOrganizationPath}
					>
						<SettingsAddComputerCardContent
							description="Set up shared agents, members, and a Center Agent."
							title="Create an organization"
						/>
					</Link>
				</li>
			</ul>
		</>
	);
}

function OrganizationPickerCard(input: {
	intent?: OrganizationEntryIntent;
	isOpening: boolean;
	isOpeningOrganization: boolean;
	onOpen: (organization: OrganizationSummary) => void;
	organization: OrganizationSummary;
}) {
	const handleClick = (event: ReactMouseEvent<HTMLAnchorElement>) => {
		if (
			event.button !== 0 ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey
		) {
			return;
		}
		event.preventDefault();
		if (!input.isOpeningOrganization) {
			input.onOpen(input.organization);
		}
	};

	return (
		<Link
			aria-busy={input.isOpening || undefined}
			aria-disabled={input.isOpeningOrganization || undefined}
			aria-label={`Open ${input.organization.name} organization`}
			className={cardPickerCardClassName()}
			data-testid={`organization-picker-card-${input.organization.id}`}
			onClick={handleClick}
			to={
				input.intent === SLACK_INSTALL_INTENT
					? buildOrganizationChannelsPath(input.organization.slug)
					: buildOrganizationDefaultPath(input.organization.slug)
			}
		>
			<div className="flex h-full w-full min-w-0 flex-1 flex-col justify-between gap-3 px-3.5 pt-4 pb-3">
				<div className="flex min-w-0 items-start gap-2.5">
					<span className="grid h-8 w-8 shrink-0 place-items-center border border-border/70 bg-background/45 text-muted-foreground transition-colors group-hover:text-foreground">
						<BuildingsIcon aria-hidden="true" className="h-4 w-4" />
					</span>
					<span className="min-w-0">
						<span className="block truncate font-medium text-foreground text-sm">
							{input.organization.name}
						</span>
						<span className="mt-1 block text-muted-foreground text-xs leading-5">
							Organization
						</span>
					</span>
				</div>
				<div className="flex items-center justify-between gap-3 border-border/70 border-t pt-2.5 text-xs leading-5">
					<span className="min-w-0 truncate text-muted-foreground">
						/{input.organization.slug}
					</span>
					<span className="inline-flex shrink-0 items-center gap-1 font-medium text-foreground">
						{input.isOpening ? "Opening" : "Open"}
						<ArrowRightIcon aria-hidden="true" className="size-3.5" />
					</span>
				</div>
			</div>
		</Link>
	);
}

function OrganizationCreateForm(input: {
	canCreateOrganization: boolean;
	createdOrganization: OrganizationSummary | null;
	errorMessage: string | null;
	errorTitle: string | null;
	isPending: boolean;
	onNameChange: (value: string) => void;
	onSubmit: (event: FormEvent<HTMLFormElement>) => void;
	organizationName: string;
	setupStep: OrganizationSetupStep | null;
}) {
	const fieldsAreLocked = input.isPending || input.createdOrganization !== null;
	let buttonLabel = "Create organization";
	if (input.isPending) {
		buttonLabel = getOrganizationSetupStepLabel({
			organizationName:
				input.createdOrganization?.name ?? input.organizationName,
			setupStep: input.setupStep,
		});
	} else if (input.createdOrganization) {
		buttonLabel = "Retry opening";
	}

	return (
		<form className="grid gap-4" onSubmit={input.onSubmit}>
			<div className="grid gap-2">
				<Label htmlFor="new-organization-name">Organization name</Label>
				<Input
					disabled={fieldsAreLocked}
					id="new-organization-name"
					onChange={(event) => input.onNameChange(event.target.value)}
					placeholder="Acme Labs"
					value={input.organizationName}
				/>
			</div>
			<Button
				className="w-full"
				disabled={!input.canCreateOrganization}
				size="lg"
				type="submit"
			>
				<PlusIcon aria-hidden="true" data-icon="inline-start" />
				{buttonLabel}
			</Button>
			{input.errorMessage ? (
				<div
					className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-3 text-destructive text-xs"
					role="alert"
				>
					{input.errorTitle ? (
						<p className="font-medium">{input.errorTitle}</p>
					) : null}
					<p className={input.errorTitle ? "mt-1" : undefined}>
						{input.errorMessage}
					</p>
				</div>
			) : null}
		</form>
	);
}

function getOrganizationSetupStepLabel(input: {
	organizationName: string;
	setupStep: OrganizationSetupStep | null;
}): string {
	switch (input.setupStep) {
		case "opening_organization":
			return `Opening ${input.organizationName}`;
		default:
			return "Creating organization";
	}
}

function useAsyncAction<TInput, TResult>(
	action: (input: TInput) => Promise<TResult>
) {
	const [state, setState] = useState<AsyncActionState<TInput>>({
		error: null,
		status: "idle",
		variables: null,
	});

	const run = async (variables: TInput): Promise<TResult> => {
		setState({ error: null, status: "pending", variables });
		try {
			const result = await action(variables);
			setState({ error: null, status: "success", variables });
			return result;
		} catch (error) {
			setState({
				error:
					error instanceof Error
						? error
						: new Error("OpenMeld could not complete this action.", {
								cause: error,
							}),
				status: "error",
				variables,
			});
			throw error;
		}
	};

	return {
		error: state.error,
		isError: state.status === "error",
		isPending: state.status === "pending",
		reset: () => {
			setState({ error: null, status: "idle", variables: null });
		},
		run,
		variables: state.variables,
	};
}
