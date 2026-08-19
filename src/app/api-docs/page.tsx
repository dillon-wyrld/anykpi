"use client";

import { useEffect, useRef } from "react";

/**
 * API Documentation Page
 * 
 * Scalar-style OpenAPI viewer
 */
export default function APIDocsPage() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Load Scalar CDN
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@scalar/api-reference@latest";
    script.async = true;
    
    script.onload = () => {
      if (containerRef.current) {
        // @ts-ignore - Scalar global
        window.Scalar = window.Scalar || {};
        // @ts-ignore
        if (window.Scalar.renderApiReference) {
          // @ts-ignore
          window.Scalar.renderApiReference(containerRef.current, {
            spec: {
              url: '/api/openapi',
            },
            proxyUrl: 'https://proxy.scalar.com',
            darkMode: false,
            layout: 'modern',
            showSidebar: true,
          });
        }
      }
    };
    
    document.head.appendChild(script);
    
    return () => {
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };
  }, []);

  return (
    <div className="min-h-screen bg-bg">
      <div className="border-b border-border bg-panel">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-display text-2xl font-semibold">API Reference</h1>
              <p className="text-sub text-sm mt-1">
                REST API for unified insights. Same resources humans see in the dashboard.
              </p>
            </div>
            <a
              href="/dashboard?workspace=demo"
              className="text-sm text-accent hover:underline"
            >
              ← Back to Dashboard
            </a>
          </div>
        </div>
      </div>
      
      <div ref={containerRef} id="api-reference" />
      
      <noscript>
        <div className="max-w-4xl mx-auto px-4 py-12">
          <div className="bg-amber/10 border-l-3 border-amber rounded-lg p-4">
            <p className="text-sm">
              JavaScript is required to view the interactive API documentation.
              View the raw OpenAPI spec at <a href="/api/openapi" className="text-accent underline">/api/openapi</a>
            </p>
          </div>
        </div>
      </noscript>
    </div>
  );
}
