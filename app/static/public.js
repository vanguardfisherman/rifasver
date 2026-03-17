const $ = (s) => document.querySelector(s);

let raffles = [];
let currentRaffle = null;
let sold = new Set();
let quantity = 0;
let siteSettings = { whatsapp: '', email: '', ticker_items: [], winner_message: '', subwinner_message: '' };
const DEFAULT_WHATSAPP = '573224620502';

function showWinnerAlert(data) {
  // data can be: { milestone_award: {...}, winning_numbers: [...] }
  const milestone = data.milestone_award || null;
  const drawWinners = data.winning_numbers || [];
  if (!milestone && !drawWinners.length) return;

  const modal = $('#winnerModal');
  const body = $('#winnerModalBody');
  if (!modal || !body) return;

  let html = '';

  if (milestone) {
    html += `<p>¡Tu compra superó la meta del <strong>${milestone.milestone_pct}%</strong> de ventas y desbloqueaste un premio anticipado!</p>`;
    html += `<div class="win-item">
      <span class="win-item-icon">⭐</span>
      <div class="win-item-text">
        <div class="win-item-number">Número ${milestone.winning_number}</div>
        <div class="win-item-label">SUBGANADOR — ${milestone.label}</div>
      </div>
    </div>`;
  }

  if (drawWinners.length) {
    html += `<p>¡Compraste un número ganador del sorteo!</p>`;
    html += drawWinners.map(w => {
      const isMain = w.winner_type === 'main';
      const icon = isMain ? '🏆' : '🎁';
      const typeLabel = isMain ? 'GANADOR PRINCIPAL' : 'SUBGANADOR';
      return `<div class="win-item">
        <span class="win-item-icon">${icon}</span>
        <div class="win-item-text">
          <div class="win-item-number">Número ${w.number}</div>
          <div class="win-item-label">${typeLabel} — ${w.label}</div>
        </div>
      </div>`;
    }).join('');
  }

  body.innerHTML = html;
  modal.style.display = 'flex';

  const closeBtn = $('#winnerModalClose');
  const closeFn = () => {
    modal.style.display = 'none';
    closeBtn.removeEventListener('click', closeFn);
  };
  closeBtn.addEventListener('click', closeFn);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeFn();
  });
}

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
  const progressPercentBadge = $('#progressPercentBadge');

  if (progressBar) {
    progressBar.style.width = `${percent}%`;
    progressBar.setAttribute('aria-valuenow', String(percent));
  }

  if (progressTrack) progressTrack.classList.toggle('goal-reached', reachedGoal);
  if (progressMarker) progressMarker.style.left = `${requiredPct}%`;

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

const CART_SVG = '<svg class="pack-cart" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>';
const HAND_SVG = '<svg class="pack-hand" viewBox="0 0 24 24" fill="currentColor"><path d="M20 8.5a1.5 1.5 0 0 0-1.5-1.5H17V5.5A1.5 1.5 0 0 0 15.5 4h0A1.5 1.5 0 0 0 14 5.5V7h-1V3.5A1.5 1.5 0 0 0 11.5 2h0A1.5 1.5 0 0 0 10 3.5V7H9V5.5A1.5 1.5 0 0 0 7.5 4h0A1.5 1.5 0 0 0 6 5.5v7.17a3 3 0 0 0 .88 2.12l2.83 2.83A3 3 0 0 0 11.83 18.5H16a4 4 0 0 0 4-4z"/></svg>';

function renderPackButtons(packages) {
  const price = Number(currentRaffle.ticket_price || 0);
  const grid = $('#packGrid');
  grid.innerHTML = '';
  packages.forEach(pkg => {
    const qty = Number(pkg.quantity);
    const isPopular = pkg.is_popular;
    const total = formatCop(price * qty);
    const btn = document.createElement('button');
    btn.className = 'pack' + (isPopular ? ' popular' : '');
    btn.type = 'button';
    btn.dataset.q = qty;
    btn.innerHTML = `${CART_SVG}<span class="pack-text"><strong>${qty.toLocaleString('es-CO')}</strong> ENTRADAS <b>${total} COP</b></span>${isPopular ? '<label>MÁS POPULAR</label>' : ''}${HAND_SVG}`;
    btn.addEventListener('click', () => setQty(qty));
    grid.appendChild(btn);
  });
}

async function loadPackages() {
  try {
    const packages = await api(`/api/raffles/${currentRaffle.id}/packages`);
    if (packages.length) {
      renderPackButtons(packages);
    } else {
      // Fallback default packages
      const defaults = [
        {quantity: 100, is_popular: false},
        {quantity: 200, is_popular: true},
        {quantity: 400, is_popular: false},
        {quantity: 600, is_popular: false},
        {quantity: 800, is_popular: false},
        {quantity: 1000, is_popular: false},
      ];
      renderPackButtons(defaults);
    }
  } catch(_) {
    renderPackButtons([
      {quantity: 100, is_popular: false},
      {quantity: 200, is_popular: true},
      {quantity: 400, is_popular: false},
      {quantity: 600, is_popular: false},
      {quantity: 800, is_popular: false},
      {quantity: 1000, is_popular: false},
    ]);
  }
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
    api('/api/settings').catch(() => ({ whatsapp: '', email: '', ticker_items: [], winner_message: '', subwinner_message: '' })),
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
  $('#raffleTitle').textContent = currentRaffle.title;
  $('#raffleInfo').innerHTML = `<span class="info-badge prize-badge">${currentRaffle.main_prize}</span><span class="info-badge">${formatCop(currentRaffle.ticket_price)} / tiquete</span><span class="info-badge">Mín: ${currentRaffle.min_purchase}</span>`;
  const raffleInfo = `⭐ Premio: ${currentRaffle.main_prize} — Precio por tiquete: ${formatCop(currentRaffle.ticket_price)} — Mínimo: ${currentRaffle.min_purchase} tiquetes`;
  renderTicker(raffleInfo);

  const sub = await api(`/api/raffles/${id}/subprizes`);
  $('#subprizes').innerHTML = sub.map(s => `<span class="chip">${s.name}: ${s.description}</span>`).join('');

  const image = currentRaffle.image_url || 'https://images.unsplash.com/photo-1550355291-bbee04a92027?auto=format&fit=crop&w=1200&q=80';
  $('#raffleImage').src = image;

  await loadPackages();
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
      showWinnerAlert({ milestone_award: init.milestone_award, winning_numbers: init.winning_numbers });
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
          showWinnerAlert({ milestone_award: statusInfo.milestone_award, winning_numbers: statusInfo.winning_numbers });
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

function getWinnerBadgeClass(type) {
  if (type === 'main') return 'wcard-badge-main';
  if (type === 'milestone') return 'wcard-badge-milestone';
  return 'wcard-badge-sub';
}

function getWinnerBadgeText(type) {
  if (type === 'main') return 'GANADOR';
  if (type === 'milestone') return 'ANTICIPADO';
  return 'GANADOR';
}

function getWinnerGift(type) {
  if (type === 'main') return '🎁';
  if (type === 'milestone') return '⭐';
  return '🎁';
}

async function renderWinners() {
  const winners = await api(`/api/raffles/${currentRaffle.id}/winners`);
  if (!winners.length) {
    $('#winners').innerHTML = '<div class="empty-state"><span class="empty-icon">🏆</span><p>Aun no hay ganadores publicados.</p></div>';
    return;
  }

  const mainMsg = siteSettings.winner_message || '';
  const subMsg = siteSettings.subwinner_message || '';

  $('#winners').innerHTML = winners.map(w => {
    const isMain = w.winner_type === 'main';
    const badgeClass = getWinnerBadgeClass(w.winner_type);
    const badgeText = getWinnerBadgeText(w.winner_type);
    const gift = getWinnerGift(w.winner_type);
    const announcementMsg = isMain ? mainMsg : subMsg;
    const prizeText = w.label || (isMain ? 'Premio principal' : 'Subpremio');

    return `<div class="wcard${isMain ? ' wcard-main' : ''}">
      <div class="wcard-visual">
        <span class="wcard-badge ${badgeClass}">
          ${badgeText} <span class="wcard-badge-number">${w.winning_number}</span>
        </span>
        <span class="wcard-gift">${gift}</span>
      </div>
      <div class="wcard-info">
        <span class="wcard-prize">${prizeText}</span>
        <span class="wcard-label">🎉 ${badgeText}</span>
        <span class="wcard-owner">${w.owner}</span>
        ${announcementMsg ? `<span style="font-size:11px;color:var(--text-muted);margin-top:4px;font-style:italic;">${announcementMsg}</span>` : ''}
      </div>
    </div>`;
  }).join('');
}

// Init sticky cart hidden
const _cart = $('#stickyCart');
_cart.style.transform = 'translateY(100%)';
_cart.style.opacity = '0';
_cart.style.transition = 'transform 0.3s cubic-bezier(.4,0,.2,1), opacity 0.3s ease';

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
