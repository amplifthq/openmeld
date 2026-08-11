"use client";

import { MarkdownEditor } from "#/components/editor/markdown-editor";

export const ORGANIZATION_DOCUMENT_CONTENT_MAX_CHARS = 20_000;

/**
 * Organization Documents keep their existing content limit while sharing the
 * exact Plate configuration and WYSIWYG surface used by Organization Skills.
 */
export function OrganizationDocumentMarkdownEditor(input: {
	ariaLabel?: string;
	disabled?: boolean;
	onChange: (value: string) => void;
	value: string;
}) {
	return (
		<MarkdownEditor
			disabled={input.disabled}
			maxChars={ORGANIZATION_DOCUMENT_CONTENT_MAX_CHARS}
			onChange={input.onChange}
			value={input.value}
			{...(input.ariaLabel === undefined ? {} : { ariaLabel: input.ariaLabel })}
		/>
	);
}
