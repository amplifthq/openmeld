import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Vite aliases "@phosphor-icons/react" and "lucide-react" to curated facades
// (vite.config.ts). An icon missing from a facade typechecks against the real
// package but breaks the bundle at runtime ("does not provide an export
// named ..."), taking the whole page down. Every name the Web bundle imports
// must be exported by its facade.

const WEB_ROOT = path.resolve(import.meta.dirname, "../..");
const SCANNED_ROOTS = [
	path.join(WEB_ROOT, "src"),
	// Shared UI is bundled by Web through the same aliases.
	path.resolve(WEB_ROOT, "../../packages/ui/src"),
];
const SOURCE_FILE = /\.(ts|tsx)$/u;
const TEST_FILE = /\.(test|spec)\.(ts|tsx)$|\.test-support\.(ts|tsx)$/u;
const EXPORT_BLOCK = /export\s+(type\s+)?\{([^}]*)\}/gu;
const WHITESPACE = /\s+/u;
const TYPE_PREFIX = /^type\s+/u;
const COMMENT = /\/\/[^\n]*|\/\*[\s\S]*?\*\//gu;

const FACADES = [
	{ module: "@phosphor-icons/react", facade: "src/lib/phosphor-icons.ts" },
	{ module: "lucide-react", facade: "src/lib/lucide-icons.ts" },
] as const;

type Exports = { types: Set<string>; values: Set<string> };

function readFacadeExports(file: string): Exports {
	const exports: Exports = { types: new Set(), values: new Set() };
	for (const match of readFileSync(file, "utf8").matchAll(EXPORT_BLOCK)) {
		const typeOnlyBlock = Boolean(match[1]);
		for (const entry of splitSpecifiers(match[2] ?? "")) {
			(typeOnlyBlock || entry.typeOnly ? exports.types : exports.values).add(
				entry.exported
			);
		}
	}
	return exports;
}

function splitSpecifiers(list: string): Array<{
	exported: string;
	imported: string;
	typeOnly: boolean;
}> {
	return list
		.replace(COMMENT, "")
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean)
		.map((part) => {
			const typeOnly = part.startsWith("type ");
			const words = part
				.replace(TYPE_PREFIX, "")
				.split(WHITESPACE)
				.filter(Boolean);
			const imported = words[0] ?? "";
			return {
				exported: words[2] ?? imported,
				imported,
				typeOnly,
			};
		});
}

function listSourceFiles(root: string): string[] {
	return readdirSync(root).flatMap((name) => {
		const file = path.join(root, name);
		if (statSync(file).isDirectory()) {
			return name === "node_modules" ? [] : listSourceFiles(file);
		}
		return SOURCE_FILE.test(name) && !TEST_FILE.test(name) ? [file] : [];
	});
}

function findMissingNames(module: string, exports: Exports): string[] {
	const escaped = module.replaceAll("/", "\\/").replaceAll(".", "\\.");
	const statement = new RegExp(
		`(import|export)\\s+(type\\s+)?(\\*\\s+as\\s+\\w+|\\{([^}]*)\\})\\s*from\\s*["']${escaped}["']`,
		"gu"
	);
	const missing: string[] = [];
	for (const root of SCANNED_ROOTS) {
		for (const file of listSourceFiles(root)) {
			const source = readFileSync(file, "utf8");
			for (const match of source.matchAll(statement)) {
				const where = path.relative(WEB_ROOT, file);
				if (match[3]?.startsWith("*")) {
					missing.push(`${where}: namespace import of ${module}`);
					continue;
				}
				const typeOnlyStatement = Boolean(match[2]);
				for (const entry of splitSpecifiers(match[4] ?? "")) {
					const known =
						exports.values.has(entry.imported) ||
						((typeOnlyStatement || entry.typeOnly) &&
							exports.types.has(entry.imported));
					if (!known) {
						missing.push(`${where}: ${entry.imported}`);
					}
				}
			}
		}
	}
	return missing;
}

describe("icon facades", () => {
	for (const { facade, module } of FACADES) {
		it(`exports every ${module} name the Web bundle imports`, () => {
			const exports = readFacadeExports(path.join(WEB_ROOT, facade));
			expect(exports.values.size).toBeGreaterThan(0);
			expect(findMissingNames(module, exports)).toEqual([]);
		});
	}
});
