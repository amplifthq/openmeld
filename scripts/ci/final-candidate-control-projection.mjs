const DEPENDENCY_LOCKFILE_PATH = "pnpm-lock.yaml";
const WORKSPACE_MANIFEST_PATH = "pnpm-workspace.yaml";
const COMMENT_OR_BLANK_PATTERN = /^\s*(?:#.*)?$/u;
const LINE_SPLIT_PATTERN = /\r?\n/u;
const NESTED_LIST_ENTRY_PATTERN =
  /^\s{2}-\s+(?:'([^']+)'|"([^"]+)"|(\S+))\s*$/u;
const NESTED_MAP_ENTRY_PATTERN =
  /^\s{2}(?:'([^']+)'|"([^"]+)"|([^:#]+)):\s*(.*?)\s*$/u;
const NON_WHITESPACE_START_PATTERN = /^\S/u;
const TOP_LEVEL_YAML_KEY_PATTERN = /^([A-Za-z][\w]*):\s*(.*?)\s*$/u;
const UNSAFE_RELATED_PATH_PATTERN = /(?:^|[\\/])\.\.(?:[\\/]|$)/u;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/u;

export function projectFinalCandidateControl(
  relativePath,
  contents,
  readRelated = () => null
) {
  if (relativePath === DEPENDENCY_LOCKFILE_PATH) {
    return "dependency-lockfile";
  }
  if (contents === null) {
    return "missing";
  }
  if (relativePath.endsWith("package.json")) {
    const manifest = JSON.parse(contents);
    return JSON.stringify({
      packageManager: manifest.packageManager ?? null,
      scripts: manifest.scripts ?? {},
    });
  }
  if (relativePath === WORKSPACE_MANIFEST_PATH) {
    return projectPnpmWorkspace(contents, readRelated);
  }
  return contents;
}

function projectPnpmWorkspace(contents, readRelated) {
  const document = parseTopLevelYamlCollections(contents);
  const patchedDependencies = asStringMap(document.patchedDependencies);
  const patchContents = {};
  for (const [packageName, patchPath] of Object.entries(
    patchedDependencies
  ).toSorted(([left], [right]) => left.localeCompare(right))) {
    patchContents[packageName] = isSafeRelatedPath(patchPath)
      ? (readRelated(patchPath) ?? "missing")
      : "unsafe-path";
  }
  return JSON.stringify({
    allowBuilds: asSortedMap(document.allowBuilds),
    configDependencies: asSortedMap(document.configDependencies),
    ignoredBuiltDependencies: asSortedList(document.ignoredBuiltDependencies),
    neverBuiltDependencies: asSortedList(document.neverBuiltDependencies),
    onlyBuiltDependencies: asSortedList(document.onlyBuiltDependencies),
    patchContents,
    patchedDependencies: asSortedMap(patchedDependencies),
  });
}

function parseTopLevelYamlCollections(text) {
  const result = {};
  let currentKey = null;
  let currentKind = null;
  for (const line of text.split(LINE_SPLIT_PATTERN)) {
    if (COMMENT_OR_BLANK_PATTERN.test(line)) {
      continue;
    }
    if (NON_WHITESPACE_START_PATTERN.test(line)) {
      ({ currentKey, currentKind } = startTopLevelCollection(result, line));
      continue;
    }
    currentKind = appendNestedYamlValue(result, currentKey, currentKind, line);
  }
  return result;
}

function startTopLevelCollection(result, line) {
  const match = TOP_LEVEL_YAML_KEY_PATTERN.exec(line);
  const currentKey = match?.[1] ?? null;
  if (!currentKey) {
    return { currentKey: null, currentKind: null };
  }
  const rest = match[2] ?? "";
  if (rest === "" || rest.startsWith("#")) {
    result[currentKey] = {};
    return { currentKey, currentKind: null };
  }
  if (rest === "[]") {
    result[currentKey] = [];
    return { currentKey, currentKind: "list" };
  }
  if (rest === "{}") {
    result[currentKey] = {};
    return { currentKey, currentKind: "map" };
  }
  result[currentKey] = stripYamlQuotes(rest);
  return { currentKey, currentKind: "scalar" };
}

function appendNestedYamlValue(result, currentKey, currentKind, line) {
  if (!currentKey || currentKind === "scalar") {
    return currentKind;
  }
  const listMatch = NESTED_LIST_ENTRY_PATTERN.exec(line);
  if (listMatch && currentKind !== "map") {
    if (!Array.isArray(result[currentKey])) {
      result[currentKey] = [];
    }
    result[currentKey].push(
      stripYamlQuotes(listMatch[1] ?? listMatch[2] ?? listMatch[3] ?? "")
    );
    return "list";
  }
  const mapMatch = NESTED_MAP_ENTRY_PATTERN.exec(line);
  if (!(mapMatch && currentKind !== "list")) {
    return currentKind;
  }
  if (
    Array.isArray(result[currentKey]) ||
    typeof result[currentKey] !== "object"
  ) {
    result[currentKey] = {};
  }
  const nestedKey = (mapMatch[1] ?? mapMatch[2] ?? mapMatch[3] ?? "").trim();
  result[currentKey][nestedKey] = stripYamlQuotes(mapMatch[4] ?? "");
  return "map";
}

function asSortedMap(value) {
  if (
    value === undefined ||
    value === null ||
    Array.isArray(value) ||
    typeof value !== "object"
  ) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entry]) => [key, normalizeYamlScalar(entry)])
      .toSorted(([left], [right]) => left.localeCompare(right))
  );
}

function asStringMap(value) {
  if (
    value === undefined ||
    value === null ||
    Array.isArray(value) ||
    typeof value !== "object"
  ) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, String(entry)])
  );
}

function asSortedList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => normalizeYamlScalar(item)).toSorted();
}

function normalizeYamlScalar(value) {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return value;
}

function stripYamlQuotes(value) {
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function isSafeRelatedPath(relativePath) {
  return (
    typeof relativePath === "string" &&
    relativePath.length > 0 &&
    !pathIsAbsolute(relativePath) &&
    !UNSAFE_RELATED_PATH_PATTERN.test(relativePath)
  );
}

function pathIsAbsolute(relativePath) {
  return (
    relativePath.startsWith("/") ||
    WINDOWS_ABSOLUTE_PATH_PATTERN.test(relativePath)
  );
}
