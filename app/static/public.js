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

function formatCop(value) {
  return `$ ${Number(value).toLocaleString('es-CO')}`;
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

function syncSticky() {
  const qty = selected.size;
  const total = qty * Number(currentRaffle.ticket_price || 0);
  $('#stickyInfo').textContent = `${qty} seleccionados • ${formatCop(total)}`;
  const cart = $('#stickyCart');
  if (qty > 0) {
    cart.style.transform = 'translateY(0)';
    cart.style.opacity = '1';
  } else {
    cart.style.transform = 'translateY(100%)';
    cart.style.opacity = '0';
  }
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

  for (let idx = 0; idx < pageNumbers.length; idx++) {
    const n = pageNumbers[idx];
    const b = document.createElement('button');
    b.className = 'num';
    b.textContent = n;
    b.style.opacity = '0';
    b.style.transform = 'scale(0.85)';
    b.style.transition = `opacity 0.25s ease ${idx * 0.003}s, transform 0.25s ease ${idx * 0.003}s, background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease`;
    requestAnimationFrame(() => {
      b.style.opacity = '1';
      b.style.transform = 'scale(1)';
    });
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
  $('#selInfo').textContent = `Seleccionados: ${selected.size} • Total: ${formatCop(selected.size * Number(currentRaffle.ticket_price))}`;
  renderProgress();
  syncSticky();
}

function fillPackPrices() {
  const price = Number(currentRaffle.ticket_price || 0);
  $('#pack2').textContent = formatCop(price * 2);
  $('#pack5').textContent = formatCop(price * 5);
  $('#pack10').textContent = formatCop(price * 10);
  $('#pack100').textContent = formatCop(price * 100);
}

function updateTicker(raffle) {
  const info = `⭐ Premio: ${raffle.main_prize} — Precio por número: ${formatCop(raffle.ticket_price)} — Mínimo: ${raffle.min_purchase} números`;
  const t1 = document.getElementById('tickerRaffleInfo');
  const t2 = document.getElementById('tickerRaffleInfo2');
  if (t1) t1.textContent = info;
  if (t2) t2.textContent = info;
}

async function loadRaffles() {
  raffles = await api('/api/raffles');
  if (raffles.length) {
    currentRaffle = raffles[0];
    await onRaffleChange();
  }
}

async function onRaffleChange() {
  const id = currentRaffle.id;
  sold = new Set((await api(`/api/raffles/${id}/numbers`)).sold);
  selected = new Set();
  currentPage = 1;
  $('#search').value = '';

  $('#raffleTitle').textContent = currentRaffle.title;
  $('#raffleInfo').textContent = `${currentRaffle.main_prize} | Precio por número: ${formatCop(currentRaffle.ticket_price)} | Mínimo: ${currentRaffle.min_purchase}`;
  updateTicker(currentRaffle);
  const sub = await api(`/api/raffles/${id}/subprizes`);
  $('#subprizes').innerHTML = sub.map(s => `<span class="chip">${s.name}: ${s.description}</span>`).join('');

  const image = currentRaffle.image_url || 'https://images.unsplash.com/photo-1550355291-bbee04a92027?auto=format&fit=crop&w=1200&q=80';
  $('#raffleImage').src = image;

  fillPackPrices();
  renderGrid();
  await renderWinners();
}

function selectRandom(qty) {
  const available = [];
  for (let i = 1; i <= Number(currentRaffle.total_numbers); i++) {
    const n = pad(i);
    if (!sold.has(n)) available.push(n);
  }
  selected = new Set();
  while (selected.size < qty && available.length) {
    const idx = Math.floor(Math.random() * available.length);
    selected.add(available[idx]);
    available.splice(idx, 1);
  }
  renderGrid();
}

function jumpToNumber() {
  const value = $('#jumpTo').value.trim();
  if (!value) return;
  $('#search').value = value;
  currentPage = 1;
  renderGrid();
}

function selectRange() {
  const from = Number($('#rangeFrom').value);
  const to = Number($('#rangeTo').value);
  if (!from || !to || to < from) return;
  for (let i = from; i <= to; i++) {
    const n = pad(i);
    if (!sold.has(n)) selected.add(n);
  }
  renderGrid();
}

async function downloadReceipt(orderId, customerDoc) {
  const res = await fetch(`/api/orders/${orderId}/receipt?document=${encodeURIComponent(customerDoc)}`);
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

function loadWompiScript() {
  return new Promise((resolve) => {
    if (window.WidgetCheckout) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://checkout.wompi.co/widget.js';
    s.onload = resolve;
    document.head.appendChild(s);
  });
}

function setMsg(el, text, type = 'success') {
  el.textContent = text;
  el.className = `msg-box msg-${type}`;
}

async function buy(e) {
  e.preventDefault();
  const msgEl = $('#msg');
  const btn = e.target.querySelector('button[type="submit"]');
  if (!selected.size) {
    setMsg(msgEl, '✗ Selecciona al menos un número antes de continuar', 'error');
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Procesando...';
  try {
    const customer = Object.fromEntries(new FormData(e.target).entries());
    const init = await api('/api/payments/init', {
      method: 'POST',
      body: JSON.stringify({ raffle_id: currentRaffle.id, numbers: [...selected], customer }),
    });

    if (init.mode === 'simulated') {
      // Modo desarrollo: sin Wompi configurado
      try { await downloadReceipt(init.order_id, customer.document); } catch (_) {}
      setMsg(msgEl, `✓ Compra exitosa. Orden #${init.order_id} — Comprobante descargado.`, 'success');
      await onRaffleChange();
      e.target.reset();
      return;
    }

    // Modo Wompi: abrir widget de pago
    await loadWompiScript();
    const checkout = new WidgetCheckout({
      currency: 'COP',
      amountInCents: init.amount_in_cents,
      reference: init.reference,
      publicKey: init.public_key,
      signature: { integrity: init.integrity },
      redirectUrl: window.location.href.split('?')[0],
      customerData: {
        email: customer.email,
        fullName: `${customer.first_name} ${customer.last_name}`,
        phoneNumber: customer.phone,
        phoneNumberPrefix: '+57',
        legalId: customer.document,
        legalIdType: 'CC',
      },
    });

    checkout.open(async function (result) {
      const { transaction } = result;
      if (transaction && transaction.status === 'APPROVED') {
        setMsg(msgEl, `✓ ¡Pago aprobado! Orden #${init.order_id} — Descargando comprobante...`, 'success');
        try { await downloadReceipt(init.order_id, customer.document); } catch (_) {}
        await onRaffleChange();
        e.target.reset();
      } else {
        const st = transaction?.status || 'CANCELADO';
        setMsg(msgEl, `✗ Pago no completado (${st}). Tus números quedaron liberados.`, 'error');
        await onRaffleChange();
      }
    });
  } catch (err) {
    setMsg(msgEl, `✗ ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirmar y pagar';
  }
}

async function lookup() {
  const key = $('#lookup').value.trim();
  if (!key) return;
  try {
    const out = await api(`/api/tickets/query?key=${encodeURIComponent(key)}`);
    if (!out.length) {
      $('#lookupOut').innerHTML = '<li><div class="empty-state"><span class="empty-icon">🎫</span><p>No encontramos ordenes con ese dato.</p></div></li>';
      return;
    }
    $('#lookupOut').innerHTML = out.map(o => {
      const nums = o.numbers.split(',');
      return `<li>
        <div class="order-item">
          <div class="order-item-header">
            <span class="order-id">Orden #${o.order_id}</span>
            <span class="order-count">${nums.length} ${nums.length === 1 ? 'numero' : 'numeros'}</span>
          </div>
          <div class="order-numbers">${o.numbers}</div>
        </div>
      </li>`;
    }).join('');
  } catch (err) {
    $('#lookupOut').innerHTML = `<li><span style="color:var(--danger-text)">${err.message}</span></li>`;
  }
}

async function renderWinners() {
  const winners = await api(`/api/raffles/${currentRaffle.id}/winners`);
  if (!winners.length) {
    $('#winners').innerHTML = '<div class="empty-state"><span class="empty-icon">🏆</span><p>Aun no hay ganadores publicados.</p></div>';
    return;
  }
  $('#winners').innerHTML = winners.map(w => `
    <div class="wcard">
      <span class="wcard-label">${w.label}</span>
      <span class="wcard-number">${w.winning_number}</span>
      <span class="wcard-owner">👤 ${w.owner}</span>
    </div>`).join('');
}

// Init sticky cart hidden
const _cart = $('#stickyCart');
_cart.style.transform = 'translateY(100%)';
_cart.style.opacity = '0';
_cart.style.transition = 'transform 0.3s cubic-bezier(.4,0,.2,1), opacity 0.3s ease';

$('#search').addEventListener('input', () => { currentPage = 1; renderGrid(); });
$('#prevPage').addEventListener('click', () => { currentPage--; renderGrid(); });
$('#nextPage').addEventListener('click', () => { currentPage++; renderGrid(); });
$('#jumpBtn').addEventListener('click', jumpToNumber);
$('#rangeBtn').addEventListener('click', selectRange);
$('#random10').addEventListener('click', () => selectRandom(10));

document.querySelectorAll('.pack').forEach(btn => btn.addEventListener('click', () => {
  const qty = Number(btn.dataset.q);
  selected = new Set();
  for (let i = 1; i <= Number(currentRaffle.total_numbers) && selected.size < qty; i++) {
    const n = pad(i);
    if (!sold.has(n)) selected.add(n);
  }
  renderGrid();
}));

$('#stickyCheckout').addEventListener('click', () => {
  document.querySelector('#checkout').scrollIntoView({behavior: 'smooth', block: 'start'});
});

$('#checkout').addEventListener('submit', buy);
$('#lookupBtn').addEventListener('click', lookup);

loadRaffles();
