import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// BASE_PATH est fourni par la GitHub Action (ex : "/mon-repo/").
// En local (npm run dev) le site tourne à la racine "/".
export default defineConfig({
  plugins: [react()],
  base: process.env.BASE_PATH || "/",
});
