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

function setState(ok){
  $('#adminArea').classList.toggle('hidden', !ok);
  $('#adminMsg').textContent = ok ? 'Sesión admin activa' : 'Inicia sesión';
}

async function login(e){
  e.preventDefault();
  try{
    const creds = Object.fromEntries(new FormData(e.target).entries());
    const out = await api('/api/admin/login', {method:'POST', body: JSON.stringify(creds), headers:{}});
    token = out.token;
    localStorage.setItem('admin_token', token);
    setState(true);
    await loadRaffles();
  }catch(err){ $('#adminMsg').textContent = err.message; }
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
  try{
    const payload = Object.fromEntries(new FormData(e.target).entries());
    await api(`/api/admin/raffles/${currentRaffle.id}`, {method:'PATCH', body: JSON.stringify(payload)});
    $('#adminMsg').textContent = 'Rifa actualizada';
    await loadRaffles();
  }catch(err){ $('#adminMsg').textContent = err.message; }
}

async function saveSubprizes(e){
  e.preventDefault();
  try{
    const lines = $('#subprizesInput').value.split('\n').map(s=>s.trim()).filter(Boolean);
    const subprizes = lines.map(line => {
      const [name, description=''] = line.split('|');
      return {name: name.trim(), description: description.trim(), winner_rule: 'editable_by_admin'};
    });
    await api(`/api/admin/raffles/${currentRaffle.id}/subprizes`, {method:'POST', body: JSON.stringify({subprizes})});
    $('#adminMsg').textContent = 'Subpremios actualizados';
  }catch(err){ $('#adminMsg').textContent = err.message; }
}

async function setWinners(e){
  e.preventDefault();
  try{
    const fd = new FormData(e.target);
    const results = [
      {winner_type:'main', label:'Premio principal', winning_number: fd.get('main') || '0000'},
      {winner_type:'subprize', label:'Subpremio', winning_number: fd.get('sub') || '0000'},
    ];
    await api(`/api/admin/raffles/${currentRaffle.id}/draw-results`, {method:'POST', body: JSON.stringify({results})});
    $('#adminMsg').textContent = 'Ganadores publicados';
  }catch(err){ $('#adminMsg').textContent = err.message; }
}

async function loadOrders(){
  try{
    const rows = await api('/api/admin/orders');
    $('#ordersOut').innerHTML = rows.map(r=>`<li>#${r.id} • ${r.raffle_title} • ${r.first_name} ${r.last_name} • ${r.numbers}</li>`).join('') || '<li>Sin órdenes</li>';
  }catch(err){ $('#ordersOut').innerHTML = `<li>${err.message}</li>`; }
}

async function loadAudit(){
  try{
    const rows = await api('/api/admin/audit-logs');
    $('#auditOut').innerHTML = rows.map(r=>`<li>${r.action} • ${r.created_at}</li>`).join('') || '<li>Sin auditoría</li>';
  }catch(err){ $('#auditOut').innerHTML = `<li>${err.message}</li>`; }
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
