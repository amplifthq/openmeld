import type { ReactNode } from "react";

/**
 * Phase-0 Settings contract (types only) — the shared FRAME; concrete config
 * rows stay per-client. See developing/clients/shell-and-settings.md §7. Purely
 * presentational + data-agnostic; persistence/data/router are injected.
 */

/**
 * Host capability gate for a settings section. A 3-tier enum (NOT a boolean
 * isDesktop):
 * - CLOUD_ACCOUNT  = signed-in cloud account (the always-present shared tier;
 *                    Account / Computers / Agents need only this).
 * - LOCAL_SERVICE  = the host can drive a local OpenMeld Service (CLI-driven Web or
 *                    Desktop).
 * - ELECTRON_HOST  = the Electron desktop app (open-at-login etc.).
 *
 * Tiers COMPOSE: an ELECTRON_HOST host also has LOCAL_SERVICE and CLOUD_ACCOUNT;
 * a LOCAL_SERVICE host also has CLOUD_ACCOUNT. Declare a host's capabilities via
 * `resolveHostCapabilities` so this invariant is never hand-rolled wrong. (A
 * future BROWSER_HOST tier can be added if a browser-only setting appears.)
 */
export type SettingsCapability =
  | "CLOUD_ACCOUNT"
  | "LOCAL_SERVICE"
  | "ELECTRON_HOST";

/** Coarse host level → the cumulative capability set (enforces tier composition). */
export type SettingsHostLevel = "cloud" | "local-service" | "electron";

export function resolveHostCapabilities(
  level: SettingsHostLevel
): SettingsCapability[] {
  switch (level) {
    case "electron":
      return ["CLOUD_ACCOUNT", "LOCAL_SERVICE", "ELECTRON_HOST"];
    case "local-service":
      return ["CLOUD_ACCOUNT", "LOCAL_SERVICE"];
    default:
      return ["CLOUD_ACCOUNT"];
  }
}

/** Context handed to a section's render fn. `capabilities` lets a section gate
 * its own ROWS (e.g. show "open at login" only when ELECTRON_HOST is present) —
 * row-level gating needs no extra field, just `ctx.capabilities`. */
export type SettingsRenderContext = {
  capabilities: readonly SettingsCapability[];
};

/** A declarative settings section. The runner filters by `requires` ⊆ host. */
export type SettingsSectionDef = {
  id: string;
  title: string;
  /** Sub-section anchor for scroll-spy inside a flat-form leaf panel. */
  anchor?: string;
  /** Optional platform-neutral route target for this section's panel. */
  to?: string;
  /** Capabilities the host must have for this section to appear. */
  requires?: readonly SettingsCapability[];
  render: (context: SettingsRenderContext) => ReactNode;
};

/** Inner-rail nav item — a thin projection of a section, no render fn. */
export type SettingsNavItem = Pick<
  SettingsSectionDef,
  "id" | "title" | "anchor" | "to"
>;

/** Renders a settings nav item as a navigable element (router Link on Web,
 * button on Desktop). Distinct from the outer-rail `RenderRailLink` because a
 * settings item carries `title`/`anchor`/`to`, not a `RailDestination`. */
export type RenderSettingsLink = (
  item: SettingsNavItem,
  children: ReactNode
) => ReactNode;

export type SettingsNavProps = {
  items: readonly SettingsNavItem[];
  activeSectionId: string;
  onNavigate: (sectionId: string) => void;
  renderLink?: RenderSettingsLink;
};

export type SettingsShellProps = {
  /** The inner settings nav (typically `<SettingsNav />`). */
  nav: ReactNode;
  children: ReactNode;
};

/** Lifecycle of one autonomously-saving field/row (per-card save, never a
 * page-level Save). `saved` is the transient success terminal state. */
export type SettingsFieldStatus =
  | "idle"
  | "dirty"
  | "saving"
  | "saved"
  | "error";

export type SettingsSectionProps = {
  id: string;
  title: string;
  description?: string;
  className?: string;
  /** Optional section-level status (e.g. an "unsaved changes" / error banner). */
  status?: SettingsFieldStatus;
  children: ReactNode;
  /** Optional action rendered on the section heading row. */
  action?: ReactNode;
  /** Optional section footer (e.g. a summary or section-level action). */
  footer?: ReactNode;
};

export type SettingsRowProps = {
  label: string;
  description?: string;
  status?: SettingsFieldStatus;
  /** Places the control beside the label or on its own full-width row. */
  layout?: "inline" | "stacked";
  /** Whether to render the row's bottom divider. Defaults to true. */
  showDivider?: boolean;
  /** Error copy shown when `status` is "error". */
  error?: string;
  /** The control slot (switch, input, button …) — owned by the per-client row. */
  control: ReactNode;
};

export type SettingsFieldProps = {
  label?: string;
  status?: SettingsFieldStatus;
  error?: string;
  children: ReactNode;
};

/**
 * Pure capability filter: keep sections whose every required capability is in
 * the host's set. An absent `requires` means always-shown. No fork, no probe.
 */
export function resolveSettingsSections(
  sections: readonly SettingsSectionDef[],
  hostCapabilities: readonly SettingsCapability[]
): SettingsSectionDef[] {
  const host = new Set(hostCapabilities);
  return sections.filter((section) =>
    (section.requires ?? []).every((capability) => host.has(capability))
  );
}

/** Project resolved sections into inner-rail nav items (so both clients don't
 * each hand-roll the same map). Order is preserved. */
export function toSettingsNavItems(
  sections: readonly SettingsSectionDef[]
): SettingsNavItem[] {
  return sections.map((section) => ({
    id: section.id,
    title: section.title,
    anchor: section.anchor,
    to: section.to,
  }));
}
