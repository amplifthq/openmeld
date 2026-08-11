import { describe, expect, it } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { createConfiguredMessageChannelProviderRegistry } from "../src/remote-agent/application/message-channel-provider-runtime";

const DB = {} as D1Database;

describe("configured Message Channel provider registry", () => {
  it("stays absent while both provider gates are disabled", () => {
    expect(
      createConfiguredMessageChannelProviderRegistry({
        db: DB,
        env: buildEnv({
          OPENMELD_FEISHU_CHANNEL_ENABLED: "false",
          OPENMELD_LARK_CHANNEL_ENABLED: "false",
        }),
      })
    ).toBeUndefined();
  });

  it("registers only the independently enabled provider", () => {
    const registry = createConfiguredMessageChannelProviderRegistry({
      db: DB,
      env: buildEnv({
        OPENMELD_FEISHU_CHANNEL_ENABLED: "false",
        OPENMELD_LARK_CHANNEL_ENABLED: "true",
      }),
    });

    expect(registry?.require("lark").provider).toBe("lark");
    expect(() => registry?.require("feishu")).toThrow(
      "Message Channel provider feishu is not registered"
    );
  });

  it("can register both brands without creating another orchestration path", () => {
    const registry = createConfiguredMessageChannelProviderRegistry({
      db: DB,
      env: buildEnv({
        OPENMELD_FEISHU_CHANNEL_ENABLED: "true",
        OPENMELD_LARK_CHANNEL_ENABLED: "true",
      }),
    });

    expect(registry?.require("lark").provider).toBe("lark");
    expect(registry?.require("feishu").provider).toBe("feishu");
  });
});

function buildEnv(
  input: Pick<
    CoreBindings,
    "OPENMELD_FEISHU_CHANNEL_ENABLED" | "OPENMELD_LARK_CHANNEL_ENABLED"
  >
): CoreBindings {
  return {
    ...input,
    LARK_OPENMELD_PLATFORM_CREDENTIAL_CRYPTO_KEY: btoa(
      "0123456789abcdef0123456789abcdef"
    ),
    OPENMELD_SPACES: {} as CoreBindings["OPENMELD_SPACES"],
  };
}
