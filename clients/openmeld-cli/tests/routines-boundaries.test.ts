import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routinesDirectory = new URL("../src/routines/", import.meta.url);
const routinesSource = readdirSync(routinesDirectory)
  .filter((name) => name.endsWith(".ts"))
  .map((name) => readFileSync(new URL(name, routinesDirectory), "utf8"))
  .join("\n");

describe("Routines CLI boundaries", () => {
  it("resolves organization context only through the shared Center Agent resolver", () => {
    expect(routinesSource).toContain("resolveCenterAgentCommandContext");
    expect(routinesSource).not.toContain("getAuthSessionState");
    expect(routinesSource).not.toContain("resolveOpenMeldProfile");
    expect(routinesSource).not.toContain("createOrganizationApi");
  });

  it("uses the API client Routines surface without direct transport calls", () => {
    expect(routinesSource).toContain("createRoutinesApi");
    expect(routinesSource).not.toContain("fetch(");
    expect(routinesSource).not.toContain("D1");
    expect(routinesSource).not.toContain("RPC");
  });
});
