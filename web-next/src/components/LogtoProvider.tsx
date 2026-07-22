import { LogtoProvider as Provider } from '@logto/react'
import type { LogtoConfig } from '@logto/react'

const config: LogtoConfig = {
  endpoint: import.meta.env['VITE_LOGTO_ENDPOINT'] ?? 'http://localhost:3301',
  appId: import.meta.env['VITE_LOGTO_APP_ID'] ?? '',
  resources: [
    import.meta.env['VITE_LOGTO_API_RESOURCE'] ?? 'https://api.nationcam.com',
  ],
  scopes: ['openid', 'profile', 'email', 'admin'],
}

export default function LogtoWrapper({
  children,
}: {
  children: React.ReactNode
}) {
  return <Provider config={config}>{children}</Provider>
}
