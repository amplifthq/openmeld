import { describe, expect, it } from "vitest";
import * as z from "zod/v4";
import { buildOpenMeldNavigationAction } from "../src/navigation-action";
import {
  appendPluginConnectionReplyLink,
  readPluginConnectionReplyLink,
} from "../src/plugin-connection-reply";
import { MAX_TEXT_LENGTH } from "../src/schemas/protocol/constants";

const origin = "https://openmeld.example";
const legacyEnvelope = z.strictObject({
  text: z.string().max(MAX_TEXT_LENGTH),
  activationTargets: z.array(z.string()),
  referenceTargets: z.array(z.string()),
  replyToSignalId: z.string().optional(),
  navigationAction: z
    .strictObject({
      label: z.string(),
      url: z.url(),
      target: z.union([
        z.strictObject({
          kind: z.literal("organization_app"),
          service: z.literal("github"),
        }),
        z.strictObject({ kind: z.literal("space"), spaceId: z.string() }),
      ]),
    })
    .optional(),
});

describe("Plugin connection reply compatibility", () => {
  it.each([
    "member",
    "shared",
    "choose",
  ] as const)("retains %s setup through text, old readers and a current presentation", (scope) => {
    const action = buildOpenMeldNavigationAction({
      organizationWebUrl: `${origin}/o/acme`,
      target: { kind: "plugin_connection", service: "linear", scope },
    });
    const text = appendPluginConnectionReplyLink({
      action,
      text: "Connect to continue.",
    });
    const wire = legacyEnvelope.parse({
      text,
      activationTargets: [],
      referenceTargets: [],
      replyToSignalId: "original-message",
    });
    expect(wire.replyToSignalId).toBe("original-message");
    expect(
      readPluginConnectionReplyLink({
        organizationSlug: "acme",
        text: wire.text,
        webOrigin: origin,
      })
    ).toEqual({ action, text: "Connect to continue." });
    expect(appendPluginConnectionReplyLink({ action, text })).toBe(text);
  });

  it.each([
    `${origin}/o/other/plugins/github?scope=personal`,
    "https://untrusted.example/o/acme/plugins/github?scope=personal",
    `${origin}/o/acme/plugins/github?scope=personal&scope=organization`,
    `${origin}/o/acme/plugins/github?scope=personal&token=not-allowed`,
    `${origin}/o/acme/plugins/unknown?scope=personal`,
    `${origin}/o/acme/plugins/github?scope=automatic`,
  ])("does not enhance a foreign or ambiguous link: %s", (url) => {
    expect(
      readPluginConnectionReplyLink({
        organizationSlug: "acme",
        webOrigin: origin,
        text: `Ready.\n\n[Open Plugin connection](${url}#openmeld-plugin-connection)`,
      })
    ).toBeNull();
  });

  it("reserves room for the recoverable link in an oversized Unicode reply", () => {
    const text = appendPluginConnectionReplyLink({
      action: buildOpenMeldNavigationAction({
        organizationWebUrl: `${origin}/o/acme`,
        target: {
          kind: "plugin_connection",
          service: "github",
          scope: "shared",
        },
      }),
      text: "🚀".repeat(MAX_TEXT_LENGTH),
    });
    expect(text.length).toBeLessThanOrEqual(MAX_TEXT_LENGTH);
    expect(text.isWellFormed()).toBe(true);
    const parsed = readPluginConnectionReplyLink({
      organizationSlug: "acme",
      webOrigin: origin,
      text,
    });
    expect(parsed?.text.endsWith("[Response truncated by OpenMeld]")).toBe(
      true
    );
    expect(parsed?.action.target).toEqual({
      kind: "plugin_connection",
      service: "github",
      scope: "shared",
    });
  });
});
