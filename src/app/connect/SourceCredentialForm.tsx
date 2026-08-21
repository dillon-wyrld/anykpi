"use client";

import type { GalleryCard } from "@/core/source-gallery";

export type CredentialValues = Record<string, string>;

export type ConnectStatus = {
  source: string;
  ok: boolean;
  rotated?: boolean;
  error?: string;
} | null;

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "password" | "url";
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-mono uppercase tracking-wider text-faint mb-1">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 text-sm bg-bg border border-border rounded font-mono"
      />
    </div>
  );
}

export function SourceCredentialForm({
  card,
  values,
  onChange,
  onConnect,
  connecting,
  status,
}: {
  card: GalleryCard;
  values: CredentialValues;
  onChange: (next: CredentialValues) => void;
  onConnect: (credentials: CredentialValues) => void;
  connecting: boolean;
  status: ConnectStatus;
}) {
  const set = (key: string, value: string) => onChange({ ...values, [key]: value });
  const mine = status && status.source === card.id ? status : null;

  if (card.status === "roadmap") {
    return (
      <div className="bg-panel border border-border rounded-lg p-6">
        <div className="flex items-start gap-4">
          <span className="text-3xl">{card.logo}</span>
          <div>
            <h3 className="font-semibold text-base mb-1">{card.name}</h3>
            <p className="text-sm text-sub mb-3">{card.valueProp}</p>
            <span className="inline-block text-xs text-faint font-mono uppercase tracking-wider border border-border rounded px-2 py-1">
              Roadmap · {card.ticket}
            </span>
          </div>
        </div>
      </div>
    );
  }

  const fields = (() => {
    switch (card.id) {
      case "posthog":
        return (
          <>
            <Field
              label="PostHog API Key"
              type="password"
              value={values.apiKey ?? ""}
              onChange={(v) => set("apiKey", v)}
              placeholder="phc_..."
            />
            <Field
              label="Project ID"
              value={values.projectId ?? ""}
              onChange={(v) => set("projectId", v)}
              placeholder="Project ID"
            />
            <Field
              label="Host (optional)"
              value={values.host ?? ""}
              onChange={(v) => set("host", v)}
              placeholder="https://app.posthog.com"
            />
          </>
        );
      case "mixpanel":
        return (
          <>
            <Field
              label="Mixpanel Project ID"
              value={values.projectId ?? ""}
              onChange={(v) => set("projectId", v)}
              placeholder="Project ID"
            />
            <Field
              label="Mixpanel API Secret"
              type="password"
              value={values.apiSecret ?? ""}
              onChange={(v) => set("apiSecret", v)}
              placeholder="API Secret"
            />
          </>
        );
      case "amplitude":
        return (
          <>
            <Field
              label="Amplitude API Key"
              type="password"
              value={values.apiKey ?? ""}
              onChange={(v) => set("apiKey", v)}
              placeholder="API Key"
            />
            <Field
              label="Amplitude Secret Key"
              type="password"
              value={values.secretKey ?? ""}
              onChange={(v) => set("secretKey", v)}
              placeholder="Secret Key"
            />
          </>
        );
      case "stripe":
        return (
          <>
            <Field
              label="Restricted key (read-only)"
              type="password"
              value={values.apiKey ?? ""}
              onChange={(v) => set("apiKey", v)}
              placeholder="rk_..."
            />
            <Field
              label="Webhook signing secret"
              type="password"
              value={values.webhookSecret ?? ""}
              onChange={(v) => set("webhookSecret", v)}
              placeholder="whsec_..."
            />
          </>
        );
      case "revenuecat":
        return (
          <>
            <Field
              label="RevenueCat API Key"
              type="password"
              value={values.apiKey ?? ""}
              onChange={(v) => set("apiKey", v)}
              placeholder="sk_..."
            />
            <Field
              label="Project ID"
              value={values.projectId ?? ""}
              onChange={(v) => set("projectId", v)}
              placeholder="Project ID"
            />
          </>
        );
      case "mercury":
        return (
          <Field
            label="Mercury API Key"
            type="password"
            value={values.apiKey ?? ""}
            onChange={(v) => set("apiKey", v)}
            placeholder="API Key"
          />
        );
      case "ics":
        return (
          <Field
            label="ICS URL"
            type="url"
            value={values.icsUrl ?? ""}
            onChange={(v) => set("icsUrl", v)}
            placeholder="https://…"
          />
        );
      case "github":
        return (
          <>
            <Field
              label="GitHub token"
              type="password"
              value={values.token ?? ""}
              onChange={(v) => set("token", v)}
              placeholder="ghp_…"
            />
            <Field
              label="Owner"
              value={values.owner ?? ""}
              onChange={(v) => set("owner", v)}
              placeholder="org-or-user"
            />
            <Field
              label="Repository"
              value={values.repo ?? ""}
              onChange={(v) => set("repo", v)}
              placeholder="repo"
            />
          </>
        );
      default:
        return (
          <p className="text-sm text-sub">No credential fields for this source.</p>
        );
    }
  })();

  const connectLabel =
    card.id === "ics" ? "Connect calendar" : `Connect ${card.name}`;

  return (
    <div className="bg-panel border border-border rounded-lg p-6" data-testid={`credential-${card.id}`}>
      <div className="flex items-start gap-4">
        <span className="text-3xl">{card.logo}</span>
        <div className="flex-1 space-y-3">
          <div>
            <h3 className="font-semibold text-base mb-1">{card.name}</h3>
            <p className="text-sm text-sub">{card.valueProp}</p>
          </div>
          {fields}
          <button
            type="button"
            disabled={connecting}
            onClick={() => {
              const credentials: CredentialValues = {};
              for (const [key, value] of Object.entries(values)) {
                if (value.trim()) credentials[key] = value.trim();
              }
              onConnect(credentials);
            }}
            className="px-4 py-2 bg-accent text-white text-sm rounded hover:opacity-90 disabled:opacity-60"
          >
            {connecting ? "Saving…" : connectLabel}
          </button>
          {mine?.ok && (
            <p className="text-sm text-sub">
              {mine.rotated ? `${card.name} credentials updated.` : `${card.name} connected.`}
            </p>
          )}
          {mine && !mine.ok && <p className="text-sm text-sub">{mine.error}</p>}
        </div>
      </div>
    </div>
  );
}
