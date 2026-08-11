import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { resolveSpaceCommandCliOptions } from "../src/space/command-cli-options";

describe("space command cli options", () => {
  it("inherits gatewayUrl, password, and json across nested space commands", () => {
    const root = new Command("space")
      .option("--gateway-url <url>")
      .option("--profile <id>");
    root.opts = (() => ({
      gatewayUrl: "https://gateway.example",
      profile: "profile-root",
    })) as Command["opts"];

    const contract = new Command("contract")
      .option("--password <value>")
      .option("--json");
    contract.parent = root;
    contract.opts = (() => ({
      password: "secret-0321",
      json: true,
    })) as Command["opts"];

    const set = new Command("set");
    set.parent = contract;
    set.opts = (() => ({})) as Command["opts"];

    expect(resolveSpaceCommandCliOptions(set, {})).toEqual({
      gatewayUrl: "https://gateway.example",
      profile: "profile-root",
      password: "secret-0321",
      json: true,
    });
  });

  it("prefers explicit child options over inherited values", () => {
    const root = new Command("space").option("--profile <id>");
    root.opts = (() => ({
      profile: "profile-root",
    })) as Command["opts"];

    const contract = new Command("contract").option("--password <value>");
    contract.parent = root;
    contract.opts = (() => ({
      password: "secret-parent",
    })) as Command["opts"];

    const set = new Command("set");
    set.parent = contract;
    set.opts = (() => ({})) as Command["opts"];

    expect(
      resolveSpaceCommandCliOptions(set, {
        profile: "profile-child",
        password: "secret-child",
      })
    ).toEqual({
      profile: "profile-child",
      password: "secret-child",
    });
  });
});
