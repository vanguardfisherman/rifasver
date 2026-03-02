const TOTAL_NUMBERS = 200;
const MIN_PURCHASE = 5;
const PRICE = 1000;

const pad = (n) => String(n).padStart(4, "0");
const soldKey = "rifa_sold_numbers";
const ordersKey = "rifa_orders";
const winnersKey = "rifa_winners";

const soldNumbers = new Set(JSON.parse(localStorage.getItem(soldKey) || "[]"));
const orders = JSON.parse(localStorage.getItem(ordersKey) || "[]");
const selected = new Set();

const grid = document.getElementById("numberGrid");
const selectionInfo = document.getElementById("selectionInfo");

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

function updateSelectionInfo() {
  const qty = selected.size;
  selectionInfo.textContent = `Seleccionados: ${qty} • Total: $${(qty * PRICE).toLocaleString("es-CO")}`;
}

function saveState() {
  localStorage.setItem(soldKey, JSON.stringify([...soldNumbers]));
  localStorage.setItem(ordersKey, JSON.stringify(orders));
}

function createSimplePdf(lines) {
  const content = lines.join("\\n").replace(/[()]/g, "");
  const stream = `BT /F1 12 Tf 50 760 Td (${content}) Tj ET`;
  const pdf = `%PDF-1.4\n1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>endobj\n4 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n5 0 obj<< /Length ${stream.length} >>stream\n${stream}\nendstream endobj\nxref\n0 6\n0000000000 65535 f \n0000000010 00000 n \n0000000060 00000 n \n0000000117 00000 n \n0000000243 00000 n \n0000000313 00000 n \ntrailer<< /Size 6 /Root 1 0 R >>\nstartxref\n${350 + stream.length}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}

document.getElementById("searchNumber").addEventListener("input", (e) => {
  renderGrid(e.target.value.trim());
});

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

document.getElementById("clearSelection").onclick = () => {
  selected.clear();
  renderGrid(document.getElementById("searchNumber").value.trim());
  updateSelectionInfo();
};

document.getElementById("checkoutForm").onsubmit = (e) => {
  e.preventDefault();
  const msg = document.getElementById("checkoutMsg");
  if (selected.size < MIN_PURCHASE) {
    msg.textContent = `Debes comprar mínimo ${MIN_PURCHASE} números.`;
    return;
  }
  const data = Object.fromEntries(new FormData(e.target).entries());
  const numbers = [...selected];
  numbers.forEach((n) => soldNumbers.add(n));
  const orderId = `ORD-${Date.now()}`;
  const order = { orderId, ...data, numbers, total: numbers.length * PRICE, createdAt: new Date().toISOString() };
  orders.push(order);
  saveState();

  const pdfBlob = createSimplePdf([
    "COMPROBANTE PLACEHOLDER RIFA",
    `Orden: ${orderId}`,
    `Fecha: ${new Date().toLocaleString("es-CO")}`,
    `Cliente: ${data.firstName} ${data.lastName}`,
    `Documento: ${data.document}`,
    `Numeros: ${numbers.join(",")}`,
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
  msg.textContent = `Pago simulado exitoso. Orden ${orderId}. PDF placeholder descargado.`;
  e.target.reset();
  renderWinners();
};

document.getElementById("lookupBtn").onclick = () => {
  const key = document.getElementById("lookup").value.trim().toLowerCase();
  const list = document.getElementById("lookupResults");
  list.innerHTML = "";
  const found = orders.filter((o) => o.email.toLowerCase() === key || String(o.document).toLowerCase() === key);
  if (!found.length) {
    list.innerHTML = "<li>No se encontraron entradas.</li>";
    return;
  }
  found.forEach((o) => {
    const li = document.createElement("li");
    li.textContent = `${o.orderId} • ${o.numbers.length} números • ${o.numbers.join(", ")}`;
    list.appendChild(li);
  });
};

function setWinners() {
  const main = document.getElementById("mainWinner").value.trim();
  const sub = document.getElementById("subWinner").value.trim();
  const winners = { main, sub };
  localStorage.setItem(winnersKey, JSON.stringify(winners));
  renderWinners();
}

document.getElementById("setWinners").onclick = setWinners;

function findOwner(number) {
  if (!number) return null;
  const order = orders.find((o) => o.numbers.includes(number));
  if (!order) return null;
  return `${order.firstName[0]}*** ${order.lastName[0]}*** • ${order.city || "N/D"}`;
}

function renderWinners() {
  const wrap = document.getElementById("winners");
  const winners = JSON.parse(localStorage.getItem(winnersKey) || "{}");
  wrap.innerHTML = "";
  [
    { label: "Premio principal", number: winners.main },
    { label: "Subpremio", number: winners.sub },
  ].forEach((w) => {
    const card = document.createElement("div");
    card.className = "winner-card";
    const owner = findOwner(w.number);
    card.innerHTML = `<h3>${w.label}</h3><p>Número: <strong>${w.number || "-"}</strong></p><p>Ganador: ${owner || "Sin asignar"}</p>`;
    wrap.appendChild(card);
  });
}

renderGrid();
updateSelectionInfo();
renderWinners();
