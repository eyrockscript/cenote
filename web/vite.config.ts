import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import path from "node:path";

// Prefer the COMMIT_HASH env var (passed in by the host via docker/podman compose).
// Fall back to running `git rev-parse` directly (no shell) — silent otherwise.
let commitHash = (process.env.COMMIT_HASH || "").trim() || "????";
if (commitHash === "????") {
  try {
    commitHash = execFileSync("git", ["rev-parse", "--short=4", "HEAD"], {
      stdio: ["ignore", "pipe", "ignore"], // mute "git: not found" stderr inside containers
    })
      .toString()
      .trim();
  } catch {
    // not a git repo or git not installed (containerised dev) — leave "????"
  }
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    __COMMIT_HASH__: JSON.stringify(commitHash),
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
  },
});
