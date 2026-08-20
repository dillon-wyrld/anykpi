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
export const BATCH_PATH = "/api/ingest/batch";

const DEFAULT_FLUSH_INTERVAL_MS = 0;
const DEFAULT_RETRY_DELAY_MS = 50;
const DEFAULT_MAX_RETRIES = 8;
const MAX_BATCH_EVENTS = 1000;

type BufferedEvent = {
  userId: string;
  event: string;
  properties: EventProperties;
  timestamp: string;
  idempotencyKey: string;
};

type FlushGate = {
  promise: Promise<void>;
  resolve: () => void;
};

let singleton: Anykpi | null = null;

function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/\/+$/, "");
}

function newIdempotencyKey(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  return `ik_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer === "object" && timer && "unref" in timer) {
      (timer as { unref: () => void }).unref();
    }
  });
}

function shouldRetryStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === "object" && timer && "unref" in timer) {
    (timer as { unref: () => void }).unref();
  }
}

export class Anykpi {
  private readonly config: Required<
    Pick<
      AnykpiConfig,
      | "endpoint"
      | "workspaceId"
      | "debug"
      | "flushIntervalMs"
      | "retryDelayMs"
      | "maxRetries"
    >
  > &
    Pick<AnykpiConfig, "apiKey">;
  private user: User | null = null;
  private queue: BufferedEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private gate: FlushGate | null = null;
  private sending = false;

  constructor(config: AnykpiConfig) {
    this.config = {
      endpoint: normalizeEndpoint(config.endpoint),
      workspaceId: config.workspaceId || "live",
      apiKey: config.apiKey,
      debug: config.debug ?? false,
      flushIntervalMs: config.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
      retryDelayMs: config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
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
    return this.postJson(IDENTIFY_PATH, {
      userId: user.userId,
      properties: user.properties || {},
      timestamp: new Date().toISOString(),
      workspaceId: this.config.workspaceId,
    })
      .then(() => undefined)
      .catch((error: unknown) => {
        console.error("[ANYKPI] Failed to send event", error);
      });
  }

  track(eventName: string, properties?: EventProperties): Promise<void> {
    if (!this.user) {
      console.warn("[ANYKPI] track() called before identify()");
      return Promise.resolve();
    }

    this.queue.push({
      userId: this.user.userId,
      event: eventName,
      properties: properties || {},
      timestamp: new Date().toISOString(),
      idempotencyKey: newIdempotencyKey(),
    });

    if (this.queue.length >= MAX_BATCH_EVENTS) {
      return this.flush();
    }
    return this.scheduleFlush();
  }

  flush(): Promise<void> {
    const wait = this.ensureGate();
    this.clearFlushTimer();
    if (!this.sending) {
      void this.sendLoop();
    }
    return wait;
  }

  private scheduleFlush(): Promise<void> {
    const wait = this.ensureGate();
    if (this.flushTimer === null && !this.sending) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        void this.flush();
      }, this.config.flushIntervalMs);
      unrefTimer(this.flushTimer);
    }
    return wait;
  }

  private ensureGate(): Promise<void> {
    if (!this.gate) {
      let resolve!: () => void;
      const promise = new Promise<void>((res) => {
        resolve = res;
      });
      this.gate = { promise, resolve };
    }
    return this.gate.promise;
  }

  private settleGate(): void {
    const gate = this.gate;
    this.gate = null;
    gate?.resolve();
  }

  private clearFlushTimer(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private async sendLoop(): Promise<void> {
    this.sending = true;
    let drained = false;
    try {
      while (this.queue.length > 0) {
        const snapshot = this.queue.slice(0, MAX_BATCH_EVENTS);
        const sent = await this.postBatch(snapshot);
        if (!sent) break;
        this.queue = this.queue.slice(snapshot.length);
      }
      drained = this.queue.length === 0;
    } finally {
      this.sending = false;
      if (drained && this.queue.length > 0) {
        void this.sendLoop();
      } else {
        this.settleGate();
      }
    }
  }

  private async postBatch(events: BufferedEvent[]): Promise<boolean> {
    const body = {
      workspaceId: this.config.workspaceId,
      events,
    };

    let delay = this.config.retryDelayMs;
    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        const response = await this.postJson(BATCH_PATH, body);
        if (response.ok) return true;
        if (!shouldRetryStatus(response.status)) {
          return true;
        }
      } catch (error: unknown) {
        console.error("[ANYKPI] Failed to send event", error);
      }

      if (attempt + 1 >= this.config.maxRetries) {
        break;
      }
      if (delay > 0) {
        await sleep(delay);
        delay = Math.min(delay * 2, 2000);
      }
    }

    return false;
  }

  private postJson(
    path: string,
    payload: Record<string, unknown>
  ): Promise<Response> {
    const url = `${this.config.endpoint}${path}`;

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
      body: JSON.stringify(payload),
    }).then((response) => {
      if (this.config.debug && !response.ok) {
        console.error("[ANYKPI] Request failed", response.status);
      }
      return response;
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

export function flush(): Promise<void> {
  if (!singleton) return Promise.resolve();
  return singleton.flush();
}

export { browserSnippet } from "./snippet";
export type { BrowserSnippetOptions } from "./snippet";

export default Anykpi;
