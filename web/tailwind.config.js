/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Geist", "system-ui", "sans-serif"],
        mono: ["Geist Mono", "monospace"],
      },
      colors: {
        drift: {
          high: "#ef4444",
          medium: "#f59e0b",
          low: "#a3a3a3",
        },
        state: {
          matched: "#10b981",
          drift: "#ef4444",
          tf_only: "#94a3b8",
          aws_only: "#f59e0b",
        },
      },
    },
  },
  plugins: [],
};
