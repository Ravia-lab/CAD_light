import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        // Three.js in einen eigenen Chunk: der 3D-View wird lazy geladen,
        // der 2D-Editor startet dadurch ohne WebGL-Payload.
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
});
