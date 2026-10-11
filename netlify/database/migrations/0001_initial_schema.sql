-- Service areas and barangays (seeded from the public site's sample data)
CREATE TABLE service_areas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  marker_name TEXT,
  status TEXT NOT NULL DEFAULT 'limited' CHECK (status IN ('steady','limited','outage')),
  source TEXT NOT NULL DEFAULT 'To be confirmed',
  rate NUMERIC(8,2) NOT NULL DEFAULT 15.00,
  hours TEXT NOT NULL DEFAULT 'To be confirmed',
  office TEXT NOT NULL DEFAULT 'To be confirmed',
  notice TEXT,
  extra BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 100,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE barangays (
  id SERIAL PRIMARY KEY,
  area_id TEXT NOT NULL REFERENCES service_areas(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  UNIQUE (area_id, name)
);

-- One row per Netlify Identity user, refreshed on each dashboard visit
CREATE TABLE profiles (
  identity_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  full_name TEXT,
  phone TEXT,
  area_id TEXT REFERENCES service_areas(id),
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','staff','admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Electricity accounts and the member who has linked them
CREATE TABLE accounts (
  id SERIAL PRIMARY KEY,
  account_no CHAR(10) NOT NULL UNIQUE CHECK (account_no ~ '^[0-9]{10}$'),
  profile_id TEXT REFERENCES profiles(identity_id) ON DELETE SET NULL,
  link_status TEXT NOT NULL DEFAULT 'pending' CHECK (link_status IN ('pending','approved','rejected')),
  area_id TEXT REFERENCES service_areas(id),
  holder_name TEXT,
  review_note TEXT,
  reviewed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE bills (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  period CHAR(7) NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
  kwh NUMERIC(10,2) NOT NULL CHECK (kwh >= 0),
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','paid','overdue')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, period)
);

CREATE TABLE outage_reports (
  id SERIAL PRIMARY KEY,
  reporter_id TEXT REFERENCES profiles(identity_id) ON DELETE SET NULL,
  area_id TEXT NOT NULL REFERENCES service_areas(id),
  barangay TEXT NOT NULL,
  landmark TEXT,
  observation TEXT NOT NULL,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','assigned','in_progress','resolved')),
  assigned_to TEXT REFERENCES profiles(identity_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX outage_reports_status_idx ON outage_reports (status, created_at DESC);
CREATE INDEX outage_reports_reporter_idx ON outage_reports (reporter_id);

CREATE TABLE outage_updates (
  id SERIAL PRIMARY KEY,
  report_id INTEGER NOT NULL REFERENCES outage_reports(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES profiles(identity_id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- New connection and membership applications
CREATE TABLE applications (
  id SERIAL PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(identity_id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('membership','new_connection')),
  area_id TEXT NOT NULL REFERENCES service_areas(id),
  barangay TEXT NOT NULL,
  address TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','in_review','approved','rejected')),
  review_note TEXT,
  reviewed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE announcements (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  area_id TEXT REFERENCES service_areas(id),
  published BOOLEAN NOT NULL DEFAULT TRUE,
  author_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE audit_log (
  id SERIAL PRIMARY KEY,
  actor_id TEXT,
  actor_email TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);

INSERT INTO service_areas (id, name, marker_name, status, source, rate, hours, office, extra, sort_order) VALUES
  ('bongao','Bongao',NULL,'steady','Diesel power plant serving the main town',13.50,'24 hours','Main office, Bongao town',FALSE,1),
  ('simunul','Simunul',NULL,'limited','Island diesel set',15.20,'Evening hours, 6 pm to 6 am','Simunul satellite office',FALSE,2),
  ('sibutu','Sibutu',NULL,'steady','Solar-diesel hybrid plant',14.10,'Most of the day','Sibutu collection office',FALSE,3),
  ('sitangkai','Sitangkai',NULL,'outage','Solar-diesel hybrid plant',14.10,'Most of the day','Sitangkai collection office',FALSE,4),
  ('taganak','Turtle Islands (Taganak)','Taganak','limited','Small island system',16.00,'Evening hours','To be confirmed',FALSE,5),
  ('mapun','Mapun',NULL,'limited','To be confirmed',15.00,'To be confirmed','To be confirmed',TRUE,6),
  ('languyan','Languyan',NULL,'limited','To be confirmed',15.00,'To be confirmed','To be confirmed',TRUE,7),
  ('sapa-sapa','Sapa-Sapa',NULL,'limited','To be confirmed',15.00,'To be confirmed','To be confirmed',TRUE,8),
  ('south-ubian','South Ubian',NULL,'limited','To be confirmed',15.00,'To be confirmed','To be confirmed',TRUE,9),
  ('tandubas','Tandubas',NULL,'limited','To be confirmed',15.00,'To be confirmed','To be confirmed',TRUE,10),
  ('panglima-sugala','Panglima Sugala',NULL,'limited','To be confirmed',15.00,'To be confirmed','To be confirmed',TRUE,11);

INSERT INTO barangays (area_id, name) VALUES ('bongao','Ipil'),('bongao','Kamagong'),('bongao','Karungdong'),('bongao','Lakit Lakit'),('bongao','Lamion'),('bongao','Lapid Lapid'),('bongao','Lato Lato'),('bongao','Luuk Pandan'),('bongao','Luuk Tulay'),('bongao','Malassa'),('bongao','Mandulan'),('bongao','Masantong'),('bongao','Montay Montay'),('bongao','Pababag'),('bongao','Pagasinan'),('bongao','Pahut'),('bongao','Pakias'),('bongao','Paniongan'),('bongao','Pasiagan'),('bongao','Bongao Poblacion'),('bongao','Sanga-sanga'),('bongao','Silubog'),('bongao','Simandagit'),('bongao','Sumangat'),('bongao','Tarawakan'),('bongao','Tongsinah'),('bongao','Tubig Basag'),('bongao','Ungus-ungus'),('bongao','Lagasan'),('bongao','Nalil'),('bongao','Pagatpat'),('bongao','Pag-asa'),('bongao','Tubig Tanah'),('bongao','Tubig-Boh'),('bongao','Tubig-Mampallam');
