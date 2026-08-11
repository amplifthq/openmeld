import type { ReactNode } from "react";

/**
 * Phase-0 shell contract (types only) — the frozen interface both the Web and
 * Desktop tracks build against. See developing/clients/shell-and-settings.md.
 *
 * Hard rule: these primitives are PURELY PRESENTATIONAL. Navigation, data,
 * persistence, and window chrome are ALWAYS injected via props — this module
 * never imports a router, a query client, storage, or electron. The boundary is
 * enforced by ui-boundary.test.ts (which also forbids direct browser storage,
 * so a vendored engine cannot self-persist).
 */

/** A top-level destination in the persistent outer rail (Spaces, Settings, …). */
export type RailDestination = {
  id: string;
  label: string;
  /** Optional icon node; the host supplies the actual icon component. */
  icon?: ReactNode;
  /** Optional platform-neutral nav target (e.g. a route path on Web). The host
   * decides how to use it; Desktop may ignore it and navigate by `id`. Keeps
   * the rail from forcing every host to keep a separate id→route map. */
  to?: string;
};

/** Renders a destination as a navigable element — Web injects a router Link,
 * Desktop injects a plain button. Keeps the rail router-agnostic. */
export type RenderRailLink = (
  destination: RailDestination,
  children: ReactNode
) => ReactNode;

/**
 * The single app frame that composes every top-level view via named slots.
 * Space = railIcon + railList(spaces) + content(conversation) + aside(members).
 * Settings = railIcon + railList(settings nav) + content(routed panel).
 */
export type AppFrameProps = {
  /** Outer rail: persistent top-level destination switcher. */
  destinations: readonly RailDestination[];
  activeDestinationId: string;
  onNavigate: (destinationId: string) => void;
  /** Injected navigation rendering (router Link on Web, button on Desktop). */
  renderRailLink?: RenderRailLink;
  /** Outer rail layout. `icon` matches the collapsed Web rail; `expanded` is a
   * fixed-open rail for hosts that do not wire resize/collapse yet. */
  railMode?: "icon" | "expanded";
  /** Full-width outer rail header. Hosts use this when the brand/header geometry
   * is client-specific, such as Desktop window-chrome spacing. */
  railHeader?: ReactNode;
  /** Brand mark pinned to the top of the outer rail (e.g. the OpenMeld logo). */
  brand?: ReactNode;
  /** Account affordance pinned to the bottom of the outer rail. */
  account?: ReactNode;
  /** Optional inner secondary rail (resizable list): spaces list, settings nav. */
  railList?: ReactNode;
  /** Optional per-view context header band that stays put while content scrolls
   * (e.g. the Space header: title + live dot + members/share). Sits above
   * `content`, inside the frame, below any window chrome. */
  header?: ReactNode;
  /** Required main content region (scrollable): conversation or settings panel. */
  content: ReactNode;
  /** Optional right drawer (e.g. the Space members panel). */
  aside?: ReactNode;
};
