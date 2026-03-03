const TOTAL_NUMBERS = 200;
const MIN_PURCHASE = 5;
const PRICE = 1000;
// Fecha del sorteo: cambia esto según necesites
const RAFFLE_DATE = new Date("2025-12-31T20:00:00");

const pad = (n) => String(n).padStart(4, "0");
const soldKey = "rifa_sold_numbers";
const ordersKey = "rifa_orders";
const winnersKey = "rifa_winners";

const soldNumbers = new Set(JSON.parse(localStorage.getItem(soldKey) || "[]"));
const orders = JSON.parse(localStorage.getItem(ordersKey) || "[]");
const selected = new Set();

const grid = document.getElementById("numberGrid");

// ── COUNTDOWN ──
function updateCountdown() {
  const now = new Date();
  const diff = RAFFLE_DATE - now;
  if (diff <= 0) {
    ["cd-days","cd-hours","cd-mins","cd-secs"].forEach(id => document.getElementById(id).textContent = "00");
    return;
  }
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  document.getElementById("cd-days").textContent  = String(d).padStart(2,"0");
  document.getElementById("cd-hours").textContent = String(h).padStart(2,"0");
  document.getElementById("cd-mins").textContent  = String(m).padStart(2,"0");
  document.getElementById("cd-secs").textContent  = String(s).padStart(2,"0");
}
updateCountdown();
setInterval(updateCountdown, 1000);

// ── PROGRESO ──
function updateProgress() {
  const sold = soldNumbers.size;
  const pct = Math.round((sold / TOTAL_NUMBERS) * 100);
  document.getElementById("prog-text").textContent = `${sold} / ${TOTAL_NUMBERS}`;
  document.getElementById("prog-fill").style.width = pct + "%";
  document.getElementById("prog-pct").textContent = `${pct}% completado`;
}
updateProgress();

// ── GRID ──
function renderGrid(filter = "") {
  grid.innerHTML = "";
  for (let i = 1; i <= TOTAL_NUMBERS; i++) {
    const n = pad(i);
    if (filter && !n.includes(filter)) continue;
    const btn = document.createElement("button");
    btn.className = "num";
    btn.textContent = n;
    if (soldNumbers.has(n)) btn.classList.add("sold");
    if (selected.has(n)) btn.classList.add("selected");
    btn.disabled = soldNumbers.has(n);
    btn.onclick = () => {
      if (selected.has(n)) selected.delete(n);
      else selected.add(n);
      renderGrid(document.getElementById("searchNumber").value.trim());
      updateSelectionInfo();
    };
    grid.appendChild(btn);
  }
}

// ── SELECTION INFO ──
function updateSelectionInfo() {
  const qty = selected.size;
  const total = qty * PRICE;
  const fmt = (v) => v.toLocaleString("es-CO");

  document.getElementById("selCount").textContent = `${qty} número${qty !== 1 ? "s" : ""} seleccionado${qty !== 1 ? "s" : ""}`;
  document.getElementById("selTotal").textContent = `$${fmt(total)} COP`;

  const summary = document.getElementById("checkoutSummary");
  if (qty === 0) {
    summary.textContent = "Selecciona números arriba para ver el total.";
  } else {
    summary.innerHTML = `
      <strong>Números seleccionados (${qty}):</strong><br>
      <span style="color:#aabce0">${[...selected].join(", ")}</span><br><br>
      <strong>Total a pagar: <span style="color:var(--gold)">$${fmt(total)} COP</span></strong>
    `;
  }
}

// ── PERSISTENCIA ──
function saveState() {
  localStorage.setItem(soldKey, JSON.stringify([...soldNumbers]));
  localStorage.setItem(ordersKey, JSON.stringify(orders));
}

// ── PDF ──
function createSimplePdf(lines) {
  const content = lines.join("\\n").replace(/[()]/g, "");
  const stream = `BT /F1 12 Tf 50 760 Td (${content}) Tj ET`;
  const pdf = `%PDF-1.4\n1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>endobj\n4 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n5 0 obj<< /Length ${stream.length} >>stream\n${stream}\nendstream endobj\nxref\n0 6\n0000000000 65535 f \n0000000010 00000 n \n0000000060 00000 n \n0000000117 00000 n \n0000000243 00000 n \n0000000313 00000 n \ntrailer<< /Size 6 /Root 1 0 R >>\nstartxref\n${350 + stream.length}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}

// ── SEARCH ──
document.getElementById("searchNumber").addEventListener("input", (e) => {
  renderGrid(e.target.value.trim());
});

// ── QUICK SELECT ──
document.querySelectorAll(".quick").forEach((btn) => {
  btn.addEventListener("click", () => {
    const qty = Number(btn.dataset.quick);
    selected.clear();
    for (let i = 1; i <= TOTAL_NUMBERS && selected.size < qty; i++) {
      const n = pad(i);
      if (!soldNumbers.has(n)) selected.add(n);
    }
    renderGrid(document.getElementById("searchNumber").value.trim());
    updateSelectionInfo();
  });
});

// ── LIMPIAR ──
document.getElementById("clearSelection").onclick = () => {
  selected.clear();
  renderGrid(document.getElementById("searchNumber").value.trim());
  updateSelectionInfo();
};

// ── CHECKOUT ──
document.getElementById("checkoutForm").onsubmit = (e) => {
  e.preventDefault();
  const msg = document.getElementById("checkoutMsg");
  if (selected.size < MIN_PURCHASE) {
    msg.style.color = "var(--red)";
    msg.textContent = `⚠️ Debes comprar mínimo ${MIN_PURCHASE} números.`;
    return;
  }
  const data = Object.fromEntries(new FormData(e.target).entries());
  const numbers = [...selected];
  numbers.forEach((n) => soldNumbers.add(n));
  const orderId = `ORD-${Date.now()}`;
  const order = { orderId, ...data, numbers, total: numbers.length * PRICE, createdAt: new Date().toISOString() };
  orders.push(order);
  saveState();
  updateProgress();

  const pdfBlob = createSimplePdf([
    "COMPROBANTE RIFA ONLINE",
    `Orden: ${orderId}`,
    `Fecha: ${new Date().toLocaleString("es-CO")}`,
    `Cliente: ${data.firstName} ${data.lastName}`,
    `Documento: ${data.document}`,
    `Ciudad: ${data.city || "N/D"}`,
    `Numeros: ${numbers.join(",")}`,
    `Total: $${(numbers.length * PRICE).toLocaleString("es-CO")} COP`,
  ]);
  const url = URL.createObjectURL(pdfBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${orderId}.pdf`;
  a.click();
  URL.revokeObjectURL(url);

  selected.clear();
  renderGrid(document.getElementById("searchNumber").value.trim());
  updateSelectionInfo();
  msg.style.color = "var(--green)";
  msg.textContent = `✅ ¡Pago registrado! Orden ${orderId}. Se descargó tu comprobante PDF.`;
  e.target.reset();
  renderWinners();
};

// ── LOOKUP ──
document.getElementById("lookupBtn").onclick = () => {
  const key = document.getElementById("lookup").value.trim().toLowerCase();
  const list = document.getElementById("lookupResults");
  list.innerHTML = "";
  const found = orders.filter((o) => o.email.toLowerCase() === key || String(o.document).toLowerCase() === key);
  if (!found.length) {
    list.innerHTML = "<li>No se encontraron entradas con esos datos.</li>";
    return;
  }
  found.forEach((o) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <strong>${o.orderId}</strong> · ${o.numbers.length} números ·
      <span style="color:var(--gold)">$${o.total.toLocaleString("es-CO")} COP</span><br>
      <span style="color:var(--muted)">${o.numbers.join(", ")}</span>
    `;
    list.appendChild(li);
  });
};

// ── WINNERS ──
document.getElementById("setWinners").onclick = () => {
  const main = document.getElementById("mainWinner").value.trim();
  const sub = document.getElementById("subWinner").value.trim();
  localStorage.setItem(winnersKey, JSON.stringify({ main, sub }));
  renderWinners();
};

function findOwner(number) {
  if (!number) return null;
  const order = orders.find((o) => o.numbers.includes(number));
  if (!order) return null;
  return `${order.firstName[0]}*** ${order.lastName[0]}*** · ${order.city || "N/D"}`;
}

function renderWinners() {
  const wrap = document.getElementById("winners");
  const winners = JSON.parse(localStorage.getItem(winnersKey) || "{}");
  wrap.innerHTML = "";
  [
    { label: "🥇 Premio principal", number: winners.main },
    { label: "🥈 Subpremio", number: winners.sub },
  ].forEach((w) => {
    const card = document.createElement("div");
    card.className = "winner-card";
    const owner = findOwner(w.number);
    card.innerHTML = `
      <h3>${w.label}</h3>
      <p>Número: <strong>${w.number || "-"}</strong></p>
      <p>Ganador: ${owner || "<span style='color:#555'>Sin asignar</span>"}</p>
    `;
    wrap.appendChild(card);
  });
}

// ── INIT ──
renderGrid();
updateSelectionInfo();
renderWinners();
