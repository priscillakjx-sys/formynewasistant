// Bake your Supabase project in here so users (and the Telegram Mini App) skip the setup screen.
// The anon key is designed to be public: row-level security in supabase/schema.sql protects the data.
// Never put the service_role key here.
//
// Google Sheet (recommended): paste your Apps Script Web app URL. Leave key empty (the passcode is asked for once per browser).
// window.SPEND_CONFIG = { mode: 'sheets', url: 'https://script.google.com/macros/s/XXXX/exec', key: '' };
//
// Supabase instead:
// window.SPEND_CONFIG = { mode: 'supabase', url: 'https://YOUR-PROJECT.supabase.co', key: 'YOUR-ANON-KEY' };
window.SPEND_CONFIG = window.SPEND_CONFIG || { mode: 'sheets', url: 'https://script.google.com/macros/s/AKfycbzby4mmh50n9k1kKUpHVzLbPXdiQfdxB6BUhOxpD7GPqYOfxFGtzouEcM6LOnYGoQv_/exec', key: '' };
