# 🧠 Brainstorm
Turn any PDF or DOCX into a quiz - auto-detected answers, shareable links, expiry, student dashboard.

## Run locally
`npm install` then `npm start` (default admin password: **ac1205**; override with `ADMIN_PASSWORD=...`) -> http://localhost:3000/admin.html (data saved in ./data).

## Deploy on Vercel (needs Supabase for storage)
1. Supabase: create a project -> SQL Editor -> run `supabase.sql`.
2. Supabase -> Project Settings -> API: copy the **Project URL** and the **service_role** key (keep it secret).
3. Vercel -> Project -> Settings -> Environment Variables (all environments):
   - `ADMIN_PASSWORD` = your admin password
   - `SUPABASE_URL` = https://xxxx.supabase.co
   - `SUPABASE_SERVICE_KEY` = service_role key
4. Redeploy. Admin: `https://your-app.vercel.app/admin.html`. Check `/api/health` shows `"storage":"supabase"`.
Note: Vercel limits uploads to ~4 MB per file.

On Vercel set `ADMIN_PASSWORD` = `ac1205` (the env var overrides the built-in default).
