import { MAX_SPACE_NAME_LENGTH } from "@openmeld/schemas";

const ENGLISH_NAME_LIST_FORMAT = new Intl.ListFormat("en", {
	style: "long",
	type: "conjunction",
});

export function formatDirectMessageConversionNames(
	names: readonly string[]
): string {
	return ENGLISH_NAME_LIST_FORMAT.format(names);
}

export function buildDirectMessageConversionDefaultName(input: {
	currentMemberNames: readonly string[];
	currentSpaceName: string | null | undefined;
	selectedNames: readonly string[];
}): string {
	const names = [...input.currentMemberNames, ...input.selectedNames].filter(
		(name, index, all) => name.trim().length > 0 && all.indexOf(name) === index
	);
	const formatted = formatDirectMessageConversionNames(names);
	if (formatted.length > 0 && formatted.length <= MAX_SPACE_NAME_LENGTH) {
		return formatted;
	}
	return input.currentSpaceName?.trim() || "New Space";
}
