/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_SUPPORT_WHATSAPP?: string;
  readonly VITE_ADMIN_PATH?: string;
  readonly VITE_ALLOW_LICENSE_MODE?: string;
  readonly VITE_LEGAL_ENTITY?: string;
  readonly VITE_LEGAL_CONTACT?: string;
  readonly VITE_DATA_REGION?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv }
