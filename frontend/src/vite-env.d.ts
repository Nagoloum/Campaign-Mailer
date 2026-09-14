/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LEGAL_PUBLISHER?: string
  readonly VITE_LEGAL_EMAIL?: string
  readonly VITE_LEGAL_PHONE?: string
  readonly VITE_LEGAL_ADDRESS?: string
  readonly VITE_LEGAL_COUNTRY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
