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

-- =====================================================================
-- Registered users + self-service auth
-- =====================================================================

create extension if not exists pgcrypto;
create extension if not exists citext;

create table if not exists public.users (
  name          citext primary key,
  password_hash text   not null,
  created_at    timestamptz not null default now()
);
alter table public.users enable row level security;
-- No public policies; everything goes through SECURITY DEFINER RPCs below.
revoke all on table public.users from anon, authenticated;

-- Register-on-first-use or verify existing user. New registrations stay
-- inactive until an admin promotes them via the registry panel.
-- Returns 'registered' on first use, 'ok' on subsequent logins.
create or replace function public.login_or_register(
  p_name     text,
  p_password text
) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  trimmed       text;
  existing_hash text;
begin
  trimmed := trim(coalesce(p_name, ''));
  if trimmed = '' then
    raise exception 'name required' using errcode = '22000';
  end if;
  if p_password is null or length(p_password) < 4 then
    raise exception 'password too short' using errcode = '22000';
  end if;

  select password_hash into existing_hash from public.users where name = trimmed;
  if existing_hash is not null then
    if existing_hash <> crypt(p_password, existing_hash) then
      raise exception 'unauthorized' using errcode = '28000';
    end if;
    return 'ok';
  end if;

  insert into public.users (name, password_hash)
  values (trimmed, crypt(p_password, gen_salt('bf')));

  return 'registered';
end;
$$;

grant execute on function public.login_or_register(text, text) to anon, authenticated;

-- Admin-only listing of every registered user (active and inactive).
create or replace function public.list_users(p_password text)
returns table(name text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  stored_hash text;
begin
  select admin_password_hash into stored_hash from public.app_secrets where id = 1;
  if stored_hash is null or md5(p_password) <> stored_hash then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  return query
    select u.name::text, u.created_at
      from public.users u
      order by u.created_at;
end;
$$;

grant execute on function public.list_users(text) to anon, authenticated;

-- Narrow self-reroll: a logged-in user replaces their own hero exactly once
-- per randomize. The client computes a valid hero (role-aware exclusion);
-- the server enforces that the caller can only touch their own row and only
-- when rerolled = false.
create or replace function public.user_reroll(
  p_name     text,
  p_password text,
  p_new_hero text
) returns public.shared_state
language plpgsql security definer set search_path = public, extensions as $$
declare
  trimmed     text;
  stored_hash text;
  state_now   jsonb;
  teams       jsonb;
  result      public.shared_state;
  found       boolean := false;
  ti          int;
  pi          int;
begin
  trimmed := trim(coalesce(p_name, ''));
  if trimmed = '' then
    raise exception 'name required' using errcode = '22000';
  end if;

  select password_hash into stored_hash from public.users where name = trimmed;
  if stored_hash is null or stored_hash <> crypt(p_password, stored_hash) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;

  select state into state_now from public.shared_state where id = 1;
  teams := state_now->'teams';
  if teams is null or jsonb_typeof(teams) <> 'array' then
    raise exception 'no active teams' using errcode = 'P0002';
  end if;

  for ti in 0..(jsonb_array_length(teams) - 1) loop
    for pi in 0..(jsonb_array_length(teams->ti) - 1) loop
      if lower(coalesce(teams->ti->pi->>'name', '')) = lower(trimmed) then
        if (teams->ti->pi->>'rerolled')::boolean then
          raise exception 'already rerolled' using errcode = 'P0003';
        end if;
        teams := jsonb_set(teams, array[ti::text, pi::text, 'hero'], to_jsonb(p_new_hero));
        teams := jsonb_set(teams, array[ti::text, pi::text, 'rerolled'], 'true'::jsonb);
        found := true;
      end if;
    end loop;
  end loop;

  if not found then
    raise exception 'player not in active teams' using errcode = 'P0002';
  end if;

  update public.shared_state
     set version = shared_state.version + 1,
         state  = jsonb_set(state_now, '{teams}', teams),
         updated_at = now()
   where id = 1
  returning * into result;
  return result;
end;
$$;

grant execute on function public.user_reroll(text, text, text) to anon, authenticated;
