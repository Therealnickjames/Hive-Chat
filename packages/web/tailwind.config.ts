import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: {
          primary: "var(--background-primary)",
          secondary: "var(--background-secondary)",
          tertiary: "var(--background-tertiary)",
          floating: "var(--background-floating)",
        },
        border: {
          DEFAULT: "var(--border-default)",
          bright: "var(--border-bright)",
        },
        text: {
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
          dim: "var(--text-dim)",
          link: "var(--text-link)",
        },
        brand: {
          DEFAULT: "var(--brand)",
          hover: "var(--brand-hover)",
          glow: "var(--brand-glow)",
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
          warning: "#f59e0b",
          success: "#10b981",
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
