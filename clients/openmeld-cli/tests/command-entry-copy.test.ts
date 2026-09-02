import { describe, expect, it } from "vitest";
import { getCommandEntryCopy } from "../src/command-entry-checks/command-entry-copy";

describe("command entry copy", () => {
  it("defines root copy as an OpenMeld home action", () => {
    expect(getCommandEntryCopy("root")).toEqual({
      signInAction: null,
      profileAction: null,
      cliUpdateAction: "opening OpenMeld",
      serviceAction: null,
    });
  });

  it("defines uninstall copy as a local-only action", () => {
    expect(getCommandEntryCopy("uninstall")).toEqual({
      signInAction: null,
      profileAction: null,
      cliUpdateAction: "uninstalling OpenMeld",
      serviceAction: null,
    });
  });

  it("keeps standalone service follow-up copy off read and space entry flows", () => {
    expect(getCommandEntryCopy("space.create").serviceAction).toBeNull();
    expect(getCommandEntryCopy("space.join").serviceAction).toBeNull();
    expect(getCommandEntryCopy("space.watch").serviceAction).toBeNull();
  });

  it("describes Space Board as a read action", () => {
    expect(getCommandEntryCopy("space.board")).toEqual({
      signInAction: "reading a space board",
      profileAction: "reading a space board",
      cliUpdateAction: "reading a space board",
      serviceAction: null,
    });
  });

  it("describes the Space member directory as a read action", () => {
    expect(getCommandEntryCopy("space.members")).toEqual({
      signInAction: "reading the Space member directory",
      profileAction: "reading the Space member directory",
      cliUpdateAction: "reading the Space member directory",
      serviceAction: null,
    });
  });

  it("describes profile add commands with explicit profile-kind language", () => {
    expect(getCommandEntryCopy("space.add-me")).toEqual({
      signInAction: "adding yourself to a space",
      profileAction: "adding yourself to a space",
      cliUpdateAction: "adding yourself to a space",
      serviceAction: null,
    });
    expect(getCommandEntryCopy("space.add-agents")).toEqual({
      signInAction: "adding agent profiles to a space",
      profileAction: "adding agent profiles to a space",
      cliUpdateAction: "adding agent profiles to a space",
      serviceAction: null,
    });
    expect(getCommandEntryCopy("space.add-human-profiles")).toEqual({
      signInAction: "adding human profiles to a space",
      profileAction: "adding human profiles to a space",
      cliUpdateAction: "adding human profiles to a space",
      serviceAction: null,
    });
    expect(getCommandEntryCopy("space.add-members")).toEqual({
      signInAction: "adding members to a space",
      profileAction: "adding members to a space",
      cliUpdateAction: "adding members to a space",
      serviceAction: null,
    });
  });

  it("does not ask for a selected profile before service run", () => {
    expect(getCommandEntryCopy("service.run")).toEqual({
      signInAction: "starting OpenMeld Service",
      profileAction: null,
      cliUpdateAction: "starting OpenMeld Service",
      serviceAction: "starting OpenMeld Service",
    });
  });

  it("describes setup as the canonical local setup command", () => {
    expect(getCommandEntryCopy("setup")).toEqual({
      signInAction: null,
      profileAction: null,
      cliUpdateAction: "setting up OpenMeld on this computer",
      serviceAction: null,
    });
  });

  it("describes computer commands with user-facing computer language", () => {
    expect(getCommandEntryCopy("computer.list")).toEqual({
      signInAction: "listing computers",
      profileAction: null,
      cliUpdateAction: "listing computers",
      serviceAction: null,
    });
    expect(getCommandEntryCopy("computer.current")).toEqual({
      signInAction: "showing this computer",
      profileAction: null,
      cliUpdateAction: "showing this computer",
      serviceAction: null,
    });
    expect(getCommandEntryCopy("computer.rename")).toEqual({
      signInAction: "renaming this computer",
      profileAction: null,
      cliUpdateAction: "renaming this computer",
      serviceAction: "renaming this computer",
    });
  });

  it("describes profile show as a read action", () => {
    expect(getCommandEntryCopy("profile.show")).toEqual({
      signInAction: "showing a profile",
      profileAction: null,
      cliUpdateAction: "showing a profile",
      serviceAction: null,
    });
  });

  it("describes exact session recovery without implying a profile scan", () => {
    expect(getCommandEntryCopy("profile.current-session")).toEqual({
      signInAction: "finding this Agent session's profile",
      profileAction: null,
      cliUpdateAction: "finding this Agent session's profile",
      serviceAction: null,
    });
  });
});
