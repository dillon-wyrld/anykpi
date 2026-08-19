import { describe, expect, it } from "vitest";
import { commandsFromHelp } from "./help";
import { createProgram, PUBLISHED_COMMANDS } from "./program";

describe("published CLI surface", () => {
  it("does not advertise connect (wired later)", () => {
    const program = createProgram();
    const names = program.commands.map((command) => command.name());
    const help = program.helpInformation();

    expect(names).not.toContain("connect");
    expect(help).not.toMatch(/\bconnect\b/);
    expect(commandsFromHelp(help)).not.toContain("connect");
  });

  it("lists every real command in --help", () => {
    const program = createProgram();
    const help = program.helpInformation();
    const fromHelp = commandsFromHelp(help);
    const registered = program.commands
      .map((command) => command.name())
      .filter((name) => name !== "help");

    expect(fromHelp).toEqual([...PUBLISHED_COMMANDS]);
    expect(registered).toEqual([...PUBLISHED_COMMANDS]);
    expect(fromHelp).toContain("login");
    expect(fromHelp).toContain("overview");
    expect(fromHelp).toContain("users");
    expect(fromHelp).toContain("cohorts");
    expect(fromHelp).toContain("wbr");
    expect(fromHelp).toContain("calendar");
    expect(fromHelp).toContain("sync");
    expect(fromHelp).toContain("identify");
    expect(fromHelp).toContain("track");
    expect(fromHelp).toContain("workspaces");
  });

  it("exposes login as key", () => {
    const login = createProgram().commands.find((command) => command.name() === "login");
    expect(login?.aliases()).toContain("key");
  });
});
