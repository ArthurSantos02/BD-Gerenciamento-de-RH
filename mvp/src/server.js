import http from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, audit, withTransaction } from './db.js';
import { escapeCsv, hashPassword, isValidCpf, maskCpf, newSessionToken, normalizeCpf, tokenHash, verifyPassword } from './security.js';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, '..', 'public');
const uploadDir = resolve(here, '..', 'uploads');
mkdirSync(uploadDir, { recursive: true });

const STATUS_FLOW = {
  DRAFT: ['SUBMITTED'],
  RETURNED: ['DRAFT'],
  SUBMITTED: ['IN_REVIEW'],
  IN_REVIEW: ['APPROVED', 'RETURNED'],
  APPROVED: ['COMPLETED'],
  COMPLETED: []
};
const COMPANY_ROLES = new Set(['COMPANY_ADMIN', 'COMPANY_RESPONSIBLE']);
const REVIEW_ROLES = new Set(['ACCOUNTING_ADMIN', 'DP_ANALYST']);
const ADMIN_ROLES = new Set(['PLATFORM_ADMIN', 'ACCOUNTING_ADMIN', 'COMPANY_ADMIN']);
const loginAttempts = new Map();

export function createApp(options = {}) {
  const db = options.db ?? openDatabase(options.databaseFile);
  const uploads = options.uploadDir ?? uploadDir;
  mkdirSync(uploads, { recursive: true });

  async function handler(req, res) {
    setSecurityHeaders(res);
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url, db, uploads);
      } else {
        serveStatic(req, res, url.pathname);
      }
    } catch (error) {
      const status = error.status ?? (String(error.message).includes('UNIQUE constraint') ? 409 : 500);
      if (status === 500) console.error(error);
      sendJson(res, status, { error: error.publicMessage ?? error.message ?? 'Erro interno' });
    }
  }

  return { handler, db };
}

async function handleApi(req, res, url, db, uploads) {
  const path = url.pathname;
  let match;
  if (req.method === 'GET' && path === '/api/health') return sendJson(res, 200, { status: 'ok' });
  if (req.method === 'POST' && path === '/api/auth/login') return login(req, res, db);

  const auth = authenticate(req, db);
  if (!auth) throw httpError(401, 'Sessão inválida ou expirada.');
  if (['POST','PUT','PATCH','DELETE'].includes(req.method)) requireCsrf(req, auth);
  if (req.method === 'POST' && path === '/api/auth/logout') return logout(req, res, db);
  if (req.method === 'GET' && path === '/api/auth/me') return sendJson(res, 200, auth);
  if (req.method === 'GET' && path === '/api/organizations') return listOrganizations(res, db, auth);
  if (req.method === 'POST' && path === '/api/organizations') return createOrganization(req, res, db, auth);
  if (req.method === 'GET' && path === '/api/users') return listUsers(res, db, auth, requiredOrg(url));
  if (req.method === 'POST' && path === '/api/users') return createUser(req, res, db, auth);
  match = path.match(/^\/api\/users\/(\d+)\/memberships$/);
  if (match && req.method === 'POST') return addUserMembership(req, res, db, auth, Number(match[1]));
  if (req.method === 'GET' && path === '/api/dashboard') return dashboard(res, db, auth, requiredOrg(url));

  if (req.method === 'GET' && path === '/api/employees') return listEmployees(res, db, auth, requiredOrg(url));
  if (req.method === 'POST' && path === '/api/employees') return createEmployee(req, res, db, auth);
  match = path.match(/^\/api\/employees\/(\d+)$/);
  if (match && req.method === 'PATCH') return updateEmployee(req, res, db, auth, Number(match[1]));

  if (req.method === 'GET' && path === '/api/competencies') return listCompetencies(res, db, auth, requiredOrg(url));
  if (req.method === 'POST' && path === '/api/competencies') return createCompetency(req, res, db, auth);
  match = path.match(/^\/api\/competencies\/(\d+)\/(close|reopen)$/);
  if (match && req.method === 'POST') return changeCompetency(req, res, db, auth, Number(match[1]), match[2]);

  if (req.method === 'GET' && path === '/api/movements') return listMovements(res, db, auth, requiredOrg(url), url);
  if (req.method === 'POST' && path === '/api/admissions') return createAdmission(req, res, db, auth);
  if (req.method === 'POST' && path === '/api/vacations') return createVacation(req, res, db, auth);
  match = path.match(/^\/api\/movements\/(\d+)\/transition$/);
  if (match && req.method === 'POST') return transitionMovement(req, res, db, auth, Number(match[1]));
  match = path.match(/^\/api\/movements\/(\d+)\/attachments$/);
  if (match && req.method === 'POST') return addAttachment(req, res, db, auth, Number(match[1]), uploads);
  if (match && req.method === 'GET') return listAttachments(res, db, auth, Number(match[1]));
  match = path.match(/^\/api\/attachments\/(\d+)$/);
  if (match && req.method === 'GET') return downloadAttachment(res, db, auth, Number(match[1]), uploads);

  if (req.method === 'GET' && path === '/api/audit') return listAudit(res, db, auth, requiredOrg(url));
  match = path.match(/^\/api\/exports\/competencies\/(\d+)\.csv$/);
  if (match && req.method === 'GET') return exportCompetency(res, db, auth, Number(match[1]));
  throw httpError(404, 'Rota não encontrada.');
}

async function login(req, res, db) {
  const body = await readJson(req);
  const attemptKey = `${req.socket.remoteAddress ?? 'unknown'}:${String(body.email ?? '').toLowerCase()}`;
  const attempt = loginAttempts.get(attemptKey);
  if (attempt && attempt.until > Date.now() && attempt.count >= 5) throw httpError(429, 'Muitas tentativas. Aguarde alguns minutos.');
  const user = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE AND active = 1').get(body.email ?? '');
  if (!user || !verifyPassword(body.password ?? '', user.password_hash)) {
    const current = attempt?.until > Date.now() ? attempt : { count: 0, until: Date.now() + 15 * 60_000 };
    current.count += 1; loginAttempts.set(attemptKey, current);
    throw httpError(401, 'E-mail ou senha inválidos.');
  }
  loginAttempts.delete(attemptKey);
  const token = newSessionToken();
  const csrfToken = newSessionToken();
  db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
  db.prepare("INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, datetime('now', '+8 hours'))")
    .run(tokenHash(token), user.id, csrfToken);
  res.setHeader('Set-Cookie', `rh_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`);
  sendJson(res, 200, authPayload(db, user, csrfToken));
}

function logout(req, res, db) {
  const token = getToken(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
  res.setHeader('Set-Cookie', 'rh_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  sendJson(res, 200, { ok: true });
}

function authenticate(req, db) {
  const token = getToken(req);
  if (!token) return null;
  const user = db.prepare(`SELECT u.*,s.csrf_token FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > datetime('now') AND u.active = 1`).get(tokenHash(token));
  return user ? authPayload(db, user, user.csrf_token) : null;
}

function authPayload(db, user, csrfToken) {
  const memberships = db.prepare(`SELECT m.organization_id, m.role, o.name AS organization_name, o.kind
    FROM memberships m JOIN organizations o ON o.id = m.organization_id
    WHERE m.user_id = ? AND o.active = 1 ORDER BY o.kind, o.name`).all(user.id);
  return { id: user.id, name: user.name, email: user.email, csrfToken, memberships };
}

function listOrganizations(res, db, auth) {
  sendJson(res, 200, auth.memberships.map(m => ({ id: m.organization_id, name: m.organization_name, kind: m.kind, role: m.role })));
}

function listUsers(res, db, auth, orgId) {
  requireRole(auth, orgId, ADMIN_ROLES);
  const users = db.prepare(`SELECT u.id,u.name,u.email,u.active,m.role FROM memberships m
    JOIN users u ON u.id=m.user_id WHERE m.organization_id=? ORDER BY u.name`).all(orgId);
  sendJson(res, 200, users);
}

async function createOrganization(req, res, db, auth) {
  const b = await readJson(req);
  const adminMembership = auth.memberships.find(m => ['ACCOUNTING_ADMIN','PLATFORM_ADMIN'].includes(m.role));
  if (!adminMembership) throw httpError(403, 'Perfil sem permissão para cadastrar empresas.');
  const document = String(b.document ?? '').replace(/\D/g, '');
  if (!b.name?.trim() || document.length !== 14) throw httpError(422, 'Nome e CNPJ com 14 dígitos são obrigatórios.');
  const id = withTransaction(db, () => {
    const orgId = Number(db.prepare("INSERT INTO organizations (name,document,kind) VALUES (?,?,'client')").run(b.name.trim(), document).lastInsertRowid);
    const accountingOrg = auth.memberships.find(m => m.kind === 'accounting' && ['ACCOUNTING_ADMIN','PLATFORM_ADMIN'].includes(m.role));
    if (accountingOrg) db.prepare('INSERT INTO organization_links (accounting_org_id,client_org_id) VALUES (?,?)').run(accountingOrg.organization_id, orgId);
    db.prepare('INSERT INTO memberships (user_id,organization_id,role) VALUES (?,?,?)').run(auth.id, orgId, 'ACCOUNTING_ADMIN');
    audit(db, orgId, auth.id, 'organization', orgId, 'CREATED', { name: b.name.trim() }); return orgId;
  });
  sendJson(res, 201, { id });
}

async function createUser(req, res, db, auth) {
  const b = await readJson(req); const orgId = integer(b.organizationId);
  requireRole(auth, orgId, ADMIN_ROLES);
  if (!b.name?.trim() || !/^\S+@\S+\.\S+$/.test(b.email ?? '') || String(b.password ?? '').length < 8) throw httpError(422, 'Nome, e-mail válido e senha com ao menos 8 caracteres são obrigatórios.');
  const allowedRoles = new Set(['ACCOUNTING_ADMIN','DP_ANALYST','COMPANY_ADMIN','COMPANY_RESPONSIBLE','MANAGER_APPROVER']);
  if (!allowedRoles.has(b.role)) throw httpError(422, 'Perfil inválido.');
  const id = withTransaction(db, () => {
    const userId = Number(db.prepare('INSERT INTO users (name,email,password_hash) VALUES (?,?,?)').run(b.name.trim(), b.email.trim().toLowerCase(), hashPassword(b.password)).lastInsertRowid);
    db.prepare('INSERT INTO memberships VALUES (?,?,?)').run(userId, orgId, b.role);
    audit(db, orgId, auth.id, 'user', userId, 'CREATED', { role: b.role }); return userId;
  });
  sendJson(res, 201, { id });
}

async function addUserMembership(req, res, db, auth, userId) {
  const b = await readJson(req); const orgId = integer(b.organizationId); requireRole(auth, orgId, ADMIN_ROLES);
  const user = db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(userId); if (!user) throw httpError(404, 'Usuário não encontrado.');
  const allowedRoles = new Set(['ACCOUNTING_ADMIN','DP_ANALYST','COMPANY_ADMIN','COMPANY_RESPONSIBLE','MANAGER_APPROVER']);
  if (!allowedRoles.has(b.role)) throw httpError(422, 'Perfil inválido.');
  db.prepare(`INSERT INTO memberships (user_id,organization_id,role) VALUES (?,?,?)
    ON CONFLICT(user_id,organization_id) DO UPDATE SET role=excluded.role`).run(userId, orgId, b.role);
  audit(db, orgId, auth.id, 'membership', userId, 'UPSERTED', { role: b.role }); sendJson(res, 200, { ok: true });
}

function dashboard(res, db, auth, orgId) {
  requireOrg(auth, orgId);
  const counts = {
    employees: db.prepare("SELECT COUNT(*) total FROM employees WHERE organization_id = ? AND status = 'ACTIVE'").get(orgId).total,
    openCompetencies: db.prepare("SELECT COUNT(*) total FROM competencies WHERE organization_id = ? AND status = 'OPEN'").get(orgId).total,
    pending: db.prepare("SELECT COUNT(*) total FROM movements WHERE organization_id = ? AND status NOT IN ('COMPLETED', 'DRAFT')").get(orgId).total,
    returned: db.prepare("SELECT COUNT(*) total FROM movements WHERE organization_id = ? AND status = 'RETURNED'").get(orgId).total
  };
  const deadlines = db.prepare(`SELECT id, type, title, status, due_date FROM movements
    WHERE organization_id = ? AND status <> 'COMPLETED' ORDER BY due_date IS NULL, due_date LIMIT 6`).all(orgId);
  sendJson(res, 200, { counts, deadlines });
}

function listEmployees(res, db, auth, orgId) {
  requireOrg(auth, orgId);
  const rows = db.prepare(`SELECT e.*, d.name department, p.name position FROM employees e
    LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN positions p ON p.id=e.position_id
    WHERE e.organization_id=? ORDER BY e.status, e.name`).all(orgId);
  sendJson(res, 200, rows);
}

async function createEmployee(req, res, db, auth) {
  const b = await readJson(req); const orgId = integer(b.organizationId);
  requireRole(auth, orgId, new Set([...COMPANY_ROLES, ...REVIEW_ROLES, 'PLATFORM_ADMIN']));
  const cpf = normalizeCpf(b.cpf); if (!isValidCpf(cpf)) throw httpError(422, 'CPF inválido.');
  if (!b.name?.trim()) throw httpError(422, 'Nome é obrigatório.');
  const result = withTransaction(db, () => {
    const id = Number(db.prepare(`INSERT INTO employees (organization_id,name,cpf,email,birth_date,hire_date)
      VALUES (?,?,?,?,?,?)`).run(orgId, b.name.trim(), cpf, b.email || null, b.birthDate || null, b.hireDate || null).lastInsertRowid);
    audit(db, orgId, auth.id, 'employee', id, 'CREATED', { cpf: maskCpf(cpf) }); return id;
  });
  sendJson(res, 201, { id: result });
}

async function updateEmployee(req, res, db, auth, id) {
  const employee = owned(db, 'employees', id, auth); const b = await readJson(req);
  requireRole(auth, employee.organization_id, new Set([...COMPANY_ROLES, ...REVIEW_ROLES, 'PLATFORM_ADMIN']));
  const status = b.status ?? employee.status;
  if (!['ACTIVE', 'INACTIVE'].includes(status)) throw httpError(422, 'Status inválido.');
  db.prepare('UPDATE employees SET name=?, email=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(b.name?.trim() || employee.name, b.email ?? employee.email, status, id);
  audit(db, employee.organization_id, auth.id, 'employee', id, 'UPDATED', { status });
  sendJson(res, 200, { ok: true });
}

function listCompetencies(res, db, auth, orgId) {
  requireOrg(auth, orgId);
  sendJson(res, 200, db.prepare('SELECT * FROM competencies WHERE organization_id=? ORDER BY year DESC, month DESC').all(orgId));
}

async function createCompetency(req, res, db, auth) {
  const b = await readJson(req); const orgId = integer(b.organizationId);
  requireRole(auth, orgId, new Set([...REVIEW_ROLES, 'COMPANY_ADMIN', 'PLATFORM_ADMIN']));
  const result = db.prepare('INSERT INTO competencies (organization_id,year,month) VALUES (?,?,?)').run(orgId, integer(b.year), integer(b.month));
  const id = Number(result.lastInsertRowid); audit(db, orgId, auth.id, 'competency', id, 'OPENED', { year: b.year, month: b.month });
  sendJson(res, 201, { id });
}

async function changeCompetency(req, res, db, auth, id, action) {
  const c = owned(db, 'competencies', id, auth); const b = await readJson(req);
  requireRole(auth, c.organization_id, new Set([...REVIEW_ROLES, 'PLATFORM_ADMIN']));
  if (action === 'close') {
    if (c.status !== 'OPEN') throw httpError(409, 'A competência já está fechada.');
    const pending = db.prepare("SELECT COUNT(*) total FROM movements WHERE competency_id=? AND status NOT IN ('DRAFT','COMPLETED')").get(id).total;
    if (pending) throw httpError(409, 'Existem movimentações pendentes nesta competência.');
    db.prepare("UPDATE competencies SET status='CLOSED',closed_at=CURRENT_TIMESTAMP,closed_by=? WHERE id=?").run(auth.id, id);
    audit(db, c.organization_id, auth.id, 'competency', id, 'CLOSED', {});
  } else {
    if (c.status !== 'CLOSED') throw httpError(409, 'A competência já está aberta.');
    if (!b.reason?.trim()) throw httpError(422, 'O motivo da reabertura é obrigatório.');
    db.prepare("UPDATE competencies SET status='OPEN',closed_at=NULL,closed_by=NULL,reopened_reason=? WHERE id=?").run(b.reason.trim(), id);
    audit(db, c.organization_id, auth.id, 'competency', id, 'REOPENED', { reason: b.reason.trim() });
  }
  sendJson(res, 200, { ok: true });
}

function listMovements(res, db, auth, orgId, url) {
  requireOrg(auth, orgId); const params = [orgId]; let where = 'm.organization_id=?';
  for (const [key, column] of [['status','m.status'],['type','m.type']]) {
    const value = url.searchParams.get(key); if (value) { where += ` AND ${column}=?`; params.push(value); }
  }
  const rows = db.prepare(`SELECT m.*, c.year, c.month,
    a.employee_name admission_employee, v.employee_id vacation_employee_id, v.start_date, v.end_date,
    e.name vacation_employee FROM movements m JOIN competencies c ON c.id=m.competency_id
    LEFT JOIN admissions a ON a.movement_id=m.id LEFT JOIN vacations v ON v.movement_id=m.id
    LEFT JOIN employees e ON e.id=v.employee_id WHERE ${where} ORDER BY m.updated_at DESC`).all(...params);
  sendJson(res, 200, rows);
}

async function createAdmission(req, res, db, auth) {
  const b = await readJson(req); const orgId = integer(b.organizationId);
  requireRole(auth, orgId, new Set([...COMPANY_ROLES, 'PLATFORM_ADMIN']));
  const cpf = normalizeCpf(b.cpf); if (!isValidCpf(cpf)) throw httpError(422, 'CPF inválido.');
  for (const field of ['employeeName','hireDate','department','position']) if (!b[field]?.trim()) throw httpError(422, `Campo obrigatório: ${field}.`);
  const competency = openCompetency(db, integer(b.competencyId), orgId);
  const id = withTransaction(db, () => {
    const movementId = Number(db.prepare(`INSERT INTO movements
      (organization_id,competency_id,type,title,due_date,created_by,updated_by)
      VALUES (?,?,'ADMISSION',?,?,?,?)`).run(orgId, competency.id, `Admissão — ${b.employeeName.trim()}`, b.dueDate || null, auth.id, auth.id).lastInsertRowid);
    db.prepare(`INSERT INTO admissions (movement_id,employee_name,cpf,email,birth_date,hire_date,department,position)
      VALUES (?,?,?,?,?,?,?,?)`).run(movementId,b.employeeName.trim(),cpf,b.email||null,b.birthDate||null,b.hireDate,b.department.trim(),b.position.trim());
    audit(db, orgId, auth.id, 'movement', movementId, 'CREATED', { type: 'ADMISSION', status: 'DRAFT' }); return movementId;
  });
  sendJson(res, 201, { id });
}

async function createVacation(req, res, db, auth) {
  const b = await readJson(req); const orgId = integer(b.organizationId);
  requireRole(auth, orgId, new Set([...COMPANY_ROLES, 'MANAGER_APPROVER', 'PLATFORM_ADMIN']));
  const employee = db.prepare('SELECT * FROM employees WHERE id=? AND organization_id=?').get(integer(b.employeeId), orgId);
  if (!employee) throw httpError(404, 'Funcionário não encontrado.');
  if (employee.status !== 'ACTIVE') throw httpError(409, 'Férias exigem funcionário ativo.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.startDate ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(b.endDate ?? '') || b.startDate > b.endDate) throw httpError(422, 'Período de férias inválido.');
  const competency = openCompetency(db, integer(b.competencyId), orgId);
  const id = withTransaction(db, () => {
    assertVacationAvailability(db, employee.id, b.startDate, b.endDate);
    const movementId = Number(db.prepare(`INSERT INTO movements
      (organization_id,competency_id,type,title,due_date,created_by,updated_by)
      VALUES (?,?,'VACATION',?,?,?,?)`).run(orgId, competency.id, `Férias — ${employee.name}`, b.dueDate || null, auth.id, auth.id).lastInsertRowid);
    db.prepare('INSERT INTO vacations VALUES (?,?,?,?)').run(movementId, employee.id, b.startDate, b.endDate);
    audit(db, orgId, auth.id, 'movement', movementId, 'CREATED', { type: 'VACATION', status: 'DRAFT' }); return movementId;
  });
  sendJson(res, 201, { id });
}

async function transitionMovement(req, res, db, auth, id) {
  const movement = owned(db, 'movements', id, auth); const b = await readJson(req); const target = b.status;
  if (movement.status === 'COMPLETED' && target === 'COMPLETED') return sendJson(res, 200, { id, status: target, idempotent: true });
  openCompetency(db, movement.competency_id, movement.organization_id);
  if (!STATUS_FLOW[movement.status]?.includes(target)) throw httpError(409, `Transição inválida: ${movement.status} → ${target}.`);
  const roles = rolesFor(auth, movement.organization_id);
  const companyAction = (movement.status === 'DRAFT' && target === 'SUBMITTED') || (movement.status === 'RETURNED' && target === 'DRAFT');
  const reviewAction = ['SUBMITTED', 'IN_REVIEW', 'APPROVED'].includes(movement.status);
  const managerAction = movement.type === 'VACATION' && movement.status === 'IN_REVIEW' && target === 'APPROVED';
  if (!(roles.has('PLATFORM_ADMIN') || (companyAction && [...roles].some(r => COMPANY_ROLES.has(r))) ||
    (reviewAction && [...roles].some(r => REVIEW_ROLES.has(r))) || (managerAction && roles.has('MANAGER_APPROVER')))) throw httpError(403, 'Seu perfil não pode executar esta transição.');
  if (target === 'RETURNED' && !b.reason?.trim()) throw httpError(422, 'O motivo da devolução é obrigatório.');

  withTransaction(db, () => {
    if (target === 'APPROVED' && movement.type === 'VACATION') {
      const vacation = db.prepare('SELECT * FROM vacations WHERE movement_id=?').get(id);
      const employee = db.prepare('SELECT status FROM employees WHERE id=?').get(vacation.employee_id);
      if (employee?.status !== 'ACTIVE') throw httpError(409, 'Férias exigem funcionário ativo no momento da aprovação.');
      assertVacationAvailability(db, vacation.employee_id, vacation.start_date, vacation.end_date, id);
    }
    db.prepare(`UPDATE movements SET status=?,return_reason=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(target, target === 'RETURNED' ? b.reason.trim() : null, auth.id, id);
    if (target === 'COMPLETED' && movement.type === 'ADMISSION') completeAdmission(db, movement, auth.id);
    audit(db, movement.organization_id, auth.id, 'movement', id, 'STATUS_CHANGED', { from: movement.status, to: target, reason: b.reason || null });
  });
  sendJson(res, 200, { id, status: target });
}

function completeAdmission(db, movement, userId) {
  const admission = db.prepare('SELECT * FROM admissions WHERE movement_id=?').get(movement.id);
  const existing = db.prepare('SELECT id FROM employees WHERE created_from_admission_id=?').get(movement.id);
  if (existing) return existing.id;
  const depId = getOrCreate(db, 'departments', movement.organization_id, admission.department);
  const posId = getOrCreate(db, 'positions', movement.organization_id, admission.position);
  const result = db.prepare(`INSERT INTO employees
    (organization_id,name,cpf,email,birth_date,hire_date,department_id,position_id,created_from_admission_id)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(movement.organization_id, admission.employee_name, admission.cpf, admission.email,
      admission.birth_date, admission.hire_date, depId, posId, movement.id);
  const id = Number(result.lastInsertRowid);
  audit(db, movement.organization_id, userId, 'employee', id, 'CREATED_FROM_ADMISSION', { movementId: movement.id }); return id;
}

function getOrCreate(db, table, orgId, name) {
  db.prepare(`INSERT INTO ${table} (organization_id,name) VALUES (?,?) ON CONFLICT(organization_id,name) DO NOTHING`).run(orgId, name);
  return db.prepare(`SELECT id FROM ${table} WHERE organization_id=? AND name=?`).get(orgId, name).id;
}

function assertVacationAvailability(db, employeeId, startDate, endDate, ignoredMovementId = 0) {
  const conflict = db.prepare(`SELECT 1 FROM vacations v JOIN movements m ON m.id=v.movement_id
    WHERE v.employee_id=? AND m.id<>? AND m.status IN ('APPROVED','COMPLETED')
      AND v.start_date<=? AND v.end_date>=? LIMIT 1`).get(employeeId, ignoredMovementId, endDate, startDate);
  if (conflict) throw httpError(409, 'O período conflita com férias já aprovadas.');
}

async function addAttachment(req, res, db, auth, movementId, uploads) {
  const movement = owned(db, 'movements', movementId, auth); openCompetency(db, movement.competency_id, movement.organization_id);
  const b = await readJson(req, 7 * 1024 * 1024); const allowed = new Set(['application/pdf','image/png','image/jpeg']);
  if (!allowed.has(b.mimeType)) throw httpError(422, 'Formato permitido: PDF, PNG ou JPEG.');
  let data; try { data = Buffer.from(b.contentBase64 ?? '', 'base64'); } catch { throw httpError(422, 'Conteúdo inválido.'); }
  if (!data.length || data.length > 5 * 1024 * 1024) throw httpError(422, 'O arquivo deve ter até 5 MB.');
  if (!matchesFileSignature(data, b.mimeType)) throw httpError(422, 'O conteúdo do arquivo não corresponde ao formato informado.');
  const storageName = `${Date.now()}-${Math.random().toString(16).slice(2)}${extensionFor(b.mimeType)}`;
  writeFileSync(join(uploads, storageName), data, { flag: 'wx' });
  const id = Number(db.prepare(`INSERT INTO attachments
    (movement_id,filename,mime_type,size_bytes,storage_name,uploaded_by) VALUES (?,?,?,?,?,?)`)
    .run(movementId, basename(b.filename || `anexo${extensionFor(b.mimeType)}`), b.mimeType, data.length, storageName, auth.id).lastInsertRowid);
  audit(db, movement.organization_id, auth.id, 'attachment', id, 'UPLOADED', { movementId, filename: b.filename });
  sendJson(res, 201, { id });
}

function listAttachments(res, db, auth, movementId) {
  owned(db, 'movements', movementId, auth);
  sendJson(res, 200, db.prepare('SELECT id,filename,mime_type,size_bytes,created_at FROM attachments WHERE movement_id=?').all(movementId));
}

function downloadAttachment(res, db, auth, id, uploads) {
  const row = db.prepare(`SELECT a.*,m.organization_id FROM attachments a JOIN movements m ON m.id=a.movement_id WHERE a.id=?`).get(id);
  if (!row) throw httpError(404, 'Anexo não encontrado.'); requireOrg(auth, row.organization_id);
  const path = join(uploads, row.storage_name); if (!existsSync(path)) throw httpError(404, 'Arquivo não encontrado.');
  res.writeHead(200, { 'Content-Type': row.mime_type, 'Content-Length': row.size_bytes, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}` });
  createReadStream(path).pipe(res);
}

function listAudit(res, db, auth, orgId) {
  requireOrg(auth, orgId); if (![...rolesFor(auth, orgId)].some(r => ADMIN_ROLES.has(r) || r === 'DP_ANALYST')) throw httpError(403, 'Perfil sem acesso à auditoria.');
  const rows = db.prepare(`SELECT a.*,u.name actor_name FROM audit_logs a JOIN users u ON u.id=a.actor_user_id
    WHERE a.organization_id=? ORDER BY a.id DESC LIMIT 100`).all(orgId).map(r => ({ ...r, details: JSON.parse(r.details_json) }));
  sendJson(res, 200, rows);
}

function exportCompetency(res, db, auth, id) {
  const c = owned(db, 'competencies', id, auth);
  const rows = db.prepare('SELECT id,type,title,status,due_date,updated_at FROM movements WHERE competency_id=? ORDER BY id').all(id);
  const csv = ['id,tipo,titulo,status,prazo,atualizado_em', ...rows.map(r => [r.id,r.type,r.title,r.status,r.due_date,r.updated_at].map(escapeCsv).join(','))].join('\r\n');
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="competencia-${c.year}-${String(c.month).padStart(2,'0')}.csv"` });
  res.end(`\uFEFF${csv}`);
}

function openCompetency(db, id, orgId) {
  const c = db.prepare('SELECT * FROM competencies WHERE id=? AND organization_id=?').get(id, orgId);
  if (!c) throw httpError(404, 'Competência não encontrada.');
  if (c.status !== 'OPEN') throw httpError(409, 'A competência está fechada e é somente leitura.'); return c;
}

function owned(db, table, id, auth) {
  if (!['employees','competencies','movements'].includes(table)) throw new Error('Tabela inválida');
  const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
  if (!row) throw httpError(404, 'Registro não encontrado.'); requireOrg(auth, row.organization_id); return row;
}

function rolesFor(auth, orgId) { return new Set(auth.memberships.filter(m => m.organization_id === orgId).map(m => m.role)); }
function requireOrg(auth, orgId) { if (!auth.memberships.some(m => m.organization_id === orgId)) throw httpError(403, 'Acesso negado para esta empresa.'); }
function requireRole(auth, orgId, allowed) { requireOrg(auth, orgId); if (![...rolesFor(auth, orgId)].some(r => allowed.has(r))) throw httpError(403, 'Perfil sem permissão para esta ação.'); }
function requiredOrg(url) { const value = url.searchParams.get('organizationId'); if (!value) throw httpError(422, 'organizationId é obrigatório.'); return integer(value); }
function integer(value) { const n = Number(value); if (!Number.isInteger(n) || n < 1) throw httpError(422, 'Identificador inválido.'); return n; }
function getToken(req) { const bearer = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1]; if (bearer) return bearer; return req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('rh_session='))?.slice(11) ?? null; }
function requireCsrf(req, auth) { if (!auth.csrfToken || req.headers['x-csrf-token'] !== auth.csrfToken) throw httpError(403, 'Proteção CSRF inválida. Atualize a página e tente novamente.'); }
function extensionFor(mime) { return mime === 'application/pdf' ? '.pdf' : mime === 'image/png' ? '.png' : '.jpg'; }
function matchesFileSignature(data, mime) {
  if (mime === 'application/pdf') return data.subarray(0, 5).toString() === '%PDF-';
  if (mime === 'image/png') return data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
}

async function readJson(req, limit = 1024 * 1024) {
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) throw httpError(415, 'Use Content-Type application/json.');
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw httpError(413, 'Corpo da requisição muito grande.'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw httpError(400, 'JSON inválido.'); }
}

function serveStatic(req, res, pathname) {
  if (!['GET','HEAD'].includes(req.method)) throw httpError(405, 'Método não permitido.');
  const requested = pathname === '/' ? '/index.html' : pathname;
  const clean = normalize(requested).replace(/^(\.\.[/\\])+/, '');
  const file = resolve(publicDir, `.${clean}`);
  if (!file.startsWith(publicDir) || !existsSync(file) || !statSync(file).isFile()) {
    const fallback = join(publicDir, 'index.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(readFileSync(fallback));
  }
  const types = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml' };
  res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Content-Length': statSync(file).size });
  if (req.method === 'HEAD') return res.end(); createReadStream(file).pipe(res);
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'");
}
function sendJson(res, status, body) { if (res.headersSent) return; const data = JSON.stringify(body); res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Content-Length':Buffer.byteLength(data) }); res.end(data); }
function httpError(status, message) { const error = new Error(message); error.status = status; error.publicMessage = message; return error; }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { handler } = createApp();
  const port = Number(process.env.PORT || 3000);
  http.createServer(handler).listen(port, '127.0.0.1', () => console.log(`RH Conecta disponível em http://127.0.0.1:${port}`));
}
