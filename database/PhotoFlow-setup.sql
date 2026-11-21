-- PhotoFlow server schema (v0.10.2) for Supabase
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> New query -> paste this whole file -> Run (once).
-- Tables, row-level security, public booking functions, admin functions.


-- ───────────── settings / admins / audit / events ─────────────
create table public.app_settings (
  key text primary key,
  value jsonb not null
);
insert into public.app_settings (key, value) values ('default_status', '"trial"'), ('trial_days', '14');
alter table public.app_settings enable row level security;   -- no policies: only security-definer functions touch it

create table public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;

create table public.admin_audit (
  id bigint generated always as identity primary key,
  admin_id uuid,
  action text not null,
  target_user uuid,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.admin_audit enable row level security;

create table public.usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create index on public.usage_events (created_at);
alter table public.usage_events enable row level security;

-- ───────────── profiles ─────────────
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  studio_name text not null default '',
  phone text not null default '',
  slug text unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,29}$'),
  status text not null default 'trial' check (status in ('pending','trial','active','suspended')),
  trial_ends_at timestamptz,
  paid_until timestamptz,
  plan text not null default '',
  booking_page_enabled boolean not null default false,
  booking_page_note text not null default '',
  packages jsonb not null default '[]',
  admin_note text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy profiles_select_own on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_update_own on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
-- The user may only change these columns; status / trial / paid / plan / note are admin-only.
revoke update on public.profiles from authenticated, anon;
grant update (display_name, studio_name, phone, slug, booking_page_enabled, booking_page_note, packages, last_seen_at) on public.profiles to authenticated;
grant select on public.profiles to authenticated;

-- A profile is created for every new auth user, using the admin's default signup mode.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare mode text; days int;
begin
  select trim('"' from value::text) into mode from app_settings where key = 'default_status';
  select coalesce((value::text)::int, 14) into days from app_settings where key = 'trial_days';
  if mode = 'pending' then
    insert into profiles (id, status) values (new.id, 'pending');
  else
    insert into profiles (id, status, trial_ends_at) values (new.id, 'trial', now() + make_interval(days => coalesce(days, 14)));
  end if;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Is the caller a signed-in admin who passed 2-factor? Never throws.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select true from admins where user_id = auth.uid()), false)
     and coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

create or replace function public.assert_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
end $$;

-- Can this account use the service right now?
create or replace function public.account_ok(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select case status
      when 'trial' then trial_ends_at > now()
      when 'active' then paid_until is null or paid_until > now()
      else false end
    from profiles where id = uid), false);
$$;

-- ───────────── synced business tables ─────────────
create or replace function public.touch_row() returns trigger language plpgsql as $$
begin new.updated_at := clock_timestamp(); return new; end $$;

create table public.clients (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null, phone text not null default '', instagram text, email text,
  source text not null default 'manual', notes text, last_contact_at timestamptz, lead_status text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default clock_timestamp(), deleted_at timestamptz
);
create table public.bookings (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  title text not null, type text not null default '', date date not null, time text not null,
  duration_minutes int not null default 60, location text, price numeric not null default 0, deposit numeric not null default 0,
  status text not null default 'pending' check (status in ('pending','confirmed','completed','cancelled')),
  notes text, share_enabled boolean not null default true,
  public_token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default clock_timestamp(), deleted_at timestamptz
);
create table public.projects (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  status text not null default 'shooting' check (status in ('shooting','editing','review','ready','delivered')),
  shot_count int, delivery_link text, notes text,
  updated_at timestamptz not null default clock_timestamp(), deleted_at timestamptz
);
create table public.transactions (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type text not null check (type in ('income','expense')),
  title text not null, amount numeric not null, date date not null,
  client_id uuid references public.clients(id) on delete set null,
  booking_id uuid references public.bookings(id) on delete set null,
  category text not null default '', notes text,
  updated_at timestamptz not null default clock_timestamp(), deleted_at timestamptz
);
create table public.reminders (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null, body text, due_at timestamptz not null,
  client_id uuid references public.clients(id) on delete set null,
  booking_id uuid references public.bookings(id) on delete set null,
  done boolean not null default false, notified_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(), deleted_at timestamptz
);
create table public.templates (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null, channel text not null default 'both' check (channel in ('whatsapp','instagram','both')), body text not null,
  updated_at timestamptz not null default clock_timestamp(), deleted_at timestamptz
);

do $$
declare t text;
begin
  foreach t in array array['clients','bookings','projects','transactions','reminders','templates'] loop
    execute format('create index on public.%I (user_id, updated_at)', t);
    execute format('create trigger touch_%1$s before insert or update on public.%1$I for each row execute function public.touch_row()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %1$s_owner on public.%1$I for all to authenticated using (user_id = auth.uid() and public.account_ok(auth.uid())) with check (user_id = auth.uid() and public.account_ok(auth.uid()))', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
end $$;
create index on public.bookings (public_token);

-- A row's owner can never be changed by an upsert from another account.
create or replace function public.lock_owner() returns trigger language plpgsql as $$
begin if new.user_id <> old.user_id then raise exception 'forbidden' using errcode = '42501'; end if; return new; end $$;
do $$
declare t text;
begin
  foreach t in array array['clients','bookings','projects','transactions','reminders','templates'] loop
    execute format('create trigger lock_owner_%1$s before update on public.%1$I for each row execute function public.lock_owner()', t);
  end loop;
end $$;

-- ───────────── booking requests (from the public page) ─────────────
create table public.booking_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, phone text not null, type text not null default '', package_name text,
  requested_date date not null, requested_time text, notes text,
  status text not null default 'new' check (status in ('new','accepted','rejected')),
  created_at timestamptz not null default now()
);
create index on public.booking_requests (user_id, created_at);
create index on public.booking_requests (phone, created_at);
alter table public.booking_requests enable row level security;
create policy requests_select_own on public.booking_requests for select to authenticated using (user_id = auth.uid());
create policy requests_update_own on public.booking_requests for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.booking_requests from anon, authenticated;
grant select on public.booking_requests to authenticated;
grant update (status) on public.booking_requests to authenticated;

-- ───────────── public + user RPCs ─────────────
create or replace function public.slug_available(p_slug text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from profiles where slug = lower(p_slug) and id <> auth.uid());
$$;

create or replace function public.public_page(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p profiles; busy jsonb;
begin
  select * into p from profiles where slug = lower(p_slug) and booking_page_enabled;
  if not found or not account_ok(p.id) then return null; end if;
  select coalesce(jsonb_agg(distinct to_char(date, 'YYYY-MM-DD')), '[]') into busy
    from bookings where user_id = p.id and deleted_at is null and status <> 'cancelled' and date >= current_date;
  return jsonb_build_object('studio_name', p.studio_name, 'display_name', p.display_name, 'phone', p.phone,
                            'note', p.booking_page_note, 'packages', p.packages, 'busy_dates', busy);
end $$;

create or replace function public.submit_booking_request(
  p_slug text, p_name text, p_phone text, p_type text, p_date date, p_time text default null,
  p_notes text default null, p_package text default null, p_hp text default ''
) returns void language plpgsql security definer set search_path = public as $$
declare p profiles;
begin
  if coalesce(p_hp, '') <> '' then return; end if;                       -- bot filled the hidden field: pretend success
  select * into p from profiles where slug = lower(p_slug) and booking_page_enabled;
  if not found or not account_ok(p.id) then raise exception 'not_available'; end if;
  if length(trim(coalesce(p_name,''))) < 2 or length(p_name) > 120 or length(coalesce(p_phone,'')) < 6 or length(p_phone) > 30
     or p_date is null or p_date < current_date - 1 or length(coalesce(p_notes,'')) > 1000 then
    raise exception 'invalid_request';
  end if;
  if (select count(*) from booking_requests where phone = p_phone and user_id = p.id and created_at > now() - interval '1 hour') >= 3
     or (select count(*) from booking_requests where user_id = p.id and created_at > now() - interval '1 hour') >= 40 then
    raise exception 'rate_limited';
  end if;
  insert into booking_requests (user_id, name, phone, type, package_name, requested_date, requested_time, notes)
  values (p.id, trim(p_name), trim(p_phone), left(coalesce(p_type,''), 60), left(p_package, 120), p_date, left(p_time, 5), left(p_notes, 1000));
end $$;

create or replace function public.booking_status(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare b bookings; p profiles; c clients; pr projects; pays jsonb;
begin
  select * into b from bookings where public_token = p_token and deleted_at is null and share_enabled;
  if not found then return null; end if;
  select * into p from profiles where id = b.user_id;
  if not account_ok(b.user_id) then return null; end if;
  select * into c from clients where id = b.client_id;
  select * into pr from projects where booking_id = b.id and deleted_at is null order by updated_at desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('date', to_char(date,'YYYY-MM-DD'), 'amount', amount) order by date), '[]') into pays
    from transactions where booking_id = b.id and type = 'income' and deleted_at is null;
  return jsonb_build_object('studio_name', p.studio_name, 'studio_phone', p.phone, 'client_name', c.name, 'title', b.title, 'type', b.type,
    'date', to_char(b.date,'YYYY-MM-DD'), 'time', b.time, 'duration_minutes', b.duration_minutes, 'location', b.location,
    'price', b.price, 'deposit', b.deposit, 'remaining', greatest(b.price - b.deposit, 0), 'status', b.status,
    'project_status', pr.status, 'payments', pays, 'updated_at', b.updated_at);
end $$;

create or replace function public.track_event(p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or p_name !~ '^[a-z_]+(\.[a-z_]+)?$' or length(p_name) > 40 then return; end if;
  insert into usage_events (user_id, name) values (auth.uid(), p_name);
end $$;

create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if exists (select 1 from admins where user_id = auth.uid()) then raise exception 'admin_cannot_delete'; end if;
  delete from auth.users where id = auth.uid();
end $$;

-- ───────────── admin RPCs ─────────────
create or replace function public.admin_log(p_action text, p_target uuid, p_details jsonb) returns void
language sql security definer set search_path = public as $$
  insert into admin_audit (admin_id, action, target_user, details) values (auth.uid(), p_action, p_target, coalesce(p_details, '{}'));
$$;

create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_admin();
  return jsonb_build_object(
    'accounts', jsonb_build_object(
      'total', (select count(*) from profiles),
      'pending', (select count(*) from profiles where status = 'pending'),
      'trial', (select count(*) from profiles where status = 'trial' and trial_ends_at > now()),
      'trial_expired', (select count(*) from profiles where status = 'trial' and (trial_ends_at is null or trial_ends_at <= now())),
      'active', (select count(*) from profiles where status = 'active' and (paid_until is null or paid_until > now())),
      'active_expired', (select count(*) from profiles where status = 'active' and paid_until <= now()),
      'suspended', (select count(*) from profiles where status = 'suspended')),
    'signups_7d', (select count(*) from profiles where created_at > now() - interval '7 days'),
    'signups_30d', (select count(*) from profiles where created_at > now() - interval '30 days'),
    'active_users_7d', (select count(*) from profiles where last_seen_at > now() - interval '7 days'),
    'active_users_1d', (select count(*) from profiles where last_seen_at > now() - interval '1 day'),
    'booking_requests_7d', (select count(*) from booking_requests where created_at > now() - interval '7 days'),
    'totals', jsonb_build_object(
      'clients', (select count(*) from clients where deleted_at is null),
      'bookings', (select count(*) from bookings where deleted_at is null),
      'transactions', (select count(*) from transactions where deleted_at is null)),
    'events_7d', coalesce((select jsonb_object_agg(name, n) from (select name, count(*) n from usage_events where created_at > now() - interval '7 days' group by name) e), '{}'));
end $$;

create or replace function public.admin_list_accounts(p_search text default '', p_status text default null, p_limit int default 100, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform assert_admin();
  return coalesce((select jsonb_agg(to_jsonb(r)) from (
    select p.id, u.email::text as email, p.display_name, p.studio_name, p.phone, p.slug, p.status, p.trial_ends_at, p.paid_until, p.plan,
           p.booking_page_enabled, p.created_at, p.last_seen_at,
           (select count(*) from clients c where c.user_id = p.id and c.deleted_at is null) as clients_count,
           (select count(*) from bookings b where b.user_id = p.id and b.deleted_at is null) as bookings_count,
           (select count(*) from booking_requests q where q.user_id = p.id) as requests_count,
           p.admin_note
    from profiles p join auth.users u on u.id = p.id
    where (p_status is null or p_status = '' or p.status = p_status)
      and (coalesce(p_search,'') = '' or u.email ilike '%'||p_search||'%' or p.display_name ilike '%'||p_search||'%' or p.studio_name ilike '%'||p_search||'%' or p.phone ilike '%'||p_search||'%')
    order by p.created_at desc limit least(greatest(p_limit,1),200) offset greatest(p_offset,0)) r), '[]');
end $$;

create or replace function public.admin_set_status(p_user uuid, p_status text, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare days int;
begin
  perform assert_admin();
  if p_status not in ('pending','trial','active','suspended') then raise exception 'invalid_status'; end if;
  select coalesce((value::text)::int, 14) into days from app_settings where key = 'trial_days';
  update profiles set status = p_status,
    trial_ends_at = case when p_status = 'trial' and (trial_ends_at is null or trial_ends_at < now()) then now() + make_interval(days => coalesce(days,14)) else trial_ends_at end
  where id = p_user;
  perform admin_log('set_status', p_user, jsonb_build_object('status', p_status, 'reason', p_reason));
end $$;

create or replace function public.admin_extend_trial(p_user uuid, p_days int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin();
  if p_days < 1 or p_days > 365 then raise exception 'invalid_days'; end if;
  update profiles set status = case when status = 'pending' then 'trial' else status end,
    trial_ends_at = greatest(coalesce(trial_ends_at, now()), now()) + make_interval(days => p_days) where id = p_user;
  perform admin_log('extend_trial', p_user, jsonb_build_object('days', p_days));
end $$;

create or replace function public.admin_set_paid(p_user uuid, p_until timestamptz, p_plan text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin();
  update profiles set status = 'active', paid_until = p_until, plan = coalesce(p_plan, plan) where id = p_user;
  perform admin_log('set_paid', p_user, jsonb_build_object('until', p_until, 'plan', p_plan));
end $$;

create or replace function public.admin_set_note(p_user uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin();
  update profiles set admin_note = left(p_note, 2000) where id = p_user;
  perform admin_log('set_note', p_user, '{}');
end $$;

create or replace function public.admin_audit_list(p_limit int default 100) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_admin();
  return coalesce((select jsonb_agg(to_jsonb(a)) from (select * from admin_audit order by id desc limit least(greatest(p_limit,1),500)) a), '[]');
end $$;

create or replace function public.admin_get_settings() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_admin();
  return coalesce((select jsonb_object_agg(key, value) from app_settings), '{}');
end $$;

create or replace function public.admin_set_setting(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin();
  if p_key not in ('default_status', 'trial_days') then raise exception 'invalid_key'; end if;
  if p_key = 'default_status' and p_value::text not in ('"trial"', '"pending"') then raise exception 'invalid_value'; end if;
  insert into app_settings (key, value) values (p_key, p_value) on conflict (key) do update set value = excluded.value;
  perform admin_log('set_setting', null, jsonb_build_object('key', p_key, 'value', p_value));
end $$;

-- ───────────── function permissions ─────────────
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.public_page(text), public.submit_booking_request(text,text,text,text,date,text,text,text,text), public.booking_status(uuid) to anon, authenticated;
grant execute on function public.account_ok(uuid), public.slug_available(text), public.track_event(text), public.delete_my_account(), public.is_admin(),
  public.admin_overview(), public.admin_list_accounts(text,text,int,int), public.admin_set_status(uuid,text,text), public.admin_extend_trial(uuid,int),
  public.admin_set_paid(uuid,timestamptz,text), public.admin_set_note(uuid,text), public.admin_audit_list(int), public.admin_get_settings(), public.admin_set_setting(text,jsonb)
  to authenticated;

-- ───────────── hardening ─────────────
-- Anonymous visitors can only use the public RPCs above; they never touch tables directly.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon, authenticated;
-- Internal tables are reachable only through the security-definer functions.
revoke all on public.app_settings, public.admins, public.admin_audit, public.usage_events from authenticated;
