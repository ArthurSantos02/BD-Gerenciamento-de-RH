const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { user: null, organizationId: null, organizations: [], competencies: [], employees: [], movements: [], filter: '' };

const statusLabel = { DRAFT:'Rascunho', SUBMITTED:'Enviada', IN_REVIEW:'Em análise', APPROVED:'Aprovada', RETURNED:'Devolvida', COMPLETED:'Concluída' };
const roleLabel = { PLATFORM_ADMIN:'Admin. plataforma', ACCOUNTING_ADMIN:'Admin. contábil', DP_ANALYST:'Analista de DP', COMPANY_ADMIN:'Admin. empresa', COMPANY_RESPONSIBLE:'Responsável empresa', MANAGER_APPROVER:'Gestor aprovador' };
const typeLabel = { ADMISSION:'Admissão', VACATION:'Férias' };

async function api(path, options = {}) {
  const mutating = options.method && options.method !== 'GET';
  const response = await fetch(path, { ...options, headers: {
    ...(options.body ? {'Content-Type':'application/json'} : {}),
    ...(mutating && state.user?.csrfToken ? {'X-CSRF-Token':state.user.csrfToken} : {}),
    ...options.headers
  } });
  const type = response.headers.get('content-type') || '';
  const body = type.includes('json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(body.error || 'Não foi possível concluir a operação.');
  return body;
}

function orgQuery(path) { return `${path}${path.includes('?') ? '&' : '?'}organizationId=${state.organizationId}`; }
function currentMembership() { return state.user?.memberships.find(m => m.organization_id === state.organizationId); }
function showToast(message, error = false) { const toast=$('#toast'); toast.textContent=message; toast.className=`toast show${error?' error':''}`; setTimeout(()=>toast.className='toast',2800); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function isoDate(value) { return value ? new Intl.DateTimeFormat('pt-BR',{timeZone:'UTC'}).format(new Date(`${value}T00:00:00Z`)) : 'Sem prazo'; }

async function bootstrap() {
  try { state.user = await api('/api/auth/me'); await enterApp(); } catch { showLogin(); }
}

function showLogin() { $('#login-view').classList.remove('hidden'); $('#app-view').classList.add('hidden'); }
async function enterApp() {
  state.organizations = state.user.memberships.filter(m => m.kind === 'client');
  if (!state.organizations.length) state.organizations = state.user.memberships;
  state.organizationId = state.organizationId && state.organizations.some(o=>o.organization_id===state.organizationId) ? state.organizationId : state.organizations[0]?.organization_id;
  $('#organization-select').innerHTML = state.organizations.map(o=>`<option value="${o.organization_id}">${escapeHtml(o.organization_name)}</option>`).join('');
  $('#organization-select').value = state.organizationId;
  $('#user-name').textContent = state.user.name; $('#user-avatar').textContent = state.user.name.slice(0,1).toUpperCase();
  $('#login-view').classList.add('hidden'); $('#app-view').classList.remove('hidden');
  await refreshAll();
}

async function refreshAll() {
  if (!state.organizationId) return;
  const [dashboard, competencies, employees, movements] = await Promise.all([
    api(orgQuery('/api/dashboard')), api(orgQuery('/api/competencies')), api(orgQuery('/api/employees')), api(orgQuery('/api/movements'))
  ]);
  state.competencies=competencies; state.employees=employees; state.movements=movements;
  $('#user-role').textContent = roleLabel[currentMembership()?.role] || currentMembership()?.role || '';
  renderDashboard(dashboard); renderMovements(); renderEmployees();
  if ($('#page-audit').classList.contains('active')) await renderAudit();
}

function renderDashboard(data) {
  $('#greeting').textContent = `Olá, ${state.user.name.split(' ')[0]}!`;
  const items=[['Funcionários ativos',data.counts.employees,'♙'],['Competências abertas',data.counts.openCompetencies,'▣'],['Em andamento',data.counts.pending,'⇄'],['Devolvidas',data.counts.returned,'!']];
  $('#kpi-grid').innerHTML=items.map(([label,value,icon])=>`<article class="kpi"><div class="kpi-top"><span>${label}</span><span class="kpi-icon">${icon}</span></div><strong>${value}</strong></article>`).join('');
  $('#deadline-list').innerHTML=data.deadlines.length?data.deadlines.map(m=>`<div class="deadline"><div class="type-icon">${m.type==='ADMISSION'?'A':'F'}</div><div><span class="row-title">${escapeHtml(m.title)}</span><span class="row-sub">${typeLabel[m.type]} · prazo ${isoDate(m.due_date)}</span></div><span class="badge ${m.status}">${statusLabel[m.status]}</span></div>`).join(''):'<div class="empty">Nenhuma pendência nesta empresa.</div>';
  const counts={};state.movements.forEach(m=>counts[m.status]=(counts[m.status]||0)+1);const max=Math.max(1,...Object.values(counts));
  $('#status-chart').innerHTML=Object.entries(statusLabel).map(([key,label])=>`<div class="status-line"><span>${label}</span><div class="bar"><i style="width:${((counts[key]||0)/max)*100}%"></i></div><b>${counts[key]||0}</b></div>`).join('');
}

function renderMovements() {
  const rows=state.movements.filter(m=>!state.filter||m.type===state.filter);
  $('#movement-list').innerHTML=rows.length?rows.map(m=>`<div class="movement"><div class="type-icon">${m.type==='ADMISSION'?'A':'F'}</div><div><span class="row-title">${escapeHtml(m.title)}</span><span class="row-sub">Competência ${String(m.month).padStart(2,'0')}/${m.year} · prazo ${isoDate(m.due_date)}${m.return_reason?` · Motivo: ${escapeHtml(m.return_reason)}`:''}</span></div><span class="badge ${m.status}">${statusLabel[m.status]}</span><div class="movement-actions">${movementActions(m)}</div></div>`).join(''):'<div class="empty">Nenhuma movimentação encontrada.</div>';
}

function movementActions(m) {
  const role=currentMembership()?.role; const actions=[];
  if (m.status==='DRAFT' && ['COMPANY_ADMIN','COMPANY_RESPONSIBLE','PLATFORM_ADMIN'].includes(role)) actions.push(['SUBMITTED','Enviar']);
  if (m.status==='RETURNED' && ['COMPANY_ADMIN','COMPANY_RESPONSIBLE','PLATFORM_ADMIN'].includes(role)) actions.push(['DRAFT','Corrigir']);
  if (m.status==='SUBMITTED' && ['ACCOUNTING_ADMIN','DP_ANALYST','PLATFORM_ADMIN'].includes(role)) actions.push(['IN_REVIEW','Iniciar análise']);
  if (m.status==='IN_REVIEW' && ['ACCOUNTING_ADMIN','DP_ANALYST','MANAGER_APPROVER','PLATFORM_ADMIN'].includes(role)) actions.push(['APPROVED','Aprovar']);
  if (m.status==='IN_REVIEW' && ['ACCOUNTING_ADMIN','DP_ANALYST','PLATFORM_ADMIN'].includes(role)) actions.push(['RETURNED','Devolver']);
  if (m.status==='APPROVED' && ['ACCOUNTING_ADMIN','DP_ANALYST','PLATFORM_ADMIN'].includes(role)) actions.push(['COMPLETED','Concluir']);
  return `<button data-attach="${m.id}">Anexar</button>`+actions.map(([target,label])=>`<button data-transition="${m.id}" data-target="${target}">${label}</button>`).join('');
}

function renderEmployees() {
  $('#employee-table').innerHTML=state.employees.length?`<table class="data-table"><thead><tr><th>Funcionário</th><th>CPF</th><th>Área</th><th>Cargo</th><th>Admissão</th><th>Status</th></tr></thead><tbody>${state.employees.map(e=>`<tr><td><strong>${escapeHtml(e.name)}</strong><span class="row-sub">${escapeHtml(e.email||'Sem e-mail')}</span></td><td>${formatCpf(e.cpf)}</td><td>${escapeHtml(e.department||'—')}</td><td>${escapeHtml(e.position||'—')}</td><td>${isoDate(e.hire_date)}</td><td><span class="badge ${e.status==='ACTIVE'?'APPROVED':'RETURNED'}">${e.status==='ACTIVE'?'Ativo':'Inativo'}</span></td></tr>`).join('')}</tbody></table>`:'<div class="empty">Nenhum funcionário cadastrado.</div>';
}

async function renderAudit() {
  try { const rows=await api(orgQuery('/api/audit')); $('#audit-list').innerHTML=rows.length?rows.map(a=>`<div class="audit-row"><span class="row-sub">${new Date(a.created_at+'Z').toLocaleString('pt-BR')}</span><strong>${escapeHtml(a.actor_name)}</strong><div><span class="row-title">${escapeHtml(a.action)}</span><span class="row-sub">${escapeHtml(a.entity_type)} #${a.entity_id}</span></div></div>`).join(''):'<div class="empty">Nenhum evento registrado.</div>'; }
  catch(error){$('#audit-list').innerHTML=`<div class="empty">${escapeHtml(error.message)}</div>`;}
}

function openForm(kind) {
  const dialog=$('#form-dialog'), fields=$('#dialog-fields'); $('#form-error').textContent=''; $('#entity-form').dataset.kind=kind;
  const competenceOptions=state.competencies.filter(c=>c.status==='OPEN').map(c=>`<option value="${c.id}">${String(c.month).padStart(2,'0')}/${c.year}</option>`).join('');
  if(kind==='admission'){
    $('#dialog-eyebrow').textContent='MOVIMENTAÇÃO';$('#dialog-title').textContent='Nova admissão';$('#save-entity').textContent='Salvar rascunho';
    fields.innerHTML=`<label class="wide">Nome completo<input name="employeeName" required></label><label>CPF<input name="cpf" inputmode="numeric" placeholder="000.000.000-00" required></label><label>E-mail<input name="email" type="email"></label><label>Nascimento<input name="birthDate" type="date"></label><label>Data de admissão<input name="hireDate" type="date" required></label><label>Departamento<input name="department" required></label><label>Cargo<input name="position" required></label><label>Competência<select name="competencyId" required>${competenceOptions}</select></label><label>Prazo interno<input name="dueDate" type="date"></label>`;
  }else if(kind==='vacation'){
    $('#dialog-eyebrow').textContent='MOVIMENTAÇÃO';$('#dialog-title').textContent='Solicitar férias';$('#save-entity').textContent='Salvar rascunho';
    const employeeOptions=state.employees.filter(e=>e.status==='ACTIVE').map(e=>`<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('');
    fields.innerHTML=`<label class="wide">Funcionário<select name="employeeId" required>${employeeOptions}</select></label><label>Início<input name="startDate" type="date" required></label><label>Fim<input name="endDate" type="date" required></label><label>Competência<select name="competencyId" required>${competenceOptions}</select></label><label>Prazo interno<input name="dueDate" type="date"></label>`;
  }else{
    $('#dialog-eyebrow').textContent='PESSOAS';$('#dialog-title').textContent='Novo funcionário';$('#save-entity').textContent='Cadastrar';
    fields.innerHTML=`<label class="wide">Nome completo<input name="name" required></label><label>CPF<input name="cpf" required></label><label>E-mail<input name="email" type="email"></label><label>Data de nascimento<input name="birthDate" type="date"></label><label>Data de admissão<input name="hireDate" type="date"></label>`;
  }
  dialog.showModal();
}

async function submitEntity(event) {
  event.preventDefault(); const form=event.currentTarget; const kind=form.dataset.kind; const data=Object.fromEntries(new FormData(form)); data.organizationId=state.organizationId;
  try { await api(kind==='admission'?'/api/admissions':kind==='vacation'?'/api/vacations':'/api/employees',{method:'POST',body:JSON.stringify(data)}); $('#form-dialog').close(); showToast('Registro salvo com sucesso.'); await refreshAll(); }
  catch(error){$('#form-error').textContent=error.message;}
}

async function transition(id,target) {
  const reason=target==='RETURNED'?prompt('Informe o motivo da devolução:'):null;if(target==='RETURNED'&&!reason)return;
  try{await api(`/api/movements/${id}/transition`,{method:'POST',body:JSON.stringify({status:target,reason})});showToast(`Movimentação atualizada para ${statusLabel[target]}.`);await refreshAll();}catch(error){showToast(error.message,true);}
}

async function attach(id) {
  const input=document.createElement('input');input.type='file';input.accept='.pdf,.png,.jpg,.jpeg';input.onchange=async()=>{const file=input.files[0];if(!file)return;if(file.size>5*1024*1024)return showToast('O arquivo deve ter até 5 MB.',true);const contentBase64=await fileToBase64(file);try{await api(`/api/movements/${id}/attachments`,{method:'POST',body:JSON.stringify({filename:file.name,mimeType:file.type,contentBase64})});showToast('Documento anexado.');}catch(error){showToast(error.message,true);}};input.click();
}

function fileToBase64(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});}
function formatCpf(v){const x=String(v||'').padStart(11,'0');return x.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,'$1.$2.$3-$4');}

$('#login-form').addEventListener('submit',async e=>{e.preventDefault();$('#login-error').textContent='';try{state.user=await api('/api/auth/login',{method:'POST',body:JSON.stringify({email:$('#email').value,password:$('#password').value})});await enterApp();}catch(error){$('#login-error').textContent=error.message;}});
$$('[data-demo]').forEach(b=>b.addEventListener('click',()=>{$('#email').value=b.dataset.demo;$('#password').value='Demo@123';}));
$('#logout-button').addEventListener('click',async()=>{await api('/api/auth/logout',{method:'POST',body:'{}'});state.user=null;showLogin();});
$('#organization-select').addEventListener('change',async e=>{state.organizationId=Number(e.target.value);await refreshAll();});
$$('.nav-item').forEach(button=>button.addEventListener('click',async()=>{const page=button.dataset.page;$$('.nav-item').forEach(x=>x.classList.toggle('active',x===button));$$('.page').forEach(x=>x.classList.toggle('active',x.id===`page-${page}`));$('.sidebar').classList.remove('open');if(page==='audit')await renderAudit();}));
$$('[data-page-link]').forEach(b=>b.addEventListener('click',()=>document.querySelector(`.nav-item[data-page="${b.dataset.pageLink}"]`).click()));
$$('[data-open]').forEach(b=>b.addEventListener('click',()=>openForm(b.dataset.open)));$('#new-employee').addEventListener('click',()=>openForm('employee'));
$('#entity-form').addEventListener('submit',submitEntity);$('#menu-button').addEventListener('click',()=>$('.sidebar').classList.toggle('open'));
$$('[data-close-dialog]').forEach(button=>button.addEventListener('click',()=>$('#form-dialog').close()));
$('#movement-list').addEventListener('click',e=>{const t=e.target.closest('[data-transition]');if(t)transition(Number(t.dataset.transition),t.dataset.target);const a=e.target.closest('[data-attach]');if(a)attach(Number(a.dataset.attach));});
$$('.chip').forEach(b=>b.addEventListener('click',()=>{state.filter=b.dataset.filter;$$('.chip').forEach(x=>x.classList.toggle('active',x===b));renderMovements();}));
$('#refresh-movements').addEventListener('click',refreshAll);

bootstrap();
