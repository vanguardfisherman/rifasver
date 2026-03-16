const $ = (s) => document.querySelector(s);

let raffles = [];
let currentRaffle = null;
let sold = new Set();
let quantity = 0;
let siteSettings = { whatsapp: '', email: '', ticker_items: [] };
const DEFAULT_WHATSAPP = '573224620502';

async function api(path, options = {}) {
  const res = await fetch(path, {headers: {'Content-Type': 'application/json'}, ...options});
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error');
  return data;
}

function formatCop(value) {
  return `$ ${Number(value).toLocaleString('es-CO')}`;
}

function getRequiredSalesPct() {
  const parsed = Number(currentRaffle?.required_sales_pct);
  if (Number.isFinite(parsed)) return Math.max(1, Math.min(100, Math.round(parsed)));
  return 70;
}

function renderProgress() {
  const total = Number(currentRaffle.total_numbers);
  const soldCount = sold.size;
  const available = total - soldCount;
  const percent = total > 0 ? Math.round((soldCount / total) * 100) : 0;
  const requiredPct = getRequiredSalesPct();
  const reachedGoal = percent >= requiredPct;

  const progressBar = $('#progressBar');
  const progressTrack = document.querySelector('.progress-track');
  const progressMarker = $('#progressGoalMarker');
  const progressText = $('#progressText');
  const progressGoalText = $('#progressGoalText');
  const progressPercentBadge = $('#progressPercentBadge');

  if (progressBar) {
    progressBar.style.width = `${percent}%`;
    progressBar.setAttribute('aria-valuenow', String(percent));
  }

  if (progressTrack) progressTrack.classList.toggle('goal-reached', reachedGoal);
  if (progressMarker) progressMarker.style.left = `${requiredPct}%`;

  if (progressText) {
    progressText.textContent = `${soldCount.toLocaleString('es-CO')} vendidos de ${total.toLocaleString('es-CO')} - ${available.toLocaleString('es-CO')} disponibles`;
  }

  if (progressGoalText) {
    progressGoalText.textContent = reachedGoal
      ? `Meta del ${requiredPct}% alcanzada. Ya puedes iniciar el sorteo.`
      : `Meta para iniciar sorteo: ${requiredPct}% de ventas.`;
  }

  if (progressPercentBadge) {
    progressPercentBadge.textContent = `${percent}%`;
    progressPercentBadge.classList.toggle('goal-met', reachedGoal);
    progressPercentBadge.classList.toggle('goal-pending', !reachedGoal);
  }
}

function syncSticky() {
  const total = quantity * Number(currentRaffle.ticket_price || 0);
  $('#stickyInfo').textContent = `${quantity} tiquete${quantity !== 1 ? 's' : ''} • ${formatCop(total)}`;
  const cart = $('#stickyCart');
  if (quantity > 0) {
    cart.style.transform = 'translateY(0)';
    cart.style.opacity = '1';
  } else {
    cart.style.transform = 'translateY(100%)';
    cart.style.opacity = '0';
  }
}

function updateSelInfo() {
  const total = quantity * Number(currentRaffle.ticket_price || 0);
  if (quantity > 0) {
    $('#selInfo').textContent = `${quantity} tiquete${quantity !== 1 ? 's' : ''} • Total: ${formatCop(total)}`;
  } else {
    $('#selInfo').textContent = '';
  }
  syncSticky();
}

function setQty(n) {
  const available = Number(currentRaffle.total_numbers) - sold.size;
  quantity = Math.max(0, Math.min(n, available));
  $('#qtyInput').value = quantity;
  updateSelInfo();
}

function fillPackPrices() {
  const price = Number(currentRaffle.ticket_price || 0);
  $('#pack2').textContent = formatCop(price * 2);
  $('#pack5').textContent = formatCop(price * 5);
  $('#pack10').textContent = formatCop(price * 10);
  $('#pack100').textContent = formatCop(price * 100);
}

function renderTicker(raffleInfoText) {
  const items = [...siteSettings.ticker_items];
  if (raffleInfoText) items.push(raffleInfoText);
  if (!items.length) return;
  const sep = '<span class="ticker-sep">✦</span>';
  const makeItem = (t) => `<span class="ticker-item">${t}</span>${sep}`;
  const half = items.map(makeItem).join('');
  $('#tickerTrack').innerHTML = half + half; // duplicate for infinite loop
}

function applyContactSettings() {
  const waDigits = (siteSettings.whatsapp || DEFAULT_WHATSAPP).replace(/\D/g, '');
  const wa = waDigits ? `https://wa.me/${waDigits}` : `https://wa.me/${DEFAULT_WHATSAPP}`;
  const email = siteSettings.email || 'soporte@tuempresa.com';
  const emailHref = `mailto:${email}`;

  ['#contactWhatsapp', '#floatingWhatsapp'].forEach(sel => {
    const el = $(sel);
    if (el) el.href = wa;
  });
  const emailLink = $('#contactEmailLink');
  if (emailLink) emailLink.href = emailHref;
  const emailText = $('#contactEmailText');
  if (emailText) emailText.textContent = email;
}

async function loadRaffles() {
  [raffles, siteSettings] = await Promise.all([
    api('/api/raffles'),
    api('/api/settings').catch(() => ({ whatsapp: '', email: '', ticker_items: [] })),
  ]);
  applyContactSettings();
  if (raffles.length) {
    currentRaffle = raffles[0];
    await onRaffleChange();
  }
}

async function onRaffleChange() {
  const id = currentRaffle.id;
  sold = new Set((await api(`/api/raffles/${id}/numbers`)).sold);
  quantity = 0;
  const milestonesText = (currentRaffle.sales_milestones || '20,40,60,80')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => `${item}%`)
    .join(' / ');
  $('#raffleTitle').textContent = currentRaffle.title;
  $('#raffleInfo').textContent = `${currentRaffle.main_prize} | Precio por tiquete: ${formatCop(currentRaffle.ticket_price)} | Minimo: ${currentRaffle.min_purchase} | Anticipos: ${milestonesText}`;
  const raffleInfo = `⭐ Premio: ${currentRaffle.main_prize} — Precio por tiquete: ${formatCop(currentRaffle.ticket_price)} — Mínimo: ${currentRaffle.min_purchase} tiquetes`;
  renderTicker(raffleInfo);

  const sub = await api(`/api/raffles/${id}/subprizes`);
  $('#subprizes').innerHTML = sub.map(s => `<span class="chip">${s.name}: ${s.description}</span>`).join('');

  const image = currentRaffle.image_url || 'https://images.unsplash.com/photo-1550355291-bbee04a92027?auto=format&fit=crop&w=1200&q=80';
  $('#raffleImage').src = image;

  fillPackPrices();
  renderProgress();
  $('#qtyInput').value = 0;
  updateSelInfo();
  await renderWinners();
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
  if (!quantity) {
    setMsg(msgEl, '✗ Selecciona al menos un tiquete antes de continuar', 'error');
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Procesando...';
  try {
    const customer = Object.fromEntries(new FormData(e.target).entries());
    const init = await api('/api/payments/init', {
      method: 'POST',
      body: JSON.stringify({ raffle_id: currentRaffle.id, quantity, customer }),
    });

    if (init.mode === 'simulated') {
      try { await downloadReceipt(init.order_id, customer.document); } catch (_) {}
      const numsStr = init.numbers ? ` Numeros asignados: ${init.numbers.join(', ')}` : '';
      const milestoneStr = init.milestone_award
        ? ` Premio anticipado desbloqueado (${init.milestone_award.milestone_pct}%): numero ganador ${init.milestone_award.winning_number}.`
        : '';
      setMsg(msgEl, `Compra exitosa. Orden #${init.order_id}. Comprobante descargado.${numsStr}${milestoneStr}`, 'success');
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
        let milestoneStr = '';
        try {
          const statusInfo = await api(`/api/orders/${init.order_id}/status?document=${encodeURIComponent(customer.document)}`);
          if (statusInfo.milestone_award) {
            milestoneStr = ` Premio anticipado desbloqueado (${statusInfo.milestone_award.milestone_pct}%): numero ganador ${statusInfo.milestone_award.winning_number}.`;
          }
        } catch (_) {}
        setMsg(msgEl, `Pago aprobado. Orden #${init.order_id}.${milestoneStr}`, 'success');
        try { await downloadReceipt(init.order_id, customer.document); } catch (_) {}
        await onRaffleChange();
        e.target.reset();
      } else {
        const st = transaction?.status || 'CANCELADO';
        setMsg(msgEl, `✗ Pago no completado (${st}). Tus tiquetes quedaron liberados.`, 'error');
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
            <span class="order-count">${nums.length} ${nums.length === 1 ? 'tiquete' : 'tiquetes'}</span>
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

// Pack buttons — set quantity
document.querySelectorAll('.pack').forEach(btn => btn.addEventListener('click', () => {
  setQty(Number(btn.dataset.q));
}));

// Quantity controls
$('#qtyMinus').addEventListener('click', () => setQty(quantity - 1));
$('#qtyPlus').addEventListener('click', () => setQty(quantity + 1));
$('#qtyInput').addEventListener('change', () => setQty(Number($('#qtyInput').value)));
$('#qtyInput').addEventListener('input', () => setQty(Number($('#qtyInput').value)));

$('#stickyCheckout').addEventListener('click', () => {
  document.querySelector('#checkout').scrollIntoView({behavior: 'smooth', block: 'start'});
});

$('#checkout').addEventListener('submit', buy);
$('#lookupBtn').addEventListener('click', lookup);

loadRaffles();
