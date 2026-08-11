"use client";

import { SettingsRow } from "@openmeld/ui/components/settings-row";
import { RadioGroup, RadioItem } from "@openmeld/ui/fluid/radio-group";
import {
	DEFAULT_ROUNDED_SHAPE_RADIUS_PX,
	type ShapeVariant,
	useShapeContext,
} from "@openmeld/ui/lib/shape-context";
import { DesktopIcon, MoonIcon, SunDimIcon } from "@phosphor-icons/react";
import { useTheme } from "next-themes";
import {
	type CSSProperties,
	type ReactNode,
	useState,
	useSyncExternalStore,
} from "react";
import { AppPageHeader } from "#/components/app/app-page-header";
import {
	readSpaceConversationLayoutPreference,
	type SpaceConversationLayout,
	writeSpaceConversationLayoutPreference,
} from "#/lib/spaces/conversation-layout-preference";
import {
	readSpaceSelfMessageAlignmentPreference,
	type SpaceSelfMessageAlignment,
	writeSpaceSelfMessageAlignmentPreference,
} from "#/lib/spaces/self-message-alignment-preference";

type ThemeChoice = {
	description: string;
	icon: ReactNode;
	label: string;
	value: "dark" | "light" | "system";
};

const THEME_CHOICES: readonly ThemeChoice[] = [
	{
		description: "Use the light appearance.",
		icon: <SunDimIcon aria-hidden="true" className="size-4" />,
		label: "Light",
		value: "light",
	},
	{
		description: "Use the dark appearance.",
		icon: <MoonIcon aria-hidden="true" className="size-4" />,
		label: "Dark",
		value: "dark",
	},
	{
		description: "Follow your operating system appearance.",
		icon: <DesktopIcon aria-hidden="true" className="size-4" />,
		label: "System",
		value: "system",
	},
] as const;

type ShapeChoice = {
	description: string;
	label: string;
	value: ShapeVariant;
};

const SHAPE_CHOICES: readonly ShapeChoice[] = [
	{
		description: "Use sharp corners across controls and surfaces.",
		label: "Square",
		value: "square",
	},
	{
		description: "Use medium-rounded corners across controls and surfaces.",
		label: "Rounded",
		value: "rounded",
	},
] as const;

type ConversationLayoutChoice = {
	description: string;
	label: string;
	value: SpaceConversationLayout;
};

const CONVERSATION_LAYOUT_CHOICES: readonly ConversationLayoutChoice[] = [
	{
		description: "Messages and the composer use all available space.",
		label: "Full width",
		value: "full-width",
	},
	{
		description: "Messages and the composer stay centered in a focused column.",
		label: "Centered",
		value: "centered",
	},
] as const;

type SelfMessageAlignmentChoice = {
	description: string;
	label: string;
	value: SpaceSelfMessageAlignment;
};

const SELF_MESSAGE_ALIGNMENT_CHOICES: readonly SelfMessageAlignmentChoice[] = [
	{
		description: "Your messages appear on the right, with actions on the left.",
		label: "Right",
		value: "right",
	},
	{
		description: "Your messages appear on the left, with actions on the right.",
		label: "Left",
		value: "left",
	},
] as const;

const subscribeToHydration = () => () => undefined;
const getClientHydrationSnapshot = () => true;
const getServerHydrationSnapshot = () => false;

export function AppearanceSection() {
	const { setTheme, theme } = useTheme();
	const { setShape, shape } = useShapeContext();
	const mounted = useSyncExternalStore(
		subscribeToHydration,
		getClientHydrationSnapshot,
		getServerHydrationSnapshot
	);
	const [conversationLayout, setConversationLayout] =
		useState<SpaceConversationLayout>(() =>
			readSpaceConversationLayoutPreference()
		);
	const [selfMessageAlignment, setSelfMessageAlignment] =
		useState<SpaceSelfMessageAlignment>(() =>
			readSpaceSelfMessageAlignmentPreference()
		);

	const selectedIndex = mounted
		? THEME_CHOICES.findIndex((choice) => choice.value === theme)
		: -1;
	const selectedConversationLayoutIndex = mounted
		? CONVERSATION_LAYOUT_CHOICES.findIndex(
				(choice) => choice.value === conversationLayout
			)
		: -1;
	const selectedShapeIndex = mounted
		? SHAPE_CHOICES.findIndex((choice) => choice.value === shape)
		: -1;
	const selectedSelfMessageAlignmentIndex = mounted
		? SELF_MESSAGE_ALIGNMENT_CHOICES.findIndex(
				(choice) => choice.value === selfMessageAlignment
			)
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
							orientation="horizontal"
							selectedIndex={selectedIndex}
						>
							{THEME_CHOICES.map((choice, index) => (
								<RadioItem
									adornment={choice.icon}
									className="min-w-0 flex-1 px-3 py-2.5"
									description={choice.description}
									index={index}
									key={choice.value}
									label={choice.label}
									onSelect={() => {
										setTheme(choice.value);
									}}
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
							orientation="horizontal"
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
							aria-label="Conversation layout"
							className="w-full"
							orientation="horizontal"
							selectedIndex={selectedConversationLayoutIndex}
						>
							{CONVERSATION_LAYOUT_CHOICES.map((choice, index) => (
								<RadioItem
									className="min-w-0 flex-1 px-3 py-3"
									description={
										<span className="flex min-w-0 flex-col gap-2">
											<span>{choice.description}</span>
											<ConversationLayoutPreview layout={choice.value} />
										</span>
									}
									index={index}
									key={choice.value}
									label={choice.label}
									onSelect={() => {
										writeSpaceConversationLayoutPreference(choice.value);
										setConversationLayout(choice.value);
									}}
									selected={mounted && conversationLayout === choice.value}
								/>
							))}
						</RadioGroup>
					}
					description="Applies to every Space and Center Agent conversation. Saved in this browser."
					label="Conversation layout"
					layout="stacked"
					showDivider
				/>
				<SettingsRow
					control={
						<RadioGroup
							aria-label="Your messages"
							className="w-full"
							orientation="horizontal"
							selectedIndex={selectedSelfMessageAlignmentIndex}
						>
							{SELF_MESSAGE_ALIGNMENT_CHOICES.map((choice, index) => (
								<RadioItem
									className="min-w-0 flex-1 px-3 py-3"
									description={
										<span className="flex min-w-0 flex-col gap-2">
											<span>{choice.description}</span>
											<SelfMessageAlignmentPreview alignment={choice.value} />
										</span>
									}
									index={index}
									key={choice.value}
									label={choice.label}
									onSelect={() => {
										writeSpaceSelfMessageAlignmentPreference(choice.value);
										setSelfMessageAlignment(choice.value);
									}}
									selected={mounted && selfMessageAlignment === choice.value}
								/>
							))}
						</RadioGroup>
					}
					description="Choose which side your messages appear on. Applies to every Space and Center Agent conversation. Saved in this browser."
					label="Your messages"
					layout="stacked"
					showDivider={false}
				/>
			</section>
		</>
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

function SelfMessageAlignmentPreview(input: {
	alignment: SpaceSelfMessageAlignment;
}) {
	const selfAlignmentClassName =
		input.alignment === "left" ? "items-start" : "items-end";
	const actionsClassName = input.alignment === "left" ? "right-1" : "left-1";

	return (
		<span
			aria-hidden="true"
			className="flex h-20 w-full overflow-hidden border border-border bg-background p-2"
			data-self-message-alignment-preview={input.alignment}
		>
			<span className="flex min-w-0 flex-1 flex-col gap-1.5">
				<span className="h-2 w-1/2 bg-muted-foreground/25" />
				<span
					className={`relative flex w-full flex-col gap-1 ${selfAlignmentClassName}`}
				>
					<span className={`absolute top-0 flex gap-0.5 ${actionsClassName}`}>
						<span className="size-1 bg-muted-foreground/35" />
						<span className="size-1 bg-muted-foreground/35" />
						<span className="size-1 bg-muted-foreground/35" />
					</span>
					<span className="mt-2 h-3 w-3/4 border border-border bg-muted/60" />
					<span className="h-1.5 w-2/5 bg-destructive/30" />
				</span>
			</span>
		</span>
	);
}

function ConversationLayoutPreview(input: { layout: SpaceConversationLayout }) {
	const conversationColumnClassName =
		input.layout === "centered" ? "mx-auto w-2/3" : "w-full";

	return (
		<span
			aria-hidden="true"
			className="flex h-20 w-full overflow-hidden border border-border bg-background"
			data-conversation-layout-preview={input.layout}
		>
			<span className="w-3 shrink-0 border-border border-r bg-muted/70" />
			<span className="flex min-w-0 flex-1 p-2">
				<span
					className={`flex min-w-0 flex-col gap-1.5 ${conversationColumnClassName}`}
				>
					<span className="h-1.5 w-3/5 bg-muted-foreground/30" />
					<span className="h-1.5 w-4/5 self-end bg-muted-foreground/20" />
					<span className="h-1.5 w-2/3 bg-muted-foreground/30" />
					<span className="mt-auto h-3 w-full border border-border bg-muted/60" />
				</span>
			</span>
			<span className="w-4 shrink-0 border-border border-l bg-muted/40" />
		</span>
	);
}
