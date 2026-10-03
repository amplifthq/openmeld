import {
  buildOrganizationPluginsPath,
  type NavigationAction,
  openMeldNavigationTargetSchema,
  openMeldWebUrlSchema,
} from "./navigation-action";
import { MAX_TEXT_LENGTH } from "./schemas/protocol/constants";

const LINK_MARKER = "openmeld-plugin-connection";
// Persisted message links outlive the domain cutover and may be read after a
// rollback. This is content compatibility, not Auth-origin admission.
const APP_ORIGIN_PAIRS = [
  ["https://openmeld.ai", "https://app.openmeld.ai"],
  ["https://staging.openmeld.ai", "https://app.staging.openmeld.ai"],
] as const;
const REPLY_SUFFIX =
  /(?:^|\n\n)\[Open Plugin connection\]\((https?:\/\/[^\s<>()[\]]{1,2400})\)$/u;

/** A normal link keeps persisted replies readable by pre-card clients and Core. */
export function appendPluginConnectionReplyLink(input: {
  action: NavigationAction;
  text: string;
}): string {
  if (input.action.target.kind !== "plugin_connection") {
    return input.text;
  }
  const url = new URL(openMeldWebUrlSchema.parse(input.action.url));
  url.hash = LINK_MARKER;
  const suffix = `\n\n[Open Plugin connection](${url.toString()})`;
  if (suffix.length > 2400) {
    throw new TypeError("Plugin connection URL is too long.");
  }
  if (input.text.endsWith(suffix)) {
    return input.text;
  }
  const truncation = "\n\n[Response truncated by OpenMeld]";
  const available = MAX_TEXT_LENGTH - suffix.length;
  let text = input.text;
  if (text.length > available) {
    let end = available - truncation.length;
    const previous = text.charCodeAt(end - 1);
    if (previous >= 0xd8_00 && previous <= 0xdb_ff) {
      end -= 1;
    }
    text = `${text.slice(0, end)}${truncation}`;
  }
  return `${text.trimEnd()}${suffix}`;
}

/** Presentation only: current APIs still authorize every connection or mutation. */
export function readPluginConnectionReplyLink(input: {
  organizationSlug: string;
  text: string;
  webOrigin: string;
}): { action: NavigationAction; text: string } | null {
  const match = REPLY_SUFFIX.exec(input.text);
  if (!match?.[1]) {
    return null;
  }
  let url: URL;
  let origin: URL;
  try {
    url = new URL(match[1]);
    origin = new URL(input.webOrigin);
  } catch {
    return null;
  }
  if (
    (url.origin !== origin.origin &&
      !APP_ORIGIN_PAIRS.some(
        (pair) =>
          pair.some((value) => value === url.origin) &&
          pair.some((value) => value === origin.origin)
      )) ||
    url.username ||
    url.password ||
    url.hash !== `#${LINK_MARKER}`
  ) {
    return null;
  }
  const prefix = `${buildOrganizationPluginsPath(input.organizationSlug)}/`;
  if (!url.pathname.startsWith(prefix)) {
    return null;
  }
  const scope = url.searchParams.get("scope");
  if (
    [...url.searchParams.keys()].some((key) => key !== "scope") ||
    url.searchParams.getAll("scope").length > 1 ||
    (scope !== null && scope !== "personal" && scope !== "organization")
  ) {
    return null;
  }
  const explicitScope = scope === "personal" ? "member" : "shared";
  const target = openMeldNavigationTargetSchema.safeParse({
    kind: "plugin_connection",
    service: url.pathname.slice(prefix.length),
    scope: scope === null ? "choose" : explicitScope,
  });
  if (!target.success) {
    return null;
  }
  url.hash = "";
  url.protocol = origin.protocol;
  url.host = origin.host;
  return {
    action: {
      label: "Open Plugin connection",
      target: target.data,
      url: url.toString(),
    },
    text: input.text.slice(0, match.index).trimEnd(),
  };
}
