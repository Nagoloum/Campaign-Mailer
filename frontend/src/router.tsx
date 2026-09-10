import { createBrowserRouter } from 'react-router-dom'

import { AppLayout } from '@/components/AppLayout'
import { Dashboard } from '@/pages/Dashboard'
import { Login } from '@/pages/Login'
import { NotFound } from '@/pages/NotFound'

/**
 * Route table. Authenticated routes sit under AppLayout; Login stands alone
 * because it has no navigation. The route guard that keeps unauthenticated
 * visitors out of AppLayout is added in Phase 1, with the auth state.
 */
export const router = createBrowserRouter([
  {
    path: '/login',
    element: <Login />,
  },
  {
    path: '/',
    element: <AppLayout />,
    children: [{ index: true, element: <Dashboard /> }],
  },
  {
    path: '*',
    element: <NotFound />,
  },
])
