/**
 * Commands advertised on `anykpi --help`.
 * Smoke tests run every name this returns (except the built-in `help`).
 */
export function commandsFromHelp(helpText: string): string[] {
  const lines = helpText.split("\n");
  const start = lines.findIndex((line) => line.trim() === "Commands:");
  if (start < 0) {
    throw new Error("anykpi --help has no Commands section");
  }

  const names: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (names.length > 0) break;
      continue;
    }
    const token = trimmed.split(/\s+/)[0];
    const name = token.split("|")[0];
    if (name && name !== "help") {
      names.push(name);
    }
  }
  return names;
}
