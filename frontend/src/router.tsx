import { createBrowserRouter } from 'react-router-dom'

import { AppLayout } from '@/components/AppLayout'
import { RequireAuth } from '@/components/RequireAuth'
import { CampaignEditor } from '@/pages/CampaignEditor'
import { CampaignNew } from '@/pages/CampaignNew'
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
        ],
      },
    ],
  },
  {
    path: '*',
    element: <NotFound />,
  },
])
