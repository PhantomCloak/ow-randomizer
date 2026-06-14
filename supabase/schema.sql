-- Schema for shared real-time state of the OW randomizer.
-- Run once in the Supabase SQL editor for the project.

create table if not exists public.shared_state (
  id int primary key default 1 check (id = 1),
  version int not null default 0,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.shared_state (id) values (1) on conflict do nothing;

create table if not exists public.app_secrets (
  id int primary key default 1 check (id = 1),
  admin_password_hash text not null
);
-- Matches the MD5 hash hardcoded in src/PasswordGate.tsx so the same password works in both gates.
insert into public.app_secrets (id, admin_password_hash)
values (1, '09cc81fcf02edae5182ebbe1d4e880a4')
on conflict do nothing;

alter table public.shared_state enable row level security;
alter table public.app_secrets  enable row level security;

drop policy if exists "anon read shared_state" on public.shared_state;
create policy "anon read shared_state"
  on public.shared_state for select to anon, authenticated using (true);
-- No SELECT/INSERT/UPDATE policy on app_secrets => anon cannot read or write the hash.

create or replace function public.update_shared_state(
  p_password text,
  p_state    jsonb
) returns public.shared_state
language plpgsql security definer set search_path = public as $$
declare
  stored_hash text;
  result      public.shared_state;
begin
  select admin_password_hash into stored_hash from public.app_secrets where id = 1;
  if stored_hash is null or md5(p_password) <> stored_hash then
    raise exception 'unauthorized' using errcode = '28000';
  end if;

  update public.shared_state
     set version = shared_state.version + 1,
         state = p_state,
         updated_at = now()
   where id = 1
  returning * into result;

  return result;
end;
$$;

grant execute on function public.update_shared_state(text, jsonb) to anon, authenticated;
revoke all on table public.app_secrets from anon, authenticated;
