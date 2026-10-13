import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // recharts(d3 포함)는 단독으로도 크기가 커서 경고 기준을 완화
    chunkSizeWarningLimit: 1000,
  },
})
