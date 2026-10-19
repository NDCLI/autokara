import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'shared/**/*.test.ts'],
  },
  server: { host: '127.0.0.1', port: 4173 },
  build: { outDir: 'dist', emptyOutDir: true },
})
