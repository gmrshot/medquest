// vite.config.mjs
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/medquest/',   // 👈 ensures JSON is served from /medquest/data/*
})
