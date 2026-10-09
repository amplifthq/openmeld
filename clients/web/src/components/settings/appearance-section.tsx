"use client";

import { BotAvatar } from "@openmeld/ui/components/bot-avatar";
import { SettingsRow } from "@openmeld/ui/components/settings-row";
import { Switch } from "@openmeld/ui/components/switch";
import { RadioGroup, RadioItem } from "@openmeld/ui/fluid/radio-group";
import { useMediaQuery } from "@openmeld/ui/hooks/use-media-query";
import { BOT_AVATAR_PALETTES } from "@openmeld/ui/lib/bot-avatar-palette";
import {
	DEFAULT_ROUNDED_SHAPE_RADIUS_PX,
	type ShapeVariant,
	useShapeContext,
} from "@openmeld/ui/lib/shape-context";
import {
	ChatCircleTextIcon,
	TrayIcon,
	UsersThreeIcon,
} from "@phosphor-icons/react";
import { useTheme } from "next-themes";
import { type CSSProperties, useSyncExternalStore } from "react";
import { AppPageHeader } from "#/components/app/app-page-header";
import { THEME_CHOICES } from "#/components/appearance/theme-choices";
import {
	BOT_MATERIAL_CHOICES,
	useBotAvatarPreference,
} from "#/lib/appearance/bot-avatar-preference";
import {
	SIDEBAR_DISPLAY_CHOICES,
	type SidebarDisplay,
	useSidebarDisplayPreference,
} from "#/lib/appearance/sidebar-preference";
import {
	TOOLBAR_SHORTCUTS,
	useToolbarPreference,
} from "#/lib/appearance/toolbar-preference";

const PHONE_APPEARANCE_CHOICES_QUERY = "(max-width: 639px)";

type ShapeChoice = {
	description: string;
	label: string;
	value: ShapeVariant;
};

const SHAPE_CHOICES: readonly ShapeChoice[] = [
	{
		description: "Use medium-rounded corners across controls and surfaces.",
		label: "Rounded",
		value: "rounded",
	},
	{
		description: "Use sharp corners across controls and surfaces.",
		label: "Square",
		value: "square",
	},
] as const;

const subscribeToHydration = () => () => undefined;
const getClientHydrationSnapshot = () => true;
const getServerHydrationSnapshot = () => false;

export function AppearanceSection() {
	const sidebar = useSidebarDisplayPreference();
	const toolbar = useToolbarPreference();
	const botAvatar = useBotAvatarPreference();
	const { setTheme, theme } = useTheme();
	const { setShape, shape } = useShapeContext();
	const choiceOrientation = useMediaQuery(PHONE_APPEARANCE_CHOICES_QUERY)
		? "vertical"
		: "horizontal";
	const mounted = useSyncExternalStore(
		subscribeToHydration,
		getClientHydrationSnapshot,
		getServerHydrationSnapshot
	);

	const selectedThemeIndex = mounted
		? THEME_CHOICES.findIndex((choice) => choice.value === theme)
		: -1;
	const selectedShapeIndex = mounted
		? SHAPE_CHOICES.findIndex((choice) => choice.value === shape)
		: -1;

	return (
		<>
			<AppPageHeader
				description="Choose how OpenMeld looks on this device."
				eyebrow="Personal"
				id="appearance-heading"
				title="Appearance"
			/>
			<section
				aria-labelledby="appearance-heading"
				className="flex flex-col pb-6 [&_[data-slot=settings-row]:not(:first-child)]:pt-5 [&_[data-slot=settings-row]:not(:last-child)]:pb-5"
				id="appearance"
			>
				<SettingsRow
					control={
						<RadioGroup
							aria-label="Theme"
							className="w-full"
							orientation={choiceOrientation}
							selectedIndex={selectedThemeIndex}
						>
							{THEME_CHOICES.map((choice, index) => (
								<RadioItem
									adornment={
										<choice.icon aria-hidden="true" className="size-4" />
									}
									className="min-w-0 flex-1 px-3 py-2.5"
									description={choice.description}
									index={index}
									key={choice.value}
									label={choice.label}
									onSelect={() => setTheme(choice.value)}
									selected={mounted && theme === choice.value}
								/>
							))}
						</RadioGroup>
					}
					description="This preference is saved in this browser."
					label="Theme"
					layout="stacked"
					showDivider
				/>
				<SettingsRow
					control={
						<RadioGroup
							aria-label="Corner style"
							className="w-full"
							orientation={choiceOrientation}
							selectedIndex={selectedShapeIndex}
						>
							{SHAPE_CHOICES.map((choice, index) => (
								<RadioItem
									className="min-w-0 flex-1 px-3 py-3"
									description={
										<span className="flex min-w-0 flex-col gap-2">
											<span>{choice.description}</span>
											<CornerStylePreview shape={choice.value} />
										</span>
									}
									index={index}
									key={choice.value}
									label={choice.label}
									onSelect={() => setShape(choice.value)}
									selected={mounted && shape === choice.value}
								/>
							))}
						</RadioGroup>
					}
					description="Applies across OpenMeld. Saved in this browser."
					label="Corner style"
					layout="stacked"
					showDivider
				/>
				<SettingsRow
					control={
						<RadioGroup
							aria-label="Sidebar display"
							className="w-full"
							orientation={choiceOrientation}
							selectedIndex={
								mounted
									? SIDEBAR_DISPLAY_CHOICES.findIndex(
											(choice) => choice.value === sidebar.display
										)
									: -1
							}
						>
							{SIDEBAR_DISPLAY_CHOICES.map((choice, index) => (
								<RadioItem
									className="min-w-0 flex-1 px-3 py-3"
									description={
										<span className="flex min-w-0 flex-col gap-2">
											<span>{choice.description}</span>
											<SidebarDisplayPreview display={choice.value} />
										</span>
									}
									index={index}
									key={choice.value}
									label={choice.label}
									onSelect={() => sidebar.setDisplay(choice.value)}
									selected={mounted && sidebar.display === choice.value}
								/>
							))}
						</RadioGroup>
					}
					description="Choose how the main navigation appears on larger screens. Saved in this browser."
					label="Sidebar"
					layout="stacked"
					showDivider
				/>
				<SettingsRow
					className="hidden lg:flex"
					control={
						<div className="flex flex-wrap items-center gap-x-8 gap-y-3">
							{TOOLBAR_SHORTCUTS.map((item) => (
								<label
									className="flex shrink-0 items-center gap-3 text-sm"
									htmlFor={`toolbar-shortcut-${item.id}`}
									key={item.id}
								>
									<span>{item.label}</span>
									<Switch
										aria-label={`Show ${item.label} in toolbar`}
										checked={toolbar.isVisible(item.id)}
										id={`toolbar-shortcut-${item.id}`}
										onCheckedChange={(checked) =>
											toolbar.setVisible(item.id, checked)
										}
									/>
								</label>
							))}
						</div>
					}
					description="Choose which shortcuts appear in the bottom toolbar. Saved in this browser."
					label="Toolbar shortcuts"
					layout="stacked"
				/>
				<SettingsRow
					control={
						<RadioGroup
							aria-label="Bot avatar material"
							className="w-full"
							orientation={choiceOrientation}
							selectedIndex={
								mounted
									? BOT_MATERIAL_CHOICES.findIndex(
											(choice) => choice.value === botAvatar.shading
										)
									: -1
							}
						>
							{BOT_MATERIAL_CHOICES.map((choice, index) => (
								<RadioItem
									className="min-w-0 flex-1 px-3 py-3"
									description={
										<span className="flex min-w-0 flex-col gap-2">
											<span>{choice.description}</span>
											<span
												aria-hidden="true"
												className="flex h-24 items-center justify-center"
											>
												<BotAvatar
													motionEnabled={botAvatar.motionEnabled}
													palette={botAvatar.palette}
													shading={choice.value}
													size={56}
													type="clover"
													working
												/>
											</span>
										</span>
									}
									index={index}
									key={choice.value}
									label={choice.label}
									onSelect={() => botAvatar.setShading(choice.value)}
									selected={mounted && botAvatar.shading === choice.value}
								/>
							))}
						</RadioGroup>
					}
					description="Choose a finish for Center Agent Bot avatars across the app. Saved in this browser."
					label="Bot avatar material"
					layout="stacked"
					showDivider
				/>
				<SettingsRow
					control={
						<RadioGroup
							aria-label="Bot avatar colors"
							className="w-full"
							orientation={choiceOrientation}
							selectedIndex={
								mounted
									? BOT_AVATAR_PALETTES.findIndex(
											(choice) => choice.value === botAvatar.palette
										)
									: -1
							}
						>
							{BOT_AVATAR_PALETTES.map((choice, index) => (
								<RadioItem
									className="min-w-0 flex-1 px-3 py-3"
									description={
										<span className="flex flex-col gap-2">
											<span>{choice.description}</span>
											<span
												aria-hidden="true"
												className="flex h-16 items-center justify-center gap-2"
											>
												{(["clover", "cat", "ghost"] as const).map((type) => (
													<BotAvatar
														key={type}
														motionEnabled={false}
														palette={choice.value}
														shading={botAvatar.shading}
														size={28}
														type={type}
													/>
												))}
											</span>
										</span>
									}
									index={index}
									key={choice.value}
									label={choice.label}
									onSelect={() => botAvatar.setPalette(choice.value)}
									selected={mounted && botAvatar.palette === choice.value}
								/>
							))}
						</RadioGroup>
					}
					description="Choose colors for Bot avatars across the app. Saved in this browser."
					label="Bot avatar colors"
					layout="stacked"
					showDivider
				/>
				<SettingsRow
					control={
						<Switch
							aria-label="Animate Bot avatars"
							checked={botAvatar.motionEnabled}
							onCheckedChange={botAvatar.setMotionEnabled}
						/>
					}
					description="Animate Bot avatars while they work and when you interact with them. Saved in this browser."
					label="Animate Bot avatars"
				/>
			</section>
		</>
	);
}

function SidebarDisplayPreview(input: { display: SidebarDisplay }) {
	return (
		<span
			aria-hidden="true"
			className="flex h-20 w-full overflow-hidden rounded-lg border border-border bg-background"
			data-sidebar-display-preview={input.display}
		>
			<span
				className={`flex shrink-0 flex-col items-center justify-center gap-1 bg-muted/60 py-1 ${input.display === "icons-only" ? "w-8" : "w-12"}`}
			>
				{[
					{ icon: TrayIcon, label: "Inbox" },
					{ icon: ChatCircleTextIcon, label: "Spaces" },
					{ icon: UsersThreeIcon, label: "Team" },
				].map(({ icon: Icon, label }) => (
					<span className="flex flex-col items-center gap-0.5" key={label}>
						<Icon className="size-3 text-muted-foreground" />
						<span
							className={
								input.display === "icons-only"
									? "hidden"
									: "text-[6px] text-muted-foreground leading-none"
							}
						>
							{label}
						</span>
					</span>
				))}
			</span>
			<span className="flex min-w-0 flex-1 flex-col gap-2 p-3">
				<span className="h-2 w-1/2 rounded-sm bg-muted-foreground/25" />
				<span className="h-2 w-4/5 rounded-sm bg-muted-foreground/15" />
				<span className="mt-auto h-4 rounded-md border border-border bg-muted/40" />
			</span>
		</span>
	);
}

function CornerStylePreview(input: { shape: ShapeVariant }) {
	const previewStyle = {
		"--radius": `${
			input.shape === "rounded" ? DEFAULT_ROUNDED_SHAPE_RADIUS_PX : 0
		}px`,
	} as CSSProperties;

	return (
		<span
			aria-hidden="true"
			className="flex h-20 w-full gap-2 overflow-hidden rounded-lg border border-border bg-background p-2"
			data-corner-style-preview={input.shape}
			style={previewStyle}
		>
			<span className="w-5 shrink-0 rounded-md bg-muted" />
			<span className="flex min-w-0 flex-1 flex-col gap-1.5">
				<span className="h-2 w-1/2 rounded-sm bg-muted-foreground/25" />
				<span className="h-5 w-full rounded-md border border-border bg-muted/60" />
				<span className="mt-auto flex justify-end gap-1">
					<span className="h-4 w-8 rounded-md border border-border bg-background" />
					<span className="h-4 w-10 rounded-md bg-foreground/80" />
				</span>
			</span>
		</span>
	);
}
