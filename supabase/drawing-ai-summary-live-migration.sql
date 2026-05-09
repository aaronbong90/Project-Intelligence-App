-- ProjectAxis AI Drawing Summary fields.
-- Stores AI-generated drawing interpretation separately from manually entered drawing metadata.

alter table public.drawing_sheets
  add column if not exists ai_drawing_title text not null default '';

alter table public.drawing_sheets
  add column if not exists ai_discipline text not null default '';

alter table public.drawing_sheets
  add column if not exists ai_likely_zones jsonb not null default '[]'::jsonb;

alter table public.drawing_sheets
  add column if not exists ai_key_notes jsonb not null default '[]'::jsonb;

alter table public.drawing_sheets
  add column if not exists ai_risks jsonb not null default '[]'::jsonb;

alter table public.drawing_sheets
  add column if not exists ai_summarized_at timestamptz;

notify pgrst, 'reload schema';
