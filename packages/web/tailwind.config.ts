import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: {
          primary: "#0c0c0c", // panels, sidebars
          secondary: "#141414", // panel headers, inputs, hover states
          tertiary: "#050505", // workspace grid background (deepest)
          floating: "#1c1c1c", // elevated elements, tooltips
        },
        border: {
          DEFAULT: "#222222",
          bright: "#333333",
        },
        text: {
          primary: "#f5f5f5",
          secondary: "#a3a3a3",
          muted: "#666666",
          dim: "#444444",
          link: "#22d3ee", // cyan for links
        },
        brand: {
          DEFAULT: "#e8a830", // gold — primary accent
          hover: "#b8862a", // gold dimmed
          glow: "rgba(232, 168, 48, 0.08)",
        },
        accent: {
          cyan: "#22d3ee",
          "cyan-dim": "#0e7490",
          "cyan-glow": "rgba(34, 211, 238, 0.06)",
          green: "#22c55e",
          "green-dim": "#166534",
          red: "#ef4444",
          orange: "#f97316",
          purple: "#a78bfa",
        },
        status: {
          online: "#22c55e",
          idle: "#f0b232",
          dnd: "#ef4444",
          offline: "#666666",
          streaming: "#22d3ee",
          error: "#ef4444",
        },
      },
      fontFamily: {
        sans: ["var(--font-space-grotesk)", "sans-serif"],
        mono: ["var(--font-jetbrains-mono)", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
