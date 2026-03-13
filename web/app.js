const API_BASE = (
  document.querySelector('meta[name="api-base"]')?.getAttribute("content")
  || window.RIFAS_API_BASE
  || ""
).trim().replace(/\/$/, "");

const soldKey = "rifa_sold_numbers";
const ordersKey = "rifa_orders";
const winnersKey = "rifa_winners";

const grid = document.getElementById("numberGrid");
const searchInput = document.getElementById("searchNumber");
const clearSelectionBtn = document.getElementById("clearSelection");
const checkoutForm = document.getElementById("checkoutForm");
const checkoutMsg = document.getElementById("checkoutMsg");
const lookupInput = document.getElementById("lookup");
const lookupBtn = document.getElementById("lookupBtn");
const lookupResults = document.getElementById("lookupResults");
const winnersWrap = document.getElementById("winners");
const goCheckoutBtn = document.getElementById("goCheckout");
const adminCard = document.getElementById("adminCard");
const setWinnersBtn = document.getElementById("setWinners");
const mainWinnerInput = document.getElementById("mainWinner");
const subWinnerInput = document.getElementById("subWinner");
const prizeAmount = document.getElementById("prizeAmount");
const prizeSub = document.getElementById("prizeSub");

let currentRaffle = null;
let soldNumbers = new Set();
const selected = new Set();
let adminToken = sessionStorage.getItem("rifa_admin_token") || "";

const RAFFLE_DATE = getRaffleDate();

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const response = await fetch(apiUrl(path), {
    method: options.method || "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const contentType = response.headers.get("content-type") || "";
  let data = null;

  if (contentType.includes("application/json")) {
    data = await response.json();
  } else {
    const text = await response.text();
    data = text ? { error: text } : {};
  }

  if (!response.ok) {
    const err = new Error(data?.error || `Error HTTP ${response.status}`);
    err.status = response.status;
    err.payload = data;
    throw err;
  }

  return data;
}

function setCheckoutMessage(text, type = "success") {
  if (!checkoutMsg) return;
  checkoutMsg.textContent = text;
  checkoutMsg.style.color = type === "error" ? "var(--red)" : "var(--green)";
}

function clearLegacyLocalState() {
  [soldKey, ordersKey, winnersKey].forEach((key) => localStorage.removeItem(key));
}

function padNumber(n) {
  return String(n).padStart(4, "0");
}

function toDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeWinner(value) {
  const digits = toDigits(value).slice(-4);
  if (!digits) return "";
  return padNumber(digits);
}

function formatMoney(value) {
  return value.toLocaleString("es-CO");
}

function getConfiguredRaffleDate() {
  const configured = document.querySelector('meta[name="raffle-date"]')?.getAttribute("content")?.trim();
  if (!configured) return null;
  const parsed = new Date(configured);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getFallbackRaffleDate() {
  const fallback = new Date();
  fallback.setDate(fallback.getDate() + 15);
  fallback.setHours(20, 0, 0, 0);
  return fallback;
}

function getRaffleDate() {
  const configured = getConfiguredRaffleDate();
  if (configured && configured > new Date()) return configured;
  return getFallbackRaffleDate();
}

function updateCountdown() {
  const diff = RAFFLE_DATE - new Date();
  if (diff <= 0) {
    ["cd-days", "cd-hours", "cd-mins", "cd-secs"].forEach((id) => {
      const node = document.getElementById(id);
      if (node) node.textContent = "00";
    });
    return;
  }

  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);

  document.getElementById("cd-days").textContent = String(d).padStart(2, "0");
  document.getElementById("cd-hours").textContent = String(h).padStart(2, "0");
  document.getElementById("cd-mins").textContent = String(m).padStart(2, "0");
  document.getElementById("cd-secs").textContent = String(s).padStart(2, "0");
}

function updateProgress() {
  if (!currentRaffle) return;
  const total = Number(currentRaffle.total_numbers || 0);
  const sold = soldNumbers.size;
  const pct = total > 0 ? Math.round((sold / total) * 100) : 0;

  document.getElementById("prog-text").textContent = `${sold} / ${total}`;
  document.getElementById("prog-fill").style.width = `${pct}%`;
  document.getElementById("prog-pct").textContent = `${pct}% completado`;
}

function updateHeaderFromRaffle() {
  if (!currentRaffle) return;

  if (prizeAmount) {
    const raw = String(currentRaffle.main_prize || "");
    const amountOnly = raw.replace(/\s*COP\s*/i, "").trim();
    prizeAmount.textContent = amountOnly || `$${formatMoney(Number(currentRaffle.ticket_price || 0) * 100)}`;
  }

  if (prizeSub) {
    prizeSub.textContent = "COP";
  }
}

function renderGrid(filter = "") {
  if (!grid || !currentRaffle) return;
  const normalizedFilter = toDigits(filter).slice(0, 4);
  const total = Number(currentRaffle.total_numbers || 0);
  grid.replaceChildren();

  for (let i = 1; i <= total; i += 1) {
    const n = padNumber(i);
    if (normalizedFilter && !n.includes(normalizedFilter)) continue;

    const btn = document.createElement("button");
    btn.className = "num";
    btn.type = "button";
    btn.textContent = n;

    if (soldNumbers.has(n)) {
      btn.classList.add("sold");
      btn.disabled = true;
    }

    if (selected.has(n)) btn.classList.add("selected");

    btn.addEventListener("click", () => {
      if (selected.has(n)) selected.delete(n);
      else selected.add(n);

      renderGrid(searchInput?.value.trim() || "");
      updateSelectionInfo();
    });

    grid.appendChild(btn);
  }
}

function updateSelectionInfo() {
  const qty = selected.size;
  const unitPrice = Number(currentRaffle?.ticket_price || 0);
  const total = qty * unitPrice;

  document.getElementById("selCount").textContent = `${qty} numero${qty !== 1 ? "s" : ""} seleccionado${qty !== 1 ? "s" : ""}`;
  document.getElementById("selTotal").textContent = `$${formatMoney(total)} COP`;

  const summary = document.getElementById("checkoutSummary");
  if (!summary) return;

  if (qty === 0) {
    summary.textContent = "Selecciona numeros arriba para ver el total.";
    return;
  }

  const title = document.createElement("strong");
  title.textContent = `Numeros seleccionados (${qty}):`;

  const numbersLine = document.createElement("p");
  numbersLine.className = "summary-numbers";
  numbersLine.textContent = [...selected].join(", ");

  const totalLine = document.createElement("strong");
  totalLine.textContent = "Total a pagar: ";

  const totalValue = document.createElement("span");
  totalValue.className = "summary-total";
  totalValue.textContent = `$${formatMoney(total)} COP`;

  totalLine.appendChild(totalValue);
  summary.replaceChildren(title, numbersLine, totalLine);
}

async function fetchRaffles() {
  const raffles = await request("/api/raffles");
  if (!Array.isArray(raffles) || !raffles.length) {
    throw new Error("No hay rifas disponibles en el backend.");
  }

  currentRaffle = raffles.find((item) => item.status === "active") || raffles[0];
  updateHeaderFromRaffle();
}

async function fetchSoldNumbers() {
  if (!currentRaffle) return;
  const out = await request(`/api/raffles/${currentRaffle.id}/numbers`);
  soldNumbers = new Set(Array.isArray(out.sold) ? out.sold : []);
}

function isWinnerNumberValid(number) {
  if (!number) return true;
  const value = Number(number);
  return value >= 1 && value <= Number(currentRaffle.total_numbers || 0);
}

async function ensureAdminToken() {
  if (adminToken) return adminToken;

  const username = window.prompt("Usuario admin:");
  if (!username) return "";
  const password = window.prompt("Clave admin:");
  if (!password) return "";

  const out = await request("/api/admin/login", {
    method: "POST",
    body: { username, password },
  });

  adminToken = out.token || "";
  if (adminToken) sessionStorage.setItem("rifa_admin_token", adminToken);
  return adminToken;
}

async function publishWinners() {
  if (!currentRaffle) return;

  const main = normalizeWinner(mainWinnerInput?.value || "");
  const sub = normalizeWinner(subWinnerInput?.value || "");

  if (!main && !sub) {
    setCheckoutMessage("Ingresa al menos un numero ganador para publicar.", "error");
    return;
  }

  if (!isWinnerNumberValid(main) || !isWinnerNumberValid(sub)) {
    setCheckoutMessage("Hay numeros ganadores fuera del rango de la rifa.", "error");
    return;
  }

  try {
    const token = await ensureAdminToken();
    if (!token) {
      setCheckoutMessage("Inicio de sesion admin cancelado.", "error");
      return;
    }

    const results = [];
    if (main) {
      results.push({ winner_type: "main", label: "Premio principal", winning_number: main });
    }
    if (sub) {
      results.push({ winner_type: "subprize", label: "Subpremio", winning_number: sub });
    }

    await request(`/api/admin/raffles/${currentRaffle.id}/draw-results`, {
      method: "POST",
      body: { results },
      token,
    });

    await renderWinners();
    setCheckoutMessage("Ganadores publicados correctamente.", "success");
  } catch (error) {
    if (error.status === 401) {
      adminToken = "";
      sessionStorage.removeItem("rifa_admin_token");
    }
    setCheckoutMessage(error.message || "No se pudo publicar ganadores.", "error");
  }
}

async function downloadReceipt(orderId, customerDocument) {
  const response = await fetch(apiUrl(`/api/orders/${orderId}/receipt?document=${encodeURIComponent(customerDocument)}`));
  if (!response.ok) {
    let errText = "No se pudo descargar el comprobante";
    try {
      const payload = await response.json();
      errText = payload.error || errText;
    } catch {
      // no-op
    }
    throw new Error(errText);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = `orden-${orderId}.pdf`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

async function submitCheckout(event) {
  event.preventDefault();
  if (!currentRaffle || !checkoutForm) return;

  const minPurchase = Number(currentRaffle.min_purchase || 1);
  if (selected.size < minPurchase) {
    setCheckoutMessage(`Debes comprar minimo ${minPurchase} numeros.`, "error");
    return;
  }

  const formData = new FormData(checkoutForm);
  const customer = {
    document: String(formData.get("document") || "").trim(),
    first_name: String(formData.get("firstName") || "").trim(),
    last_name: String(formData.get("lastName") || "").trim(),
    email: String(formData.get("email") || "").trim(),
    phone: String(formData.get("phone") || "").trim(),
    city: String(formData.get("city") || "").trim(),
  };

  const submitBtn = checkoutForm.querySelector('button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Procesando...";
  }

  try {
    const out = await request("/api/orders", {
      method: "POST",
      body: {
        raffle_id: currentRaffle.id,
        numbers: [...selected],
        customer,
      },
    });

    try {
      await downloadReceipt(out.order_id, customer.document);
    } catch {
      // receipt download failure should not rollback a successful order
    }

    selected.clear();
    await fetchSoldNumbers();
    updateProgress();
    renderGrid(searchInput?.value.trim() || "");
    updateSelectionInfo();
    await renderWinners();
    checkoutForm.reset();

    setCheckoutMessage(`Pago registrado. Orden ${out.order_id} completada.`, "success");
  } catch (error) {
    if (error.status === 409) {
      await fetchSoldNumbers();
      renderGrid(searchInput?.value.trim() || "");
      updateProgress();
      setCheckoutMessage("Algunos numeros ya fueron vendidos. Actualizamos la grilla para que elijas otros.", "error");
    } else {
      setCheckoutMessage(error.message || "No fue posible completar la compra.", "error");
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "ðŸ’³ PAGAR AHORA";
    }
  }
}

async function runLookup() {
  if (!lookupInput || !lookupResults) return;

  const key = lookupInput.value.trim();
  if (!key) {
    lookupResults.replaceChildren();
    return;
  }

  lookupResults.replaceChildren();

  try {
    const out = await request(`/api/tickets/query?key=${encodeURIComponent(key)}`);

    if (!Array.isArray(out) || !out.length) {
      const empty = document.createElement("li");
      empty.textContent = "No se encontraron entradas con esos datos.";
      lookupResults.appendChild(empty);
      return;
    }

    out.forEach((order) => {
      const li = document.createElement("li");

      const numbers = String(order.numbers || "").split(",").filter(Boolean);
      const top = document.createElement("p");
      top.className = "lookup-top";
      top.textContent = `Orden #${order.order_id} Â· ${numbers.length} numero${numbers.length !== 1 ? "s" : ""} Â· `;

      const amount = document.createElement("span");
      amount.className = "lookup-amount";
      amount.textContent = `$${formatMoney(Number(order.total || 0))} COP`;
      top.appendChild(amount);

      const numbersLine = document.createElement("p");
      numbersLine.className = "lookup-numbers";
      numbersLine.textContent = numbers.join(", ");

      li.append(top, numbersLine);
      lookupResults.appendChild(li);
    });
  } catch (error) {
    const errItem = document.createElement("li");
    errItem.textContent = error.message || "No se pudo consultar entradas.";
    lookupResults.appendChild(errItem);
  }
}

function buildWinnerCard(title, number, owner) {
  const card = document.createElement("div");
  card.className = "winner-card";

  const heading = document.createElement("h3");
  heading.textContent = title;

  const numberLine = document.createElement("p");
  numberLine.textContent = `Numero: ${number || "-"}`;

  const ownerLine = document.createElement("p");
  ownerLine.textContent = `Ganador: ${owner || "Sin asignar"}`;

  card.append(heading, numberLine, ownerLine);
  return card;
}

async function renderWinners() {
  if (!winnersWrap || !currentRaffle) return;

  try {
    const out = await request(`/api/raffles/${currentRaffle.id}/winners`);

    if (!Array.isArray(out) || !out.length) {
      winnersWrap.replaceChildren(
        buildWinnerCard("Premio principal", "", "Sin asignar"),
        buildWinnerCard("Subpremio", "", "Sin asignar"),
      );
      return;
    }

    const cards = out.map((winner) => {
      const title = winner.label || "Premio";
      return buildWinnerCard(title, winner.winning_number, winner.owner);
    });

    winnersWrap.replaceChildren(...cards);
  } catch {
    winnersWrap.replaceChildren(
      buildWinnerCard("Premio principal", "", "No disponible"),
      buildWinnerCard("Subpremio", "", "No disponible"),
    );
  }
}

function selectQuick(qty) {
  if (!currentRaffle) return;

  const total = Number(currentRaffle.total_numbers || 0);
  const available = [];

  for (let i = 1; i <= total; i += 1) {
    const number = padNumber(i);
    if (!soldNumbers.has(number)) available.push(number);
  }

  selected.clear();
  for (let i = 0; i < available.length && selected.size < qty; i += 1) {
    selected.add(available[i]);
  }

  renderGrid(searchInput?.value.trim() || "");
  updateSelectionInfo();
}

function bindEvents() {
  if (searchInput) {
    searchInput.addEventListener("input", (event) => {
      renderGrid(event.target.value.trim());
    });
  }

  document.querySelectorAll(".quick").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectQuick(Number(btn.dataset.quick || 0));
    });
  });

  if (clearSelectionBtn) {
    clearSelectionBtn.addEventListener("click", () => {
      selected.clear();
      renderGrid(searchInput?.value.trim() || "");
      updateSelectionInfo();
    });
  }

  if (goCheckoutBtn && checkoutForm) {
    goCheckoutBtn.addEventListener("click", () => {
      checkoutForm.scrollIntoView({ behavior: "smooth" });
    });
  }

  if (checkoutForm) {
    checkoutForm.addEventListener("submit", submitCheckout);
  }

  if (lookupBtn) {
    lookupBtn.addEventListener("click", runLookup);
  }

  if (lookupInput) {
    lookupInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        runLookup();
      }
    });
  }

  const isAdminMode = new URLSearchParams(window.location.search).get("admin") === "1";
  if (adminCard) adminCard.hidden = !isAdminMode;

  if (isAdminMode && setWinnersBtn) {
    setWinnersBtn.addEventListener("click", publishWinners);
  }
}

async function bootstrap() {
  bindEvents();
  updateCountdown();
  setInterval(updateCountdown, 1000);

  clearLegacyLocalState();

  try {
    await fetchRaffles();
    await fetchSoldNumbers();
    updateProgress();
    renderGrid();
    updateSelectionInfo();
    await renderWinners();
  } catch (error) {
    setCheckoutMessage(`No se pudo cargar la rifa desde backend: ${error.message}`, "error");
  }
}

bootstrap();
