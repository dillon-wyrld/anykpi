import { Anykpi, identify, init, track } from "./index";
import type { AnykpiConfig, EventProperties, User } from "./types";

export type AnykpiBrowserApi = {
  init: typeof init;
  identify: typeof identify;
  track: typeof track;
  Anykpi: typeof Anykpi;
};

export type AnykpiBrowserScope = {
  anykpi?: unknown;
  Anykpi?: typeof Anykpi;
};

type QueuedCommand = [string, ...unknown[]];

function queueFrom(existing: unknown): QueuedCommand[] {
  if (Array.isArray(existing)) {
    return existing.filter(
      (item): item is QueuedCommand => Array.isArray(item) && typeof item[0] === "string"
    );
  }

  if (existing && typeof existing === "object" && "q" in existing) {
    const queued = (existing as { q: unknown }).q;
    if (Array.isArray(queued)) {
      return queued.filter(
        (item): item is QueuedCommand => Array.isArray(item) && typeof item[0] === "string"
      );
    }
  }

  return [];
}

function applyCommand(api: AnykpiBrowserApi, command: QueuedCommand): void {
  const [method, ...args] = command;
  if (method === "init") {
    api.init(args[0] as AnykpiConfig);
    return;
  }
  if (method === "identify") {
    void api.identify(args[0] as User);
    return;
  }
  if (method === "track") {
    void api.track(args[0] as string, args[1] as EventProperties | undefined);
  }
}

export function installAnykpiBrowser(scope: AnykpiBrowserScope): AnykpiBrowserApi {
  const queued = queueFrom(scope.anykpi);
  const api: AnykpiBrowserApi = {
    init,
    identify,
    track,
    Anykpi,
  };

  for (const command of queued) {
    applyCommand(api, command);
  }

  scope.anykpi = api;
  scope.Anykpi = Anykpi;
  return api;
}
