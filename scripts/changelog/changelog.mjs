import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";

const ENTRY_DIRECTORY = "changelog/entries";
const INDEX_PATH = "changelog/index.json";
const RELEASE_DIRECTORY = "changelog/releases";
const CHANGELOG_PATH = "CHANGELOG.md";
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const RELEASE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/+@-]*$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const ENTRY_ID_MAX_CHARS = 120;
const ENTRY_TITLE_MAX_CHARS = 240;
const ENTRY_BODY_MAX_CHARS = 4000;
const ENTRY_LIST_MAX_ITEMS = 10;
const ENTRY_LIST_ITEM_MAX_CHARS = 120;
const ENTRY_EVIDENCE_MAX_CHARS = 240;
const ENTRY_FIELDS = new Set([
  "id",
  "title",
  "kind",
  "areas",
  "audiences",
  "publishedAt",
  "release",
  "evidence",
]);
const ENTRY_KINDS = [
  "new",
  "improved",
  "fixed",
  "security",
  "breaking",
  "deprecated",
  "removed",
];
const KIND_LABELS = new Map([
  ["new", "New"],
  ["improved", "Improved"],
  ["fixed", "Fixed"],
  ["security", "Security"],
  ["breaking", "Breaking"],
  ["deprecated", "Deprecated"],
  ["removed", "Removed"],
]);
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export class ChangelogError extends Error {
  constructor(messages) {
    super(messages.join("\n"));
    this.name = "ChangelogError";
    this.messages = messages;
  }
}

const parseFrontmatter = (source, filePath) => {
  const normalizedSource = source.replaceAll("\r\n", "\n");
  if (!normalizedSource.startsWith("---\n")) {
    throw new ChangelogError([`${filePath}: entry must start with ---`]);
  }

  const closingMarkerIndex = normalizedSource.indexOf("\n---\n", 4);
  if (closingMarkerIndex === -1) {
    throw new ChangelogError([
      `${filePath}: entry must close frontmatter with ---`,
    ]);
  }

  const frontmatter = normalizedSource.slice(4, closingMarkerIndex);
  const body = normalizedSource.slice(closingMarkerIndex + 5).trim();
  const document = parseDocument(frontmatter, {
    prettyErrors: true,
    strict: true,
    stringKeys: true,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    throw new ChangelogError(
      document.errors.map((error) => `${filePath}: ${error.message}`)
    );
  }
  let fields;
  try {
    fields = document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    throw new ChangelogError([
      `${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    throw new ChangelogError([
      `${filePath}: frontmatter must be a field mapping`,
    ]);
  }
  const unsupportedFields = Object.keys(fields).filter(
    (fieldName) => !ENTRY_FIELDS.has(fieldName)
  );
  if (unsupportedFields.length > 0) {
    throw new ChangelogError(
      unsupportedFields.map(
        (fieldName) => `${filePath}: unsupported field ${fieldName}`
      )
    );
  }
  return { ...fields, body, filePath };
};

const isRealDate = (date) => {
  if (!DATE_PATTERN.test(date)) {
    return false;
  }
  const parsedDate = new Date(`${date}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsedDate.valueOf()) &&
    parsedDate.toISOString().startsWith(date)
  );
};

const validateStringList = (
  entry,
  fieldName,
  errors,
  { itemMaxChars, required, slugs }
) => {
  const values = entry[fieldName];
  if (values === undefined && !required) {
    return;
  }
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.some(
      (value) => typeof value !== "string" || value.trim().length === 0
    )
  ) {
    errors.push(
      `${entry.filePath}: ${fieldName} must be a non-empty string array`
    );
    return;
  }
  const invalidValue = slugs
    ? values.find((value) => !ID_PATTERN.test(value))
    : undefined;
  if (invalidValue) {
    errors.push(
      `${entry.filePath}: ${fieldName} value ${invalidValue} must be a lowercase slug`
    );
  }
  if (new Set(values).size !== values.length) {
    errors.push(`${entry.filePath}: ${fieldName} must not contain duplicates`);
  }
  if (values.length > ENTRY_LIST_MAX_ITEMS) {
    errors.push(
      `${entry.filePath}: ${fieldName} must contain at most ${ENTRY_LIST_MAX_ITEMS} items`
    );
  }
  const oversizedValue = values.find((value) => value.length > itemMaxChars);
  if (oversizedValue) {
    errors.push(
      `${entry.filePath}: ${fieldName} values must contain at most ${itemMaxChars} characters`
    );
  }
};

const isNonEmptyString = (value) =>
  typeof value === "string" && value.trim().length > 0;

const validateIdentity = (entry, knownIds, errors) => {
  if (!isNonEmptyString(entry.id)) {
    errors.push(`${entry.filePath}: id must be a non-empty string`);
    return;
  }
  if (!ID_PATTERN.test(entry.id)) {
    errors.push(`${entry.filePath}: id must be a lowercase slug`);
  }
  if (entry.id.length > ENTRY_ID_MAX_CHARS) {
    errors.push(
      `${entry.filePath}: id must contain at most ${ENTRY_ID_MAX_CHARS} characters`
    );
  }
  const expectedId = path.posix.basename(entry.filePath, ".md");
  if (entry.id !== expectedId) {
    errors.push(
      `${entry.filePath}: id ${entry.id} must match filename ${expectedId}.md`
    );
  }
  if (knownIds.has(entry.id)) {
    errors.push(`${entry.filePath}: duplicate id ${entry.id}`);
  }
  knownIds.add(entry.id);
};

const validateRequiredContent = (entry, errors) => {
  if (!isNonEmptyString(entry.title)) {
    errors.push(`${entry.filePath}: title must be a non-empty string`);
  } else if (entry.title.length > ENTRY_TITLE_MAX_CHARS) {
    errors.push(
      `${entry.filePath}: title must contain at most ${ENTRY_TITLE_MAX_CHARS} characters`
    );
  }
  if (!(isNonEmptyString(entry.kind) && ENTRY_KINDS.includes(entry.kind))) {
    errors.push(
      `${entry.filePath}: kind must be one of ${ENTRY_KINDS.join(", ")}`
    );
  }
  validateStringList(entry, "areas", errors, {
    itemMaxChars: ENTRY_LIST_ITEM_MAX_CHARS,
    required: true,
    slugs: true,
  });
  validateStringList(entry, "audiences", errors, {
    itemMaxChars: ENTRY_LIST_ITEM_MAX_CHARS,
    required: true,
    slugs: true,
  });
  validateStringList(entry, "evidence", errors, {
    itemMaxChars: ENTRY_EVIDENCE_MAX_CHARS,
    required: false,
    slugs: false,
  });
  if (!entry.body) {
    errors.push(`${entry.filePath}: Markdown body is required`);
  } else if (entry.body.length > ENTRY_BODY_MAX_CHARS) {
    errors.push(
      `${entry.filePath}: Markdown body must contain at most ${ENTRY_BODY_MAX_CHARS} characters`
    );
  }
};

const validatePublication = (entry, releaseDates, errors) => {
  const hasPublishedAt = entry.publishedAt !== undefined;
  const hasRelease = entry.release !== undefined;
  if (hasPublishedAt && !isNonEmptyString(entry.publishedAt)) {
    errors.push(`${entry.filePath}: publishedAt must be a string`);
  } else if (hasPublishedAt && !isRealDate(entry.publishedAt)) {
    errors.push(
      `${entry.filePath}: publishedAt must be a real YYYY-MM-DD date`
    );
  }
  if (hasPublishedAt && entry.evidence === undefined) {
    errors.push(`${entry.filePath}: a published entry requires evidence`);
  }
  if (hasRelease && !hasPublishedAt) {
    errors.push(`${entry.filePath}: release requires publishedAt`);
  }
  if (hasRelease && !isNonEmptyString(entry.release)) {
    errors.push(`${entry.filePath}: release must be a non-empty string`);
  } else if (hasRelease && !RELEASE_PATTERN.test(entry.release)) {
    errors.push(`${entry.filePath}: release contains unsupported characters`);
  }
  if (!(hasRelease && hasPublishedAt)) {
    return;
  }
  const knownDate = releaseDates.get(entry.release);
  if (knownDate && knownDate !== entry.publishedAt) {
    errors.push(
      `${entry.filePath}: release ${entry.release} already uses publishedAt ${knownDate}`
    );
    return;
  }
  releaseDates.set(entry.release, entry.publishedAt);
};

const validateEntries = (entries) => {
  const errors = [];
  const knownIds = new Set();
  const releaseDates = new Map();

  for (const entry of entries) {
    validateIdentity(entry, knownIds, errors);
    validateRequiredContent(entry, errors);
    validatePublication(entry, releaseDates, errors);
  }

  if (errors.length > 0) {
    throw new ChangelogError(errors);
  }
};

const readEntries = (rootDirectory) => {
  const entryDirectory = path.join(rootDirectory, ENTRY_DIRECTORY);
  if (!existsSync(entryDirectory)) {
    throw new ChangelogError([`${ENTRY_DIRECTORY}: directory does not exist`]);
  }
  const fileNames = readdirSync(entryDirectory)
    .filter((fileName) => fileName.endsWith(".md"))
    .sort();
  const entries = fileNames.map((fileName) => {
    const absolutePath = path.join(entryDirectory, fileName);
    const relativePath = path.posix.join(ENTRY_DIRECTORY, fileName);
    return parseFrontmatter(readFileSync(absolutePath, "utf8"), relativePath);
  });
  validateEntries(entries);
  return entries;
};

const sortPublishedEntries = (entries) =>
  entries
    .filter((entry) => entry.publishedAt)
    .sort(
      (left, right) =>
        right.publishedAt.localeCompare(left.publishedAt) ||
        left.title.localeCompare(right.title) ||
        left.id.localeCompare(right.id)
    );

const formatDate = (date) => {
  const [year, month, day] = date.split("-").map(Number);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
};

const renderEntry = (entry, { includeEvidence }) => {
  const details = [KIND_LABELS.get(entry.kind)];
  if (entry.release) {
    details.push(entry.release);
  }
  details.push(...entry.areas);
  const lines = [`### ${entry.title}`, "", details.join(" · "), "", entry.body];
  if (includeEvidence) {
    lines.push("", `Evidence: ${entry.evidence.join(", ")}`);
  }
  return lines.join("\n");
};

const renderChangelog = (publishedEntries) => {
  const lines = [
    "# Changelog",
    "",
    "OpenMeld changes, generated from `changelog/entries/*.md`. Do not edit this file directly.",
  ];
  if (publishedEntries.length === 0) {
    lines.push("", "No published changes yet.", "");
    return lines.join("\n");
  }

  let activeDate;
  for (const entry of publishedEntries) {
    if (entry.publishedAt !== activeDate) {
      activeDate = entry.publishedAt;
      lines.push("", `## ${formatDate(activeDate)}`);
    }
    lines.push("", renderEntry(entry, { includeEvidence: true }));
  }
  lines.push("");
  return lines.join("\n");
};

const renderIndex = (publishedEntries) => {
  const entries = publishedEntries.map((entry) => ({
    id: entry.id,
    title: entry.title,
    kind: entry.kind,
    areas: entry.areas,
    audiences: entry.audiences,
    publishedAt: entry.publishedAt,
    ...(entry.release ? { release: entry.release } : {}),
    evidence: entry.evidence,
    body: entry.body,
  }));
  return `${JSON.stringify({ schemaVersion: 1, entries }, null, 2)}\n`;
};

const renderRelease = (release, entries) => {
  const lines = [
    `# ${release}`,
    "",
    `Released ${formatDate(entries[0].publishedAt)}`,
  ];
  for (const kind of ENTRY_KINDS) {
    const matchingEntries = entries.filter((entry) => entry.kind === kind);
    if (matchingEntries.length === 0) {
      continue;
    }
    lines.push("", `## ${KIND_LABELS.get(kind)}`);
    for (const entry of matchingEntries) {
      lines.push("", `### ${entry.title}`, "", entry.body);
    }
  }
  lines.push("");
  return lines.join("\n");
};

const createExpectedFiles = (entries) => {
  const publishedEntries = sortPublishedEntries(entries);
  const expectedFiles = new Map([
    [CHANGELOG_PATH, renderChangelog(publishedEntries)],
    [INDEX_PATH, renderIndex(publishedEntries)],
  ]);
  const entriesByRelease = new Map();
  for (const entry of publishedEntries) {
    if (!entry.release) {
      continue;
    }
    const releaseEntries = entriesByRelease.get(entry.release) ?? [];
    releaseEntries.push(entry);
    entriesByRelease.set(entry.release, releaseEntries);
  }
  for (const [release, releaseEntries] of entriesByRelease) {
    const releasePath = path.posix.join(
      RELEASE_DIRECTORY,
      `${encodeURIComponent(release)}.md`
    );
    expectedFiles.set(releasePath, renderRelease(release, releaseEntries));
  }
  return { expectedFiles, publishedEntries };
};

const listGeneratedReleaseFiles = (rootDirectory) => {
  const releaseDirectory = path.join(rootDirectory, RELEASE_DIRECTORY);
  if (!existsSync(releaseDirectory)) {
    return [];
  }
  return readdirSync(releaseDirectory)
    .filter((fileName) => fileName.endsWith(".md"))
    .map((fileName) => path.posix.join(RELEASE_DIRECTORY, fileName))
    .sort();
};

export const buildChangelog = (rootDirectory = process.cwd()) => {
  const entries = readEntries(rootDirectory);
  const { expectedFiles, publishedEntries } = createExpectedFiles(entries);
  for (const [relativePath, contents] of expectedFiles) {
    const absolutePath = path.join(rootDirectory, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, contents);
  }

  const expectedReleaseFiles = new Set(
    [...expectedFiles.keys()].filter((filePath) =>
      filePath.startsWith(`${RELEASE_DIRECTORY}/`)
    )
  );
  for (const releaseFile of listGeneratedReleaseFiles(rootDirectory)) {
    if (!expectedReleaseFiles.has(releaseFile)) {
      rmSync(path.join(rootDirectory, releaseFile));
    }
  }

  return {
    draftCount: entries.length - publishedEntries.length,
    publishedCount: publishedEntries.length,
  };
};

export const checkChangelog = (rootDirectory = process.cwd()) => {
  const entries = readEntries(rootDirectory);
  const { expectedFiles, publishedEntries } = createExpectedFiles(entries);
  const errors = [];
  for (const [relativePath, expectedContents] of expectedFiles) {
    const absolutePath = path.join(rootDirectory, relativePath);
    if (!existsSync(absolutePath)) {
      errors.push(`${relativePath}: generated file is missing`);
      continue;
    }
    if (readFileSync(absolutePath, "utf8") !== expectedContents) {
      errors.push(`${relativePath}: generated file is stale`);
    }
  }

  const expectedReleaseFiles = new Set(
    [...expectedFiles.keys()].filter((filePath) =>
      filePath.startsWith(`${RELEASE_DIRECTORY}/`)
    )
  );
  for (const releaseFile of listGeneratedReleaseFiles(rootDirectory)) {
    if (!expectedReleaseFiles.has(releaseFile)) {
      errors.push(`${releaseFile}: generated file is unexpected`);
    }
  }
  if (errors.length > 0) {
    throw new ChangelogError(errors);
  }

  return {
    draftCount: entries.length - publishedEntries.length,
    publishedCount: publishedEntries.length,
  };
};

export const formatChangelogError = (error) => {
  if (error instanceof ChangelogError) {
    return error.messages.map((message) => `- ${message}`).join("\n");
  }
  return error instanceof Error
    ? (error.stack ?? error.message)
    : String(error);
};
