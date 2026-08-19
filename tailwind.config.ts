import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        panel: "var(--panel)",
        "panel-2": "var(--panel-2)",
        border: "var(--border)",
        rule: "var(--rule)",
        text: "var(--text)",
        sub: "var(--sub)",
        faint: "var(--faint)",
        accent: "var(--accent)",
        "accent-soft": "var(--accent-soft)",
        "accent-line": "var(--accent-line)",
        green: "var(--green)",
        "green-soft": "var(--green-soft)",
        amber: "var(--amber)",
        hatch: "var(--hatch)",
      },
      fontFamily: {
        sans: ["IBM Plex Sans", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
        display: ["Bricolage Grotesque", "IBM Plex Sans", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
