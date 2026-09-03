import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../src/server.js';

let server; let base; let temp; let database;
const csrfByCookie = new Map();

before(async () => {
  temp = mkdtempSync(join(tmpdir(), 'rh-conecta-'));
  const app = createApp({ databaseFile: join(temp, 'test.sqlite'), uploadDir: join(temp, 'uploads') });
  database = app.db;
  server = http.createServer(app.handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  database.close();
  rmSync(temp, { recursive: true, force: true });
});

async function request(path, options = {}, cookie = '') {
  const csrf = cookie ? csrfByCookie.get(cookie) : null;
  const response = await fetch(`${base}${path}`, { ...options, headers: {
    ...(options.body ? {'content-type':'application/json'} : {}),
    ...(cookie ? {cookie} : {}),
    ...(csrf && options.method && options.method !== 'GET' ? {'x-csrf-token':csrf} : {}),
    ...options.headers
  } });
  const type = response.headers.get('content-type') || '';
  const body = type.includes('json') ? await response.json() : await response.text();
  return { response, body };
}

async function login(email) {
  const { response, body } = await request('/api/auth/login', { method:'POST', body:JSON.stringify({ email, password:'Demo@123' }) });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  csrfByCookie.set(cookie, body.csrfToken);
  return { cookie, user: body };
}

test('health e autenticação rejeitam credenciais incorretas', async () => {
  assert.equal((await request('/api/health')).response.status, 200);
  const invalid = await request('/api/auth/login', { method:'POST', body:JSON.stringify({ email:'empresa@demo.rh', password:'errada' }) });
  assert.equal(invalid.response.status, 401);
  const company = await login('empresa@demo.rh');
  const missingCsrf = await fetch(`${base}/api/auth/logout`, { method:'POST', headers:{cookie:company.cookie,'content-type':'application/json'}, body:'{}' });
  assert.equal(missingCsrf.status, 403);
});

test('isolamento impede acesso a outra empresa', async () => {
  const company = await login('empresa@demo.rh');
  const outsider = await login('oficina@demo.rh');
  const ownOrg = company.user.memberships.find(m => m.kind === 'client').organization_id;
  const denied = await request(`/api/employees?organizationId=${ownOrg}`, {}, outsider.cookie);
  assert.equal(denied.response.status, 403);
});

test('CPF é validado e não duplica dentro da empresa', async () => {
  const company = await login('empresa@demo.rh');
  const org = company.user.memberships.find(m => m.kind === 'client').organization_id;
  const invalid = await request('/api/employees', { method:'POST', body:JSON.stringify({organizationId:org,name:'CPF Ruim',cpf:'123'}) }, company.cookie);
  assert.equal(invalid.response.status, 422);
  const duplicate = await request('/api/employees', { method:'POST', body:JSON.stringify({organizationId:org,name:'Duplicada',cpf:'52998224725'}) }, company.cookie);
  assert.equal(duplicate.response.status, 409);

  const outsider = await login('oficina@demo.rh');
  const otherOrg = outsider.user.memberships.find(m => m.kind === 'client').organization_id;
  const allowed = await request('/api/employees', { method:'POST', body:JSON.stringify({organizationId:otherOrg,name:'Mesmo CPF, outra empresa',cpf:'52998224725'}) }, outsider.cookie);
  assert.equal(allowed.response.status, 201);
});

test('administrador contábil cadastra empresa e usuário isolados', async () => {
  const admin = await login('admin@demo.rh');
  const company = await login('empresa@demo.rh');
  const deniedOrg = await request('/api/organizations', { method:'POST', body:JSON.stringify({name:'Sem permissão',document:'98765432000198'}) }, company.cookie);
  assert.equal(deniedOrg.response.status, 403);
  const createdOrg = await request('/api/organizations', { method:'POST', body:JSON.stringify({name:'Mercado Novo',document:'12345678000195'}) }, admin.cookie);
  assert.equal(createdOrg.response.status, 201);

  const createdUser = await request('/api/users', { method:'POST', body:JSON.stringify({
    organizationId:createdOrg.body.id,name:'Rita Cliente',email:'rita@mercado.test',password:'Senha@123',role:'COMPANY_ADMIN'
  }) }, admin.cookie);
  assert.equal(createdUser.response.status, 201);
  const users = await request(`/api/users?organizationId=${createdOrg.body.id}`, {}, admin.cookie);
  assert.equal(users.response.status, 200);
  assert.equal(users.body.some(user => user.email === 'rita@mercado.test' && user.role === 'COMPANY_ADMIN'), true);
  const newLogin = await request('/api/auth/login', { method:'POST', body:JSON.stringify({email:'rita@mercado.test',password:'Senha@123'}) });
  assert.equal(newLogin.response.status, 200);
});

test('devolução exige motivo e fluxo rejeita transição inválida', async () => {
  const company = await login('empresa@demo.rh'); const analyst = await login('analista@demo.rh');
  const org = company.user.memberships.find(m => m.kind === 'client').organization_id;
  const movements = (await request(`/api/movements?organizationId=${org}`, {}, company.cookie)).body;
  const id = movements.find(m => m.status === 'DRAFT').id;
  assert.equal((await request(`/api/movements/${id}/transition`, {method:'POST',body:JSON.stringify({status:'APPROVED'})}, company.cookie)).response.status, 409);
  assert.equal((await request(`/api/movements/${id}/transition`, {method:'POST',body:JSON.stringify({status:'SUBMITTED'})}, company.cookie)).response.status, 200);
  assert.equal((await request(`/api/movements/${id}/transition`, {method:'POST',body:JSON.stringify({status:'IN_REVIEW'})}, company.cookie)).response.status, 403);
  assert.equal((await request(`/api/movements/${id}/transition`, {method:'POST',body:JSON.stringify({status:'IN_REVIEW'})}, analyst.cookie)).response.status, 200);
  assert.equal((await request(`/api/movements/${id}/transition`, {method:'POST',body:JSON.stringify({status:'RETURNED'})}, analyst.cookie)).response.status, 422);
});

test('conclusão da admissão é idempotente', async () => {
  const company = await login('empresa@demo.rh'); const analyst = await login('analista@demo.rh');
  const org = company.user.memberships.find(m => m.kind === 'client').organization_id;
  const competency = (await request(`/api/competencies?organizationId=${org}`, {}, company.cookie)).body.find(c=>c.status==='OPEN');
  const created = await request('/api/admissions',{method:'POST',body:JSON.stringify({organizationId:org,competencyId:competency.id,employeeName:'Teste Idempotente',cpf:'12345678909',hireDate:'2026-09-01',department:'Operações',position:'Auxiliar'})},company.cookie);
  assert.equal(created.response.status,201); const id=created.body.id;
  await request(`/api/movements/${id}/transition`,{method:'POST',body:JSON.stringify({status:'SUBMITTED'})},company.cookie);
  await request(`/api/movements/${id}/transition`,{method:'POST',body:JSON.stringify({status:'IN_REVIEW'})},analyst.cookie);
  await request(`/api/movements/${id}/transition`,{method:'POST',body:JSON.stringify({status:'APPROVED'})},analyst.cookie);
  assert.equal((await request(`/api/movements/${id}/transition`,{method:'POST',body:JSON.stringify({status:'COMPLETED'})},analyst.cookie)).response.status,200);
  const again=await request(`/api/movements/${id}/transition`,{method:'POST',body:JSON.stringify({status:'COMPLETED'})},analyst.cookie);
  assert.equal(again.response.status,200); assert.equal(again.body.idempotent,true);
  const employees=(await request(`/api/employees?organizationId=${org}`,{},company.cookie)).body;
  assert.equal(employees.filter(e=>e.cpf==='12345678909').length,1);
});

test('férias exigem funcionário ativo e bloqueiam sobreposição aprovada', async () => {
  const company=await login('empresa@demo.rh'); const analyst=await login('analista@demo.rh');
  const org=company.user.memberships.find(m=>m.kind==='client').organization_id;
  const employee=(await request(`/api/employees?organizationId=${org}`,{},company.cookie)).body.find(e=>e.status==='ACTIVE');
  const competency=(await request(`/api/competencies?organizationId=${org}`,{},company.cookie)).body.find(c=>c.status==='OPEN');
  const body={organizationId:org,competencyId:competency.id,employeeId:employee.id,startDate:'2026-11-01',endDate:'2026-11-15'};
  const first=await request('/api/vacations',{method:'POST',body:JSON.stringify(body)},company.cookie);assert.equal(first.response.status,201);
  await request(`/api/movements/${first.body.id}/transition`,{method:'POST',body:JSON.stringify({status:'SUBMITTED'})},company.cookie);
  await request(`/api/movements/${first.body.id}/transition`,{method:'POST',body:JSON.stringify({status:'IN_REVIEW'})},analyst.cookie);
  await request(`/api/movements/${first.body.id}/transition`,{method:'POST',body:JSON.stringify({status:'APPROVED'})},analyst.cookie);
  const overlap=await request('/api/vacations',{method:'POST',body:JSON.stringify({...body,startDate:'2026-11-10',endDate:'2026-11-20'})},company.cookie);
  assert.equal(overlap.response.status,409);
  const draftA=await request('/api/vacations',{method:'POST',body:JSON.stringify({...body,startDate:'2027-02-01',endDate:'2027-02-15'})},company.cookie);
  const draftB=await request('/api/vacations',{method:'POST',body:JSON.stringify({...body,startDate:'2027-02-10',endDate:'2027-02-20'})},company.cookie);
  assert.equal(draftA.response.status,201);assert.equal(draftB.response.status,201);
  for (const draft of [draftA,draftB]) {
    await request(`/api/movements/${draft.body.id}/transition`,{method:'POST',body:JSON.stringify({status:'SUBMITTED'})},company.cookie);
    await request(`/api/movements/${draft.body.id}/transition`,{method:'POST',body:JSON.stringify({status:'IN_REVIEW'})},analyst.cookie);
  }
  assert.equal((await request(`/api/movements/${draftA.body.id}/transition`,{method:'POST',body:JSON.stringify({status:'APPROVED'})},analyst.cookie)).response.status,200);
  assert.equal((await request(`/api/movements/${draftB.body.id}/transition`,{method:'POST',body:JSON.stringify({status:'APPROVED'})},analyst.cookie)).response.status,409);
  await request(`/api/employees/${employee.id}`,{method:'PATCH',body:JSON.stringify({status:'INACTIVE'})},company.cookie);
  const inactive=await request('/api/vacations',{method:'POST',body:JSON.stringify({...body,startDate:'2027-01-01',endDate:'2027-01-10'})},company.cookie);
  assert.equal(inactive.response.status,409);
});

test('download de anexo respeita o isolamento entre empresas', async () => {
  const company = await login('empresa@demo.rh');
  const outsider = await login('oficina@demo.rh');
  const org = company.user.memberships.find(m => m.kind === 'client').organization_id;
  const movement = (await request(`/api/movements?organizationId=${org}`, {}, company.cookie)).body[0];
  const uploaded = await request(`/api/movements/${movement.id}/attachments`, { method:'POST', body:JSON.stringify({
    filename:'teste.pdf',mimeType:'application/pdf',contentBase64:Buffer.from('%PDF-1.4\n%%EOF').toString('base64')
  }) }, company.cookie);
  assert.equal(uploaded.response.status, 201);
  assert.equal((await request(`/api/attachments/${uploaded.body.id}`, {}, outsider.cookie)).response.status, 403);
  assert.equal((await request(`/api/attachments/${uploaded.body.id}`, {}, company.cookie)).response.status, 200);
});

test('competência fechada fica somente leitura', async () => {
  const analyst=await login('analista@demo.rh'); const company=await login('empresa@demo.rh'); const org=company.user.memberships.find(m=>m.kind==='client').organization_id;
  const created=await request('/api/competencies',{method:'POST',body:JSON.stringify({organizationId:org,year:2027,month:3})},analyst.cookie);assert.equal(created.response.status,201);
  assert.equal((await request(`/api/competencies/${created.body.id}/close`,{method:'POST',body:'{}'},analyst.cookie)).response.status,200);
  const admission=await request('/api/admissions',{method:'POST',body:JSON.stringify({organizationId:org,competencyId:created.body.id,employeeName:'Fechada',cpf:'93541134780',hireDate:'2027-03-01',department:'Operações',position:'Auxiliar'})},company.cookie);
  assert.equal(admission.response.status,409);
});

test('auditoria registra ações sem expor CPF e competência pode ser exportada', async () => {
  const analyst = await login('analista@demo.rh');
  const company = await login('empresa@demo.rh');
  const org = company.user.memberships.find(m => m.kind === 'client').organization_id;
  const employee = await request('/api/employees', { method:'POST', body:JSON.stringify({
    organizationId:org,name:'Teste de Auditoria',cpf:'93541134780'
  }) }, company.cookie);
  assert.equal(employee.response.status, 201);
  const auditLog = await request(`/api/audit?organizationId=${org}`, {}, analyst.cookie);
  assert.equal(auditLog.response.status, 200);
  const employeeEntry = auditLog.body.find(entry => entry.entity_type === 'employee' && entry.entity_id === employee.body.id && entry.action === 'CREATED');
  assert.ok(employeeEntry);
  assert.equal(employeeEntry.details.cpf, '***.***.***-80');

  const competency = (await request(`/api/competencies?organizationId=${org}`, {}, company.cookie)).body.find(item => item.status === 'OPEN');
  const exported = await request(`/api/exports/competencies/${competency.id}.csv`, {}, analyst.cookie);
  assert.equal(exported.response.status, 200);
  assert.match(exported.response.headers.get('content-type'), /text\/csv/);
  assert.match(exported.body, /tipo,titulo,status/);
});
