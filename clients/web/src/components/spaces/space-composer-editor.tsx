"use client";

import type { MessageMentionType } from "@openmeld/schemas/types";
import { listSpaceMentionRelationChoices } from "@openmeld/space";
import { CaretDownIcon, XIcon } from "@phosphor-icons/react";
import { MentionInputPlugin, MentionPlugin } from "@platejs/mention/react";
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
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Editor, EditorContainer } from "#/components/editor/ui/editor";
import {
	InlineCombobox,
	InlineComboboxContent,
	InlineComboboxEmpty,
	InlineComboboxGroup,
	InlineComboboxGroupLabel,
	InlineComboboxInput,
	InlineComboboxItem,
} from "#/components/editor/ui/inline-combobox";
import type { ComposerDraftAuthoredMention } from "#/lib/composer-draft-storage";
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
import { SpaceProfileIcon } from "./space-profile-icon";
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
	selectTextRange: (selection: SpaceComposerSelection) => void;
};

export type SpaceComposerInputRef =
	MutableRefObject<SpaceComposerEditorHandle | null>;

export type SpaceComposerEditorChange = {
	authoredMentions: ComposerDraftAuthoredMention[];
	selection: SpaceComposerSelection;
	text: string;
};

type SpaceComposerEditorProps = {
	addressingTargets: readonly SpaceComposerAddressingTarget[];
	ariaLabel: string;
	authoredMentions: readonly ComposerDraftAuthoredMention[];
	centerAgentProfileId?: string | null;
	composerRef?: SpaceComposerInputRef;
	disabled?: boolean;
	maxHeight?: number;
	mentionPickerItems: readonly SpaceMentionPickerItem[];
	onChange: (change: SpaceComposerEditorChange) => void;
	onDragEnter?: (event: DragEvent<HTMLDivElement>) => void;
	onDragLeave?: (event: DragEvent<HTMLDivElement>) => void;
	onDragOver?: (event: DragEvent<HTMLDivElement>) => void;
	onDrop?: (event: DragEvent<HTMLDivElement>) => void;
	onBlur?: FocusEventHandler<HTMLDivElement>;
	onFocus?: FocusEventHandler<HTMLDivElement>;
	onPaste?: (event: ClipboardEvent<HTMLDivElement>) => void;
	onSend: () => void;
	placeholder: string;
	text: string;
};

type SpaceComposerEditorContextValue = Pick<
	SpaceComposerEditorProps,
	"addressingTargets" | "centerAgentProfileId" | "mentionPickerItems"
>;

const SpaceComposerEditorContext =
	createContext<SpaceComposerEditorContextValue | null>(null);

const SpaceComposerEditorKit = [
	ParagraphPlugin.withComponent(SpaceComposerParagraphElement),
	MentionPlugin.configure({
		options: {
			insertSpaceAfterMention: true,
			trigger: "@",
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
	const lastExternalValueRef = useRef({
		authoredMentions: input.authoredMentions,
		text: input.text,
	});
	const contextValue = useMemo(
		() => ({
			addressingTargets: input.addressingTargets,
			centerAgentProfileId: input.centerAgentProfileId,
			mentionPickerItems: input.mentionPickerItems,
		}),
		[
			input.addressingTargets,
			input.centerAgentProfileId,
			input.mentionPickerItems,
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
		editor.tf.setValue(
			createSpaceComposerEditorValue({
				authoredMentions: input.authoredMentions,
				text: input.text,
			})
		);
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
			focus: () => {
				focusEditorAtSelection(editor, focusWhenReady);
			},
			insertMentionTrigger: () => {
				focusEditorAtSelection(editor, focusWhenReady);
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
		};
		input.composerRef.current = composerHandle;

		return () => {
			if (input.composerRef?.current === composerHandle) {
				input.composerRef.current = null;
			}
		};
	}, [editor, input.composerRef]);

	return (
		<SpaceComposerEditorContext.Provider value={contextValue}>
			<Plate
				editor={editor}
				onChange={({ editor: changedEditor }) => {
					const serialized = serializeSpaceComposerEditorValue(
						changedEditor.children
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
					style={{ maxHeight: input.maxHeight ?? 240 }}
				>
					<Editor
						aria-label={input.ariaLabel}
						aria-placeholder={input.placeholder}
						className="min-h-11 px-1 py-2 text-sm leading-6"
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
						onKeyDownCapture={(event) =>
							handleKeyDown(event, editor, input.onSend)
						}
						onPasteCapture={(event) =>
							handlePaste(
								event,
								editor,
								input.mentionPickerItems,
								input.onPaste
							)
						}
						placeholder={input.placeholder}
						variant="none"
					/>
				</EditorContainer>
			</Plate>
		</SpaceComposerEditorContext.Provider>
	);
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
	return (
		<PlateElement {...props} className="m-0 min-h-6">
			{props.children}
		</PlateElement>
	);
}

function SpaceComposerProfileToken(
	props: PlateElementProps<SpaceComposerProfileElement>
) {
	const { editor, element } = props;
	const context = useSpaceComposerEditorContext();
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
				primaryMentionLabel: target.profileName,
				wakeAvailability: target.wakeAvailability,
			})
		: [];
	const isRepeatedAgent =
		profileKind === "agent" && isRepeatedProfileElement(editor, element);
	let relationControl: ReactNode = null;
	if (profileKind === "agent" && choices.length > 0 && !isRepeatedAgent) {
		const selectedRelationLabel =
			choices.find((choice) => choice.relation === element.relation)?.label ??
			(element.relation === "wake" ? "Wake" : "Reference");
		relationControl = (
			<label className="relative inline-flex h-6 shrink-0 items-center gap-0.5 border-border border-l pr-1 pl-2 text-muted-foreground">
				<span className="sr-only">Relation</span>
				<span
					aria-hidden="true"
					className="whitespace-pre font-medium text-xs"
					data-testid="space-composer-profile-token-relation-width"
				>
					{selectedRelationLabel}
				</span>
				<CaretDownIcon aria-hidden="true" className="size-3" />
				<select
					aria-label={`Change relation for ${profileName}`}
					className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0 outline-none"
					onChange={(event) => {
						const path = editor.api.findPath(element);
						if (!path) {
							return;
						}
						editor.tf.setNodes(
							{
								relation: event.target.value as MessageMentionType,
							},
							{ at: path }
						);
					}}
					onClick={(event) => event.stopPropagation()}
					onMouseDown={(event) => event.stopPropagation()}
					value={element.relation}
				>
					{choices.map((choice) => (
						<option
							disabled={choice.disabled}
							key={choice.relation}
							value={choice.relation}
						>
							{choice.disabled && choice.disabledReason
								? `${choice.label} — ${choice.disabledReason}`
								: choice.label}
						</option>
					))}
				</select>
			</label>
		);
	} else if (isRepeatedAgent) {
		relationControl = (
			<span className="inline-flex h-6 items-center border-border border-l px-2 font-medium text-muted-foreground text-xs">
				Reference
			</span>
		);
	}

	return (
		<PlateElement {...props} as="span">
			<span
				className="group/profile-token relative mx-0.5 inline-flex h-7 max-w-full items-center gap-1 rounded-md bg-muted px-1.5 align-middle text-foreground ring-1 ring-border/70 focus-within:ring-2 focus-within:ring-ring"
				contentEditable={false}
				data-mention-text={element.mentionText}
				data-testid="space-composer-profile-token"
			>
				<span
					aria-hidden="true"
					className="shrink-0 font-semibold"
					data-slot="space-composer-profile-token-at"
				>
					@
				</span>
				<span
					className="inline-flex shrink-0"
					data-slot="space-composer-profile-token-icon"
				>
					<SpaceProfileIcon
						agentControllerRef={
							pickerItem?.memberEntry.agentControllerRef ?? null
						}
						avatarImageUrl={pickerItem?.memberEntry.avatarUrl}
						className="size-4"
						isCenterAgent={element.profileId === context.centerAgentProfileId}
						profileId={element.profileId}
						profileKind={profileKind}
						profileName={profileName}
					/>
				</span>
				<span
					className="min-w-0 truncate font-medium"
					data-slot="space-composer-profile-token-name"
				>
					{profileName}
				</span>
				{relationControl}
				<button
					aria-label={`Remove ${profileName} from message`}
					className="pointer-events-none absolute -top-2 -right-2 z-10 inline-flex size-5 items-center justify-center rounded-full bg-popover text-muted-foreground opacity-0 shadow-sm ring-1 ring-border transition-opacity duration-100 ease-out hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-focus-within/profile-token:pointer-events-auto group-focus-within/profile-token:opacity-100 group-hover/profile-token:pointer-events-auto group-hover/profile-token:opacity-100 motion-reduce:transition-none [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
					onClick={(event) => {
						event.stopPropagation();
						const path = editor.api.findPath(element);
						if (!path) {
							return;
						}
						const nextPath = PathApi.next(path);
						const nextNode = (editor.children as SpaceComposerEditorValue)[
							nextPath[0]
						]?.children[nextPath[1] ?? 0];

						editor.tf.withoutNormalizing(() => {
							if (
								nextNode &&
								TextApi.isText(nextNode) &&
								nextNode.text.startsWith(" ")
							) {
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
					<InlineComboboxEmpty>No matching members</InlineComboboxEmpty>
					<SpaceComposerMentionGroup items={agentItems} title="Agents" />
					<SpaceComposerMentionGroup items={humanItems} title="Humans" />
				</InlineComboboxContent>
			</InlineCombobox>
			{props.children}
		</PlateElement>
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
						className="mr-2 size-5"
						isCenterAgent={
							item.suggestion.profileId === context.centerAgentProfileId
						}
						profileId={item.suggestion.profileId}
						profileKind={item.suggestion.profileKind}
						profileName={item.suggestion.profileName}
					/>
					<span className="min-w-0 flex-1 truncate font-medium">
						{item.suggestion.profileName}
					</span>
					<span className="ml-2 text-muted-foreground text-xs">
						{resolveMentionPickerRelationLabel(item.suggestion)}
					</span>
				</InlineComboboxItem>
			))}
		</InlineComboboxGroup>
	);
}

function resolveMentionPickerRelationLabel(
	suggestion: SpaceMentionPickerItem["suggestion"]
): "Mention" | "Reference" | "Wake" {
	const relation = resolveDefaultSpaceComposerMentionRelation(suggestion);
	if (relation === "reference") {
		return "Reference";
	}
	return suggestion.profileKind === "human" ? "Mention" : "Wake";
}

function insertProfile(
	editor: PlateEditor,
	item: SpaceMentionPickerItem
): void {
	const relation = resolveDefaultSpaceComposerMentionRelation(item.suggestion);
	if (!relation) {
		return;
	}
	const mentionText = `@${item.suggestion.primaryMentionLabel}`;
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
	onSend: () => void
): void {
	if (event.nativeEvent.isComposing || event.key !== "Enter") {
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
			item.suggestion
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
				mentionText: `@${item.suggestion.primaryMentionLabel}`,
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
