export const CONFIG = Object.freeze({
    SUPABASE_URL: window.__ENV?.SUPABASE_URL ?? '',
    SUPABASE_KEY: window.__ENV?.SUPABASE_KEY ?? '',
    AI_PROXY:     window.__ENV?.AI_PROXY     ?? 'http://localhost:3001/api/ai',
    WS_URL:       window.__ENV?.WS_URL       ?? '',
    APP_VERSION:  '3.0.0',
    STORAGE_KEY:  'ai_os_state_v3',
    MAX_RETRIES:  3,
});
