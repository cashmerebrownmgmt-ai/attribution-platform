-- Creative media for full-size ad previews on the Creatives page.
alter table public.ads add column video_url text;   -- playable video source, when the platform exposes one
alter table public.ads add column cta text;         -- call-to-action button text
