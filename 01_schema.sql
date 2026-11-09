-- AXION — database schema for Supabase (or any Postgres 14+)
-- Run once in Supabase → SQL Editor → New query → paste → Run. Safe to run again.
--
-- AXION's server (on Vercel) reaches these tables through the Supabase API with the
-- service_role key (SUPABASE_SERVICE_ROLE_KEY), which only the server holds.
-- Row Level Security is on with no policies, and the anon / authenticated roles have no
-- grants on the tables or functions, so the public anon key can't read or change anything.

-- All tracker records (structure, people, actions, update trails, settings, sent log) as JSON documents.
-- path = "collection/id" or "actions/<id>/comments/<commentId>"
CREATE TABLE IF NOT EXISTS public.docs (
  path        TEXT PRIMARY KEY,
  coll        TEXT    NOT NULL,                -- parent collection, e.g. "actions" or "actions/qbr-05/comments"
  id          TEXT    NOT NULL,
  data        JSONB   NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  BIGINT  NOT NULL                 -- epoch milliseconds
);
CREATE INDEX IF NOT EXISTS docs_coll ON public.docs (coll);

-- Logins (one per person in the directory). Passwords are bcrypt hashes; never sent to browsers.
CREATE TABLE IF NOT EXISTS public.users (
  person_id      TEXT PRIMARY KEY,             -- matches docs path "people/<person_id>"
  email          TEXT    NOT NULL,
  role           TEXT    NOT NULL CHECK (role IN ('admin','editor','contributor','client')),
  scopes         JSONB   NOT NULL DEFAULT '[]', -- e.g. ["exp:custcap","poc:albourne:acr"]
  login_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  ms_allowed     BOOLEAN NOT NULL DEFAULT TRUE,
  password_hash  TEXT,
  last_login     BIGINT,
  created_at     BIGINT  NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email ON public.users (lower(email));

-- Signed-in sessions (only a SHA-256 of the cookie token is stored)
CREATE TABLE IF NOT EXISTS public.sessions (
  token_hash  TEXT PRIMARY KEY,
  person_id   TEXT   NOT NULL,
  created_at  BIGINT NOT NULL,
  expires_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_person ON public.sessions (person_id);

-- Invite and password-reset links (hashed, single use)
CREATE TABLE IF NOT EXISTS public.tokens (
  token_hash  TEXT PRIMARY KEY,
  person_id   TEXT    NOT NULL,
  purpose     TEXT    NOT NULL CHECK (purpose IN ('invite','reset')),
  expires_at  BIGINT  NOT NULL,
  used        BOOLEAN NOT NULL DEFAULT FALSE
);

-- Small key/value store (e.g. date the daily reminder last ran)
CREATE TABLE IF NOT EXISTS public.meta (k TEXT PRIMARY KEY, v TEXT);

-- Change counter the browser polls to know when to refresh
CREATE TABLE IF NOT EXISTS public.counters (k TEXT PRIMARY KEY, v BIGINT NOT NULL DEFAULT 0);

-- Failed sign-in attempts, for the 10-tries-per-15-minutes limit
CREATE TABLE IF NOT EXISTS public.login_fails (k TEXT PRIMARY KEY, n INTEGER NOT NULL, t BIGINT NOT NULL);

-- Observability: audit trail (who did what), server and browser errors, slow requests, scheduled-job runs.
-- Kept for EVENT_RETENTION_DAYS (default 180) and pruned by the daily job.
CREATE TABLE IF NOT EXISTS public.events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at          BIGINT NOT NULL,                 -- epoch milliseconds
  kind        TEXT   NOT NULL,                 -- audit | error | client_error | slow | cron
  level       TEXT   NOT NULL DEFAULT 'info',  -- info | warn | error
  person_id   TEXT,
  request_id  TEXT,                            -- matches the X-Request-Id header and the Vercel log line
  path        TEXT,
  message     TEXT,
  data        JSONB
);
CREATE INDEX IF NOT EXISTS events_at ON public.events (at DESC);
CREATE INDEX IF NOT EXISTS events_kind_at ON public.events (kind, at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- Functions the server calls through the API (supabase.rpc) for writes that must be atomic
-- ─────────────────────────────────────────────────────────────────────────────

-- Create or replace a document, bump its version and the change counter
CREATE OR REPLACE FUNCTION public.axion_put_doc(p_path TEXT, p_coll TEXT, p_id TEXT, p_data JSONB)
RETURNS public.docs LANGUAGE plpgsql SET search_path = public AS $$
DECLARE r public.docs;
BEGIN
  INSERT INTO docs(path, coll, id, data, version, updated_at)
  VALUES (p_path, p_coll, p_id, p_data, 1, (extract(epoch FROM clock_timestamp()) * 1000)::BIGINT)
  ON CONFLICT (path) DO UPDATE SET data = EXCLUDED.data, version = docs.version + 1, updated_at = EXCLUDED.updated_at
  RETURNING * INTO r;
  INSERT INTO counters(k, v) VALUES ('rev', 1) ON CONFLICT (k) DO UPDATE SET v = counters.v + 1;
  RETURN r;
END $$;

-- Delete a document and bump the change counter
CREATE OR REPLACE FUNCTION public.axion_delete_doc(p_path TEXT)
RETURNS VOID LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  DELETE FROM docs WHERE path = p_path;
  INSERT INTO counters(k, v) VALUES ('rev', 1) ON CONFLICT (k) DO UPDATE SET v = counters.v + 1;
END $$;

-- Set meta[k] = v only if it isn't already v. TRUE if this call set it (run-once-a-day jobs).
CREATE OR REPLACE FUNCTION public.axion_claim_meta(p_k TEXT, p_v TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SET search_path = public AS $$
DECLARE n INT;
BEGIN
  INSERT INTO meta(k, v) VALUES (p_k, p_v)
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v WHERE meta.v IS DISTINCT FROM EXCLUDED.v;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END $$;

-- Count a failed sign-in (window of 15 minutes)
CREATE OR REPLACE FUNCTION public.axion_record_fail(p_k TEXT, p_now BIGINT)
RETURNS VOID LANGUAGE sql SET search_path = public AS $$
  INSERT INTO login_fails(k, n, t) VALUES (p_k, 1, p_now)
  ON CONFLICT (k) DO UPDATE SET
    n = CASE WHEN login_fails.t > p_now - 900000 THEN login_fails.n + 1 ELSE 1 END,
    t = CASE WHEN login_fails.t > p_now - 900000 THEN login_fails.t ELSE p_now END;
$$;

-- Create or update a login (keeps password and created_at)
CREATE OR REPLACE FUNCTION public.axion_upsert_user(p_person_id TEXT, p_email TEXT, p_role TEXT, p_scopes JSONB, p_login_enabled BOOLEAN, p_ms_allowed BOOLEAN)
RETURNS public.users LANGUAGE plpgsql SET search_path = public AS $$
DECLARE r public.users;
BEGIN
  INSERT INTO users(person_id, email, role, scopes, login_enabled, ms_allowed, created_at)
  VALUES (p_person_id, lower(p_email), p_role, COALESCE(p_scopes, '[]'::jsonb), p_login_enabled, p_ms_allowed, (extract(epoch FROM clock_timestamp()) * 1000)::BIGINT)
  ON CONFLICT (person_id) DO UPDATE SET email = EXCLUDED.email, role = EXCLUDED.role, scopes = EXCLUDED.scopes,
    login_enabled = EXCLUDED.login_enabled, ms_allowed = EXCLUDED.ms_allowed
  RETURNING * INTO r;
  RETURN r;
END $$;

-- First start: optionally load documents (only into an empty tracker), add default settings,
-- and make sure the admin has a login. Safe if two servers call it at once.
CREATE OR REPLACE FUNCTION public.axion_bootstrap(p_docs JSONB, p_settings JSONB, p_admin_email TEXT, p_admin_name TEXT)
RETURNS JSONB LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  nowms BIGINT := (extract(epoch FROM clock_timestamp()) * 1000)::BIGINT;
  seeded INT := 0; created BOOLEAN := FALSE; pid TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('axion-bootstrap'));
  IF p_docs IS NOT NULL AND NOT EXISTS (SELECT 1 FROM docs WHERE coll = 'org') THEN
    INSERT INTO docs(path, coll, id, data, version, updated_at)
    SELECT e.key, regexp_replace(e.key, '/[^/]+$', ''), regexp_replace(e.key, '^.*/', ''), e.value, 1, nowms
    FROM jsonb_each(p_docs) e
    ON CONFLICT (path) DO NOTHING;
    GET DIAGNOSTICS seeded = ROW_COUNT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM docs WHERE path = 'org/settings') THEN
    INSERT INTO docs(path, coll, id, data, version, updated_at) VALUES ('org/settings', 'org', 'settings', p_settings, 1, nowms);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin') THEN
    SELECT id INTO pid FROM docs WHERE coll = 'people' AND lower(data->>'email') = lower(p_admin_email) LIMIT 1;
    IF pid IS NULL THEN
      pid := 'admin';
      INSERT INTO docs(path, coll, id, data, version, updated_at)
      VALUES ('people/admin', 'people', 'admin', jsonb_build_object('name', p_admin_name, 'email', lower(p_admin_email), 'role', 'Leadership', 'side', 'internal', 'companyId', '', 'clientId', '', 'teamId', '', 'active', true), 1, nowms)
      ON CONFLICT (path) DO NOTHING;
    END IF;
    INSERT INTO users(person_id, email, role, scopes, login_enabled, ms_allowed, created_at)
    VALUES (pid, lower(p_admin_email), 'admin', '["*"]', TRUE, TRUE, nowms)
    ON CONFLICT (person_id) DO UPDATE SET role = 'admin', scopes = '["*"]', login_enabled = TRUE;
    created := TRUE;
  END IF;
  INSERT INTO counters(k, v) VALUES ('rev', 1) ON CONFLICT (k) DO UPDATE SET v = counters.v + 1;
  RETURN jsonb_build_object('seeded', seeded, 'adminCreated', created);
END $$;

-- Lock the tables away from Supabase's public API
ALTER TABLE public.docs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tokens      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.counters    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_fails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events      ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r TEXT;
BEGIN
  -- Nobody but the server's service_role may touch the tables or call the functions
  REVOKE ALL ON FUNCTION public.axion_put_doc(TEXT, TEXT, TEXT, JSONB), public.axion_delete_doc(TEXT), public.axion_claim_meta(TEXT, TEXT),
    public.axion_record_fail(TEXT, BIGINT), public.axion_upsert_user(TEXT, TEXT, TEXT, JSONB, BOOLEAN, BOOLEAN), public.axion_bootstrap(JSONB, JSONB, TEXT, TEXT) FROM PUBLIC;
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON public.docs, public.users, public.sessions, public.tokens, public.meta, public.counters, public.login_fails, public.events FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION public.axion_put_doc(TEXT, TEXT, TEXT, JSONB), public.axion_delete_doc(TEXT), public.axion_claim_meta(TEXT, TEXT), public.axion_record_fail(TEXT, BIGINT), public.axion_upsert_user(TEXT, TEXT, TEXT, JSONB, BOOLEAN, BOOLEAN), public.axion_bootstrap(JSONB, JSONB, TEXT, TEXT) FROM %I', r);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT USAGE ON SCHEMA public TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.docs, public.users, public.sessions, public.tokens, public.meta, public.counters, public.login_fails, public.events TO service_role;
    GRANT EXECUTE ON FUNCTION public.axion_put_doc(TEXT, TEXT, TEXT, JSONB), public.axion_delete_doc(TEXT), public.axion_claim_meta(TEXT, TEXT),
      public.axion_record_fail(TEXT, BIGINT), public.axion_upsert_user(TEXT, TEXT, TEXT, JSONB, BOOLEAN, BOOLEAN), public.axion_bootstrap(JSONB, JSONB, TEXT, TEXT) TO service_role;
  END IF;
END $$;

-- Make the Supabase API pick up the new tables and functions straight away
NOTIFY pgrst, 'reload schema';
