interface AnykpiConfig {
  endpoint: string;
  workspaceId?: string;
  apiKey?: string;
  debug?: boolean;
}

interface EventProperties {
  [key: string]: string | number | boolean | null;
}

interface User {
  userId: string;
  properties?: {
    name?: string;
    email?: string;
    platform?: string;
    country?: string;
    [key: string]: any;
  };
}

class Anykpi {
  private config: AnykpiConfig;
  private user: User | null = null;

  constructor(config: AnykpiConfig) {
    this.config = {
      workspaceId: "live",
      debug: false,
      ...config,
    };

    if (this.config.debug) {
      console.log("[ANYKPI] Initialized", {
        endpoint: this.config.endpoint,
        workspaceId: this.config.workspaceId,
      });
    }
  }

  identify(user: User): void {
    this.user = user;
    this.send("/ingest/identify", {
      userId: user.userId,
      properties: user.properties || {},
      timestamp: new Date().toISOString(),
    });
  }

  track(eventName: string, properties?: EventProperties): void {
    if (!this.user) {
      console.warn("[ANYKPI] track() called before identify()");
      return;
    }

    this.send("/ingest/event", {
      userId: this.user.userId,
      event: eventName,
      properties: properties || {},
      timestamp: new Date().toISOString(),
    });
  }

  private async send(path: string, payload: any): Promise<void> {
    try {
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
      }

      await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    } catch (error) {
      console.error("[ANYKPI] Failed to send event", error);
    }
  }
}

export default Anykpi;

export function init(config: AnykpiConfig): Anykpi {
  return new Anykpi(config);
}
