const $ = (s) => document.querySelector(s);

let token = '';
let raffles = [];
let currentRaffle = null;
let currentSubprizeLabels = [];

function updateImagePreview(url) {
  const container = $('#raffleImagePreview');
  const img = $('#raffleImagePreviewImg');
  if (!container || !img) return;
  if (url && url.trim()) {
    img.src = url.trim();
    container.style.display = 'block';
    img.onerror = () => { container.style.display = 'none'; };
  } else {
    container.style.display = 'none';
  }
}

function normalizeWinnerNumber(raw) {
  const digits = String(raw || '').replace(/\D/g, '').slice(-4);
  return digits ? digits.padStart(4, '0') : '';
}

function refreshSubwinnerRows() {
  const rows = Array.from(document.querySelectorAll('#subwinnerRows .subwinner-row'));
  rows.forEach((row, index) => {
    const input = row.querySelector('input[name="subWinner"]');
    const removeBtn = row.querySelector('.remove-subwinner-btn');
    if (input) {
      input.placeholder = `Numero subganador #${index + 1} (ej: 0123)`;
      input.setAttribute('aria-label', `Numero subganador ${index + 1}`);
    }
    if (removeBtn) removeBtn.disabled = rows.length === 1 && !(input && input.value.trim());
  });
}

function addSubwinnerRow(value = '') {
  const wrap = $('#subwinnerRows');
  if (!wrap) return;

  const row = document.createElement('div');
  row.className = 'subwinner-row';

  const input = document.createElement('input');
  input.name = 'subWinner';
  input.maxLength = 4;
  input.value = value;

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'remove-subwinner-btn';
  removeBtn.textContent = 'Quitar';
  removeBtn.addEventListener('click', () => {
    const allRows = Array.from(document.querySelectorAll('#subwinnerRows .subwinner-row'));
    if (allRows.length === 1) {
      input.value = '';
      refreshSubwinnerRows();
      return;
    }
    row.remove();
    refreshSubwinnerRows();
  });

  row.append(input, removeBtn);
  wrap.appendChild(row);
  refreshSubwinnerRows();
}

function ensureSubwinnerRows() {
  const wrap = $('#subwinnerRows');
  if (!wrap) return;
  if (!wrap.children.length) addSubwinnerRow();
  else refreshSubwinnerRows();
}

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
    loadDbTables();
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
    setState(true);
    await loadRaffles();
  }catch(err){
    setMsg($('#adminMsg'), `✗ ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Ingresar';
  }
}

async function loadRaffles(selectedRaffleId = null){
  raffles = await api('/api/admin/raffles');
  const select = $('#raffleSelect');
  select.innerHTML = raffles.map(r => {
    const tag = r.status === 'active' ? '🟢' : '⚪';
    return `<option value="${r.id}">${tag} ${r.title}</option>`;
  }).join('');

  if (!raffles.length){
    currentRaffle = null;
    currentSubprizeLabels = [];
    $('#subprizesInput').value = '';
    return;
  }

  const preferredId = Number(selectedRaffleId);
  const hasPreferred = Number.isFinite(preferredId) && raffles.some(r => r.id === preferredId);
  select.value = String(hasPreferred ? preferredId : raffles[0].id);
  await onRaffleSelect();
}

async function onRaffleSelect(){
  const id = Number($('#raffleSelect').value);
  currentRaffle = raffles.find(r=>r.id===id) || null;
  if (!currentRaffle) return;
  const form = $('#editRaffle');
  form.title.value = currentRaffle.title;
  form.main_prize.value = currentRaffle.main_prize;
  form.total_numbers.value = currentRaffle.total_numbers;
  form.ticket_price.value = currentRaffle.ticket_price;
  form.min_purchase.value = currentRaffle.min_purchase;
  form.required_sales_pct.value = currentRaffle.required_sales_pct || 70;
  form.sales_milestones.value = currentRaffle.sales_milestones || '20,40,60,80';
  form.image_url.value = currentRaffle.image_url || '';
  updateImagePreview(currentRaffle.image_url);
  form.status.value = currentRaffle.status;

  // Update status bar
  updateRaffleStatusBar();

  const sub = await api(`/api/raffles/${id}/subprizes`);
  currentSubprizeLabels = sub.map(s => s.name).filter(Boolean);
  $('#subprizesInput').value = sub.map(s => `${s.name}|${s.description}`).join('\n');
  const subwinnerRows = $('#subwinnerRows');
  if (subwinnerRows) subwinnerRows.innerHTML = '';
  ensureSubwinnerRows();
  await loadPackages();
}

async function saveRaffle(e){
  e.preventDefault();
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  try{
    if (!currentRaffle) throw new Error('No hay rifa seleccionada.');
    const payload = Object.fromEntries(new FormData(e.target).entries());
    await api(`/api/admin/raffles/${currentRaffle.id}`, {method:'PATCH', body: JSON.stringify(payload)});
    setMsg($('#adminMsg'), '✓ Rifa actualizada correctamente', 'success');
    await loadRaffles(currentRaffle.id);
  }catch(err){ setMsg($('#adminMsg'), `✗ ${err.message}`, 'error'); }
  finally { btn.disabled = false; }
}

async function createRaffle(e){
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'Creando...';
  try {
    const payload = Object.fromEntries(new FormData(e.target).entries());
    const out = await api('/api/admin/raffles', {method:'POST', body: JSON.stringify(payload)});
    setMsg($('#adminMsg'), 'Nueva rifa creada correctamente', 'success');
    e.target.reset();
    e.target.min_purchase.value = 1;
    e.target.required_sales_pct.value = 70;
    e.target.sales_milestones.value = '20,40,60,80';
    await loadRaffles(out.id);
  } catch(err) {
    setMsg($('#adminMsg'), `Error: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Crear rifa';
  }
}

async function resetRaffle(){
  if (!currentRaffle) {
    setMsg($('#adminMsg'), 'No hay rifa seleccionada para resetear.', 'error');
    return;
  }
  const confirmation = prompt(`Escribe RESET para confirmar el reseteo de: ${currentRaffle.title}`);
  if (confirmation !== 'RESET') {
    setMsg($('#adminMsg'), 'Reset cancelado.', 'info');
    return;
  }

  const btn = $('#resetRaffleBtn');
  btn.disabled = true;
  btn.textContent = 'Reseteando...';
  try {
    await api(`/api/admin/raffles/${currentRaffle.id}/reset`, {
      method:'POST',
      body: JSON.stringify({ confirm: 'RESET' }),
    });
    setMsg($('#adminMsg'), 'Rifa reseteada: subpremios, ventas y ganadores eliminados.', 'success');
    await loadRaffles(currentRaffle.id);
    await loadOrders();
  } catch(err) {
    setMsg($('#adminMsg'), `Error: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Resetear rifa';
  }
}

async function saveSubprizes(e){
  e.preventDefault();
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  try{
    if (!currentRaffle) throw new Error('No hay rifa seleccionada.');
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
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  try{
    if (!currentRaffle) throw new Error('No hay rifa seleccionada.');
    const fd = new FormData(e.target);
    const mainWinner = normalizeWinnerNumber(fd.get('main'));
    if (!mainWinner) throw new Error('Debes ingresar el numero ganador principal.');

    const subWinnerInputs = Array.from(document.querySelectorAll('#subwinnerRows input[name="subWinner"]'));
    const subWinners = subWinnerInputs
      .map((input) => normalizeWinnerNumber(input.value))
      .filter(Boolean);

    const results = [
      {winner_type:'main', label:'Premio principal', winning_number: mainWinner},
      ...subWinners.map((number, index) => ({
        winner_type: 'subprize',
        label: currentSubprizeLabels[index] || `Subganador ${index + 1}`,
        winning_number: number,
      })),
    ];

    await api(`/api/admin/raffles/${currentRaffle.id}/draw-results`, {method:'POST', body: JSON.stringify({results})});
    setMsg($('#adminMsg'), `Ganadores publicados exitosamente (${1 + subWinners.length} total).`, 'success');
  }catch(err){ setMsg($('#adminMsg'), `Error: ${err.message}`, 'error'); }
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
    form.winner_message.value = s.winner_message || '';
    form.subwinner_message.value = s.subwinner_message || '';
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
      body: JSON.stringify({
        whatsapp: fd.get('whatsapp'),
        email: fd.get('email'),
        ticker_items,
        winner_message: fd.get('winner_message') || '',
        subwinner_message: fd.get('subwinner_message') || '',
      }),
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

// ===== DATABASE EXPLORER =====
let dbCurrentTable = '';
let dbCurrentPage = 1;
let dbCurrentRows = [];
const DB_LIMIT = 50;

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function buildWhere(row) {
  if (row.id !== undefined && row.id !== null) {
    return isNaN(Number(row.id)) ? `id = '${row.id}'` : `id = ${row.id}`;
  }
  return Object.entries(row)
    .map(([k, v]) => v === null ? `${k} IS NULL` : `${k} = '${String(v).replace(/'/g, "''")}'`)
    .join(' AND ');
}

async function loadDbTables() {
  try {
    const tables = await api('/api/admin/db/tables');
    const sel = $('#dbTableSelect');
    sel.innerHTML = '<option value="">— Selecciona una tabla —</option>';
    tables.forEach(t => sel.insertAdjacentHTML('beforeend', `<option value="${t}">${t}</option>`));
  } catch(_) {}
}

async function loadDbTable(table, page = 1) {
  if (!table) return;
  dbCurrentTable = table;
  dbCurrentPage = page;
  const btn = $('#dbLoadTableBtn');
  btn.disabled = true; btn.textContent = 'Cargando...';
  try {
    const data = await api(`/api/admin/db/table/${encodeURIComponent(table)}?page=${page}&limit=${DB_LIMIT}`);
    dbCurrentRows = data.rows;
    renderDbTable(data);
    const pager = $('#dbTablePager');
    pager.style.display = 'flex';
    const totalPages = Math.max(1, Math.ceil(data.total / data.limit));
    $('#dbPageInfo').textContent = `Página ${data.page} de ${totalPages} — ${data.total.toLocaleString('es-CO')} filas`;
    $('#dbPrevPage').disabled = data.page <= 1;
    $('#dbNextPage').disabled = data.page >= totalPages;
  } catch(err) {
    $('#dbTableOut').innerHTML = `<div style="color:var(--danger-text);padding:12px">${esc(err.message)}</div>`;
  } finally { btn.disabled = false; btn.textContent = 'Ver tabla'; }
}

function renderDbTable(data) {
  if (!data.rows.length) {
    $('#dbTableOut').innerHTML = '<div class="empty-state"><span class="empty-icon">📋</span><p>Tabla vacía.</p></div>';
    return;
  }
  const cols = data.columns;
  let html = '<table class="db-table"><thead><tr><th>Acciones</th>';
  cols.forEach(c => { html += `<th>${esc(c)}</th>`; });
  html += '</tr></thead><tbody>';
  data.rows.forEach((row, idx) => {
    html += `<tr><td style="white-space:nowrap">
      <button type="button" class="db-edit-btn" data-idx="${idx}" style="padding:3px 8px;font-size:11px;margin-right:4px">Editar</button>
      <button type="button" class="db-delete-btn" data-idx="${idx}" style="padding:3px 8px;font-size:11px;background:linear-gradient(135deg,#ef4444,#dc2626);box-shadow:none">Eliminar</button>
    </td>`;
    cols.forEach(c => {
      const v = row[c];
      const display = v === null ? '<em style="color:var(--text-muted)">NULL</em>' : esc(String(v).length > 80 ? String(v).slice(0, 80) + '…' : String(v));
      html += `<td>${display}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  $('#dbTableOut').innerHTML = html;
}

function dbEditRow(idx) {
  const row = dbCurrentRows[idx];
  const table = dbCurrentTable;
  const sets = Object.entries(row)
    .filter(([k]) => k !== 'id')
    .map(([k, v]) => v === null ? `  ${k} = NULL` : `  ${k} = '${String(v).replace(/'/g, "''")}'`)
    .join(',\n');
  const where = buildWhere(row);
  $('#dbQueryInput').value = `UPDATE "${table}"\nSET\n${sets}\nWHERE ${where};`;
  $('#dbQueryMsg').textContent = '';
  $('#dbQueryOut').innerHTML = '';
  $('#dbQueryInput').focus();
  $('#dbQueryInput').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function dbDeleteRow(idx) {
  const row = dbCurrentRows[idx];
  const table = dbCurrentTable;
  const where = buildWhere(row);
  if (confirm(`¿Eliminar la fila donde ${where}?\nEsta acción no se puede deshacer.`)) {
    $('#dbQueryInput').value = `DELETE FROM "${table}" WHERE ${where};`;
    runDbQuery();
  }
}

$('#dbTableOut').addEventListener('click', (e) => {
  const editBtn = e.target.closest('.db-edit-btn');
  const delBtn = e.target.closest('.db-delete-btn');
  if (editBtn) dbEditRow(Number(editBtn.dataset.idx));
  if (delBtn) dbDeleteRow(Number(delBtn.dataset.idx));
});

async function runDbQuery() {
  const sql = $('#dbQueryInput').value.trim();
  if (!sql) return;
  const btn = $('#dbRunQueryBtn');
  const msgEl = $('#dbQueryMsg');
  btn.disabled = true; btn.textContent = 'Ejecutando...';
  msgEl.textContent = ''; msgEl.style.color = 'var(--text-muted)';
  try {
    const result = await api('/api/admin/db/query', { method: 'POST', body: JSON.stringify({ sql }) });
    if (result.type === 'select') {
      if (!result.rows.length) {
        $('#dbQueryOut').innerHTML = '<div style="color:var(--text-muted);padding:8px 0">Sin resultados.</div>';
        msgEl.textContent = '0 filas';
      } else {
        const cols = result.columns;
        let html = '<table class="db-table"><thead><tr>';
        cols.forEach(c => { html += `<th>${esc(c)}</th>`; });
        html += '</tr></thead><tbody>';
        result.rows.forEach(row => {
          html += '<tr>';
          cols.forEach(c => {
            const v = row[c];
            const display = v === null ? '<em style="color:var(--text-muted)">NULL</em>' : esc(String(v));
            html += `<td>${display}</td>`;
          });
          html += '</tr>';
        });
        html += '</tbody></table>';
        $('#dbQueryOut').innerHTML = html;
        msgEl.textContent = `${result.rows.length} fila(s)`;
      }
    } else {
      $('#dbQueryOut').innerHTML = '';
      msgEl.textContent = `✓ ${result.rowcount} fila(s) afectada(s)`;
      msgEl.style.color = 'var(--success)';
      if (dbCurrentTable) loadDbTable(dbCurrentTable, dbCurrentPage);
    }
  } catch(err) {
    $('#dbQueryOut').innerHTML = `<div style="color:var(--danger-text);padding:8px 0">${esc(err.message)}</div>`;
  } finally { btn.disabled = false; btn.textContent = '▶ Ejecutar'; }
}

// ===== PACKAGES MANAGEMENT =====
function addPackageRow(quantity = '', isPopular = false) {
  const wrap = $('#packagesRows');
  if (!wrap) return;

  const row = document.createElement('div');
  row.className = 'package-row';

  const qtyInput = document.createElement('input');
  qtyInput.type = 'number';
  qtyInput.min = '1';
  qtyInput.placeholder = 'Cantidad';
  qtyInput.value = quantity;
  qtyInput.setAttribute('aria-label', 'Cantidad de tiquetes');
  qtyInput.addEventListener('input', updatePackagePreviews);

  const popularLabel = document.createElement('label');
  const popularCheck = document.createElement('input');
  popularCheck.type = 'checkbox';
  popularCheck.checked = isPopular;
  popularLabel.append(popularCheck, ' Popular');

  const preview = document.createElement('span');
  preview.className = 'pkg-price-preview';

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'remove-package-btn';
  removeBtn.textContent = '✕';
  removeBtn.addEventListener('click', () => {
    row.remove();
    updatePackagePreviews();
  });

  row.append(qtyInput, popularLabel, preview, removeBtn);
  wrap.appendChild(row);
  updatePackagePreviews();
}

function updatePackagePreviews() {
  const price = currentRaffle ? Number(currentRaffle.ticket_price || 0) : 0;
  document.querySelectorAll('#packagesRows .package-row').forEach(row => {
    const qty = Number(row.querySelector('input[type="number"]').value || 0);
    const preview = row.querySelector('.pkg-price-preview');
    if (qty > 0 && price > 0) {
      preview.textContent = `= $${(qty * price).toLocaleString('es-CO')} COP`;
    } else {
      preview.textContent = '';
    }
  });
}

async function loadPackages() {
  if (!currentRaffle) return;
  try {
    const packages = await api(`/api/raffles/${currentRaffle.id}/packages`);
    const wrap = $('#packagesRows');
    wrap.innerHTML = '';
    if (packages.length) {
      packages.forEach(p => addPackageRow(p.quantity, p.is_popular));
    } else {
      // Default packages if none exist
      [100, 200, 400, 600, 800, 1000].forEach((q, i) => addPackageRow(q, i === 1));
    }
  } catch(_) {
    // Fallback defaults
    const wrap = $('#packagesRows');
    wrap.innerHTML = '';
    [100, 200, 400, 600, 800, 1000].forEach((q, i) => addPackageRow(q, i === 1));
  }
}

async function savePackages() {
  if (!currentRaffle) {
    setMsg($('#adminMsg'), 'No hay rifa seleccionada.', 'error');
    return;
  }
  const btn = $('#savePackagesBtn');
  btn.disabled = true;
  btn.textContent = 'Guardando...';
  try {
    const rows = document.querySelectorAll('#packagesRows .package-row');
    const packages = [];
    rows.forEach(row => {
      const qty = Number(row.querySelector('input[type="number"]').value || 0);
      const isPopular = row.querySelector('input[type="checkbox"]').checked;
      if (qty > 0) {
        packages.push({ quantity: qty, is_popular: isPopular });
      }
    });
    if (!packages.length) throw new Error('Agrega al menos un paquete.');
    await api(`/api/admin/raffles/${currentRaffle.id}/packages`, {
      method: 'POST',
      body: JSON.stringify({ packages }),
    });
    setMsg($('#adminMsg'), '✓ Paquetes actualizados', 'success');
  } catch(err) {
    setMsg($('#adminMsg'), `✗ ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar paquetes';
  }
}

function updateRaffleStatusBar() {
  if (!currentRaffle) return;
  const tag = $('#raffleStatusTag');
  const btn = $('#activateRaffleBtn');
  if (currentRaffle.status === 'active') {
    tag.innerHTML = '<span style="display:inline-flex;align-items:center;gap:5px;padding:4px 12px;border-radius:999px;font-size:12px;font-weight:700;background:rgba(16,185,129,0.12);color:var(--success);border:1px solid rgba(16,185,129,0.25);">🟢 Activa — visible en el sitio</span>';
    btn.style.display = 'none';
  } else {
    tag.innerHTML = '<span style="display:inline-flex;align-items:center;gap:5px;padding:4px 12px;border-radius:999px;font-size:12px;font-weight:700;background:rgba(100,116,139,0.12);color:var(--text-muted);border:1px solid rgba(100,116,139,0.25);">⚪ Cerrada — no visible</span>';
    btn.style.display = '';
  }
}

async function activateRaffle() {
  if (!currentRaffle) return;
  const btn = $('#activateRaffleBtn');
  btn.disabled = true;
  btn.textContent = 'Activando...';
  try {
    await api(`/api/admin/raffles/${currentRaffle.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'active' }),
    });
    setMsg($('#adminMsg'), `✓ "${currentRaffle.title}" ahora está activa. Las demás rifas se cerraron automáticamente.`, 'success');
    await loadRaffles(currentRaffle.id);
  } catch(err) {
    setMsg($('#adminMsg'), `✗ ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🟢 Activar esta rifa en el sitio';
  }
}

$('#activateRaffleBtn').addEventListener('click', activateRaffle);
$('#addPackageBtn').addEventListener('click', () => addPackageRow());
$('#savePackagesBtn').addEventListener('click', savePackages);

$('#adminLogin').addEventListener('submit', login);
$('#raffleSelect').addEventListener('change', onRaffleSelect);
$('#createRaffle').addEventListener('submit', createRaffle);
$('#editRaffle').addEventListener('submit', saveRaffle);
$('#editRaffle').image_url.addEventListener('input', (e) => updateImagePreview(e.target.value));
$('#resetRaffleBtn').addEventListener('click', resetRaffle);
$('#subprizesForm').addEventListener('submit', saveSubprizes);
$('#winnersForm').addEventListener('submit', setWinners);
$('#addSubwinnerBtn').addEventListener('click', () => addSubwinnerRow());
$('#refreshOrders').addEventListener('click', loadOrders);
$('#settingsForm').addEventListener('submit', saveSettings);
$('#loadAudit').addEventListener('click', loadAudit);
$('#dbLoadTableBtn').addEventListener('click', () => loadDbTable($('#dbTableSelect').value));
$('#dbPrevPage').addEventListener('click', () => loadDbTable(dbCurrentTable, dbCurrentPage - 1));
$('#dbNextPage').addEventListener('click', () => loadDbTable(dbCurrentTable, dbCurrentPage + 1));
$('#dbRunQueryBtn').addEventListener('click', runDbQuery);
$('#dbClearQueryBtn').addEventListener('click', () => { $('#dbQueryInput').value = ''; $('#dbQueryOut').innerHTML = ''; $('#dbQueryMsg').textContent = ''; });
$('#dbQueryInput').addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') runDbQuery(); });

function logout() {
  token = '';
  raffles = [];
  currentRaffle = null;
  setState(false);
  $('#adminLogin').reset();
  $('#adminMsg').textContent = '';
  $('#adminMsg').className = '';
}

$('#logoutBtn').addEventListener('click', logout);

ensureSubwinnerRows();
setState(false);
