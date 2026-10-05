# Deployment

Cost: Supabase free tier + any static host's free tier is enough for a small group.

## 1. Supabase
1. Create a project at supabase.com.
2. Apply the three files in `supabase/migrations/` in order (SQL editor, or `supabase link` + `supabase db push`).
3. Authentication → Providers → Email: keep **Confirm email ON**. URL Configuration: set **Site URL** to your deployed URL and add `https://YOUR-URL/reset-password` and `https://YOUR-URL` to Redirect URLs. (Optional: configure custom SMTP for reliable email.)
4. Settings → API: copy the Project URL and the **anon** key. Never use the `service_role` key in the app.

## 2. Frontend (Vercel, Netlify or Cloudflare Pages)
- Build command `npm run build`, output directory `dist`.
- Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, optionally `VITE_AI_ENABLED=true`.
- **Single-page-app fallback** so deep links like `/trips/<id>` and `/invite/<token>` work:
  - Netlify: `public/_redirects` containing `/* /index.html 200`
  - Vercel: `vercel.json` with `{"rewrites":[{"source":"/(.*)","destination":"/index.html"}]}`
  - Cloudflare Pages: SPA mode is the default.
- Recommended response headers: `Content-Security-Policy` (see SECURITY.md), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.

## 3. Optional AI
```bash
supabase functions deploy ai-assist
supabase secrets set ANTHROPIC_API_KEY=sk-... AI_MODEL=claude-haiku-4-5-20251001
```
Then set `VITE_AI_ENABLED=true` and redeploy the frontend. Restrict the function's CORS origin before production.

## 4. Smoke test after deploy
Sign up → confirm email → create a trip → invite a second account (copy the link, open it in a private window with that email) → add an itinerary item → add an expense split three ways → mark a payment → upload a PDF and open it → download the `.ics` file.
