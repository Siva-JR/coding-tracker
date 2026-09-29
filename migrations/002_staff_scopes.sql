-- Replaces the fixed hod/institute roles with two roles (admin, viewer) plus per-user scopes.
-- No staff data existed yet, so the table is rebuilt.
drop table staff;

create table staff (
  id serial primary key,
  username text not null unique check (username = lower(username)),
  password_hash text not null,
  role text not null check (role in ('admin', 'viewer')),
  display_title text,
  must_change_password boolean not null default false,
  token_version int not null default 0,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  disabled boolean not null default false,
  created_at timestamptz not null default now()
);

-- One row per grant. dept_id null = all departments, year null = all years of study (1-4).
create table staff_scopes (
  id serial primary key,
  staff_id int not null references staff (id) on delete cascade,
  dept_id int references departments (id),
  year smallint check (year between 1 and 4)
);
create unique index staff_scopes_unique on staff_scopes (staff_id, coalesce(dept_id, 0), coalesce(year, 0));
