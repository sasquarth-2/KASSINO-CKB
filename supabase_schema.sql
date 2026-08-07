-- SQL Schema for KASSINO-CKB (Fortune Tiger Clone)
-- Run this script in your Supabase SQL Editor.

-- Enable UUID extension if not enabled
create extension if not exists "uuid-ossp";

-- 1. Create Profiles Table (user balances, nicknames, claims, admin status)
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  username text unique not null,
  balance numeric not null default 10000 check (balance >= 0),
  last_daily_claim timestamp with time zone,
  is_admin boolean not null default false,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security for profiles
alter table public.profiles enable row level security;

-- Create profiles policies
-- Permit authenticated users to view all profiles (necessary for the leaderboard)
drop policy if exists "Allow authenticated users to read all profiles" on public.profiles;
create policy "Allow authenticated users to read all profiles"
  on public.profiles
  for select
  to authenticated
  using (true);

-- Allow users to update only their own username (not balance/admin status)
drop policy if exists "Allow users to update their own username" on public.profiles;
create policy "Allow users to update their own username"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Note: Balance updates and admin actions will be handled by API routes using the service_role key.

-- 2. Create Spins Table (logs of all games played)
create table if not exists public.spins (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  username text not null,
  bet_amount numeric not null check (bet_amount > 0),
  win_amount numeric not null check (win_amount >= 0),
  multiplier numeric not null check (multiplier >= 0),
  symbols jsonb not null, -- 3x3 grid layout of symbols
  is_feature_trigger boolean default false not null,
  feature_respins jsonb, -- array of respin grids if Fortune Tiger feature was triggered
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS for spins
alter table public.spins enable row level security;

-- Create spins policies
-- Allow authenticated users to view all spins (necessary for recent big wins feed)
drop policy if exists "Allow authenticated users to read all spins" on public.spins;
create policy "Allow authenticated users to read all spins"
  on public.spins
  for select
  to authenticated
  using (true);

-- Allow authenticated users to insert spins (or we can insert via service role in API)
drop policy if exists "Allow service role to insert spins" on public.spins;
create policy "Allow service role to insert spins"
  on public.spins
  for insert
  with check (true);

-- 3. Trigger to automatically create a profile after signup
create or replace function public.handle_new_user()
returns trigger as $$
declare
  default_username text;
  is_super_admin boolean;
begin
  -- Retrieve username from user metadata or fallback to email prefix
  default_username := coalesce(
    new.raw_user_meta_data->>'username',
    split_part(new.email, '@', 1)
  );

  -- Handle case if username is empty or already exists by appending random numbers
  if exists (select 1 from public.profiles where username = default_username) then
    default_username := default_username || floor(random() * 1000)::text;
  end if;

  -- Check if this user is the designated super admin
  is_super_admin := (new.email = 'sasquarth@gmail.com');

  insert into public.profiles (id, username, balance, is_admin)
  values (
    new.id,
    default_username,
    10000, -- Initial balance of 10,000 chips
    is_super_admin
  );
  return new;
exception
  when others then
    return new;
end;
$$ language plpgsql security definer;

-- Drop trigger if exists and recreate
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- SQL Query to force make an existing user an admin (Run this in Supabase SQL editor if user is already registered):
-- UPDATE public.profiles SET is_admin = true WHERE id = (SELECT id FROM auth.users WHERE email = 'sasquarth@gmail.com');

-- 4. Security Trigger to prevent client-side modifications of sensitive columns
create or replace function public.check_profile_update()
returns trigger as $$
begin
  -- If the session is authenticated (client-side user), block modifications to balance, is_admin, or last_daily_claim
  if auth.role() = 'authenticated' then
    if new.balance is distinct from old.balance then
      raise exception 'Permissão negada: Não é possível modificar o saldo diretamente pelo front-end.';
    end if;
    if new.is_admin is distinct from old.is_admin then
      raise exception 'Permissão negada: Não é possível modificar o privilégio de administrador diretamente pelo front-end.';
    end if;
    if new.last_daily_claim is distinct from old.last_daily_claim then
      raise exception 'Permissão negada: Não é possível modificar a data de recarga diretamente pelo front-end.';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

-- Drop trigger if exists and recreate
drop trigger if exists check_profile_update_trigger on public.profiles;
create trigger check_profile_update_trigger
  before update on public.profiles
  for each row execute procedure public.check_profile_update();

-- 5. Active Crash Round Table (Multiplayer synchronization with near-zero database load)
create table if not exists public.active_crash_round (
  id int primary key default 1 check (id = 1),
  round_id uuid not null default gen_random_uuid(),
  status text not null default 'betting', -- 'betting', 'flying', 'crashed'
  betting_start_time timestamp with time zone not null default now(),
  flight_start_time timestamp with time zone,
  crash_point numeric not null default 1.50,
  updated_at timestamp with time zone not null default now()
);

-- Insert initial row if not exists
insert into public.active_crash_round (id, status, betting_start_time, crash_point)
values (1, 'betting', now(), 1.50)
on conflict (id) do nothing;

-- Enable RLS for active_crash_round (no select policies to prevent client-side sniffing)
alter table public.active_crash_round enable row level security;
drop policy if exists "Allow authenticated users to read active crash round" on public.active_crash_round;

-- 6. Completed Crash Rounds History Table (Leak-proof history feed)
create table if not exists public.crash_rounds_history (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null unique,
  crash_point numeric not null,
  created_at timestamp with time zone not null default now()
);

-- Enable RLS for crash_rounds_history
alter table public.crash_rounds_history enable row level security;

-- Allow authenticated users to read the history
drop policy if exists "Allow authenticated users to read crash history" on public.crash_rounds_history;
create policy "Allow authenticated users to read crash history"
  on public.crash_rounds_history
  for select
  to authenticated
  using (true);

-- 7. Blackjack da Dengue Tables (Multiplayer state machine and bets)
create table if not exists public.active_dengue_round (
  id int primary key default 1 check (id = 1),
  round_id uuid not null default gen_random_uuid(),
  status text not null default 'betting', -- 'betting', 'revealing', 'reset'
  betting_start_time timestamp with time zone not null default now(),
  reveal_start_time timestamp with time zone,
  winning_card text, -- dengue, cigaro, frango, cap-mate, sapo
  updated_at timestamp with time zone not null default now()
);

-- Seed active_dengue_round row if not exists
insert into public.active_dengue_round (id, status, betting_start_time)
values (1, 'betting', now())
on conflict (id) do nothing;

-- Enable RLS for active_dengue_round (no select policies to prevent client-side sniffing)
alter table public.active_dengue_round enable row level security;
drop policy if exists "Allow authenticated users to read active dengue round" on public.active_dengue_round;

create table if not exists public.dengue_bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  round_id uuid not null,
  bet_amount numeric not null check (bet_amount >= 10),
  selected_card text not null, -- dengue, cigaro, frango, cap-mate, sapo
  status text not null default 'pending', -- pending, won, lost
  created_at timestamp with time zone not null default now()
);

-- Enable RLS for dengue_bets
alter table public.dengue_bets enable row level security;

drop policy if exists "Allow users to read their own dengue bets" on public.dengue_bets;
create policy "Allow users to read their own dengue bets"
  on public.dengue_bets
  for select
  to authenticated
  using (auth.uid() = user_id);

-- Create Indexes for performance
create index if not exists profiles_balance_idx on public.profiles (balance desc);
create index if not exists spins_user_id_idx on public.spins (user_id);
create index if not exists spins_created_at_idx on public.spins (created_at desc);
create index if not exists crash_rounds_history_created_at_idx on public.crash_rounds_history (created_at desc);
create index if not exists dengue_bets_round_id_idx on public.dengue_bets (round_id);
create index if not exists dengue_bets_user_id_idx on public.dengue_bets (user_id);
