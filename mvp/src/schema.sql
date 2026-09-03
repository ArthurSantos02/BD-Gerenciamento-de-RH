PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  document TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('accounting', 'client')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS organization_links (
  accounting_org_id INTEGER NOT NULL REFERENCES organizations(id),
  client_org_id INTEGER NOT NULL REFERENCES organizations(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (accounting_org_id, client_org_id),
  CHECK (accounting_org_id <> client_org_id)
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS memberships (
  user_id INTEGER NOT NULL REFERENCES users(id),
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  role TEXT NOT NULL CHECK (role IN (
    'PLATFORM_ADMIN', 'ACCOUNTING_ADMIN', 'DP_ANALYST',
    'COMPANY_ADMIN', 'COMPANY_RESPONSIBLE', 'MANAGER_APPROVER'
  )),
  PRIMARY KEY (user_id, organization_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  csrf_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  cpf TEXT NOT NULL,
  email TEXT,
  birth_date TEXT,
  hire_date TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  department_id INTEGER REFERENCES departments(id),
  position_id INTEGER REFERENCES positions(id),
  created_from_admission_id INTEGER UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, cpf)
);

CREATE TABLE IF NOT EXISTS competencies (
  id INTEGER PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  year INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2200),
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  closed_at TEXT,
  closed_by INTEGER REFERENCES users(id),
  reopened_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, year, month)
);

CREATE TABLE IF NOT EXISTS movements (
  id INTEGER PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  competency_id INTEGER NOT NULL REFERENCES competencies(id),
  type TEXT NOT NULL CHECK (type IN ('ADMISSION', 'VACATION')),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
    'DRAFT', 'SUBMITTED', 'IN_REVIEW', 'APPROVED', 'RETURNED', 'COMPLETED'
  )),
  title TEXT NOT NULL,
  due_date TEXT,
  return_reason TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  updated_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admissions (
  movement_id INTEGER PRIMARY KEY REFERENCES movements(id),
  employee_name TEXT NOT NULL,
  cpf TEXT NOT NULL,
  email TEXT,
  birth_date TEXT,
  hire_date TEXT NOT NULL,
  department TEXT NOT NULL,
  position TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vacations (
  movement_id INTEGER PRIMARY KEY REFERENCES movements(id),
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  CHECK (start_date <= end_date)
);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY,
  movement_id INTEGER NOT NULL REFERENCES movements(id),
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  storage_name TEXT NOT NULL UNIQUE,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  actor_user_id INTEGER NOT NULL REFERENCES users(id),
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_memberships_org ON memberships(organization_id);
CREATE INDEX IF NOT EXISTS idx_employees_org_status ON employees(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_competencies_org_status ON competencies(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_movements_org_status ON movements(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_org_created ON audit_logs(organization_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS audit_logs_immutable_update
BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit logs are immutable'); END;

CREATE TRIGGER IF NOT EXISTS audit_logs_immutable_delete
BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit logs are immutable'); END;
