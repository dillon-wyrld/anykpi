"use client";

import { useState } from "react";

interface PMFProps {
  workspace: string;
}

export default function PMF({ workspace }: PMFProps) {
  const [selectedUser, setSelectedUser] = useState("");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold mb-2">PMF+</h2>
        <p className="text-sub text-sm">
          Point at a user or group and say "go understand these people." A researcher finds them across the
          public internet and comes back with context and sharp questions.
        </p>
      </div>

      <div className="bg-panel border border-border rounded-lg shadow-sm p-8 text-center">
        <div className="max-w-md mx-auto space-y-4">
          <span className="text-4xl">🔍</span>
          <h3 className="font-display text-xl font-semibold">Research Assistant</h3>
          <p className="text-sub text-sm">
            PMF+ research is available for connected workspaces. On the demo workspace, this would find
            public profiles, read their content, and suggest targeted questions.
          </p>

          <div className="pt-4 border-t border-rule text-xs text-sub">
            <p>
              <strong>Important:</strong> Nothing ever sends on its own. Every outreach message waits
              in a queue for your approval. This is a permanent property of the product, not a setting.
            </p>
          </div>
        </div>
      </div>

      <div className="bg-amber/10 border-l-2 border-amber rounded-lg p-4">
        <div className="font-semibold mb-1">Coming in Phase 5</div>
        <p className="text-sm text-sub">
          Select users from the Dot Plot → Research their public presence → Get context cards with
          sharp questions → Draft outreach (all queued for approval, never auto-sent).
        </p>
      </div>
    </div>
  );
}
