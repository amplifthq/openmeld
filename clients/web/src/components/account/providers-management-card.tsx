import { Button } from "@openmeld/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@openmeld/ui/components/dialog";
import {
	DeviceMobileIcon,
	EnvelopeIcon,
	GithubLogoIcon,
	GoogleLogoIcon,
	KeyIcon,
	LinkIcon,
	MonitorIcon,
	TrashIcon,
	UserCheckIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";
import {
	useAccountLinkedProviders,
	useAccountPasskeys,
	useAccountSession,
	useCanUnlinkProvider,
	useHasPassword,
	useLinkSocialProvider,
	useRemovePasskey,
	useUnlinkSocialProvider,
} from "#/hooks/account.hooks";
import { useAddPasskey, useSignOut } from "#/hooks/auth.hooks";
import {
	getAuthErrorMessage,
	isFreshSessionRequiredError,
} from "#/lib/auth-errors";
import { getPasskeyDeviceLabel } from "#/lib/passkey-utils";
import { buildLoginRedirectUrl } from "#/lib/session-expired";
import { ProvidersManagementCardSkeleton } from "./account-skeletons";

type ProviderId = "email" | "magic-link" | "passkeys" | "google" | "github";

type ProviderStatus = {
	actionLabel?: string;
	message: string;
	onAction?: () => void;
};

type ProviderCardModel = {
	id: ProviderId;
	label: string;
	description: string;
	connected: boolean;
};

type PasskeyRecord = {
	id: string;
	name?: string | null;
	deviceType?: string | null;
	createdAt?: unknown;
};

function providerIcon(id: ProviderId) {
	switch (id) {
		case "email":
			return <EnvelopeIcon className="size-4" />;
		case "magic-link":
			return <LinkIcon className="size-4" />;
		case "passkeys":
			return <KeyIcon className="size-4" />;
		case "google":
			return <GoogleLogoIcon className="size-4" weight="bold" />;
		case "github":
			return <GithubLogoIcon className="size-4" weight="bold" />;
		default:
			return <UserCheckIcon className="size-4" />;
	}
}

function formatPasskeyDate(value: unknown): string {
	if (!value) {
		return "Unknown";
	}
	const parsed = new Date(String(value));
	if (Number.isNaN(parsed.getTime())) {
		return "Unknown";
	}
	return parsed.toLocaleDateString();
}

function buildProviderCards({
	hasPassword,
	passkeyCount,
	emailVerified,
	connectedGoogle,
	connectedGithub,
}: {
	hasPassword: boolean;
	passkeyCount: number;
	emailVerified: boolean;
	connectedGoogle: boolean;
	connectedGithub: boolean;
}): ProviderCardModel[] {
	return [
		{
			id: "email",
			label: "Email & Password",
			description: hasPassword ? "Password enabled" : "Password not set",
			connected: hasPassword,
		},
		{
			id: "magic-link",
			label: "Magic Link",
			description: emailVerified
				? "Email verification completed"
				: "Requires verified email",
			connected: emailVerified,
		},
		{
			id: "passkeys",
			label: "Passkeys",
			description: `${String(passkeyCount)} registered`,
			connected: passkeyCount > 0,
		},
		{
			id: "google",
			label: "Google",
			description: connectedGoogle ? "Connected" : "Not connected",
			connected: connectedGoogle,
		},
		{
			id: "github",
			label: "GitHub",
			description: connectedGithub ? "Connected" : "Not connected",
			connected: connectedGithub,
		},
	];
}

function ProviderRowLayout({
	card,
	actions,
	warning,
}: {
	card: ProviderCardModel;
	actions: ReactNode;
	warning?: string | null;
}) {
	return (
		<div className="space-y-2 border border-border p-3">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex items-center gap-2">
					<span className="text-muted-foreground">{providerIcon(card.id)}</span>
					<div>
						<p className="font-medium text-sm">{card.label}</p>
						<p className="text-muted-foreground text-xs">{card.description}</p>
					</div>
				</div>
				<div className="flex flex-wrap gap-2">{actions}</div>
			</div>
			{warning ? (
				<p className="text-muted-foreground text-xs">{warning}</p>
			) : null}
		</div>
	);
}

function PasskeyManageDialog({
	open,
	onOpenChange,
	passkeys,
	disabled,
	onRequestRemove,
}: {
	open: boolean;
	onOpenChange: (value: boolean) => void;
	passkeys: PasskeyRecord[];
	disabled: boolean;
	onRequestRemove: (id: string) => void;
}) {
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogTrigger
				disabled={disabled || passkeys.length === 0}
				render={<Button size="sm" variant="outline" />}
			>
				Manage
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Your Passkeys</DialogTitle>
					<DialogDescription>
						Review and remove registered passkeys.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-2">
					{passkeys.length === 0 ? (
						<p className="text-muted-foreground text-xs">
							No passkeys registered.
						</p>
					) : (
						passkeys.map((passkey) => (
							<div
								className="flex items-center justify-between border border-border p-2"
								key={passkey.id}
							>
								<div className="space-y-0.5">
									<p className="inline-flex items-center gap-1 text-xs">
										{passkey.deviceType === "multiDevice" ? (
											<DeviceMobileIcon className="size-3" />
										) : (
											<MonitorIcon className="size-3" />
										)}
										{passkey.name ?? "Unnamed passkey"}
									</p>
									<p className="text-muted-foreground text-xs">
										{getPasskeyDeviceLabel(passkey.deviceType)}
										{" • Added "}
										{formatPasskeyDate(passkey.createdAt)}
									</p>
								</div>
								<Button
									disabled={disabled}
									onClick={() => onRequestRemove(passkey.id)}
									size="icon-sm"
									variant="ghost"
								>
									<TrashIcon className="size-3" />
								</Button>
							</div>
						))
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}

function PasswordShortcutButton({
	disabled,
	connected,
	onJump,
}: {
	disabled: boolean;
	connected: boolean;
	onJump: () => void;
}) {
	return (
		<Button disabled={disabled} onClick={onJump} size="sm" variant="outline">
			{connected ? "Change Password" : "Set Password"}
		</Button>
	);
}

function buildSocialProviderAction({
	connected,
	isBusy,
	canDisconnect,
	isPending,
	onConnect,
	onDisconnect,
}: {
	connected: boolean;
	isBusy: boolean;
	canDisconnect: boolean;
	isPending: boolean;
	onConnect: () => void;
	onDisconnect: () => void;
}) {
	if (connected) {
		return (
			<Button
				disabled={isBusy || !canDisconnect}
				onClick={onDisconnect}
				size="sm"
				variant="outline"
			>
				{isPending ? "Disconnecting..." : "Disconnect"}
			</Button>
		);
	}

	return (
		<Button disabled={isBusy} onClick={onConnect} size="sm" variant="outline">
			{isPending ? "Redirecting..." : "Connect"}
		</Button>
	);
}

function buildProviderActionsById({
	hasPassword,
	userEmailVerified,
	isBusy,
	isPasskeyDialogOpen,
	passkeys,
	addPasskeyPending,
	socialPending,
	googleConnected,
	githubConnected,
	canDisconnectGoogle,
	canDisconnectGithub,
	setIsPasskeyDialogOpen,
	setPasskeyToRemove,
	jumpToPasswordCard,
	handleAddPasskeyClick,
	handleConnectGoogle,
	handleDisconnectGoogle,
	handleConnectGithub,
	handleDisconnectGithub,
}: {
	hasPassword: boolean;
	userEmailVerified: boolean;
	isBusy: boolean;
	isPasskeyDialogOpen: boolean;
	passkeys: PasskeyRecord[];
	addPasskeyPending: boolean;
	socialPending: boolean;
	googleConnected: boolean;
	githubConnected: boolean;
	canDisconnectGoogle: boolean;
	canDisconnectGithub: boolean;
	setIsPasskeyDialogOpen: (value: boolean) => void;
	setPasskeyToRemove: (value: string | null) => void;
	jumpToPasswordCard: () => void;
	handleAddPasskeyClick: () => void;
	handleConnectGoogle: () => void;
	handleDisconnectGoogle: () => void;
	handleConnectGithub: () => void;
	handleDisconnectGithub: () => void;
}): Record<ProviderId, ReactNode> {
	const googleActions = buildSocialProviderAction({
		connected: googleConnected,
		isBusy,
		canDisconnect: canDisconnectGoogle,
		isPending: socialPending,
		onConnect: handleConnectGoogle,
		onDisconnect: handleDisconnectGoogle,
	});

	const githubActions = buildSocialProviderAction({
		connected: githubConnected,
		isBusy,
		canDisconnect: canDisconnectGithub,
		isPending: socialPending,
		onConnect: handleConnectGithub,
		onDisconnect: handleDisconnectGithub,
	});

	return {
		email: (
			<PasswordShortcutButton
				connected={hasPassword}
				disabled={isBusy}
				onJump={jumpToPasswordCard}
			/>
		),
		"magic-link": (
			<Button disabled size="sm" variant="outline">
				{userEmailVerified ? "Enabled" : "Pending"}
			</Button>
		),
		passkeys: (
			<>
				<PasskeyManageDialog
					disabled={isBusy}
					onOpenChange={setIsPasskeyDialogOpen}
					onRequestRemove={(id) => setPasskeyToRemove(id)}
					open={isPasskeyDialogOpen}
					passkeys={passkeys}
				/>
				<Button
					disabled={isBusy}
					onClick={handleAddPasskeyClick}
					size="sm"
					variant="outline"
				>
					{addPasskeyPending ? "Adding..." : "Add"}
				</Button>
			</>
		),
		google: googleActions,
		github: githubActions,
	};
}

function buildProviderWarningsById({
	googleConnected,
	githubConnected,
	googleWarning,
	githubWarning,
}: {
	googleConnected: boolean;
	githubConnected: boolean;
	googleWarning: string | null;
	githubWarning: string | null;
}): Partial<Record<ProviderId, string | null>> {
	return {
		google: googleConnected ? googleWarning : null,
		github: githubConnected ? githubWarning : null,
	};
}

export function ProvidersManagementCard() {
	const { data: session, isPending: isSessionPending } = useAccountSession();
	const { data: linkedAccounts = [], isPending: isAccountsPending } =
		useAccountLinkedProviders();
	const { data: passkeys = [], isPending: isPasskeysPending } =
		useAccountPasskeys();
	const hasPassword = useHasPassword();

	const addPasskey = useAddPasskey();
	const removePasskey = useRemovePasskey();
	const linkSocial = useLinkSocialProvider();
	const unlinkSocial = useUnlinkSocialProvider();
	const signOut = useSignOut();
	const googleUnlinkSafety = useCanUnlinkProvider("google");
	const githubUnlinkSafety = useCanUnlinkProvider("github");

	const [status, setStatus] = useState<ProviderStatus | null>(null);
	const [isPasskeyDialogOpen, setIsPasskeyDialogOpen] = useState(false);
	const [passkeyToRemove, setPasskeyToRemove] = useState<string | null>(null);

	if (isSessionPending || isAccountsPending || isPasskeysPending) {
		return <ProvidersManagementCardSkeleton />;
	}

	const user = session?.user;
	if (!user) {
		return (
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<UserCheckIcon className="size-5" />
						Sign-in Methods
					</CardTitle>
					<CardDescription>No user data available.</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	const connectedGoogle = linkedAccounts.some(
		(account) => account.providerId === "google"
	);
	const connectedGithub = linkedAccounts.some(
		(account) => account.providerId === "github"
	);

	const cards = buildProviderCards({
		hasPassword,
		passkeyCount: passkeys.length,
		emailVerified: Boolean(user.emailVerified),
		connectedGoogle,
		connectedGithub,
	});

	const passkeyNameMap = new Map<string, string>();
	for (const passkey of passkeys) {
		passkeyNameMap.set(passkey.id, passkey.name ?? "Unnamed passkey");
	}

	const isBusy =
		addPasskey.isPending ||
		removePasskey.isPending ||
		linkSocial.isPending ||
		unlinkSocial.isPending ||
		signOut.isPending;

	const jumpToPasswordCard = () => {
		window.location.hash = "password-card";
		document.getElementById("password-card")?.scrollIntoView({
			behavior: "smooth",
			block: "center",
		});
	};

	const handleFreshSignInClick = () => {
		signOut.mutateAsync().then(
			() => window.location.assign(buildLoginRedirectUrl()),
			(error) =>
				setStatus({
					message: getAuthErrorMessage(
						error,
						"Failed to start re-authentication."
					),
				})
		);
	};

	const handleAddPasskeyClick = () => {
		setStatus(null);
		addPasskey.mutateAsync().then(
			() => setStatus({ message: "Passkey added." }),
			(error) => {
				if (isFreshSessionRequiredError(error)) {
					setStatus({
						actionLabel: "Sign in again",
						message: "Sign in again before adding a passkey.",
						onAction: handleFreshSignInClick,
					});
					return;
				}

				setStatus({
					message: getAuthErrorMessage(error, "Failed to add passkey."),
				});
			}
		);
	};

	const handleRemovePasskeyClick = () => {
		if (!passkeyToRemove) {
			return;
		}

		setStatus(null);
		removePasskey.mutateAsync(passkeyToRemove).then(
			() => {
				setStatus({ message: "Passkey removed." });
				setPasskeyToRemove(null);
			},
			(error) =>
				setStatus({
					message: getAuthErrorMessage(error, "Failed to remove passkey."),
				})
		);
	};

	const handleConnectGoogle = () => {
		setStatus(null);
		linkSocial.mutateAsync("google").catch((error) =>
			setStatus({
				message: getAuthErrorMessage(error, "Failed to connect google."),
			})
		);
	};

	const handleConnectGithub = () => {
		setStatus(null);
		linkSocial.mutateAsync("github").catch((error) =>
			setStatus({
				message: getAuthErrorMessage(error, "Failed to connect github."),
			})
		);
	};

	const handleDisconnectGoogle = () => {
		setStatus(null);
		unlinkSocial.mutateAsync("google").then(
			() => setStatus({ message: "google disconnected." }),
			(error) =>
				setStatus({
					message: getAuthErrorMessage(error, "Failed to disconnect google."),
				})
		);
	};

	const handleDisconnectGithub = () => {
		setStatus(null);
		unlinkSocial.mutateAsync("github").then(
			() => setStatus({ message: "github disconnected." }),
			(error) =>
				setStatus({
					message: getAuthErrorMessage(error, "Failed to disconnect github."),
				})
		);
	};

	const providerActionsById = buildProviderActionsById({
		hasPassword,
		userEmailVerified: !!user.emailVerified,
		isBusy,
		isPasskeyDialogOpen,
		passkeys,
		addPasskeyPending: addPasskey.isPending,
		socialPending: linkSocial.isPending || unlinkSocial.isPending,
		googleConnected: connectedGoogle,
		githubConnected: connectedGithub,
		canDisconnectGoogle: googleUnlinkSafety.canUnlink,
		canDisconnectGithub: githubUnlinkSafety.canUnlink,
		setIsPasskeyDialogOpen,
		setPasskeyToRemove,
		jumpToPasswordCard,
		handleAddPasskeyClick,
		handleConnectGoogle,
		handleDisconnectGoogle,
		handleConnectGithub,
		handleDisconnectGithub,
	});

	const providerWarningsById = buildProviderWarningsById({
		googleConnected: connectedGoogle,
		githubConnected: connectedGithub,
		googleWarning: googleUnlinkSafety.warningMessage,
		githubWarning: githubUnlinkSafety.warningMessage,
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<UserCheckIcon className="size-5" />
					Sign-in Methods
				</CardTitle>
				<CardDescription>
					Manage your authentication methods for account access.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{cards.map((card) => (
					<ProviderRowLayout
						actions={providerActionsById[card.id]}
						card={card}
						key={card.id}
						warning={providerWarningsById[card.id]}
					/>
				))}
				{status ? (
					<div className="flex flex-wrap items-center gap-3 text-muted-foreground text-xs">
						<p>{status.message}</p>
						{status.onAction && status.actionLabel ? (
							<Button
								disabled={signOut.isPending}
								onClick={status.onAction}
								size="sm"
								variant="outline"
							>
								{signOut.isPending ? "Signing out..." : status.actionLabel}
							</Button>
						) : null}
					</div>
				) : null}
			</CardContent>

			<Dialog
				onOpenChange={() => setPasskeyToRemove(null)}
				open={Boolean(passkeyToRemove)}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Remove passkey?</DialogTitle>
						<DialogDescription>
							This will remove “
							{passkeyNameMap.get(passkeyToRemove ?? "") ?? "Passkey"}” from
							your account.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							disabled={removePasskey.isPending}
							onClick={() => setPasskeyToRemove(null)}
							variant="outline"
						>
							Cancel
						</Button>
						<Button
							disabled={removePasskey.isPending}
							onClick={handleRemovePasskeyClick}
							variant="destructive"
						>
							{removePasskey.isPending ? "Removing..." : "Remove passkey"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</Card>
	);
}
