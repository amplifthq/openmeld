"use client";

import type { MessageMentionType } from "@openmeld/schemas/types";
import { listSpaceMentionRelationChoices } from "@openmeld/space";
import {
	DropdownMenu,
	DropdownMenuRadioGroup,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import {
	FluidDropdownMenuContent,
	FluidDropdownMenuGroup,
	FluidDropdownMenuRadioItem,
} from "@openmeld/ui/fluid/dropdown-menu";
import type { StatusTone } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import {
	CaretDownIcon,
	SpinnerGapIcon,
	UsersIcon,
	XIcon,
} from "@phosphor-icons/react";
import { MentionInputPlugin, MentionPlugin } from "@platejs/mention/react";
import { MotionConfig } from "framer-motion";
import { PathApi, type TElement, TextApi } from "platejs";
import {
	createPlatePlugin,
	ParagraphPlugin,
	Plate,
	type PlateEditor,
	PlateElement,
	type PlateElementProps,
	useEditorRef,
	usePlateEditor,
} from "platejs/react";
import {
	type ClipboardEvent,
	createContext,
	type DragEvent,
	type FocusEventHandler,
	type KeyboardEvent,
	type MutableRefObject,
	type ReactNode,
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	groupSpaceAgentRequestMentionItems,
	type SpaceAgentRequestMentionAvailability,
	type SpaceAgentRequestMentionItem,
	type SpaceAgentRequestMentions,
} from "#/components/agent-access/space-agent-request-mentions";
import { Editor, EditorContainer } from "#/components/editor/ui/editor";
import {
	InlineCombobox,
	InlineComboboxCancel,
	InlineComboboxContent,
	InlineComboboxEmpty,
	InlineComboboxGroup,
	InlineComboboxGroupLabel,
	InlineComboboxInput,
	InlineComboboxItem,
} from "#/components/editor/ui/inline-combobox";
import { AgentProfileUsage } from "#/components/profiles/agent-profile-usage";
import type { ComposerDraftAuthoredMention } from "#/lib/composer-draft-storage";
import { recordReactUpdate } from "#/lib/observability/react-update-trace";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import {
	type MessageSendShortcut,
	resolveMessageEnterAction,
	useMessageSendShortcut,
} from "#/lib/spaces/message-send-shortcut";
import { useOptionalSpaceAgentProfileEditContext } from "./space-agent-profile-edit-context";
import { useSpaceProfileDetailsPopover } from "./use-space-profile-details-popover";
import "./space-wake-recommendation.css";
import { resolveSpaceMemberStatusBadgeDisplay } from "#/lib/spaces/presentation";
import { SpaceComposerAllMentionOptions } from "./space-composer-all-mention-options";
import { createSpaceComposerDeviceWait } from "./space-composer-device-wait";
import {
	createSpaceComposerEditorValue,
	createSpaceComposerPastedValue,
	getSpaceComposerEditorChildText,
	isSpaceComposerProfileElement,
	SPACE_COMPOSER_PROFILE_ELEMENT_TYPE,
	type SpaceComposerEditorValue,
	type SpaceComposerPasteTarget,
	type SpaceComposerProfileElement,
	serializeSpaceComposerEditorValue,
} from "./space-composer-editor-model";
import {
	getEditorFocusReadiness,
	SPACE_COMPOSER_FOCUS_RETRY_FRAMES,
} from "./space-composer-focus";
import { SpaceAgentAvailabilityIndicator } from "./space-member-inline-status-text";
import { resolveSpaceMemberStatusTone } from "./space-member-status-tone";
import { SpaceProfileIcon } from "./space-profile-icon";
import {
	SPACE_PROFILE_MENTION_NAME_CLASS_NAME,
	SPACE_PROFILE_MENTION_RELATION_CLASS_NAME,
	SPACE_PROFILE_MENTION_TOKEN_CLASS_NAME,
	SpaceProfileMentionIdentity,
} from "./space-profile-mention-token";
import { SpaceWakeSuggestionToken } from "./space-wake-suggestion-token";
import type {
	SpaceComposerAddressingTarget,
	SpaceComposerSelection,
	SpaceMentionPickerItem,
} from "./use-space-mention-authoring";
import { resolveDefaultSpaceComposerMentionRelation } from "./use-space-mention-authoring";

const SPACE_COMPOSER_MENTION_INPUT_TYPE = "mention_input";
const SPACE_COMPOSER_CLIPBOARD_TYPE =
	"application/x-openmeld-space-composer+json";

export type SpaceComposerEditorHandle = {
	focus: () => void;
	insertMentionTrigger: () => void;
	acceptWakeRecommendation?: (profileId: string) => void;
	setAgentMentionOnly?: (profileIds: readonly string[]) => void;
	selectTextRange: (selection: SpaceComposerSelection) => void;
};

export type SpaceComposerInputRef =
	MutableRefObject<SpaceComposerEditorHandle | null>;

export type SpaceComposerEditorChange = {
	restoredFromSignalId?: string;
	authoredMentions: ComposerDraftAuthoredMention[];
	selection: SpaceComposerSelection;
	text: string;
};

type SpaceComposerEditorProps = {
	// Colleagues' Agents outside the Space; choosing one asks its owner.
	agentRequestMentions?: SpaceAgentRequestMentions;
	renderAgentOptions?: (profileId: string) => ReactNode;
	addressingTargets: readonly SpaceComposerAddressingTarget[];
	ariaLabel: string;
	authoredMentions: readonly ComposerDraftAuthoredMention[];
	centerAgentProfileId?: string | null;
	composerRef?: SpaceComposerInputRef;
	disabled?: boolean;
	inline?: boolean;
	lockedWakeProfileIds?: readonly string[];
	maxHeight?: number;
	mentionPickerItems: readonly SpaceMentionPickerItem[];
	mentionEmptyMessage?: string;
	onChange: (change: SpaceComposerEditorChange) => void;
	onDragEnter?: (event: DragEvent<HTMLDivElement>) => void;
	onDragLeave?: (event: DragEvent<HTMLDivElement>) => void;
	onDragOver?: (event: DragEvent<HTMLDivElement>) => void;
	onDrop?: (event: DragEvent<HTMLDivElement>) => void;
	onBlur?: FocusEventHandler<HTMLDivElement>;
	onFocus?: FocusEventHandler<HTMLDivElement>;
	onPaste?: (event: ClipboardEvent<HTMLDivElement>) => void;
	onSend: () => void;
	onCancel?: () => void;
	wakeRecommendation?: {
		profileId: string;
		onAccept: () => void;
		onDismiss: () => void;
	};
	placeholder: string;
	text: string;
};

type SpaceComposerEditorContextValue = Pick<
	SpaceComposerEditorProps,
	| "addressingTargets"
	| "agentRequestMentions"
	| "centerAgentProfileId"
	| "mentionPickerItems"
	| "mentionEmptyMessage"
	| "lockedWakeProfileIds"
	| "inline"
	| "wakeRecommendation"
	| "renderAgentOptions"
>;

const SpaceComposerEditorContext =
	createContext<SpaceComposerEditorContextValue | null>(null);

export const SpaceComposerEditorKit = [
	ParagraphPlugin.withComponent(SpaceComposerParagraphElement),
	MentionPlugin.configure({
		options: {
			insertSpaceAfterMention: true,
			trigger: "@",
			// Allow natural CJK sentences and punctuation without intercepting email addresses.
			triggerPreviousCharPattern:
				/^$|^[\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}，。！？；：、（）【】《》「」『』“”‘’,;:!?()[\]{}<>"']$/u,
		},
	}),
	MentionInputPlugin.withComponent(SpaceComposerMentionInput),
	createPlatePlugin({
		key: SPACE_COMPOSER_PROFILE_ELEMENT_TYPE,
		node: {
			component: SpaceComposerProfileToken,
			isElement: true,
			isInline: true,
			isMarkableVoid: true,
			isVoid: true,
		},
	}),
];

export function SpaceComposerEditor(input: SpaceComposerEditorProps) {
	const { shortcut } = useMessageSendShortcut();
	const [initialValue] = useState(() =>
		createSpaceComposerEditorValue({
			authoredMentions: input.authoredMentions,
			text: input.text,
		})
	);
	const editor = usePlateEditor({
		plugins: SpaceComposerEditorKit,
		value: initialValue,
	});
	const pendingExternalValueRef = useRef<{
		authoredMentions: readonly ComposerDraftAuthoredMention[];
		text: string;
	} | null>(null);
	const focusAnimationFrameRef = useRef<number | null>(null);
	const focusRetryFramesRemainingRef = useRef(0);
	const isMountedRef = useRef(false);
	const pendingFocusRef = useRef(false);
	const pendingFocusOwnerRef = useRef<Element | null>(null);
	const lastExternalValueRef = useRef({
		authoredMentions: input.authoredMentions,
		text: input.text,
	});
	const contextValue = useMemo(
		() => ({
			addressingTargets: input.addressingTargets,
			agentRequestMentions: input.agentRequestMentions,
			centerAgentProfileId: input.centerAgentProfileId,
			mentionPickerItems: input.mentionPickerItems,
			mentionEmptyMessage: input.mentionEmptyMessage,
			lockedWakeProfileIds: input.lockedWakeProfileIds,
			inline: input.inline,
			wakeRecommendation: input.wakeRecommendation,
			renderAgentOptions: input.renderAgentOptions,
		}),
		[
			input.addressingTargets,
			input.agentRequestMentions,
			input.centerAgentProfileId,
			input.mentionPickerItems,
			input.mentionEmptyMessage,
			input.lockedWakeProfileIds,
			input.inline,
			input.wakeRecommendation,
			input.renderAgentOptions,
		]
	);

	useLayoutEffect(() => {
		isMountedRef.current = true;
		return () => {
			isMountedRef.current = false;
			pendingFocusRef.current = false;
			focusRetryFramesRemainingRef.current = 0;
			if (focusAnimationFrameRef.current !== null) {
				window.cancelAnimationFrame(focusAnimationFrameRef.current);
				focusAnimationFrameRef.current = null;
			}
		};
	}, []);

	useLayoutEffect(() => {
		const lastExternalValue = lastExternalValueRef.current;
		if (
			lastExternalValue.text === input.text &&
			authoredMentionsEqual(
				lastExternalValue.authoredMentions,
				input.authoredMentions
			)
		) {
			return;
		}
		lastExternalValueRef.current = {
			authoredMentions: input.authoredMentions,
			text: input.text,
		};
		const current = serializeSpaceComposerEditorValue(editor.children);
		if (
			current.text === input.text &&
			authoredMentionsEqual(current.authoredMentions, input.authoredMentions)
		) {
			return;
		}

		pendingExternalValueRef.current = {
			authoredMentions: input.authoredMentions,
			text: input.text,
		};
		const wasFocused = editor.api.isFocused();
		recordReactUpdate("composer_editor_external_value");
		editor.tf.setValue(
			createSpaceComposerEditorValue({
				authoredMentions: input.authoredMentions,
				text: input.text,
			})
		);
		// Replacing the draft removes Slate's selection. Keep the caret in the
		// new draft only when this editor still owns focus (including a send).
		if (wasFocused) {
			editor.tf.select(editor.api.end([]));
		}
	}, [editor, input.authoredMentions, input.text]);

	useLayoutEffect(() => {
		if (!input.composerRef) {
			return;
		}
		// Slate retries focus with its own timer while operations are pending. An
		// externally restored draft can finish those operations before React has
		// registered the replacement text nodes, so wait for both facts here and
		// cancel the frame when this editor unmounts.
		const flushPendingFocus = () => {
			focusAnimationFrameRef.current = null;
			if (!(isMountedRef.current && pendingFocusRef.current)) {
				return;
			}
			if (document.activeElement !== pendingFocusOwnerRef.current) {
				pendingFocusRef.current = false;
				return;
			}
			const readiness = getEditorFocusReadiness(
				editor,
				focusRetryFramesRemainingRef.current
			);
			if (readiness === "retry") {
				focusRetryFramesRemainingRef.current -= 1;
				focusAnimationFrameRef.current =
					window.requestAnimationFrame(flushPendingFocus);
				return;
			}
			pendingFocusRef.current = false;
			focusRetryFramesRemainingRef.current = 0;
			if (readiness === "focus") {
				editor.tf.focus();
			}
		};
		const focusWhenReady = () => {
			pendingFocusOwnerRef.current = document.activeElement;
			const readiness = getEditorFocusReadiness(
				editor,
				SPACE_COMPOSER_FOCUS_RETRY_FRAMES
			);
			if (readiness === "retry") {
				pendingFocusRef.current = true;
				focusRetryFramesRemainingRef.current =
					SPACE_COMPOSER_FOCUS_RETRY_FRAMES - 1;
				if (focusAnimationFrameRef.current === null) {
					focusAnimationFrameRef.current =
						window.requestAnimationFrame(flushPendingFocus);
				}
				return;
			}
			pendingFocusRef.current = false;
			focusRetryFramesRemainingRef.current = 0;
			if (readiness === "focus") {
				editor.tf.focus();
			}
		};

		const composerHandle: SpaceComposerEditorHandle = {
			setAgentMentionOnly: (profileIds) => {
				applyComposerReferenceTargets(
					editor,
					input.mentionPickerItems,
					profileIds
				);
				focusWhenReady();
			},
			focus: () => {
				focusEditorAtSelection(editor, focusWhenReady);
			},
			insertMentionTrigger: () => {
				focusEditorAtSelection(editor, focusWhenReady);
				// The toolbar opens the picker even after a word. Typed @ keeps
				// the plugin's whitespace rule, so email addresses stay plain text.
				const start = editor.selection && editor.api.start(editor.selection);
				const before = start && editor.api.before(start);
				const previousChar =
					before && start
						? editor.api.string({ anchor: before, focus: start })
						: "";
				if (previousChar.trim().length > 0) {
					editor.tf.insertText(" ");
				}
				editor.tf.insertText("@");
			},
			selectTextRange: (selection) => {
				const value = editor.children as SpaceComposerEditorValue;
				editor.tf.select({
					anchor: resolvePointAtTextOffset(value, selection.start),
					focus: resolvePointAtTextOffset(value, selection.end),
				});
				focusWhenReady();
			},
			acceptWakeRecommendation: (profileId) => {
				const item = input.mentionPickerItems.find(
					(candidate) => candidate.suggestion.profileId === profileId
				);
				if (
					!item?.suggestion.allowedRelations.wake ||
					item.suggestion.wakeAvailability.status !== "ready"
				) {
					return;
				}
				editor.tf.select(editor.api.start([]));
				insertProfile(editor, item, true);
				focusWhenReady();
			},
		};
		input.composerRef.current = composerHandle;

		return () => {
			if (input.composerRef?.current === composerHandle) {
				input.composerRef.current = null;
			}
		};
	}, [editor, input.composerRef, input.mentionPickerItems]);

	return (
		<SpaceComposerEditorContext.Provider value={contextValue}>
			<Plate
				editor={editor}
				onValueChange={({ editor: changedEditor }) => {
					const serialized = serializeSpaceComposerEditorValue(
						changedEditor.children
					);
					recordReactUpdate(
						serialized.text === input.text &&
							authoredMentionsEqual(
								serialized.authoredMentions,
								input.authoredMentions
							)
							? "composer_editor_change_equal"
							: "composer_editor_change_different"
					);
					const pendingExternalValue = pendingExternalValueRef.current;
					if (
						pendingExternalValue &&
						pendingExternalValue.text === serialized.text &&
						authoredMentionsEqual(
							pendingExternalValue.authoredMentions,
							serialized.authoredMentions
						)
					) {
						pendingExternalValueRef.current = null;
						return;
					}
					pendingExternalValueRef.current = null;
					input.onChange({
						...serialized,
						selection: resolveTextSelection(
							changedEditor,
							serialized.text.length
						),
					});
				}}
				readOnly={input.disabled}
			>
				<EditorContainer
					className="overflow-y-auto"
					style={{
						maxHeight: input.inline ? undefined : (input.maxHeight ?? 240),
					}}
				>
					<Editor
						aria-label={input.ariaLabel}
						aria-placeholder={
							input.wakeRecommendation ? undefined : input.placeholder
						}
						className={
							input.inline
								? "min-h-0 rounded-none p-0 content-space-message"
								: "min-h-11 px-1 py-2 text-sm leading-6"
						}
						disabled={input.disabled}
						onBlurCapture={input.onBlur}
						onCopyCapture={(event) => handleCopy(event, editor)}
						onDragEnterCapture={(event) =>
							handleDragCapture(event, input.onDragEnter)
						}
						onDragLeaveCapture={(event) =>
							handleDragCapture(event, input.onDragLeave)
						}
						onDragOverCapture={(event) =>
							handleDragCapture(event, input.onDragOver)
						}
						onDropCapture={(event) => handleDragCapture(event, input.onDrop)}
						onFocusCapture={input.onFocus}
						onKeyDownCapture={(event) => {
							const suggestion = input.wakeRecommendation;
							const choosingMention = editor.api.some({
								match: { type: SPACE_COMPOSER_MENTION_INPUT_TYPE },
							});
							if (
								suggestion &&
								!choosingMention &&
								!(event.target instanceof HTMLButtonElement) &&
								!event.nativeEvent.isComposing &&
								!event.altKey &&
								!event.ctrlKey &&
								!event.metaKey &&
								!event.shiftKey
							) {
								if (event.key === "Tab") {
									event.preventDefault();
									event.stopPropagation();
									suggestion.onAccept();
									return;
								}
								if (
									event.key === "Escape" ||
									(event.key === "Backspace" &&
										editor.api.isCollapsed() &&
										editor.api.isStart(editor.selection?.anchor, []))
								) {
									event.preventDefault();
									event.stopPropagation();
									suggestion.onDismiss();
									return;
								}
							}
							if (
								event.key === "Escape" &&
								input.onCancel &&
								!(event.target instanceof HTMLInputElement)
							) {
								event.stopPropagation();
								input.onCancel();
								return;
							}
							handleKeyDown(
								event,
								editor,
								input.onSend,
								input.inline ? "enter" : shortcut
							);
						}}
						onPasteCapture={(event) =>
							handlePaste(
								event,
								editor,
								input.mentionPickerItems,
								input.onPaste
							)
						}
						placeholder={
							input.wakeRecommendation ? undefined : input.placeholder
						}
						variant="none"
					/>
				</EditorContainer>
			</Plate>
		</SpaceComposerEditorContext.Provider>
	);
}

function applyComposerReferenceTargets(
	editor: PlateEditor,
	items: readonly SpaceMentionPickerItem[],
	profileIds: readonly string[]
): void {
	editor.tf.setNodes(
		{ relation: "reference" },
		{
			at: [],
			match: (node) =>
				isSpaceComposerProfileElement(node) &&
				profileIds.includes(node.profileId) &&
				node.relation === "wake",
		}
	);
	// A Direct Message's default recipient is implicit, not an editor node.
	// Make the user's opt-out visible and serialize the ordinary Reference.
	const existing = new Set(
		serializeSpaceComposerEditorValue(editor.children).authoredMentions.map(
			(mention) => mention.profileId
		)
	);
	for (const profileId of new Set(profileIds)) {
		if (existing.has(profileId)) {
			continue;
		}
		const item = items.find(
			(candidate) => candidate.suggestion.profileId === profileId
		);
		if (
			item?.suggestion.profileKind !== "agent" ||
			!item.suggestion.allowedRelations.reference
		) {
			continue;
		}
		editor.tf.select(editor.api.start([]));
		insertProfile(editor, item, false, "reference");
	}
}

function focusEditorAtSelection(
	editor: PlateEditor,
	focus: () => void = () => editor.tf.focus()
): void {
	const shouldSelectEnd = !editor.selection;
	focus();
	if (shouldSelectEnd) {
		const end = editor.api.end([]);
		if (end) {
			editor.tf.select(end);
		}
	}
}

function handleDragCapture(
	event: DragEvent<HTMLDivElement>,
	handler?: (event: DragEvent<HTMLDivElement>) => void
): void {
	handler?.(event);
	if (event.defaultPrevented) {
		event.stopPropagation();
	}
}

function SpaceComposerParagraphElement(props: PlateElementProps) {
	const context = useSpaceComposerEditorContext();
	const recommendation = context.wakeRecommendation;
	const candidate =
		recommendation && props.editor.children[0] === props.element
			? context.mentionPickerItems.find(
					(item) => item.suggestion.profileId === recommendation.profileId
				)
			: undefined;
	return (
		<PlateElement
			{...props}
			className={context.inline ? "m-0 min-h-0" : "m-0 min-h-6"}
		>
			{candidate && recommendation ? (
				<SpaceWakeSuggestionToken
					ghost
					isCenterAgent={
						candidate.suggestion.profileId === context.centerAgentProfileId
					}
					onAccept={recommendation.onAccept}
					onDismiss={recommendation.onDismiss}
					target={candidate}
				/>
			) : null}
			{props.children}
		</PlateElement>
	);
}

function composerRelationLabel(
	label: string,
	relation: string,
	target: SpaceComposerAddressingTarget | undefined,
	unavailableLabel?: string
) {
	if (relation === "reference") {
		return "Mention only";
	}
	if (relation === "wake" && target && createSpaceComposerDeviceWait(target)) {
		return "Wake when online";
	}
	if (
		relation === "wake" &&
		target?.agentWakeAvailability?.category === "offline" &&
		!target.agentWakeAvailability.isRefreshing
	) {
		return "Wake — Offline";
	}
	return unavailableLabel ? `${label} — ${unavailableLabel}` : label;
}

function resolveProfileTokenPresentation(
	editor: PlateEditor,
	element: SpaceComposerProfileElement,
	context: SpaceComposerEditorContextValue
) {
	const target = context.addressingTargets.find(
		(candidate) => candidate.profileId === element.profileId
	);
	const pickerItem = context.mentionPickerItems.find(
		(item) => item.suggestion.profileId === element.profileId
	);
	const profileName = target?.profileName ?? element.mentionText.slice(1);
	const profileKind =
		pickerItem?.suggestion.profileKind ??
		(element.relation === "mention" ? "human" : "agent");
	const choices = target
		? listSpaceMentionRelationChoices({
				allowedRelations: target.allowedRelations,
				primaryMentionLabel: target.primaryMentionLabel,
				wakeAvailability: target.wakeAvailability,
			}).map((choice) =>
				choice.relation === "wake" && createSpaceComposerDeviceWait(target)
					? { ...choice, disabled: false }
					: choice
			)
		: [];
	const locked =
		element.relation === "wake" &&
		context.lockedWakeProfileIds?.includes(element.profileId);
	const isRepeatedAgent =
		profileKind === "agent" && isRepeatedProfileElement(editor, element);
	const isBlockedWake =
		profileKind === "agent" &&
		element.relation === "wake" &&
		!isRepeatedAgent &&
		!locked &&
		target?.wakeAvailability.status !== "ready" &&
		target?.wakeAvailability.status !== "preparing";
	return {
		target,
		pickerItem,
		profileName,
		profileKind,
		choices,
		locked,
		isRepeatedAgent,
		isBlockedWake,
	};
}

function SpaceComposerProfileToken(
	props: PlateElementProps<SpaceComposerProfileElement>
) {
	const { editor, element } = props;
	// Moving focus into the portaled menu must not move the draft's caret.
	const relationSelection = useRef(editor.selection);
	const context = useSpaceComposerEditorContext();
	if (element.audience) {
		return (
			<PlateElement {...props} as="span">
				<span
					className={cn(
						SPACE_PROFILE_MENTION_TOKEN_CLASS_NAME,
						"group/profile-token relative content-space-message focus-within:ring-2 focus-within:ring-ring"
					)}
					contentEditable={false}
					data-mention-text={element.mentionText}
					data-testid="space-composer-audience-token"
				>
					<UsersIcon aria-hidden="true" className="size-3.5 shrink-0" />
					<span className={SPACE_PROFILE_MENTION_NAME_CLASS_NAME}>
						{element.mentionText}
					</span>
					<button
						aria-label={`Remove ${element.mentionText} from message`}
						className="pointer-events-none absolute -top-2 -right-2 z-10 inline-flex size-5 items-center justify-center rounded-full bg-popover text-muted-foreground opacity-0 shadow-sm ring-1 ring-border transition-opacity duration-100 ease-out hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-focus-within/profile-token:pointer-events-auto group-focus-within/profile-token:opacity-100 group-hover/profile-token:pointer-events-auto group-hover/profile-token:opacity-100 motion-reduce:transition-none [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
						onClick={(event) => {
							event.stopPropagation();
							removeSpaceComposerToken(editor, element);
						}}
						onMouseDown={(event) => {
							event.preventDefault();
							event.stopPropagation();
						}}
						type="button"
					>
						<XIcon aria-hidden="true" className="size-3" />
					</button>
				</span>
				{props.children}
			</PlateElement>
		);
	}
	const {
		target,
		pickerItem,
		profileName,
		profileKind,
		choices,
		locked,
		isRepeatedAgent,
		isBlockedWake,
	} = resolveProfileTokenPresentation(editor, element, context);
	let relationControl: ReactNode = null;
	if (locked) {
		relationControl = (
			<span className={SPACE_PROFILE_MENTION_RELATION_CLASS_NAME}>Wake</span>
		);
	} else if (
		profileKind === "agent" &&
		choices.length > 0 &&
		!isRepeatedAgent
	) {
		const selectedRelationLabel =
			choices.find((choice) => choice.relation === element.relation)?.label ??
			(element.relation === "wake" ? "Wake" : "Mention only");
		relationControl = (
			<MotionConfig reducedMotion="user">
				<DropdownMenu>
					<DropdownMenuTrigger
						aria-label={`Change relation for ${profileName}`}
						className={cn(
							SPACE_PROFILE_MENTION_RELATION_CLASS_NAME,
							"inline-flex h-5 items-center gap-1 border-l bg-transparent"
						)}
						onClickCapture={() => {
							relationSelection.current = editor.selection;
						}}
						onKeyDownCapture={() => {
							relationSelection.current = editor.selection;
						}}
						onMouseDown={(event) => event.preventDefault()}
					>
						{composerRelationLabel(
							selectedRelationLabel,
							element.relation,
							target
						)}
						{element.relation === "wake" &&
						(target?.wakeAvailability.status === "preparing" ||
							(isBlockedWake &&
								!target?.wakeAvailability.reasonCodes.length)) ? (
							<ComposerWakeChecking key={element.profileId} />
						) : null}
						<CaretDownIcon aria-hidden="true" className="size-3" />
					</DropdownMenuTrigger>
					<FluidDropdownMenuContent
						align="end"
						className="min-w-64"
						finalFocus={() => {
							const selection =
								editor.selection ??
								relationSelection.current ??
								editor.api.end([]);
							editor.tf.focus();
							if (selection) {
								editor.tf.select(selection);
							}
							return false;
						}}
						side="top"
					>
						<FluidDropdownMenuGroup>
							<DropdownMenuRadioGroup
								onValueChange={(value) => {
									if (
										!choices.some(
											(choice) => choice.relation === value && !choice.disabled
										)
									) {
										return;
									}
									const path = editor.api.findPath(element);
									if (path) {
										editor.tf.setNodes(
											{ relation: value as MessageMentionType },
											{ at: path }
										);
									}
								}}
								value={element.relation}
							>
								{choices.map((choice, index) => (
									<FluidDropdownMenuRadioItem
										closeOnClick
										disabled={choice.disabled}
										index={index}
										key={choice.relation}
										value={choice.relation}
									>
										{composerRelationLabel(
											choice.label,
											choice.relation,
											target,
											choice.disabled
												? resolveComposerUnavailableLabel(pickerItem)
												: undefined
										)}
										{choice.relation === "reference" ? (
											<span className="text-muted-foreground">
												{" "}
												— Won’t wake the agent
											</span>
										) : null}
									</FluidDropdownMenuRadioItem>
								))}
							</DropdownMenuRadioGroup>
						</FluidDropdownMenuGroup>
						{element.relation === "wake"
							? context.renderAgentOptions?.(element.profileId)
							: null}
					</FluidDropdownMenuContent>
				</DropdownMenu>
			</MotionConfig>
		);
	} else if (isRepeatedAgent) {
		relationControl = (
			<span className={SPACE_PROFILE_MENTION_RELATION_CLASS_NAME}>
				Mention only
			</span>
		);
	}

	return (
		<PlateElement {...props} as="span">
			<span
				className={cn(
					SPACE_PROFILE_MENTION_TOKEN_CLASS_NAME,
					"group/profile-token relative content-space-message focus-within:ring-2 focus-within:ring-ring",
					isBlockedWake && "text-muted-foreground"
				)}
				contentEditable={false}
				data-mention-text={element.mentionText}
				data-testid="space-composer-profile-token"
				data-wake-confirmed={element.wakeRecommendationAccepted || undefined}
			>
				<SpaceProfileMentionIdentity
					muted={isBlockedWake}
					profile={{
						agentControllerRef:
							pickerItem?.memberEntry.agentControllerRef ?? null,
						avatarImageUrl: pickerItem?.memberEntry.avatarUrl ?? null,
						avatarStyle: pickerItem?.memberEntry.avatarStyle,
						avatarModelId: pickerItem?.memberEntry.avatarModelId,
						isCenterAgent: element.profileId === context.centerAgentProfileId,
						profileId: element.profileId,
						profileKind,
						profileName,
					}}
				>
					<SpaceComposerProfileName
						pickerItem={pickerItem}
						profileName={profileName}
					/>
				</SpaceProfileMentionIdentity>
				{relationControl}
				{locked ? null : (
					<button
						aria-label={`Remove ${profileName} from message`}
						className="pointer-events-none absolute -top-2 -right-2 z-10 inline-flex size-5 items-center justify-center rounded-full bg-popover text-muted-foreground opacity-0 shadow-sm ring-1 ring-border transition-opacity duration-100 ease-out hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-focus-within/profile-token:pointer-events-auto group-focus-within/profile-token:opacity-100 group-hover/profile-token:pointer-events-auto group-hover/profile-token:opacity-100 motion-reduce:transition-none [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
						onClick={(event) => {
							event.stopPropagation();
							removeSpaceComposerToken(editor, element);
						}}
						onMouseDown={(event) => {
							event.preventDefault();
							event.stopPropagation();
						}}
						type="button"
					>
						<XIcon aria-hidden="true" className="size-3" />
					</button>
				)}
			</span>
			{props.children}
		</PlateElement>
	);
}

function removeSpaceComposerToken(
	editor: PlateEditor,
	element: SpaceComposerProfileElement
): void {
	const path = editor.api.findPath(element);
	if (!path) {
		return;
	}
	const nextPath = PathApi.next(path);
	const nextNode = (editor.children as SpaceComposerEditorValue)[nextPath[0]]
		?.children[nextPath[1] ?? 0];

	editor.tf.withoutNormalizing(() => {
		if (nextNode && TextApi.isText(nextNode) && nextNode.text.startsWith(" ")) {
			editor.tf.delete({
				at: {
					anchor: { offset: 0, path: nextPath },
					focus: { offset: 1, path: nextPath },
				},
			});
		}
		editor.tf.removeNodes({ at: path });
	});
	editor.tf.focus();
}

function ComposerWakeChecking() {
	const [visible, setVisible] = useState(false);
	useEffect(() => {
		const timer = window.setTimeout(() => setVisible(true), 1000);
		return () => window.clearTimeout(timer);
	}, []);
	if (!visible) {
		return null;
	}
	return (
		<output aria-label="Checking availability">
			<SpinnerGapIcon
				aria-hidden="true"
				className="size-3 motion-safe:animate-spin motion-reduce:animate-none"
			/>
		</output>
	);
}

function SpaceComposerMentionInput(props: PlateElementProps<TElement>) {
	const { element } = props;
	const context = useSpaceComposerEditorContext();
	const agentItems = context.mentionPickerItems.filter(
		(item) => item.suggestion.profileKind === "agent"
	);
	const humanItems = context.mentionPickerItems.filter(
		(item) => item.suggestion.profileKind === "human"
	);

	return (
		<PlateElement {...props} as="span">
			<InlineCombobox element={element} trigger="@">
				<span className="inline-flex rounded bg-muted px-1">
					<InlineComboboxInput aria-label="Find a member to mention" />
				</span>
				<InlineComboboxContent
					aria-label="Member options"
					className="w-[min(24rem,calc(100vw-1.5rem))]"
				>
					<InlineComboboxCancel label="Close mentions" />
					<SpaceComposerAllMentionOptions
						suggestions={context.mentionPickerItems.map(
							(item) => item.suggestion
						)}
					/>
					<InlineComboboxEmpty>
						{context.mentionEmptyMessage ?? "No matching members"}
					</InlineComboboxEmpty>
					<SpaceComposerMentionGroup items={agentItems} title="Agents" />
					<SpaceComposerMentionGroup items={humanItems} title="People" />
					<SpaceComposerAgentRequestGroups />
				</InlineComboboxContent>
			</InlineCombobox>
			{props.children}
		</PlateElement>
	);
}

function SpaceComposerProfileName({
	pickerItem,
	profileName,
}: {
	pickerItem: SpaceMentionPickerItem | undefined;
	profileName: string;
}) {
	const context = useSpaceComposerEditorContext();
	const organization = useOptionalAppOrganization();
	const profileContext = useOptionalSpaceAgentProfileEditContext();
	const { profileDetailsPopoverTrigger } = useSpaceProfileDetailsPopover({
		centerAgentProfileId: context.centerAgentProfileId,
		currentOwnerUserId: organization?.currentUserId ?? null,
		entry: pickerItem?.memberEntry ?? null,
		modelCatalog: profileContext?.modelCatalog ?? null,
		orgSlug: organization?.currentOrganization.slug,
	});
	const trigger = (
		<button
			aria-label={`View ${profileName}'s profile`}
			className={cn(SPACE_PROFILE_MENTION_NAME_CLASS_NAME, "outline-none")}
			data-slot="space-composer-profile-token-name"
			onMouseDown={(event) => event.preventDefault()}
			type="button"
		>
			{profileName}
		</button>
	);
	return (
		<>
			{profileDetailsPopoverTrigger ? (
				profileDetailsPopoverTrigger(trigger)
			) : (
				<span
					className={SPACE_PROFILE_MENTION_NAME_CLASS_NAME}
					data-slot="space-composer-profile-token-name"
				>
					{profileName}
				</span>
			)}
			{pickerItem?.suggestion.profileKind === "agent" &&
			pickerItem.suggestion.profileId !== context.centerAgentProfileId ? (
				<AgentProfileUsage profileId={pickerItem.suggestion.profileId} />
			) : null}
		</>
	);
}

function SpaceComposerMentionGroup(input: {
	items: readonly SpaceMentionPickerItem[];
	title: string;
}) {
	const context = useSpaceComposerEditorContext();
	const editor = useEditorRef();
	if (input.items.length === 0) {
		return null;
	}

	return (
		<InlineComboboxGroup>
			<InlineComboboxGroupLabel>{input.title}</InlineComboboxGroupLabel>
			{input.items.map((item) => (
				<InlineComboboxItem
					key={item.suggestion.profileId}
					keywords={[item.suggestion.primaryMentionLabel]}
					label={item.suggestion.profileName}
					onClick={() => insertProfile(editor, item)}
					value={item.suggestion.profileName}
				>
					<SpaceProfileIcon
						agentControllerRef={item.memberEntry.agentControllerRef}
						avatarImageUrl={item.memberEntry.avatarUrl}
						avatarModelId={item.memberEntry.avatarModelId}
						avatarStyle={item.memberEntry.avatarStyle}
						className="mr-2 size-5"
						isCenterAgent={
							item.suggestion.profileId === context.centerAgentProfileId
						}
						profileId={item.suggestion.profileId}
						profileKind={item.suggestion.profileKind}
						profileName={item.suggestion.profileName}
					/>
					<span className="flex min-w-0 flex-1 items-center gap-2 font-medium">
						<span className="truncate">{item.suggestion.profileName}</span>
						{item.suggestion.profileKind === "agent" ? (
							<ComposerAgentAvailability item={item} />
						) : null}
						{item.suggestion.profileKind === "agent" &&
						item.suggestion.profileId !== context.centerAgentProfileId ? (
							<AgentProfileUsage profileId={item.suggestion.profileId} />
						) : null}
					</span>
					<span className="ml-2 text-muted-foreground text-xs">
						{resolveMentionPickerRelationLabel(item)}
					</span>
				</InlineComboboxItem>
			))}
		</InlineComboboxGroup>
	);
}

/**
 * Colleagues' Agents outside this Space, under their owner. The name goes
 * in as text; sending the message asks the owner (§5, §7).
 */
function SpaceComposerAgentRequestGroups() {
	const requests = useSpaceComposerEditorContext().agentRequestMentions;
	const editor = useEditorRef();
	if (!requests || requests.items.length === 0) {
		return null;
	}
	return groupSpaceAgentRequestMentionItems(requests.items).map((group) => (
		<InlineComboboxGroup key={group.ownerUserId}>
			<InlineComboboxGroupLabel>
				{`${group.ownerName}'s Agents · not in this Space`}
			</InlineComboboxGroupLabel>
			{group.items.map((item) => (
				<InlineComboboxItem
					key={item.profileId}
					keywords={[item.ownerName, item.profileHandle ?? item.profileName]}
					label={item.profileName}
					onClick={() => {
						editor.tf.insertText(`@${item.mentionName} `);
						requests.onSelect(item);
					}}
					value={item.profileName}
				>
					<SpaceProfileIcon
						agentControllerRef={item.agentControllerRef}
						avatarImageUrl={item.avatarUrl}
						className="mr-2 size-5"
						profileId={item.profileId}
						profileKind="agent"
						profileName={item.profileName}
					/>
					<span className="flex min-w-0 flex-1 items-center gap-2 font-medium">
						<span className="truncate">{item.profileName}</span>
						{item.availability ? (
							<SpaceAgentRequestAvailability availability={item.availability} />
						) : null}
					</span>
					<span className="ml-2 text-muted-foreground text-xs">
						{resolveAgentRequestRelationLabel(item)}
					</span>
				</InlineComboboxItem>
			))}
		</InlineComboboxGroup>
	));
}

/**
 * Choosing an Agent here only asks its owner, so an unavailable one stays
 * selectable, but the row says it is unavailable in the shared wording
 * instead of promising a reply.
 */
export function resolveAgentRequestRelationLabel(
	item: Pick<SpaceAgentRequestMentionItem, "availability" | "ownerName">
): string {
	const availability = item.availability;
	if (
		!availability ||
		availability.status === "available_for_wake" ||
		availability.isRefreshing
	) {
		return `Asks ${item.ownerName}`;
	}
	return availability.badgeLabel;
}

const AGENT_REQUEST_AVAILABILITY_TONE: Record<
	SpaceAgentRequestMentionAvailability["category"],
	StatusTone
> = {
	available: "ready",
	checking: "checking",
	offline: "muted",
	unavailable: "warning",
};

function SpaceAgentRequestAvailability({
	availability,
}: {
	availability: SpaceAgentRequestMentionAvailability;
}) {
	const label = availability.isRefreshing
		? "Checking"
		: availability.badgeLabel;
	return (
		<SpaceAgentAvailabilityIndicator
			action={availability.action}
			category={availability.category}
			isRefreshing={availability.isRefreshing}
			label={label}
			phase={availability.phase}
			reasonCode={availability.reasonCode}
			tone={
				availability.isRefreshing
					? "checking"
					: AGENT_REQUEST_AVAILABILITY_TONE[availability.category]
			}
			tooltip={availability.isRefreshing ? "Checking" : availability.tooltip}
		/>
	);
}

function resolveComposerUnavailableLabel(
	item: SpaceMentionPickerItem | undefined
): string {
	if (item?.memberEntry.availabilityIsRefreshing) {
		return "Checking";
	}
	const display = item
		? resolveSpaceMemberStatusBadgeDisplay(item.memberEntry)
		: null;
	if (display?.isRefreshing) {
		return "Checking";
	}
	const label = display?.label;
	return label && !["Available", "Connect"].includes(label)
		? label
		: "Unavailable";
}

function ComposerAgentAvailability({ item }: { item: SpaceMentionPickerItem }) {
	const entry = item.memberEntry;
	const display = resolveSpaceMemberStatusBadgeDisplay(entry);
	const isRefreshing = entry.availabilityIsRefreshing || display?.isRefreshing;
	const label =
		display?.label === "Connect"
			? "Unavailable"
			: (display?.label ?? "Unavailable");
	return (
		<SpaceAgentAvailabilityIndicator
			category={entry.availabilityCategory}
			isRefreshing={isRefreshing}
			label={isRefreshing ? "Checking" : label}
			phase={entry.availabilityPhase}
			reasonCode={entry.availabilityReasonCode}
			tone={resolveSpaceMemberStatusTone(entry)}
			tooltip={isRefreshing ? "Checking" : label}
		/>
	);
}

function resolveMentionPickerRelationLabel(
	item: SpaceMentionPickerItem
): string {
	const { suggestion, agentMember } = item;
	const relation = resolveDefaultSpaceComposerMentionRelation(
		suggestion,
		agentMember
	);
	if (relation === "reference") {
		return "Mention only";
	}
	if (
		relation === "wake" &&
		agentMember &&
		createSpaceComposerDeviceWait(agentMember)
	) {
		return "Wake when online";
	}
	return suggestion.profileKind === "human" ? "Mention" : "Wake";
}

function insertProfile(
	editor: PlateEditor,
	item: SpaceMentionPickerItem,
	wakeRecommendationAccepted = false,
	relationOverride?: "reference"
): void {
	const relation =
		relationOverride ??
		resolveDefaultSpaceComposerMentionRelation(
			item.suggestion,
			item.agentMember
		);
	if (!relation) {
		return;
	}
	const mentionText = `@${item.suggestion.profileName}`;
	const existing = serializeSpaceComposerEditorValue(
		editor.children
	).authoredMentions.some(
		(mention) => mention.profileId === item.suggestion.profileId
	);
	const resolvedRelation =
		existing &&
		item.suggestion.profileKind === "agent" &&
		item.suggestion.allowedRelations.reference
			? "reference"
			: relation;

	editor.tf.insertNodes({
		children: [{ text: "" }],
		mentionText,
		wakeRecommendationAccepted,
		profileId: item.suggestion.profileId,
		relation: resolvedRelation,
		type: SPACE_COMPOSER_PROFILE_ELEMENT_TYPE,
	});
	editor.tf.move({ unit: "offset" });
	editor.tf.insertText(" ");
}

function handleKeyDown(
	event: KeyboardEvent<HTMLDivElement>,
	editor: PlateEditor,
	onSend: () => void,
	shortcut: MessageSendShortcut
): void {
	if (
		event.target instanceof Element &&
		event.target.closest('button, select, [role="listbox"]')
	) {
		return;
	}
	const action = resolveMessageEnterAction(event.nativeEvent, shortcut);
	if (!action) {
		return;
	}
	if (event.shiftKey) {
		event.preventDefault();
		event.stopPropagation();
		editor.tf.insertBreak();
		return;
	}
	if (
		editor.api.some({
			at: [],
			match: (node) =>
				"type" in node && node.type === SPACE_COMPOSER_MENTION_INPUT_TYPE,
		})
	) {
		return;
	}

	event.preventDefault();
	event.stopPropagation();
	if (action === "newline") {
		editor.tf.insertBreak();
		return;
	}
	onSend();
}

function handlePaste(
	event: ClipboardEvent<HTMLDivElement>,
	editor: PlateEditor,
	mentionPickerItems: readonly SpaceMentionPickerItem[],
	onPaste?: (event: ClipboardEvent<HTMLDivElement>) => void
): void {
	onPaste?.(event);
	if (event.defaultPrevented || event.clipboardData.files.length > 0) {
		if (event.defaultPrevented) {
			event.stopPropagation();
		}
		return;
	}
	const text = event.clipboardData.getData("text/plain");
	if (!text) {
		return;
	}
	event.preventDefault();
	event.stopPropagation();
	if (!editor.selection) {
		focusEditorAtSelection(editor);
	}
	editor.tf.deleteFragment();
	const pastedValue = createSpaceComposerPastedValue({
		existingProfileIds: serializeSpaceComposerEditorValue(
			editor.children
		).authoredMentions.map((mention) => mention.profileId),
		preferredMentions: readSpaceComposerClipboardMentions(
			event.clipboardData,
			text
		),
		targets: buildSpaceComposerPasteTargets(mentionPickerItems),
		text,
	});
	insertSpaceComposerValue(editor, pastedValue);
}

function handleCopy(
	event: ClipboardEvent<HTMLDivElement>,
	editor: PlateEditor
): void {
	if (!editor.selection) {
		return;
	}
	const fragment = editor.api.fragment(editor.selection);
	if (fragment.length === 0) {
		return;
	}
	const blocks = fragment.every(
		(node) => "children" in node && Array.isArray(node.children)
	)
		? (fragment as TElement[])
		: [{ children: fragment, type: "p" } as TElement];
	const serialized = serializeSpaceComposerEditorValue(blocks);
	event.preventDefault();
	event.stopPropagation();
	event.clipboardData.setData("text/plain", serialized.text);
	if (serialized.authoredMentions.length > 0) {
		event.clipboardData.setData(
			SPACE_COMPOSER_CLIPBOARD_TYPE,
			JSON.stringify({ ...serialized, version: 1 })
		);
	}
}

function buildSpaceComposerPasteTargets(
	items: readonly SpaceMentionPickerItem[]
): SpaceComposerPasteTarget[] {
	return items.flatMap((item) => {
		const defaultRelation = resolveDefaultSpaceComposerMentionRelation(
			item.suggestion,
			item.agentMember
		);
		if (!defaultRelation) {
			return [];
		}
		return [
			{
				allowedRelations: item.suggestion.allowedRelations,
				defaultRelation,
				duplicateRelation:
					item.suggestion.profileKind === "agent" &&
					item.suggestion.allowedRelations.reference
						? "reference"
						: defaultRelation,
				mentionText: `@${item.suggestion.profileName}`,
				profileId: item.suggestion.profileId,
			},
		];
	});
}

function insertSpaceComposerValue(
	editor: PlateEditor,
	value: SpaceComposerEditorValue
): void {
	for (const child of value[0].children) {
		if (isSpaceComposerProfileElement(child)) {
			editor.tf.insertNodes(child);
			editor.tf.move({ unit: "offset" });
			continue;
		}
		editor.tf.insertText(child.text);
	}
}

function readSpaceComposerClipboardMentions(
	clipboardData: DataTransfer,
	text: string
): ComposerDraftAuthoredMention[] {
	const serialized = clipboardData.getData(SPACE_COMPOSER_CLIPBOARD_TYPE);
	if (!serialized) {
		return [];
	}
	try {
		const value: unknown = JSON.parse(serialized);
		if (!(value && typeof value === "object")) {
			return [];
		}
		const payload = value as {
			authoredMentions?: unknown;
			text?: unknown;
			version?: unknown;
		};
		if (
			payload.version !== 1 ||
			payload.text !== text ||
			!Array.isArray(payload.authoredMentions)
		) {
			return [];
		}
		return payload.authoredMentions.filter(isComposerClipboardMention);
	} catch {
		return [];
	}
}

function isComposerClipboardMention(
	value: unknown
): value is ComposerDraftAuthoredMention {
	if (!(value && typeof value === "object")) {
		return false;
	}
	const mention = value as Partial<ComposerDraftAuthoredMention>;
	return (
		(mention.audience === undefined ||
			mention.audience === "people" ||
			mention.audience === "agents" ||
			mention.audience === "both") &&
		typeof mention.profileId === "string" &&
		typeof mention.text === "string" &&
		Number.isSafeInteger(mention.start) &&
		Number.isSafeInteger(mention.end) &&
		(mention.start ?? -1) >= 0 &&
		(mention.end ?? 0) > (mention.start ?? -1) &&
		(mention.relation === "mention" ||
			mention.relation === "reference" ||
			mention.relation === "wake")
	);
}

function isRepeatedProfileElement(
	editor: PlateEditor,
	element: SpaceComposerProfileElement
): boolean {
	const path = editor.api.findPath(element);
	if (!path) {
		return false;
	}
	const value = editor.children as SpaceComposerEditorValue;
	for (let blockIndex = 0; blockIndex <= (path[0] ?? 0); blockIndex += 1) {
		const block = value[blockIndex];
		if (!block) {
			continue;
		}
		const childLimit =
			blockIndex === path[0] ? (path[1] ?? 0) : block.children.length;
		for (let childIndex = 0; childIndex < childLimit; childIndex += 1) {
			const child = block.children[childIndex];
			if (
				isSpaceComposerProfileElement(child) &&
				child.profileId === element.profileId
			) {
				return true;
			}
		}
	}
	return false;
}

function resolveTextSelection(
	editor: PlateEditor,
	fallbackOffset: number
): SpaceComposerSelection {
	if (!editor.selection) {
		return { end: fallbackOffset, start: fallbackOffset };
	}
	const value = editor.children as SpaceComposerEditorValue;
	return {
		end: resolveTextOffsetAtPoint(
			value,
			editor.selection.focus.path,
			editor.selection.focus.offset
		),
		start: resolveTextOffsetAtPoint(
			value,
			editor.selection.anchor.path,
			editor.selection.anchor.offset
		),
	};
}

function resolveTextOffsetAtPoint(
	value: SpaceComposerEditorValue,
	path: readonly number[],
	pointOffset: number
): number {
	let offset = 0;
	const blockIndex = path[0] ?? 0;
	for (let index = 0; index < blockIndex; index += 1) {
		const precedingBlock = value[index];
		if (precedingBlock) {
			offset +=
				serializeSpaceComposerEditorValue([precedingBlock]).text.length + 1;
		}
	}
	const block = value[blockIndex] ?? value[0];
	const childIndex = path[1] ?? 0;
	for (let index = 0; index < childIndex; index += 1) {
		const child = block.children[index];
		offset += getSpaceComposerEditorChildText(child).length;
	}
	const child = block.children[childIndex];
	if (child && "text" in child && !isSpaceComposerProfileElement(child)) {
		offset += Math.min(pointOffset, child.text.length);
	}
	return offset;
}

function resolvePointAtTextOffset(
	value: SpaceComposerEditorValue,
	targetOffset: number
): { offset: number; path: number[] } {
	let offset = 0;
	for (let blockIndex = 0; blockIndex < value.length; blockIndex += 1) {
		const block = value[blockIndex];
		if (!block) {
			continue;
		}
		for (
			let childIndex = 0;
			childIndex < block.children.length;
			childIndex += 1
		) {
			const child = block.children[childIndex];
			if (!child) {
				continue;
			}
			const length = getSpaceComposerEditorChildText(child).length;
			if (isSpaceComposerProfileElement(child) && targetOffset <= offset) {
				return {
					offset: 0,
					path: [blockIndex, childIndex, 0],
				};
			}
			if ("text" in child && targetOffset <= offset + length) {
				return {
					offset: Math.max(0, targetOffset - offset),
					path: [blockIndex, childIndex],
				};
			}
			offset += length;
		}
		offset += 1;
	}

	const lastBlockIndex = value.length - 1;
	const lastBlock = value.at(-1) ?? value[0];
	const lastChildIndex = lastBlock.children.length - 1;
	const lastChild = lastBlock.children.at(-1) ?? { text: "" };
	return "text" in lastChild && typeof lastChild.text === "string"
		? {
				offset: lastChild.text.length,
				path: [lastBlockIndex, lastChildIndex],
			}
		: { offset: 0, path: [lastBlockIndex, lastChildIndex, 0] };
}

function authoredMentionsEqual(
	left: readonly ComposerDraftAuthoredMention[],
	right: readonly ComposerDraftAuthoredMention[]
): boolean {
	return (
		left.length === right.length &&
		left.every((mention, index) => {
			const candidate = right[index];
			return (
				candidate?.audience === mention.audience &&
				candidate?.end === mention.end &&
				candidate.profileId === mention.profileId &&
				candidate.relation === mention.relation &&
				candidate.start === mention.start &&
				candidate.text === mention.text
			);
		})
	);
}

function useSpaceComposerEditorContext(): SpaceComposerEditorContextValue {
	const context = useContext(SpaceComposerEditorContext);
	if (!context) {
		throw new Error("Space Composer editor context is missing.");
	}
	return context;
}
