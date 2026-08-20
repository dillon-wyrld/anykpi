"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

type SessionState = "loading" | "in" | "out";

type WorkspaceSessionValue = {
  workspace: string;
  status: SessionState;
  enter: () => void;
  logout: () => Promise<void>;
};

const WorkspaceSessionContext = createContext<WorkspaceSessionValue | null>(null);

export function useWorkspaceSession(): WorkspaceSessionValue | null {
  return useContext(WorkspaceSessionContext);
}

export function WorkspaceSessionProvider({
  workspace,
  children,
}: {
  workspace: string;
  children: ReactNode;
}) {
  const [status, setStatus] = useState<SessionState>(() =>
    workspace === "demo" ? "in" : "loading"
  );

  useEffect(() => {
    if (workspace === "demo") {
      setStatus("in");
      return;
    }

    let cancelled = false;
    setStatus("loading");
    void fetch("/api/session")
      .then(async (response) => {
        const data = (await response.json()) as { authenticated?: boolean };
        if (!cancelled) {
          setStatus(data.authenticated === true ? "in" : "out");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("out");
      });

    return () => {
      cancelled = true;
    };
  }, [workspace]);

  const enter = useCallback(() => {
    setStatus("in");
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/session", { method: "DELETE" });
    if (workspace !== "demo") {
      setStatus("out");
    }
  }, [workspace]);

  return (
    <WorkspaceSessionContext.Provider
      value={{ workspace, status, enter, logout }}
    >
      {children}
    </WorkspaceSessionContext.Provider>
  );
}

export function SessionLogout() {
  const session = useWorkspaceSession();
  if (!session || session.workspace === "demo" || session.status !== "in") {
    return null;
  }

  return (
    <button
      type="button"
      onClick={() => {
        void session.logout();
      }}
      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-hover text-sm text-sub w-full text-left"
    >
      Log out
    </button>
  );
}

export function LiveWorkspaceGate({ children }: { children: ReactNode }) {
  const session = useWorkspaceSession();
  const workspace = session?.workspace ?? "demo";
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const status = session?.status ?? "loading";

  if (workspace === "demo" || status === "in") {
    return <>{children}</>;
  }

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center min-h-[40vh] text-sub text-sm">
        Loading…
      </div>
    );
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const presented = key;
    setKey("");
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: presented }),
      });
      if (!response.ok) {
        setError("That key was not accepted.");
        return;
      }
      session?.enter();
    } catch {
      setError("Could not start a session.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-panel border border-border rounded-lg p-8 max-w-md">
      <h2 className="font-display text-xl font-semibold mb-2">Live workspace</h2>
      <p className="text-sub text-sm mb-6">
        Enter the API key for this instance. It is stored in a signed cookie on
        this browser and never added to the URL.
      </p>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="anykpi-session-key" className="block text-sm font-medium mb-2">
            API key
          </label>
          <input
            id="anykpi-session-key"
            type="password"
            autoComplete="off"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            className="w-full px-3 py-2 border border-border rounded-lg bg-bg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            placeholder="ak_…"
          />
        </div>
        {error ? (
          <p className="text-sm" style={{ color: "var(--red)" }}>
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={submitting || key.trim().length === 0}
          className="px-4 py-2 bg-accent text-white rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        >
          {submitting ? "Opening…" : "Open live workspace"}
        </button>
      </form>
    </div>
  );
}
