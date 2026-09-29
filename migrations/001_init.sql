create table departments (
  id serial primary key,
  name text not null unique,
  code text not null unique
);

create table staff (
  id serial primary key,
  username text not null unique,
  password_hash text not null,
  role text not null check (role in ('admin', 'institute', 'hod')),
  dept_id int references departments (id),
  display_title text,
  token_version int not null default 0,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  disabled boolean not null default false,
  check ((role = 'hod') = (dept_id is not null))
);

create table students (
  id serial primary key,
  roll_no text not null unique,
  name text not null,
  dept_id int not null references departments (id),
  batch_year int not null check (batch_year between 2000 and 2100),
  created_at timestamptz not null default now()
);
create index students_dept_batch on students (dept_id, batch_year);

create table platform_accounts (
  id serial primary key,
  student_id int not null references students (id) on delete cascade,
  platform text not null check (platform in ('leetcode', 'hackerrank')),
  username text not null,
  state text not null default 'active' check (state in ('active', 'broken')),
  attempts int not null default 0,
  next_retry_at timestamptz,
  claimed_until timestamptz,
  last_scraped_at timestamptz,
  last_ok_at timestamptz,
  last_error text,
  unique (student_id, platform)
);
create index platform_accounts_queue on platform_accounts (platform, state, last_scraped_at);

-- Successful fetches only. Failures are tracked on platform_accounts so a bad
-- scrape can never overwrite a good snapshot for the same day.
create table snapshots (
  id bigserial primary key,
  student_id int not null references students (id) on delete cascade,
  platform text not null check (platform in ('leetcode', 'hackerrank')),
  snap_date date not null,
  solved_total int not null,
  solved_easy int,
  solved_medium int,
  solved_hard int,
  global_rank int,
  hr_stars int,
  scraped_at timestamptz not null default now(),
  unique (student_id, platform, snap_date)
);
create index snapshots_latest on snapshots (student_id, platform, snap_date desc);
