-- Fretsense progress table for a shared Nhost project.
-- Run once in the Nhost dashboard: Database -> SQL Editor, with "Track this" switched ON.
-- Everything is prefixed fretsense_ so other apps can share the same project.

create table public.fretsense_progress (
  -- One row per account. Deleting the account deletes the row.
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- The whole progress document (answer log, statistics, XP, exercise settings).
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- updated_at is set by the database, so the app can use it as a version number.
create function public.fretsense_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger fretsense_progress_touch
  before update on public.fretsense_progress
  for each row execute function public.fretsense_touch_updated_at();

-- Permissions are not SQL: set them in the dashboard afterwards (see README, "Backend setup").
