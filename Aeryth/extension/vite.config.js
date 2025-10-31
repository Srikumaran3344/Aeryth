import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";
import fs from "fs-extra";

export default defineConfig({
  root: resolve(__dirname, "src"),
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "copy-static-files",
      closeBundle() {
        const dist = resolve(__dirname, "dist");
        fs.ensureDirSync(dist);
        fs.copySync(resolve(__dirname, "manifest.json"), resolve(dist, "manifest.json"));
        fs.copySync(resolve(__dirname, "icons"), resolve(dist, "icons"));
        fs.copySync(resolve(__dirname, "background.js"), resolve(dist, "background.js"));
        fs.copySync(resolve(__dirname, "src/utils"), resolve(dist, "utils"));
      },
    },
  ],
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: { popup: resolve(__dirname, "src/popup.jsx") },
      output: {
        entryFileNames: "popup.js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
  rollupOptions: {
    input: {
      popup: resolve(__dirname, "src/popup.jsx"),
      background: resolve(__dirname, "background.js"),
    },
    output: {
      entryFileNames: "[name].js",
    },
  },
  optimizeDeps: {
    include: ["firebase/app", "firebase/auth", "firebase/firestore"],
  },

});
