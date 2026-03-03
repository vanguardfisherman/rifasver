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

async function loadOrders(){
  const btn = $('#loadOrders');
  btn.disabled = true;
  btn.textContent = 'Cargando...';
  try{
    const rows = await api('/api/admin/orders');
    if (!rows.length) {
      $('#ordersOut').innerHTML = '<li><div class="empty-state"><span class="empty-icon">📋</span><p>No hay ordenes aun.</p></div></li>';
      return;
    }
    $('#ordersOut').innerHTML = rows.map(r => {
      const nums = (r.numbers || '').split(',');
      return `<li>
        <div class="order-item">
          <div class="order-item-header">
            <span class="order-id">Orden #${r.id} — ${r.first_name} ${r.last_name}</span>
            <span class="order-count">${nums.length} ${nums.length === 1 ? 'numero' : 'numeros'}</span>
          </div>
          <div class="order-numbers">${r.raffle_title} &bull; ${r.numbers}</div>
        </div>
      </li>`;
    }).join('');
  }catch(err){ $('#ordersOut').innerHTML = `<li style="color:var(--danger-text)">${err.message}</li>`; }
  finally { btn.disabled = false; btn.textContent = 'Cargar ordenes'; }
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
$('#loadOrders').addEventListener('click', loadOrders);
$('#loadAudit').addEventListener('click', loadAudit);

setState(Boolean(token));
if (token) loadRaffles();
