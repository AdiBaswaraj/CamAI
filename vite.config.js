import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: {
    format: 'es'
  },
  server: {
    host: true,
    port: 5173
  },
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: {
          tfjs: ['@tensorflow/tfjs', '@tensorflow-models/coco-ssd'],
          tesseract: ['tesseract.js'],
          fuse: ['fuse.js']
        }
      }
    }
  },
  optimizeDeps: {
    exclude: ['tesseract.js']
  }
});
