import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react({
      // node_modules/shia2n-core の .jsx も変換対象にする
      include: [/\.jsx?$/, /node_modules\/shia2n-core\/.*/],
    }),
  ],
  optimizeDeps: {
    include: ["shia2n-core"],
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ["firebase/app", "firebase/auth", "firebase/firestore"],
          supabase: ["@supabase/supabase-js"],
        },
      },
    },
  },
});
