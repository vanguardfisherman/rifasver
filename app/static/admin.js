const $ = (s) => document.querySelector(s);

let token = localStorage.getItem('admin_token') || '';
let raffles = [];
let currentRaffle = null;

async function api(path, options = {}) {
  const headers = {'Content-Type':'application/json', ...(options.headers || {})};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, {...options, headers});
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error');
  return data;
}

function setMsg(el, text, type = 'info') {
  el.textContent = text;
  el.className = `msg-box msg-${type}`;
}

function setState(ok){
  $('#adminArea').classList.toggle('hidden', !ok);
  const msg = $('#adminMsg');
  if (ok) {
    setMsg(msg, '✓ Sesion admin activa', 'success');
    loadOrders();
    loadSettings();
  } else {
    msg.textContent = '';
    msg.className = '';
  }
}

async function login(e){
  e.preventDefault();
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  btn.textContent = 'Verificando...';
  try{
    const creds = Object.fromEntries(new FormData(e.target).entries());
    const out = await api('/api/admin/login', {method:'POST', body: JSON.stringify(creds), headers:{}});
    token = out.token;
    localStorage.setItem('admin_token', token);
    setState(true);
    await loadRaffles();
  }catch(err){
    setMsg($('#adminMsg'), `✗ ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Ingresar';
  }
}

async function loadRaffles(){
  raffles = await api('/api/raffles');
  $('#raffleSelect').innerHTML = raffles.map(r=>`<option value="${r.id}">${r.title}</option>`).join('');
  if (raffles.length){
    $('#raffleSelect').value = raffles[0].id;
    onRaffleSelect();
  }
}

async function onRaffleSelect(){
  const id = Number($('#raffleSelect').value);
  currentRaffle = raffles.find(r=>r.id===id);
  const form = $('#editRaffle');
  form.title.value = currentRaffle.title;
  form.main_prize.value = currentRaffle.main_prize;
  form.total_numbers.value = currentRaffle.total_numbers;
  form.ticket_price.value = currentRaffle.ticket_price;
  form.min_purchase.value = currentRaffle.min_purchase;
  form.status.value = currentRaffle.status;

  const sub = await api(`/api/raffles/${id}/subprizes`);
  $('#subprizesInput').value = sub.map(s => `${s.name}|${s.description}`).join('\n');
}

async function saveRaffle(e){
  e.preventDefault();
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  try{
    const payload = Object.fromEntries(new FormData(e.target).entries());
    await api(`/api/admin/raffles/${currentRaffle.id}`, {method:'PATCH', body: JSON.stringify(payload)});
    setMsg($('#adminMsg'), '✓ Rifa actualizada correctamente', 'success');
    await loadRaffles();
  }catch(err){ setMsg($('#adminMsg'), `✗ ${err.message}`, 'error'); }
  finally { btn.disabled = false; }
}

async function saveSubprizes(e){
  e.preventDefault();
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  try{
    const lines = $('#subprizesInput').value.split('\n').map(s=>s.trim()).filter(Boolean);
    const subprizes = lines.map(line => {
      const [name, description=''] = line.split('|');
      return {name: name.trim(), description: description.trim(), winner_rule: 'editable_by_admin'};
    });
    await api(`/api/admin/raffles/${currentRaffle.id}/subprizes`, {method:'POST', body: JSON.stringify({subprizes})});
    setMsg($('#adminMsg'), '✓ Subpremios actualizados', 'success');
  }catch(err){ setMsg($('#adminMsg'), `✗ ${err.message}`, 'error'); }
  finally { btn.disabled = false; }
}

async function setWinners(e){
  e.preventDefault();
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  try{
    const fd = new FormData(e.target);
    const results = [
      {winner_type:'main', label:'Premio principal', winning_number: fd.get('main') || '0000'},
      {winner_type:'subprize', label:'Subpremio', winning_number: fd.get('sub') || '0000'},
    ];
    await api(`/api/admin/raffles/${currentRaffle.id}/draw-results`, {method:'POST', body: JSON.stringify({results})});
    setMsg($('#adminMsg'), '🏆 Ganadores publicados exitosamente', 'success');
  }catch(err){ setMsg($('#adminMsg'), `✗ ${err.message}`, 'error'); }
  finally { btn.disabled = false; }
}

const STATUS_LABELS = {
  paid: { label: 'Pagado', color: 'var(--success)' },
  paid_simulated: { label: 'Simulado', color: 'var(--accent)' },
  pending_payment: { label: 'Pendiente', color: 'var(--warning)' },
};

async function loadOrders(){
  const btn = $('#refreshOrders');
  if (btn) { btn.disabled = true; btn.textContent = 'Cargando...'; }
  try{
    const rows = await api('/api/admin/orders');
    const countEl = $('#ordersCount');
    if (countEl) countEl.textContent = rows.length ? `${rows.length} órdenes` : '';
    if (!rows.length) {
      $('#ordersOut').innerHTML = '<div class="empty-state"><span class="empty-icon">📋</span><p>No hay órdenes aún.</p></div>';
      return;
    }
    $('#ordersOut').innerHTML = rows.map(r => {
      const nums = (r.numbers || '').split(',');
      const st = STATUS_LABELS[r.status] || { label: r.status, color: 'var(--text-muted)' };
      const date = new Date(r.created_at).toLocaleString('es-CO', {dateStyle:'short', timeStyle:'short'});
      return `<div style="background:var(--bg-subtle);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px 16px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">
          <div>
            <span style="font-weight:700;color:var(--text)">Orden #${r.id}</span>
            <span style="margin-left:10px;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:rgba(0,0,0,0.2);color:${st.color}">${st.label}</span>
          </div>
          <span style="font-size:12px;color:var(--text-muted)">${date}</span>
        </div>
        <div style="margin-top:6px;font-size:13px;color:var(--text-secondary)">
          <b>${r.first_name} ${r.last_name}</b> &bull; ${r.document} &bull; ${r.email}
        </div>
        <div style="margin-top:4px;font-size:12px;color:var(--text-muted)">${r.raffle_title}</div>
        <div style="margin-top:6px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
          <span style="font-size:12px;color:var(--text-muted);word-break:break-all">${nums.length} tiquete${nums.length!==1?'s':''}: ${r.numbers}</span>
          <span style="font-weight:700;color:var(--success);font-size:14px">$ ${Number(r.total).toLocaleString('es-CO')}</span>
        </div>
      </div>`;
    }).join('');
  }catch(err){ $('#ordersOut').innerHTML = `<div style="color:var(--danger-text);padding:12px">${err.message}</div>`; }
  finally { if (btn) { btn.disabled = false; btn.textContent = 'Actualizar'; } }
}

async function loadSettings(){
  try {
    const s = await api('/api/settings');
    const form = $('#settingsForm');
    if (!form) return;
    form.whatsapp.value = s.whatsapp || '';
    form.email.value = s.email || '';
    $('#tickerItemsInput').value = (s.ticker_items || []).join('\n');
  } catch(_) {}
}

async function saveSettings(e){
  e.preventDefault();
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  try {
    const fd = new FormData(e.target);
    const ticker_items = (fd.get('ticker_items') || '').split('\n').map(s=>s.trim()).filter(Boolean);
    await api('/api/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify({ whatsapp: fd.get('whatsapp'), email: fd.get('email'), ticker_items }),
    });
    setMsg($('#adminMsg'), '✓ Configuración guardada', 'success');
  } catch(err) { setMsg($('#adminMsg'), `✗ ${err.message}`, 'error'); }
  finally { btn.disabled = false; }
}

async function loadAudit(){
  const btn = $('#loadAudit');
  btn.disabled = true;
  btn.textContent = 'Cargando...';
  try{
    const rows = await api('/api/admin/audit-logs');
    if (!rows.length) {
      $('#auditOut').innerHTML = '<li><div class="empty-state"><span class="empty-icon">📊</span><p>Sin registros de auditoria.</p></div></li>';
      return;
    }
    $('#auditOut').innerHTML = rows.map(r => `<li>
      <div class="order-item">
        <div class="order-item-header">
          <span class="order-id">${r.action}</span>
          <span class="order-count" style="background:rgba(100,116,139,0.12);color:var(--text-muted)">${new Date(r.created_at).toLocaleString('es-CO')}</span>
        </div>
      </div>
    </li>`).join('');
  }catch(err){ $('#auditOut').innerHTML = `<li style="color:var(--danger-text)">${err.message}</li>`; }
  finally { btn.disabled = false; btn.textContent = 'Cargar auditoria'; }
}

$('#adminLogin').addEventListener('submit', login);
$('#raffleSelect').addEventListener('change', onRaffleSelect);
$('#editRaffle').addEventListener('submit', saveRaffle);
$('#subprizesForm').addEventListener('submit', saveSubprizes);
$('#winnersForm').addEventListener('submit', setWinners);
$('#refreshOrders').addEventListener('click', loadOrders);
$('#settingsForm').addEventListener('submit', saveSettings);
$('#loadAudit').addEventListener('click', loadAudit);

setState(Boolean(token));
if (token) loadRaffles();
