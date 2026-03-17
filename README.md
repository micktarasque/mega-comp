# Mega Comp

Minimalist friend competition tracker. Log game results, track wins, see the leaderboard.

## Dev

```bash
npm install
npm run dev
```

## Deploy

**Vercel (easiest):**
1. Push repo to GitHub
2. Import on vercel.com → deploys automatically

**Netlify:**
1. `npm run build`
2. Drag `dist/` folder to netlify.com/drop

**GitHub Pages:**
```bash
npm run build
# push dist/ to gh-pages branch
```

## Supabase Migration

The entire backend lives in `src/db/mockDb.js`. All functions return Promises and use the same shape as Supabase's JS client. When ready:

1. Create a Supabase project with `players` and `games` tables
2. Replace each function in `mockDb.js` with `supabase.from(...).select/insert/delete` calls
3. Nothing else changes
