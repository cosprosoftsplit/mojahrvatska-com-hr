import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import siteConfig from './site.config.json';

export default defineConfig({
  site: `https://${siteConfig.domain}`,
  integrations: [sitemap()],
  vite: {
    plugins: [tailwindcss()],
  },
});
