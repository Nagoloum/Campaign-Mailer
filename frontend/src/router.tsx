import { createBrowserRouter } from 'react-router-dom'

import { AppLayout } from '@/components/AppLayout'
import { RequireAuth } from '@/components/RequireAuth'
import { Account } from '@/pages/Account'
import { CampaignEditor } from '@/pages/CampaignEditor'
import { CampaignNew } from '@/pages/CampaignNew'
import { LegalNotice } from '@/pages/legal/LegalNotice'
import { Privacy } from '@/pages/legal/Privacy'
import { Terms } from '@/pages/legal/Terms'
import { Dashboard } from '@/pages/Dashboard'
import { Login } from '@/pages/Login'
import { NotFound } from '@/pages/NotFound'

/**
 * Route table. Login stands alone because it has no navigation; everything
 * else sits behind RequireAuth, inside the application shell.
 */
export const router = createBrowserRouter([
  {
    path: '/login',
    element: <Login />,
  },
  // Public: someone deciding whether to sign in must be able to read them.
  { path: '/legal/mentions', element: <LegalNotice /> },
  { path: '/legal/cgu', element: <Terms /> },
  { path: '/legal/confidentialite', element: <Privacy /> },
  {
    element: <RequireAuth />,
    children: [
      {
        path: '/',
        element: <AppLayout />,
        children: [
          { index: true, element: <Dashboard /> },
          { path: 'campaigns/new', element: <CampaignNew /> },
          { path: 'campaigns/:id', element: <CampaignEditor /> },
          { path: 'account', element: <Account /> },
        ],
      },
    ],
  },
  {
    path: '*',
    element: <NotFound />,
  },
])
