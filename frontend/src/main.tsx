import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { Toaster } from 'sonner'

import { AuthProvider } from '@/auth/AuthProvider'
import { router } from '@/router'

import './index.css'

const container = document.getElementById('root')

if (!container) {
  throw new Error('Root element #root is missing from index.html')
}

createRoot(container).render(
  <StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
      {/*
        Feedback that does not take the page hostage. An import reporting
        "412 imported, 3 rejected" belongs beside the work, not behind an OK
        button that has to be dismissed before the report can be read.
      */}
      <Toaster position="bottom-right" closeButton richColors />
    </AuthProvider>
  </StrictMode>,
)
