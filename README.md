# Closets & Blinds — Meta Ads Dashboard

Live dashboard de performance de Meta Ads para Closets and Blinds FL.

## Stack
- Next.js 16 + Tailwind v4
- Windsor.ai REST API (live Meta Ads data)
- Apify Meta Ad Library Scraper (competitor intel)
- Vercel deploy

## Environment variables (Vercel → Settings → Environment Variables)

| Var | Value |
|---|---|
| `WINDSOR_API_KEY` | API key de Windsor.ai (settings/api de cuenta) |
| `APIFY_TOKEN` | Token de Apify (account/api de Apify) |
| `META_ACCOUNT_ID` | `828008049115166` (Closets & Blinds Meta account) |
| `NEXT_PUBLIC_DASHBOARD_PASSWORD` | Password para acceso al dashboard |

## Local dev

```
cp .env.example .env.local
# (rellenar con keys reales)
npm install
npm run dev
```

## Routes
- `/` — dashboard principal (password protegido)
- `/api/meta-data` — pulls live de Windsor.ai (~2s)
- `/api/competitors` — pulls de Apify con cache de 6h
