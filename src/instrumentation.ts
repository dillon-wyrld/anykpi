/**
 * Next.js boot hook. Validate operator config before any view renders.
 * Invalid `anykpi.config.json` throws with the offending path.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { loadAnykpiConfig } = await import("@/core/config");
  loadAnykpiConfig();
}
