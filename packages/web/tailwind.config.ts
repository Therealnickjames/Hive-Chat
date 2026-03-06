import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: {
          primary: "#0b0f19", // Very dark slate (sidebars, panels)
          secondary: "#151b2b", // Slightly elevated slate (headers, inputs)
          tertiary: "#050810", // Deepest void (workspace area)
          floating: "#1e293b", // Elevated elements, modals
        },
        border: {
          DEFAULT: "#222b3f", // Soft, cool gray borders
          bright: "#334155",
        },
        text: {
          primary: "#f8fafc",
          secondary: "#94a3b8",
          muted: "#64748b",
          dim: "#475569",
          link: "#0ea5e9", // Electric Blue
        },
        brand: {
          DEFAULT: "#0ea5e9", // Electric Blue — primary accent
          hover: "#0284c7", // Electric Blue dimmed
          glow: "rgba(14, 165, 233, 0.15)",
        },
        accent: {
          cyan: "#38bdf8",
          "cyan-dim": "#0369a1",
          "cyan-glow": "rgba(56, 189, 248, 0.1)",
          green: "#10b981",
          "green-dim": "#047857",
          red: "#ef4444",
          orange: "#f97316",
          purple: "#8b5cf6",
        },
        status: {
          online: "#10b981",
          idle: "#f59e0b",
          dnd: "#ef4444",
          offline: "#475569",
          streaming: "#0ea5e9",
          error: "#ef4444",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "sans-serif"],
        mono: ["var(--font-jetbrains-mono)", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
