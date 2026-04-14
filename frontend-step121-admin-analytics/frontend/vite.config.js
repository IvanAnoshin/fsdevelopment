import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/src/pages/messages/MessagesBlocks')) return 'messages-blocks'
          if (id.includes('/src/pages/messages/useDirectCallController')) return 'messages-call'
          if (id.includes('/src/pages/profile/ProfileBlocks')) return 'profile-blocks'
          if (id.includes('/src/pages/messages/')) return 'messages-page'
          if (id.includes('/src/pages/profile/')) return 'profile-page'
          if (id.includes('/src/pages/feed/')) return 'feed-page'
          if (id.includes('/src/pages/search/')) return 'search-page'
          if (id.includes('/src/pages/communities/')) return 'communities-page'
          if (id.includes('/src/pages/admin/')) return 'admin-page'
          if (id.includes('/src/pages/settings/')) return 'settings-page'
          if (id.includes('/src/services/e2ee')) return 'e2ee-runtime'
          if (!id.includes('node_modules')) return undefined
          if (id.includes('react-router-dom')) return 'router'
          if (id.includes('axios')) return 'network'
          if (id.includes('react')) return 'react-vendor'
          return 'vendor'
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      }
    }
  }
})
