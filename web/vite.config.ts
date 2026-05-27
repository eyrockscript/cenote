import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import path from "node:path";

let commitHash = "????";
try {
  commitHash = execSync("git rev-parse --short=4 HEAD").toString().trim();
} catch {
  // not a git repo yet
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
