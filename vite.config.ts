import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed port and must not obscure Rust errors.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**", "**/engine/**"] },
  },
  build: { target: "safari15", sourcemap: false },
  test: {
    // A DOM only where one is asked for.
    //
    // The suites that read source text or exercise pure functions do not need
    // jsdom and are slower with it, and a global DOM invites a component test
    // to be written without saying that it is one. So the default stays
    // `node` and a component test opts in with `@vitest-environment jsdom` in
    // its first docblock -- which is per-file, visible at the top of the file
    // that needs it, and does not depend on a glob in another file agreeing
    // with how the test was named.
    environment: "node",
    setupFiles: ["src/test/setup.ts"],
    // Agent worktrees live under .claude/ and carry their own copy of every test.
    exclude: ["**/node_modules/**", ".claude/**"],
  },
});
