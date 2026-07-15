import { createClient } from "@supabase/supabase-js";

const configuredUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const configuredPublishableKey = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY
)?.trim();

export const isAuthConfigured = Boolean(configuredUrl && configuredPublishableKey);

// The inert URL keeps the public, anonymous portal available in a local review
// build. Staff sign-in is explicitly disabled unless both public Auth values are
// configured; no privileged credential is ever accepted by the frontend.
export const supabase = createClient(
  configuredUrl || "https://auth-not-configured.invalid",
  configuredPublishableKey || "auth-not-configured",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  },
);
