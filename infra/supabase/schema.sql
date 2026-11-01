-- Run once in the Supabase SQL editor (free tier project).
-- Student uploads wait here until an admin approves or rejects them.
-- The file itself lives in MongoDB GridFS ("pending" bucket); file_id points to it.

create table if not exists public.uploads (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  status           text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  course_code      text not null,
  term_key         text not null check (term_key ~ '^\d{4}-[123]$'),
  section          text not null,
  instructor       text not null,
  file_id          text not null,
  file_size        integer not null,
  uploader_ip_hash text not null,
  detected         jsonb,
  reviewed_at      timestamptz,
  reviewed_by      text,
  note             text
);

create index if not exists uploads_pending_idx on public.uploads (created_at) where status = 'pending';

-- Only the API (service role key) touches this table. With RLS on and no policies,
-- the public anon key used by the browser can't read or write it.
alter table public.uploads enable row level security;

-- Needed when "Automatically expose new tables" is off: only the service role gets access.
grant select, insert, update, delete on public.uploads to service_role;
