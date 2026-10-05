import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isConfigured = Boolean(url && anon && !url.includes('YOUR-PROJECT'));
export const AI_ENABLED = import.meta.env.VITE_AI_ENABLED === 'true';

// A placeholder URL keeps the module importable when env vars are missing; the app shows a setup screen instead.
export const supabase = createClient(url || 'http://localhost:54321', anon || 'missing-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
