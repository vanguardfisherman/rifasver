const $ = (s) => document.querySelector(s);
const pad = (n) => String(n).padStart(4, '0');

let raffles = [];
let currentRaffle = null;
let sold = new Set();
let selected = new Set();

const PAGE_SIZE = 250;
let currentPage = 1;
let filteredNumbers = [];

async function api(path, options = {}) {
  const res = await fetch(path, {headers: {'Content-Type': 'application/json'}, ...options});
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error');
  return data;
}

function buildFilteredNumbers() {
  const filter = $('#search').value.trim();
  const max = Number(currentRaffle.total_numbers);
  filteredNumbers = [];
  for (let i = 1; i <= max; i++) {
    const n = pad(i);
    if (!filter || n.includes(filter)) filteredNumbers.push(n);
  }
  const totalPages = Math.max(1, Math.ceil(filteredNumbers.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
}

function renderProgress() {
  const total = Number(currentRaffle.total_numbers);
  const soldCount = sold.size;
  const percent = total > 0 ? Math.round((soldCount / total) * 100) : 0;
  $('#progressBar').style.width = `${percent}%`;
  $('#progressText').textContent = `${soldCount.toLocaleString('es-CO')} vendidos de ${total.toLocaleString('es-CO')} (${percent}%)`;
}

function renderGrid() {
  buildFilteredNumbers();
  const totalPages = Math.max(1, Math.ceil(filteredNumbers.length / PAGE_SIZE));
  const start = (currentPage - 1) * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  const pageNumbers = filteredNumbers.slice(start, end);

  const wrap = $('#grid');
  wrap.innerHTML = '';
  const fragment = document.createDocumentFragment();

  for (const n of pageNumbers) {
    const b = document.createElement('button');
    b.className = 'num';
    b.textContent = n;
    if (sold.has(n)) {
      b.classList.add('sold');
      b.disabled = true;
    }
    if (selected.has(n)) b.classList.add('selected');
    b.onclick = () => {
      selected.has(n) ? selected.delete(n) : selected.add(n);
      renderGrid();
    };
    fragment.appendChild(b);
  }

  wrap.appendChild(fragment);
  $('#pageInfo').textContent = `Página ${currentPage} de ${totalPages}`;
  $('#prevPage').disabled = currentPage <= 1;
  $('#nextPage').disabled = currentPage >= totalPages;
  $('#selInfo').textContent = `Seleccionados: ${selected.size} • Total: $${(selected.size * Number(currentRaffle.ticket_price)).toLocaleString('es-CO')}`;
  renderProgress();
}

async function loadRaffles() {
  raffles = await api('/api/raffles');
  $('#raffleSelect').innerHTML = raffles.map(r => `<option value="${r.id}">${r.title}</option>`).join('');
  if (raffles.length) {
    currentRaffle = raffles[0];
    $('#raffleSelect').value = currentRaffle.id;
    await onRaffleChange();
  }
}

async function onRaffleChange() {
  const id = Number($('#raffleSelect').value);
  currentRaffle = raffles.find(r => r.id === id);
  sold = new Set((await api(`/api/raffles/${id}/numbers`)).sold);
  selected = new Set();
  currentPage = 1;
  $('#search').value = '';

  $('#raffleInfo').textContent = `${currentRaffle.main_prize} | Precio: $${Number(currentRaffle.ticket_price).toLocaleString('es-CO')} | Mínimo: ${currentRaffle.min_purchase}`;
  const sub = await api(`/api/raffles/${id}/subprizes`);
  $('#subprizes').innerHTML = sub.map(s => `<span class="chip">${s.name}: ${s.description}</span>`).join('');
  renderGrid();
  await renderWinners();
}

async function downloadReceipt(orderId, document) {
  const res = await fetch(`/api/orders/${orderId}/receipt?document=${encodeURIComponent(document)}`);
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'No se pudo generar el comprobante');
  }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `orden-${orderId}.pdf`;
  a.click();
}

async function buy(e) {
  e.preventDefault();
  try {
    const customer = Object.fromEntries(new FormData(e.target).entries());
    const out = await api('/api/orders', {method: 'POST', body: JSON.stringify({raffle_id: currentRaffle.id, numbers: [...selected], customer})});
    await downloadReceipt(out.order_id, customer.document);
    $('#msg').textContent = `Compra exitosa. Orden #${out.order_id}. Comprobante descargado.`;
    await onRaffleChange();
    e.target.reset();
  } catch (err) {
    $('#msg').textContent = err.message;
  }
}

async function lookup() {
  try {
    const key = $('#lookup').value.trim();
    const out = await api(`/api/tickets/query?key=${encodeURIComponent(key)}`);
    $('#lookupOut').innerHTML = out.map(o => `<li>Orden #${o.order_id} • ${o.numbers}</li>`).join('') || '<li>Sin resultados</li>';
  } catch (err) {
    $('#lookupOut').innerHTML = `<li>${err.message}</li>`;
  }
}

async function renderWinners() {
  const winners = await api(`/api/raffles/${currentRaffle.id}/winners`);
  $('#winners').innerHTML = winners.map(w => `<div class="wcard"><b>${w.label}</b><br>Número: ${w.winning_number}<br>Ganador: ${w.owner}</div>`).join('') || '<p>Sin ganadores publicados.</p>';
}

$('#raffleSelect').addEventListener('change', onRaffleChange);
$('#search').addEventListener('input', () => {
  currentPage = 1;
  renderGrid();
});
$('#prevPage').addEventListener('click', () => { currentPage--; renderGrid(); });
$('#nextPage').addEventListener('click', () => { currentPage++; renderGrid(); });

document.querySelectorAll('.quick').forEach(b => b.addEventListener('click', () => {
  const q = Number(b.dataset.q);
  selected = new Set();
  for (let i = 1; i <= Number(currentRaffle.total_numbers) && selected.size < q; i++) {
    const n = pad(i);
    if (!sold.has(n)) selected.add(n);
  }
  renderGrid();
}));

$('#checkout').addEventListener('submit', buy);
$('#lookupBtn').addEventListener('click', lookup);

loadRaffles();
