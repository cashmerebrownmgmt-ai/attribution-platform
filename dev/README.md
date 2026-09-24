# Local tracker test

```bash
ALLOWED_ORIGINS=http://localhost:3200 npx next dev -p 3100   # app, serves /t.js and /api/collect
python3 -m http.server 3200 --directory dev                   # test page
```

Open http://localhost:3200/tracker-test.html?utm_source=google&utm_medium=cpc&gclid=TEST and
check the `events` table: each page load adds a `page_view` row for the same visitor.
Events go to whichever Supabase project `.env.local` points at.
