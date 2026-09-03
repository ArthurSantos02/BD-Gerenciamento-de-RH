import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from './security.js';

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(resolve(here, 'schema.sql'), 'utf8');

export function openDatabase(filename = resolve(here, '..', 'data', 'rh-conecta.sqlite')) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;');
  db.exec(schema);
  migrateDatabase(db);
  seedDatabase(db);
  return db;
}

function migrateDatabase(db) {
  const sessionColumns = db.prepare('PRAGMA table_info(sessions)').all().map(column => column.name);
  if (!sessionColumns.includes('csrf_token')) {
    db.exec('ALTER TABLE sessions ADD COLUMN csrf_token TEXT; DELETE FROM sessions;');
  }
}

function seedDatabase(db) {
  const existing = db.prepare('SELECT COUNT(*) AS total FROM organizations').get().total;
  if (existing) {
    ensureDemoAdmin(db);
    return;
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    const addOrg = db.prepare('INSERT INTO organizations (name, document, kind) VALUES (?, ?, ?)');
    const accountingId = Number(addOrg.run('Contábil Horizonte', '11222333000181', 'accounting').lastInsertRowid);
    const clientId = Number(addOrg.run('Padaria Aurora', '44555666000110', 'client').lastInsertRowid);
    const secondClientId = Number(addOrg.run('Oficina Estrela', '77888999000142', 'client').lastInsertRowid);
    db.prepare('INSERT INTO organization_links VALUES (?, ?, CURRENT_TIMESTAMP)').run(accountingId, clientId);
    db.prepare('INSERT INTO organization_links VALUES (?, ?, CURRENT_TIMESTAMP)').run(accountingId, secondClientId);

    const addUser = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)');
    const password = hashPassword('Demo@123');
    const analystId = Number(addUser.run('Ana Analista', 'analista@demo.rh', password).lastInsertRowid);
    const adminId = Number(addUser.run('Amanda Contábil', 'admin@demo.rh', password).lastInsertRowid);
    const companyId = Number(addUser.run('Carlos Empresa', 'empresa@demo.rh', password).lastInsertRowid);
    const managerId = Number(addUser.run('Marina Gestora', 'gestor@demo.rh', password).lastInsertRowid);
    const outsiderId = Number(addUser.run('Olívia Oficina', 'oficina@demo.rh', password).lastInsertRowid);
    const addMembership = db.prepare('INSERT INTO memberships VALUES (?, ?, ?)');
    addMembership.run(analystId, accountingId, 'DP_ANALYST');
    addMembership.run(analystId, clientId, 'DP_ANALYST');
    addMembership.run(analystId, secondClientId, 'DP_ANALYST');
    addMembership.run(adminId, accountingId, 'ACCOUNTING_ADMIN');
    addMembership.run(adminId, clientId, 'ACCOUNTING_ADMIN');
    addMembership.run(adminId, secondClientId, 'ACCOUNTING_ADMIN');
    addMembership.run(companyId, clientId, 'COMPANY_RESPONSIBLE');
    addMembership.run(managerId, clientId, 'MANAGER_APPROVER');
    addMembership.run(outsiderId, secondClientId, 'COMPANY_RESPONSIBLE');

    const depId = Number(db.prepare('INSERT INTO departments (organization_id, name) VALUES (?, ?)').run(clientId, 'Operações').lastInsertRowid);
    const posId = Number(db.prepare('INSERT INTO positions (organization_id, name) VALUES (?, ?)').run(clientId, 'Atendente').lastInsertRowid);
    db.prepare(`INSERT INTO employees
      (organization_id, name, cpf, email, birth_date, hire_date, department_id, position_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(clientId, 'Beatriz Lima', '52998224725', 'beatriz@aurora.test', '1994-05-10', '2025-01-15', depId, posId);
    const competenceId = Number(db.prepare('INSERT INTO competencies (organization_id, year, month) VALUES (?, ?, ?)')
      .run(clientId, new Date().getUTCFullYear(), new Date().getUTCMonth() + 1).lastInsertRowid);
    const movementId = Number(db.prepare(`INSERT INTO movements
      (organization_id, competency_id, type, title, due_date, created_by, updated_by)
      VALUES (?, ?, 'ADMISSION', ?, date('now', '+5 days'), ?, ?)`)
      .run(clientId, competenceId, 'Admissão — João Souza', companyId, companyId).lastInsertRowid);
    db.prepare(`INSERT INTO admissions
      (movement_id, employee_name, cpf, email, birth_date, hire_date, department, position)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(movementId, 'João Souza', '11144477735', 'joao@aurora.test', '1998-02-03', new Date().toISOString().slice(0, 10), 'Operações', 'Auxiliar');
    audit(db, clientId, companyId, 'movement', movementId, 'CREATED', { type: 'ADMISSION', status: 'DRAFT' });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function ensureDemoAdmin(db) {
  const accounting = db.prepare("SELECT id FROM organizations WHERE kind='accounting' ORDER BY id LIMIT 1").get();
  if (!accounting) return;
  db.prepare(`INSERT INTO users (name,email,password_hash)
    VALUES ('Amanda Contábil','admin@demo.rh',?) ON CONFLICT(email) DO NOTHING`).run(hashPassword('Demo@123'));
  const admin = db.prepare("SELECT id FROM users WHERE email='admin@demo.rh' COLLATE NOCASE").get();
  const organizations = db.prepare(`SELECT id FROM organizations WHERE id=? OR id IN (
    SELECT client_org_id FROM organization_links WHERE accounting_org_id=?)`).all(accounting.id, accounting.id);
  const addMembership = db.prepare(`INSERT INTO memberships (user_id,organization_id,role) VALUES (?,?,'ACCOUNTING_ADMIN')
    ON CONFLICT(user_id,organization_id) DO UPDATE SET role=excluded.role`);
  withTransaction(db, () => organizations.forEach(org => addMembership.run(admin.id, org.id)));
}

export function audit(db, organizationId, userId, entityType, entityId, action, details = {}) {
  db.prepare(`INSERT INTO audit_logs
    (organization_id, actor_user_id, entity_type, entity_id, action, details_json)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(organizationId, userId, entityType, entityId, action, JSON.stringify(details));
}

export function withTransaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
