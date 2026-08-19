export type {
  AnykpiConfig,
  EventProperties,
  JsonPrimitive,
  User,
  UserProperties,
} from "./types";
import type { AnykpiConfig, EventProperties, User } from "./types";

export const IDENTIFY_PATH = "/api/ingest/identify";
export const EVENT_PATH = "/api/ingest/event";

let singleton: Anykpi | null = null;

function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/\/+$/, "");
}

export class Anykpi {
  private readonly config: Required<Pick<AnykpiConfig, "endpoint" | "workspaceId" | "debug">> &
    Pick<AnykpiConfig, "apiKey">;
  private user: User | null = null;

  constructor(config: AnykpiConfig) {
    this.config = {
      endpoint: normalizeEndpoint(config.endpoint),
      workspaceId: config.workspaceId || "live",
      apiKey: config.apiKey,
      debug: config.debug ?? false,
    };

    if (this.config.debug) {
      console.log("[ANYKPI] Initialized", {
        endpoint: this.config.endpoint,
        workspaceId: this.config.workspaceId,
      });
    }
  }

  identify(user: User): Promise<void> {
    this.user = user;
    return this.send(IDENTIFY_PATH, {
      userId: user.userId,
      properties: user.properties || {},
      timestamp: new Date().toISOString(),
    });
  }

  track(eventName: string, properties?: EventProperties): Promise<void> {
    if (!this.user) {
      console.warn("[ANYKPI] track() called before identify()");
      return Promise.resolve();
    }

    return this.send(EVENT_PATH, {
      userId: this.user.userId,
      event: eventName,
      properties: properties || {},
      timestamp: new Date().toISOString(),
    });
  }

  private send(path: string, payload: Record<string, unknown>): Promise<void> {
    const url = `${this.config.endpoint}${path}`;
    const body = {
      ...payload,
      workspaceId: this.config.workspaceId,
    };

    if (this.config.debug) {
      console.log("[ANYKPI] Sending", url);
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
      headers["x-api-key"] = this.config.apiKey;
    }

    return fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })
      .then((response) => {
        if (this.config.debug && !response.ok) {
          console.error("[ANYKPI] Request failed", response.status);
        }
      })
      .catch((error: unknown) => {
        console.error("[ANYKPI] Failed to send event", error);
      });
  }
}

export function init(config: AnykpiConfig): Anykpi {
  singleton = new Anykpi(config);
  return singleton;
}

export function identify(user: User): Promise<void> {
  if (!singleton) {
    console.warn("[ANYKPI] identify() called before init()");
    return Promise.resolve();
  }
  return singleton.identify(user);
}

export function track(eventName: string, properties?: EventProperties): Promise<void> {
  if (!singleton) {
    console.warn("[ANYKPI] track() called before init()");
    return Promise.resolve();
  }
  return singleton.track(eventName, properties);
}

export { browserSnippet } from "./snippet";
export type { BrowserSnippetOptions } from "./snippet";

export default Anykpi;
