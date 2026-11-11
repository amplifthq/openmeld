import { parseAsStringLiteral } from "nuqs";

// URL state for page navigation only. Form choices and previews stay local.
const PAGE_TAB_OPTIONS = { history: "push", scroll: false } as const;

export const routineScopeParser = parseAsStringLiteral(["personal", "team"])
	.withDefault("team")
	.withOptions(PAGE_TAB_OPTIONS);
export const fileViewParser = parseAsStringLiteral([
	"team",
	"my",
	"trash",
	"trash-my",
	"knowledge",
	"skills",
])
	.withDefault("team")
	.withOptions(PAGE_TAB_OPTIONS);
export const pluginScopeParser = parseAsStringLiteral([
	"organization",
	"personal",
])
	.withDefault("organization")
	.withOptions(PAGE_TAB_OPTIONS);
export const spacesViewParser = parseAsStringLiteral([
	"conversations",
	"spaces",
	"messages",
	"discover",
])
	.withDefault("conversations")
	.withOptions(PAGE_TAB_OPTIONS);
export const inboxViewParser = parseAsStringLiteral([
	"all",
	"mentions",
	"needs-action",
	"needs-review",
])
	.withDefault("all")
	.withOptions(PAGE_TAB_OPTIONS);
export const skillContentParser = parseAsStringLiteral([
	"instructions",
	"files",
])
	.withDefault("instructions")
	.withOptions(PAGE_TAB_OPTIONS);
export const usageScopeParser = parseAsStringLiteral(["organization", "my"])
	.withDefault("organization")
	.withOptions(PAGE_TAB_OPTIONS);
