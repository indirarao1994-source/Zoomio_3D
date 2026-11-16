import { defineConfig } from 'vite';

/**
 * Builds the standalone tour player into `server/player-dist/`.
 *
 * The publish endpoint and the ZIP export both copy this output verbatim, so a
 * hosted tour and a downloaded tour run byte-identical code. Output is a single
 * IIFE plus one stylesheet with no external requests, which is what lets a
 * downloaded tour work on any static host — or offline behind a local server.
 */
export default defineConfig({
  // Without this Vite copies the studio's `public/` folder into the player
  // output, which dragged the sample panoramas and the old tour.html into
  // every published tour and every downloaded ZIP.
  publicDir: false,
  build: {
    outDir: 'server/player-dist',
    emptyOutDir: true,
    target: 'es2020',
    cssMinify: true,
    lib: {
      entry: 'player/main.ts',
      name: 'PanoTourPlayer',
      formats: ['iife'],
      fileName: () => 'player.js',
      cssFileName: 'player',
    },
    rollupOptions: {
      output: {
        // Keep asset names stable so republishing overwrites cleanly.
        assetFileNames: 'player.[ext]',
      },
    },
  },
});
