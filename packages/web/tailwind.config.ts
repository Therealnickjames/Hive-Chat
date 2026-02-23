import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Discord-inspired dark palette
        background: {
          primary: "#313338",    // main content area
          secondary: "#2b2d31",  // sidebars
          tertiary: "#1e1f22",   // server list / deepest background
          floating: "#111214",   // modals / popups
        },
        text: {
          primary: "#f2f3f5",    // white-ish
          secondary: "#b5bac1",  // muted
          muted: "#949ba4",      // most muted
          link: "#00a8fc",       // links
        },
        brand: {
          DEFAULT: "#f59e0b",    // amber — HiveChat brand (bee/hive theme)
          hover: "#d97706",
        },
        status: {
          online: "#23a559",
          idle: "#f0b232",
          dnd: "#f23f43",
          offline: "#80848e",
        },
      },
    },
  },
  plugins: [],
};

export default config;
