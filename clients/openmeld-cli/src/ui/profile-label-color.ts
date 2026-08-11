import {
  type BuiltinAgentControllerBrand,
  resolveBuiltinAgentControllerBrand,
} from "@openmeld/schemas";
import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import pc from "picocolors";
import { OPENMELD_COMPOSER_SURFACE_BG_RGB } from "./brand";
import { sanitizeTerminalDisplayText } from "./terminal-safe-text";

export type ProfileColorIdentityLike =
  | {
      agentControllerRef?: string;
      identityKey?: string;
      profileId?: string;
      profileName?: string;
      kind?: string;
    }
  | undefined;

export type DisplayProfileColorInput = {
  agentControllerRef?: string | null;
  kind?: string | null;
  profileKind?: string | null;
  owner?: string | null;
  ownerName?: string | null;
  ownerUserId?: string | null;
  openMeldProfileId?: string | null;
  profileId?: string | null;
  profileName?: string | null;
};

export type PersonColorIdentityInput = {
  ownerUserId?: string | null;
  ownerName?: string | null;
  profileId?: string | null;
  profileName?: string | null;
};

export type AgentColorIdentityInput = {
  agentControllerRef?: string | null;
  profileId?: string | null;
  profileName?: string | null;
};

export type ProfileNameColorInput =
  | {
      label: string;
      target: "display-profile";
      profileIdentity: DisplayProfileColorInput | undefined;
      spaceMembersSnapshot?: SpaceMembersSnapshot | null;
    }
  | {
      label: string;
      target: "person";
      personIdentity: PersonColorIdentityInput;
      spaceMembersSnapshot?: SpaceMembersSnapshot | null;
    }
  | {
      label: string;
      target: "agent";
      agentIdentity: AgentColorIdentityInput;
      spaceMembersSnapshot?: SpaceMembersSnapshot | null;
    }
  | {
      label: string;
      target: "resolved";
      profileIdentity: ProfileColorIdentityLike;
      spaceMembersSnapshot?: SpaceMembersSnapshot | null;
    };

type ColorizeFn = (input: string | number | null | undefined) => string;
type RgbColor = {
  r: number;
  g: number;
  b: number;
};
/**
 * Global, identity-stable fallback palettes.
 *
 * Space-aware surfaces should pass a members snapshot so every visible profile
 * name in that Space shares one scoped palette. When no snapshot is available,
 * we fall back to these deterministic global anchors.
 */
const PERSON_PROFILE_ACCENT_HUE_ANCHORS = [
  18, 36, 54, 72, 94, 116, 138, 160, 182, 204, 226, 248, 270, 292, 314, 336,
  350, 106, 150,
] as const;
const AGENT_PROFILE_ACCENT_HUE_ANCHORS = [
  8, 28, 48, 68, 88, 110, 134, 158, 184, 208, 232, 256, 280, 304, 328, 344, 196,
  40, 120,
] as const;
const PROFILE_ACCENT_HUE_STEP_DEGREES = 11;
const PROFILE_ACCENT_VARIANTS = 4;
const SPACE_SCOPED_BASE_HUE = 24;
const SPACE_SCOPED_GOLDEN_ANGLE_DEGREES = 137.508;
const SPACE_SCOPED_PRIMARY_HUE_STEP_DEGREES = 15;
const SPACE_SCOPED_MIN_CANDIDATE_COUNT = 24;
const SPACE_SCOPED_WRAP_COUNT = 3;
const SPACE_SCOPED_WRAP_SHIFT_DEGREES = 17;
export const HUMAN_PROFILE_NAME_COLOR_ENABLED = false;

type ProfileColorScope = {
  hueByIdentity: Map<string, number>;
};

type DisplayProfileColorTarget = {
  kind: "agent" | "person";
  identity: ProfileColorIdentityLike;
};

const profileColorScopeCache = new WeakMap<
  SpaceMembersSnapshot,
  ProfileColorScope
>();

/**
 * Low-level primitive. UI call sites should prefer the higher-level helpers
 * below so person-vs-agent identity resolution stays in one place.
 */
export function colorizeProfileLabel(
  label: string,
  profileIdentity: ProfileColorIdentityLike,
  options?: {
    spaceMembersSnapshot?: SpaceMembersSnapshot | null;
  }
): string {
  if (!shouldColorizeProfileIdentity(profileIdentity)) {
    return sanitizeSingleLineText(label);
  }

  const colorize = toAnsiTrueColorColorize(
    resolveProfileAccentRgb(label, profileIdentity, options)
  );
  return colorize(sanitizeSingleLineText(label));
}

export function resolveProfileAccentRgb(
  label: string,
  profileIdentity: ProfileColorIdentityLike,
  options?: {
    spaceMembersSnapshot?: SpaceMembersSnapshot | null;
  }
): RgbColor {
  const builtinControllerBrand =
    resolveBuiltinAgentControllerBrandForIdentity(profileIdentity);
  if (builtinControllerBrand) {
    const [r, g, b] = builtinControllerBrand.accentRgb;
    return { r, g, b };
  }

  return toStableProfileRgb(
    resolveProfileColorKey(label, profileIdentity),
    profileIdentity,
    options?.spaceMembersSnapshot ?? null
  );
}

export function resolveProfileSurfaceRgb(
  label: string,
  profileIdentity: ProfileColorIdentityLike,
  options?: {
    spaceMembersSnapshot?: SpaceMembersSnapshot | null;
  }
): RgbColor {
  const builtinControllerBrand =
    resolveBuiltinAgentControllerBrandForIdentity(profileIdentity);
  if (builtinControllerBrand) {
    return deriveBuiltinControllerBrandSurfaceRgb(builtinControllerBrand);
  }

  if (profileIdentity?.kind === "agent") {
    return {
      r: OPENMELD_COMPOSER_SURFACE_BG_RGB[0],
      g: OPENMELD_COMPOSER_SURFACE_BG_RGB[1],
      b: OPENMELD_COMPOSER_SURFACE_BG_RGB[2],
    };
  }

  const paletteSeed = resolveProfilePaletteSeed(
    label,
    profileIdentity,
    options?.spaceMembersSnapshot ?? null
  );
  const saturation = 22 + (Math.floor(paletteSeed.hash / 53) % 8);
  const lightness = 18 + (Math.floor(paletteSeed.hash / 131) % 5);
  return hslToRgb(paletteSeed.hue, saturation / 100, lightness / 100);
}

export function resolvePersonColorIdentity(
  input: PersonColorIdentityInput
): ProfileColorIdentityLike {
  const ownerUserId = sanitizeSingleLineText(input.ownerUserId).trim();
  const ownerName = sanitizeSingleLineText(input.ownerName).trim();
  const profileId = sanitizeSingleLineText(input.profileId).trim();
  const profileName = sanitizeSingleLineText(input.profileName).trim();

  return {
    identityKey: ownerUserId || profileId || undefined,
    profileId: profileId || undefined,
    profileName: ownerName || profileName || undefined,
    kind: "human",
  };
}

export function resolveAgentColorIdentity(
  input: AgentColorIdentityInput
): ProfileColorIdentityLike {
  const agentControllerRef = sanitizeSingleLineText(
    input.agentControllerRef
  ).trim();
  const profileId = sanitizeSingleLineText(input.profileId).trim();
  const profileName = sanitizeSingleLineText(input.profileName).trim();
  const builtinControllerBrand =
    resolveBuiltinAgentControllerBrand(agentControllerRef);

  return {
    agentControllerRef: agentControllerRef || undefined,
    identityKey: builtinControllerBrand
      ? `builtin-controller:${builtinControllerBrand.controllerId}`
      : profileId || undefined,
    profileId: profileId || undefined,
    profileName: profileName || undefined,
    kind: "agent",
  };
}

export function resolveDisplayProfileIdentity(input: {
  profileIdentity: DisplayProfileColorInput | undefined;
  spaceMembersSnapshot?: SpaceMembersSnapshot | null;
}): DisplayProfileColorInput {
  const profileIdentity = normalizeDisplayProfileColorInput(
    input.profileIdentity
  );
  const profileKind = resolveDisplayProfileKind(profileIdentity);
  if (!input.spaceMembersSnapshot) {
    return profileIdentity;
  }

  if (profileKind === "human") {
    if (profileIdentity.ownerUserId || profileIdentity.ownerName) {
      return profileIdentity;
    }

    const matchingHumanSnapshot = findMatchingHumanSnapshot({
      profileIdentity,
      spaceMembersSnapshot: input.spaceMembersSnapshot,
    });
    if (!matchingHumanSnapshot) {
      return profileIdentity;
    }

    return {
      ...profileIdentity,
      ownerUserId: matchingHumanSnapshot.ownerUserId ?? undefined,
      ownerName: matchingHumanSnapshot.ownerName ?? undefined,
    };
  }

  if (profileKind === "agent" && !profileIdentity.agentControllerRef) {
    const matchingAgentSnapshot = findMatchingAgentSnapshot({
      profileIdentity,
      spaceMembersSnapshot: input.spaceMembersSnapshot,
    });
    if (matchingAgentSnapshot) {
      return {
        ...profileIdentity,
        agentControllerRef:
          matchingAgentSnapshot.agentControllerRef ?? undefined,
      };
    }
  }

  return profileIdentity;
}

export function resolveDisplayProfileColorIdentity(input: {
  profileIdentity: DisplayProfileColorInput | undefined;
  spaceMembersSnapshot?: SpaceMembersSnapshot | null;
}): ProfileColorIdentityLike {
  return resolveDisplayProfileColorTarget(input).identity;
}

export function colorizeDisplayProfileLabel(input: {
  label: string;
  profileIdentity: DisplayProfileColorInput | undefined;
  spaceMembersSnapshot?: SpaceMembersSnapshot | null;
}): string {
  return colorizeProfileName({
    label: input.label,
    target: "display-profile",
    profileIdentity: input.profileIdentity,
    spaceMembersSnapshot: input.spaceMembersSnapshot,
  });
}

export function colorizePersonLabel(
  label: string,
  personIdentity: PersonColorIdentityInput,
  options?: {
    spaceMembersSnapshot?: SpaceMembersSnapshot | null;
  }
): string {
  return colorizeProfileName({
    label,
    target: "person",
    personIdentity,
    spaceMembersSnapshot: options?.spaceMembersSnapshot,
  });
}

export function colorizeAgentLabel(
  label: string,
  agentIdentity: AgentColorIdentityInput,
  options?: {
    spaceMembersSnapshot?: SpaceMembersSnapshot | null;
  }
): string {
  return colorizeProfileName({
    label,
    target: "agent",
    agentIdentity,
    spaceMembersSnapshot: options?.spaceMembersSnapshot,
  });
}

export function colorizeResolvedProfileLabel(
  label: string,
  profileIdentity: ProfileColorIdentityLike,
  options?: {
    spaceMembersSnapshot?: SpaceMembersSnapshot | null;
  }
): string {
  return colorizeProfileName({
    label,
    target: "resolved",
    profileIdentity,
    spaceMembersSnapshot: options?.spaceMembersSnapshot,
  });
}

export function resolveDisplayProfileSurfaceRgb(input: {
  label: string;
  profileIdentity: DisplayProfileColorInput | undefined;
  spaceMembersSnapshot?: SpaceMembersSnapshot | null;
}): RgbColor {
  return resolveProfileNameSurfaceRgb({
    label: input.label,
    target: "display-profile",
    profileIdentity: input.profileIdentity,
    spaceMembersSnapshot: input.spaceMembersSnapshot,
  });
}

export function resolvePersonSurfaceRgb(
  label: string,
  personIdentity: PersonColorIdentityInput,
  options?: {
    spaceMembersSnapshot?: SpaceMembersSnapshot | null;
  }
): RgbColor {
  return resolveProfileNameSurfaceRgb({
    label,
    target: "person",
    personIdentity,
    spaceMembersSnapshot: options?.spaceMembersSnapshot,
  });
}

export function resolveAgentSurfaceRgb(
  label: string,
  agentIdentity: AgentColorIdentityInput,
  options?: {
    spaceMembersSnapshot?: SpaceMembersSnapshot | null;
  }
): RgbColor {
  return resolveProfileNameSurfaceRgb({
    label,
    target: "agent",
    agentIdentity,
    spaceMembersSnapshot: options?.spaceMembersSnapshot,
  });
}

/**
 * Single source of truth for every visible profile-name color in OpenMeld CLI.
 * Call sites must pass the semantic identity they are rendering:
 * - "person" for human/owner names
 * - "agent" for agent-profile names
 * - "display-profile" when the call site only has a generic profile identity
 */
export function colorizeProfileName(input: ProfileNameColorInput): string {
  const profileIdentity = resolveProfileNameColorIdentity(input);
  if (!shouldColorizeProfileIdentity(profileIdentity)) {
    return sanitizeSingleLineText(input.label);
  }

  return colorizeProfileLabel(input.label, profileIdentity, {
    spaceMembersSnapshot:
      "spaceMembersSnapshot" in input ? input.spaceMembersSnapshot : null,
  });
}

export function resolveProfileNameColorIdentity(
  input: ProfileNameColorInput
): ProfileColorIdentityLike {
  switch (input.target) {
    case "display-profile":
      return resolveDisplayProfileColorIdentity({
        profileIdentity: input.profileIdentity,
        spaceMembersSnapshot: input.spaceMembersSnapshot,
      });
    case "person":
      return resolvePersonColorIdentity(input.personIdentity);
    case "agent":
      return resolveAgentColorIdentity(input.agentIdentity);
    case "resolved":
      return input.profileIdentity;
    default:
      return undefined;
  }
}

export function resolveProfileNameSurfaceRgb(
  input: ProfileNameColorInput
): RgbColor {
  return resolveProfileSurfaceRgb(
    input.label,
    resolveProfileNameColorIdentity(input),
    {
      spaceMembersSnapshot:
        "spaceMembersSnapshot" in input ? input.spaceMembersSnapshot : null,
    }
  );
}

const sanitizeSingleLineText = (
  value: string | number | null | undefined
): string => sanitizeTerminalDisplayText(value, "single-line");

function resolveProfileColorKey(
  label: string,
  profileIdentity: ProfileColorIdentityLike
): string {
  const identityKey = sanitizeSingleLineText(
    profileIdentity?.identityKey
  ).trim();
  if (identityKey) {
    return identityKey.toLowerCase();
  }
  const profileId = sanitizeSingleLineText(profileIdentity?.profileId).trim();
  if (profileId) {
    return profileId.toLowerCase();
  }
  const profileName =
    sanitizeSingleLineText(profileIdentity?.profileName).trim() ||
    sanitizeSingleLineText(label).trim() ||
    "unknown";
  const profileKind = sanitizeSingleLineText(profileIdentity?.kind).trim();
  return `${profileName.toLowerCase()}::${profileKind.toLowerCase()}`;
}

function resolveBuiltinAgentControllerBrandForIdentity(
  profileIdentity: ProfileColorIdentityLike
): BuiltinAgentControllerBrand | null {
  if (profileIdentity?.kind !== "agent") {
    return null;
  }

  return resolveBuiltinAgentControllerBrand(profileIdentity.agentControllerRef);
}

function shouldColorizeProfileIdentity(
  profileIdentity: ProfileColorIdentityLike
): boolean {
  if (profileIdentity?.kind === "human") {
    return HUMAN_PROFILE_NAME_COLOR_ENABLED;
  }

  if (profileIdentity?.kind === "agent") {
    return (
      resolveBuiltinAgentControllerBrandForIdentity(profileIdentity) !== null
    );
  }

  return true;
}

function stableHash(value: string): number {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 131 + char.charCodeAt(0)) % 2_147_483_647;
  }
  return hash;
}

function toStableProfileRgb(
  key: string,
  profileIdentity: ProfileColorIdentityLike,
  spaceMembersSnapshot: SpaceMembersSnapshot | null
): RgbColor {
  const paletteSeed = resolveProfilePaletteSeed(
    key,
    profileIdentity,
    spaceMembersSnapshot
  );
  const saturation = 58 + (Math.floor(paletteSeed.hash / 359) % 18);
  const lightness = 52 + (Math.floor(paletteSeed.hash / 131) % 12);
  return hslToRgb(paletteSeed.hue, saturation / 100, lightness / 100);
}

function resolveProfilePaletteSeed(
  label: string,
  profileIdentity: ProfileColorIdentityLike,
  spaceMembersSnapshot: SpaceMembersSnapshot | null
): { hash: number; hue: number } {
  const colorKey = resolveProfileColorKey(label, profileIdentity);
  const hash = stableHash(colorKey);
  const scopedHue = resolveSpaceScopedProfileHue({
    colorKey,
    spaceMembersSnapshot,
  });
  if (scopedHue !== null) {
    return {
      hash,
      hue: scopedHue,
    };
  }
  const hueAnchors = resolveProfileAccentHueAnchors(profileIdentity);
  const anchor = hueAnchors[hash % hueAnchors.length] ?? 210;
  const variant =
    Math.floor(hash / hueAnchors.length) % PROFILE_ACCENT_VARIANTS;
  const hueOffset =
    (variant - Math.floor(PROFILE_ACCENT_VARIANTS / 2)) *
    PROFILE_ACCENT_HUE_STEP_DEGREES;

  return {
    hash,
    hue: normalizeHue(anchor + hueOffset),
  };
}

function resolveProfileAccentHueAnchors(
  profileIdentity: ProfileColorIdentityLike
): readonly number[] {
  return profileIdentity?.kind === "agent"
    ? AGENT_PROFILE_ACCENT_HUE_ANCHORS
    : PERSON_PROFILE_ACCENT_HUE_ANCHORS;
}

function resolveSpaceScopedProfileHue(input: {
  colorKey: string;
  spaceMembersSnapshot: SpaceMembersSnapshot | null;
}): number | null {
  const snapshot = input.spaceMembersSnapshot;
  if (!snapshot) {
    return null;
  }

  const scope = resolveProfileColorScope(snapshot);
  return scope.hueByIdentity.get(input.colorKey) ?? null;
}

function resolveProfileColorScope(
  snapshot: SpaceMembersSnapshot
): ProfileColorScope {
  const cachedScope = profileColorScopeCache.get(snapshot);
  if (cachedScope) {
    return cachedScope;
  }

  const scope: ProfileColorScope = {
    hueByIdentity: buildScopedHueAssignments({
      baseHue: resolveSpaceScopedBaseHue(snapshot.spaceId),
      identities: collectScopedColorIdentities(snapshot),
    }),
  };
  profileColorScopeCache.set(snapshot, scope);
  return scope;
}

function buildScopedHueAssignments(input: {
  baseHue: number;
  identities: readonly ProfileColorIdentityLike[];
}): Map<string, number> {
  const uniqueColorKeys = [
    ...new Set(
      input.identities
        .map((identity) =>
          resolveProfileColorKey(identity?.profileName ?? "", identity)
        )
        .filter((colorKey) => colorKey.length > 0)
    ),
  ].sort((left, right) => {
    const leftHash = stableHash(left);
    const rightHash = stableHash(right);
    if (leftHash !== rightHash) {
      return leftHash - rightHash;
    }
    return left.localeCompare(right);
  });

  const assignments = new Map<string, number>();
  const assignedHues: number[] = [];
  const candidateHues = buildSpaceScopedHueCandidates(input.baseHue);
  for (const [index, colorKey] of uniqueColorKeys.entries()) {
    const preferredHue = resolveSpaceScopedPreferredHue({
      baseHue: input.baseHue,
      colorKey,
      index,
    });
    const assignedHue = chooseSpaceScopedHue({
      assignedHues,
      candidateHues,
      preferredHue,
    });
    assignments.set(colorKey, assignedHue);
    assignedHues.push(assignedHue);
  }
  return assignments;
}

function buildSpaceScopedHueCandidates(baseHue: number): readonly number[] {
  const candidates = new Set<number>();

  for (
    let stepIndex = 0;
    stepIndex < SPACE_SCOPED_MIN_CANDIDATE_COUNT;
    stepIndex += 1
  ) {
    const stepHue = stepIndex * SPACE_SCOPED_PRIMARY_HUE_STEP_DEGREES;
    for (
      let wrapIndex = 0;
      wrapIndex < SPACE_SCOPED_WRAP_COUNT;
      wrapIndex += 1
    ) {
      candidates.add(
        normalizeHue(
          baseHue + stepHue + wrapIndex * SPACE_SCOPED_WRAP_SHIFT_DEGREES
        )
      );
    }
  }

  return [...candidates];
}

function resolveSpaceScopedPreferredHue(input: {
  baseHue: number;
  colorKey: string;
  index: number;
}): number {
  return normalizeHue(
    input.baseHue +
      stableHash(input.colorKey) +
      input.index * Math.round(SPACE_SCOPED_GOLDEN_ANGLE_DEGREES)
  );
}

function chooseSpaceScopedHue(input: {
  assignedHues: readonly number[];
  candidateHues: readonly number[];
  preferredHue: number;
}): number {
  if (input.assignedHues.length === 0) {
    return (
      input.candidateHues
        .toSorted(
          (left, right) =>
            circularHueDistance(left, input.preferredHue) -
              circularHueDistance(right, input.preferredHue) || left - right
        )
        .at(0) ?? input.preferredHue
    );
  }

  return (
    input.candidateHues
      .toSorted((left, right) => {
        const leftMinDistance = resolveMinimumAssignedHueDistance(
          left,
          input.assignedHues
        );
        const rightMinDistance = resolveMinimumAssignedHueDistance(
          right,
          input.assignedHues
        );
        if (leftMinDistance !== rightMinDistance) {
          return rightMinDistance - leftMinDistance;
        }

        const leftPreferredDistance = circularHueDistance(
          left,
          input.preferredHue
        );
        const rightPreferredDistance = circularHueDistance(
          right,
          input.preferredHue
        );
        if (leftPreferredDistance !== rightPreferredDistance) {
          return leftPreferredDistance - rightPreferredDistance;
        }

        return left - right;
      })
      .at(0) ?? input.preferredHue
  );
}

function resolveMinimumAssignedHueDistance(
  hue: number,
  assignedHues: readonly number[]
): number {
  let minimumDistance = Number.POSITIVE_INFINITY;
  for (const assignedHue of assignedHues) {
    minimumDistance = Math.min(
      minimumDistance,
      circularHueDistance(hue, assignedHue)
    );
  }
  return Number.isFinite(minimumDistance) ? minimumDistance : 0;
}

function circularHueDistance(left: number, right: number): number {
  const distance = Math.abs(normalizeHue(left) - normalizeHue(right));
  return Math.min(distance, 360 - distance);
}

function collectScopedColorIdentities(
  snapshot: SpaceMembersSnapshot
): ProfileColorIdentityLike[] {
  const identities: ProfileColorIdentityLike[] = [];

  for (const human of snapshot.humans) {
    identities.push(
      resolvePersonColorIdentity({
        ownerUserId: human.ownerUserId,
        ownerName: human.ownerName,
        profileId: human.profileId,
        profileName: human.profileName,
      })
    );
  }

  for (const agent of snapshot.agents) {
    identities.push(
      resolveAgentColorIdentity({
        agentControllerRef: agent.agentControllerRef,
        profileId: agent.profileId,
        profileName: agent.profileName,
      })
    );
    identities.push(
      resolvePersonColorIdentity({
        ownerUserId: agent.ownerUserId,
        ownerName: agent.ownerName,
        profileName: agent.ownerName,
      })
    );
    identities.push(
      resolvePersonColorIdentity({
        ownerUserId: agent.addedByOwnerUserId,
        ownerName: agent.addedByDisplayName,
        profileId: agent.addedByProfileId,
        profileName: agent.addedByDisplayName,
      })
    );
  }

  return identities;
}

function normalizeHue(value: number): number {
  const normalized = value % 360;
  return normalized >= 0 ? normalized : normalized + 360;
}

function deriveBuiltinControllerBrandSurfaceRgb(
  brand: BuiltinAgentControllerBrand
): RgbColor {
  const [red, green, blue] = brand.accentRgb;
  const { hue } = rgbToHsl(red, green, blue);
  return hslToRgb(hue, 0.24, 0.18);
}

function resolveSpaceScopedBaseHue(spaceId: string): number {
  const normalizedSpaceId = sanitizeSingleLineText(spaceId)
    .trim()
    .toLowerCase();
  if (!normalizedSpaceId) {
    return SPACE_SCOPED_BASE_HUE;
  }

  return normalizeHue(
    SPACE_SCOPED_BASE_HUE +
      (stableHash(normalizedSpaceId) %
        Math.round(SPACE_SCOPED_GOLDEN_ANGLE_DEGREES))
  );
}

function hslToRgb(
  hue: number,
  saturation: number,
  lightness: number
): RgbColor {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const huePrime = hue / 60;
  const second = chroma * (1 - Math.abs((huePrime % 2) - 1));

  let red = 0;
  let green = 0;
  let blue = 0;

  if (huePrime >= 0 && huePrime < 1) {
    red = chroma;
    green = second;
  } else if (huePrime < 2) {
    red = second;
    green = chroma;
  } else if (huePrime < 3) {
    green = chroma;
    blue = second;
  } else if (huePrime < 4) {
    green = second;
    blue = chroma;
  } else if (huePrime < 5) {
    red = second;
    blue = chroma;
  } else {
    red = chroma;
    blue = second;
  }

  const match = lightness - chroma / 2;
  return {
    r: Math.round((red + match) * 255),
    g: Math.round((green + match) * 255),
    b: Math.round((blue + match) * 255),
  };
}

function rgbToHsl(
  red: number,
  green: number,
  blue: number
): {
  hue: number;
  lightness: number;
  saturation: number;
} {
  const normalizedRed = red / 255;
  const normalizedGreen = green / 255;
  const normalizedBlue = blue / 255;
  const max = Math.max(normalizedRed, normalizedGreen, normalizedBlue);
  const min = Math.min(normalizedRed, normalizedGreen, normalizedBlue);
  const chroma = max - min;
  const lightness = (max + min) / 2;

  if (chroma === 0) {
    return { hue: 0, lightness, saturation: 0 };
  }

  const saturation = chroma / (1 - Math.abs(2 * lightness - 1));

  let huePrime = 0;
  if (max === normalizedRed) {
    huePrime = (normalizedGreen - normalizedBlue) / chroma;
  } else if (max === normalizedGreen) {
    huePrime = (normalizedBlue - normalizedRed) / chroma + 2;
  } else {
    huePrime = (normalizedRed - normalizedGreen) / chroma + 4;
  }

  return {
    hue: normalizeHue(huePrime * 60),
    lightness,
    saturation,
  };
}

function toAnsiTrueColorColorize(color: RgbColor): ColorizeFn {
  if (!pc.isColorSupported) {
    return (value: string | number | null | undefined) => String(value ?? "");
  }
  const open = `\u001B[38;2;${String(color.r)};${String(color.g)};${String(color.b)}m`;
  const close = "\u001B[39m";
  return (value: string | number | null | undefined) =>
    `${open}${String(value ?? "")}${close}`;
}

function resolveDisplayProfileColorTarget(input: {
  profileIdentity: DisplayProfileColorInput | undefined;
  spaceMembersSnapshot?: SpaceMembersSnapshot | null;
}): DisplayProfileColorTarget {
  const profileIdentity = resolveDisplayProfileIdentity(input);
  return resolveDisplayProfileKind(profileIdentity) === "agent"
    ? {
        kind: "agent",
        identity: resolveAgentColorIdentity({
          agentControllerRef: profileIdentity.agentControllerRef,
          profileId:
            profileIdentity.profileId ?? profileIdentity.openMeldProfileId,
          profileName: profileIdentity.profileName,
        }),
      }
    : {
        kind: "person",
        identity: resolvePersonColorIdentity({
          ownerUserId: profileIdentity.ownerUserId,
          ownerName: profileIdentity.ownerName,
          profileId:
            profileIdentity.profileId ?? profileIdentity.openMeldProfileId,
          profileName: profileIdentity.profileName,
        }),
      };
}

function resolveDisplayProfileKind(
  profileIdentity: DisplayProfileColorInput | undefined
): "human" | "agent" | "system" | "" {
  const normalizedKind = sanitizeSingleLineText(
    profileIdentity?.kind ?? profileIdentity?.profileKind
  )
    .trim()
    .toLowerCase();
  if (
    normalizedKind === "human" ||
    normalizedKind === "agent" ||
    normalizedKind === "system"
  ) {
    return normalizedKind;
  }
  return "";
}

function normalizeDisplayProfileColorInput(
  profileIdentity: DisplayProfileColorInput | undefined
): DisplayProfileColorInput {
  if (!profileIdentity) {
    return {};
  }

  const profileId = sanitizeSingleLineText(
    profileIdentity.openMeldProfileId ?? profileIdentity.profileId
  ).trim();
  const profileName = sanitizeSingleLineText(
    profileIdentity.profileName
  ).trim();
  const agentControllerRef = sanitizeSingleLineText(
    profileIdentity.agentControllerRef
  ).trim();
  const owner = sanitizeSingleLineText(profileIdentity.owner).trim();
  const ownerUserId = sanitizeSingleLineText(
    profileIdentity.ownerUserId
  ).trim();
  const ownerName = sanitizeSingleLineText(profileIdentity.ownerName).trim();
  const kind = sanitizeSingleLineText(
    profileIdentity.kind ?? profileIdentity.profileKind
  ).trim();

  return {
    ...(kind ? { kind } : {}),
    ...(agentControllerRef ? { agentControllerRef } : {}),
    ...(owner ? { owner } : {}),
    ...(ownerName ? { ownerName } : {}),
    ...(ownerUserId ? { ownerUserId } : {}),
    ...(profileId ? { profileId } : {}),
    ...(profileName ? { profileName } : {}),
  };
}

function findMatchingHumanSnapshot(input: {
  profileIdentity: DisplayProfileColorInput;
  spaceMembersSnapshot: SpaceMembersSnapshot;
}) {
  const profileId = sanitizeSingleLineText(
    input.profileIdentity.openMeldProfileId ?? input.profileIdentity.profileId
  ).trim();
  if (!profileId) {
    return null;
  }
  return (
    input.spaceMembersSnapshot.humans.find(
      (humanSnapshot) =>
        humanSnapshot.status === "active" &&
        sanitizeSingleLineText(humanSnapshot.profileId).trim() === profileId
    ) ?? null
  );
}

function findMatchingAgentSnapshot(input: {
  profileIdentity: DisplayProfileColorInput;
  spaceMembersSnapshot: SpaceMembersSnapshot;
}) {
  const profileId = sanitizeSingleLineText(
    input.profileIdentity.openMeldProfileId ?? input.profileIdentity.profileId
  ).trim();
  if (!profileId) {
    return null;
  }

  return (
    input.spaceMembersSnapshot.agents.find(
      (agentSnapshot) =>
        agentSnapshot.status === "active" &&
        sanitizeSingleLineText(agentSnapshot.profileId).trim() === profileId
    ) ?? null
  );
}
