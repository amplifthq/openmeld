import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import {
  createSpaceTargetCatalog,
  type SpaceTargetCatalogEntry,
} from "../target-identity/target-catalog";

const WORD_CHARACTER_PATTERN = /\w/u;
const BARE_MENTION_BOUNDARY_PATTERN = /[\s.,!?;:，。！？；：\]})"'`]/u;
const WHITESPACE_PATTERN = /\s+/g;
const MAX_BARE_MENTION_DIAGNOSTICS = 5;

export type SpaceBareMentionDiagnostic = {
  end: number;
  mentionText: string;
  profileId: string;
  profileKind: "human" | "agent";
  profileName: string;
  start: number;
  suggestedReferenceText: string;
  suggestedWakeText: string | null;
};

type BareMentionCandidate = {
  entry: SpaceTargetCatalogEntry;
  label: string;
};

type IgnoredMentionTextRange = {
  end: number;
  start: number;
};

export function listSpaceBareMentionDiagnostics(input: {
  ignoredRanges?: readonly IgnoredMentionTextRange[];
  maxResults?: number;
  snapshot: SpaceMembersSnapshot;
  text: string;
}): SpaceBareMentionDiagnostic[] {
  if (!input.text.includes("@")) {
    return [];
  }

  const catalog = createSpaceTargetCatalog(input.snapshot);
  const candidates = buildBareMentionCandidates(catalog.entries);
  if (candidates.length === 0) {
    return [];
  }

  const maxResults = Math.max(
    1,
    Math.min(input.maxResults ?? MAX_BARE_MENTION_DIAGNOSTICS, 20)
  );
  const diagnostics: SpaceBareMentionDiagnostic[] = [];
  const seenStarts = new Set<number>();
  const ignoredRanges = normalizeIgnoredRanges(input.ignoredRanges ?? []);

  for (let cursor = 0; cursor < input.text.length; cursor += 1) {
    const atIndex = input.text.indexOf("@", cursor);
    if (atIndex < 0) {
      break;
    }
    cursor = atIndex;

    const ignoredRange = findIgnoredRangeContaining(ignoredRanges, atIndex);
    if (ignoredRange) {
      cursor = Math.max(cursor, ignoredRange.end - 1);
      continue;
    }

    if (!isPotentialBareMentionStart(input.text, atIndex)) {
      continue;
    }

    const match = resolveBareMentionCandidateAt({
      atIndex,
      candidates,
      text: input.text,
    });
    if (!match || seenStarts.has(atIndex)) {
      continue;
    }

    seenStarts.add(atIndex);
    diagnostics.push(toBareMentionDiagnostic(match));
    cursor = Math.max(cursor, match.end - 1);

    if (diagnostics.length >= maxResults) {
      break;
    }
  }

  return diagnostics;
}

function normalizeIgnoredRanges(
  ranges: readonly IgnoredMentionTextRange[]
): IgnoredMentionTextRange[] {
  return ranges
    .filter((range) => range.start >= 0 && range.end > range.start)
    .map((range) => ({
      end: range.end,
      start: range.start,
    }))
    .sort((left, right) => left.start - right.start);
}

function findIgnoredRangeContaining(
  ranges: readonly IgnoredMentionTextRange[],
  index: number
): IgnoredMentionTextRange | null {
  for (const range of ranges) {
    if (index < range.start) {
      return null;
    }
    if (index >= range.start && index < range.end) {
      return range;
    }
  }
  return null;
}

function buildBareMentionCandidates(
  entries: readonly SpaceTargetCatalogEntry[]
): BareMentionCandidate[] {
  const candidatesByLabel = new Map<string, BareMentionCandidate | null>();

  for (const entry of entries) {
    const labels = new Set<string>([
      entry.profileName,
      entry.primaryMentionLabel,
      ...(entry.mentionAlias ? [entry.mentionAlias] : []),
      ...entry.exactMentionLabels,
    ]);

    for (const label of labels) {
      const normalized = normalizeLabel(label);
      if (!normalized) {
        continue;
      }
      const key = normalized.toLowerCase();
      const existing = candidatesByLabel.get(key);
      if (existing === undefined) {
        candidatesByLabel.set(key, {
          entry,
          label: normalized,
        });
        continue;
      }
      if (existing === null || existing.entry.profileId !== entry.profileId) {
        candidatesByLabel.set(key, null);
      }
    }
  }

  return [...candidatesByLabel.values()]
    .filter(
      (candidate): candidate is BareMentionCandidate => candidate !== null
    )
    .sort((left, right) => right.label.length - left.label.length);
}

function resolveBareMentionCandidateAt(input: {
  atIndex: number;
  candidates: readonly BareMentionCandidate[];
  text: string;
}): {
  candidate: BareMentionCandidate;
  end: number;
  mentionText: string;
  start: number;
} | null {
  const tail = input.text.slice(input.atIndex + 1);
  const lowerTail = tail.toLowerCase();

  for (const candidate of input.candidates) {
    const lowerLabel = candidate.label.toLowerCase();
    if (!lowerTail.startsWith(lowerLabel)) {
      continue;
    }

    const afterLabel = tail.slice(candidate.label.length);
    if (isCanonicalMentionRelationSuffix(afterLabel)) {
      continue;
    }
    if (!isBareMentionBoundary(afterLabel[0] ?? "")) {
      continue;
    }

    const end = input.atIndex + 1 + candidate.label.length;
    return {
      candidate,
      end,
      mentionText: input.text.slice(input.atIndex, end),
      start: input.atIndex,
    };
  }

  return null;
}

function toBareMentionDiagnostic(input: {
  candidate: BareMentionCandidate;
  end: number;
  mentionText: string;
  start: number;
}): SpaceBareMentionDiagnostic {
  const label = input.candidate.entry.primaryMentionLabel;
  const suggestedWakeText =
    input.candidate.entry.profileKind === "agent" &&
    input.candidate.entry.allowedRelations.wake
      ? `@${label}(wake)`
      : null;

  return {
    end: input.end,
    mentionText: input.mentionText,
    profileId: input.candidate.entry.profileId,
    profileKind: input.candidate.entry.profileKind,
    profileName: input.candidate.entry.profileName,
    start: input.start,
    suggestedReferenceText: `@${label}(reference)`,
    suggestedWakeText,
  };
}

function isPotentialBareMentionStart(text: string, atIndex: number): boolean {
  const previous = atIndex > 0 ? (text[atIndex - 1] ?? "") : "";
  return !(previous === "\\" || WORD_CHARACTER_PATTERN.test(previous));
}

function isBareMentionBoundary(value: string): boolean {
  if (!value) {
    return true;
  }
  return BARE_MENTION_BOUNDARY_PATTERN.test(value);
}

function isCanonicalMentionRelationSuffix(value: string): boolean {
  return (
    value.startsWith("(wake)") ||
    value.startsWith("(reference)") ||
    value.startsWith("(cc)")
  );
}

function normalizeLabel(value: string | null | undefined): string | null {
  const normalized = String(value ?? "")
    .replaceAll(WHITESPACE_PATTERN, " ")
    .trim();
  return normalized.length > 0 ? normalized : null;
}
