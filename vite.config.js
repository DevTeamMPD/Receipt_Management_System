import { defineConfig, loadEnv } from 'vite';
import { apiPlugin } from './server/vitePlugin.js';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  return { plugins: [apiPlugin(env)] };
});
