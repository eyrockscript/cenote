/// <reference types="vite/client" />

declare const __COMMIT_HASH__: string;

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
