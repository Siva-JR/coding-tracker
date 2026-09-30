-- GitHub profile link, stored as given for future use. Nothing reads or fetches it yet.
alter table students add column github_url text check (github_url is null or length(github_url) <= 300);
