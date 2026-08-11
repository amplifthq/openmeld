import { describe, expect, it, vi } from "vitest";
import {
  listSpaceConfigs,
  upsertSpaceConfig,
  writeSpaceCacheDeletionNoticeState,
  writeSpaceCacheMaintenanceState,
} from "../src/space/local-state";
import { withTempHome } from "./helpers/fs";
import { expectSpaceConfigListItems } from "./helpers/local-state";

const OPENMELD_PROFILE_ID = "mira--aaaa1111";

describe("listSpaceConfigs", () => {
  it("returns known spaces sorted by updatedAt desc", async () => {
    vi.useFakeTimers();
    try {
      await withTempHome(async () => {
        vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
        await upsertSpaceConfig({
          openMeldProfileId: OPENMELD_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: "alpha",
          profileName: "Mira",
        });

        vi.setSystemTime(new Date("2026-01-01T00:00:01.000Z"));
        await upsertSpaceConfig({
          openMeldProfileId: OPENMELD_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: "beta",
          profileName: "Mira",
        });

        const list = expectSpaceConfigListItems(
          await listSpaceConfigs({ openMeldProfileId: OPENMELD_PROFILE_ID })
        );
        expect(list.map((item) => item.space)).toEqual(["beta", "alpha"]);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores maintenance metadata files", async () => {
    vi.useFakeTimers();
    try {
      await withTempHome(async () => {
        vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
        await upsertSpaceConfig({
          openMeldProfileId: OPENMELD_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: "alpha",
          profileName: "Mira",
        });
        await writeSpaceCacheMaintenanceState({
          openMeldProfileId: OPENMELD_PROFILE_ID,
          lastRunAt: "2026-01-01T00:00:00.000Z",
        });

        const list = expectSpaceConfigListItems(
          await listSpaceConfigs({ openMeldProfileId: OPENMELD_PROFILE_ID })
        );
        expect(list).toHaveLength(1);
        expect(list[0]?.space).toBe("alpha");
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores deletion notice metadata files", async () => {
    vi.useFakeTimers();
    try {
      await withTempHome(async () => {
        vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
        await upsertSpaceConfig({
          openMeldProfileId: OPENMELD_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: "alpha",
          profileName: "Mira",
        });
        await writeSpaceCacheDeletionNoticeState({
          openMeldProfileId: OPENMELD_PROFILE_ID,
          seen: {
            "gateway.openmeld.invalid:alpha": "2026-01-01T00:00:00.000Z",
          },
        });

        const list = expectSpaceConfigListItems(
          await listSpaceConfigs({ openMeldProfileId: OPENMELD_PROFILE_ID })
        );
        expect(list).toHaveLength(1);
        expect(list[0]?.space).toBe("alpha");
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
