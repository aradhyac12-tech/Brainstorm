-- Run once in Supabase: SQL Editor -> New query -> paste -> Run
create table if not exists brainstorm_quizzes (id text primary key, data jsonb not null, created bigint not null);
create table if not exists brainstorm_attempts (id text primary key, quiz_id text not null, data jsonb not null, start bigint not null);
create index if not exists brainstorm_attempts_quiz_idx on brainstorm_attempts (quiz_id);
alter table brainstorm_quizzes enable row level security;
alter table brainstorm_attempts enable row level security;
