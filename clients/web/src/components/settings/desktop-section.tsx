import { desktopSettingsViewSchema } from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import { SettingsRow } from "@openmeld/ui/components/settings-row";
import { SettingsSection } from "@openmeld/ui/components/settings-section";
import { Switch } from "@openmeld/ui/components/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppPageHeader } from "#/components/app/app-page-header";
import { ComputerPowerSettings } from "#/components/computers/computer-power-settings";
import { useDesktopComputerConnection } from "#/desktop/use-computer-connection";
import { useAuthSession } from "#/hooks/auth.hooks";
import { getBridge } from "../../../../desktop/src/renderer/ipc";

const queryKey = ["desktop-startup-settings"] as const;

export function DesktopSection() {
	const account = useAuthSession().data?.user.id;
	const computer = useDesktopComputerConnection();
	const target =
		computer.data?.status === "available" && computer.data.accountId === account
			? computer.data.target
			: null;
	const client = useQueryClient();
	const settings = useQuery({
		queryKey,
		queryFn: async () =>
			desktopSettingsViewSchema.parse(await getBridge().getDesktopSettings()),
		retry: false,
		refetchOnMount: "always",
		refetchOnWindowFocus: "always",
	});
	const mutation = useMutation({
		mutationFn: async (input: {
			method: "setOpenAtLogin" | "setStartInBackground";
			enabled: boolean;
		}) =>
			desktopSettingsViewSchema.parse(
				await getBridge()[input.method](input.enabled)
			),
		onSuccess: (value) => client.setQueryData(queryKey, value),
	});
	const value = settings.data;
	const error = mutation.error ?? settings.error;
	const problem =
		error instanceof Error ? error.message : value?.problem?.message;
	const busy = settings.isFetching || mutation.isPending;
	return (
		<>
			<AppPageHeader
				description="Manage startup and power settings on this computer."
				eyebrow="Personal"
				title="Desktop"
			/>
			<SettingsSection id="desktop-startup" title="Startup">
				<SettingsRow
					control={
						typeof value?.openAtLogin === "boolean" ? (
							<Switch
								aria-label="Open at login"
								checked={value?.openAtLogin === true}
								disabled={busy}
								onCheckedChange={(enabled) =>
									mutation.mutate({ method: "setOpenAtLogin", enabled })
								}
							/>
						) : (
							<span className="text-muted-foreground text-xs">
								{settings.isPending ? "Loading…" : "Unavailable"}
							</span>
						)
					}
					description="Open OpenMeld when you log in to your computer."
					label="Open at login"
				/>
				{value?.openAtLogin ? (
					<SettingsRow
						control={
							typeof value.startInBackground === "boolean" ? (
								<Switch
									aria-label="Start in background"
									checked={value.startInBackground === true}
									disabled={busy}
									onCheckedChange={(enabled) =>
										mutation.mutate({ method: "setStartInBackground", enabled })
									}
								/>
							) : (
								<span className="text-muted-foreground text-xs">
									Unavailable
								</span>
							)
						}
						description="Keep the window hidden when OpenMeld opens at login. Opening the app yourself still shows the window."
						label="Start in background"
					/>
				) : null}
				{settings.isPending ? (
					<output className="text-muted-foreground text-sm">
						Loading startup settings…
					</output>
				) : null}
				{problem ? (
					<div className="mt-3 flex items-center gap-3">
						<p className="text-destructive text-sm" role="alert">
							{problem}
						</p>
						<Button
							disabled={busy}
							onClick={() => {
								mutation.reset();
								settings.refetch();
							}}
							size="sm"
							variant="outline"
						>
							Retry
						</Button>
					</div>
				) : null}
			</SettingsSection>
			<ComputerPowerSettings
				key={`${account}/${target?.deviceId}/${target?.runtimeLane}`}
				storageScope={account ?? "signed-out"}
				target={target}
			/>
			<p className="text-muted-foreground text-sm">
				Closing the window keeps OpenMeld running. Quitting the app stops
				desktop notifications. OpenMeld Service and accepted local Agent tasks
				continue running in either case.
			</p>
		</>
	);
}
