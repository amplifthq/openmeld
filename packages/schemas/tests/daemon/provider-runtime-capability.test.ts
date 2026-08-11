import { describe, expect, it } from "vitest";
import {
  daemonRuntimeAdapterCapabilitySnapshotSchema,
  providerRuntimeCapabilityDeclarationSchema,
} from "../../src/index";

const createCapabilityDeclaration = () => ({
  continuationCapability: "standard" as const,
  imageInputCapability: "local_file_path" as const,
  preparationRequirement: "none" as const,
  runtimeWorkingDirectoryMode: "spawn_cwd" as const,
  streamingCapability: "preview_capable" as const,
  workspaceResumeBehavior: "transparent" as const,
});

describe("provider runtime capability schema", () => {
  it("accepts a complete capability declaration", () => {
    const parsed = providerRuntimeCapabilityDeclarationSchema.safeParse(
      createCapabilityDeclaration()
    );

    expect(parsed.success).toBe(true);
  });

  it("accepts a legacy declaration without image input capability", () => {
    const {
      imageInputCapability: _imageInputCapability,
      ...legacyDeclaration
    } = createCapabilityDeclaration();

    const parsed =
      providerRuntimeCapabilityDeclarationSchema.safeParse(legacyDeclaration);

    expect(parsed.success).toBe(true);
  });

  it("rejects a capability declaration with an unknown field", () => {
    const parsed = providerRuntimeCapabilityDeclarationSchema.safeParse({
      ...createCapabilityDeclaration(),
      extraField: true,
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects a capability declaration with an invalid enum value", () => {
    const parsed = providerRuntimeCapabilityDeclarationSchema.safeParse({
      ...createCapabilityDeclaration(),
      runtimeWorkingDirectoryMode: "cwd",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects an unknown image input capability", () => {
    const parsed = providerRuntimeCapabilityDeclarationSchema.safeParse({
      ...createCapabilityDeclaration(),
      imageInputCapability: "remote_url",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects a capability declaration with an invalid workspace resume behavior", () => {
    const parsed = providerRuntimeCapabilityDeclarationSchema.safeParse({
      ...createCapabilityDeclaration(),
      workspaceResumeBehavior: "cross_workspace",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects a runtime adapter capability snapshot with empty transport modes", () => {
    const parsed = daemonRuntimeAdapterCapabilitySnapshotSchema.safeParse({
      adapterId: "codex",
      capabilityDeclaration: createCapabilityDeclaration(),
      defaultStreamingMode: "final",
      transportModes: [],
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts a runtime adapter capability snapshot with Codex App Server transport", () => {
    const parsed = daemonRuntimeAdapterCapabilitySnapshotSchema.safeParse({
      adapterId: "codex",
      capabilityDeclaration: createCapabilityDeclaration(),
      defaultStreamingMode: "final",
      transportModes: ["codex-app-server"],
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects a runtime adapter capability snapshot without capability declaration", () => {
    const parsed = daemonRuntimeAdapterCapabilitySnapshotSchema.safeParse({
      adapterId: "codex",
      defaultStreamingMode: "final",
      transportModes: ["local-cli"],
    });

    expect(parsed.success).toBe(false);
  });
});
