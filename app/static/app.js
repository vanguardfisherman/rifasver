const $ = (s) => document.querySelector(s);
const pad = (n) => String(n).padStart(4, '0');
let raffles = [];
let currentRaffle = null;
let sold = new Set();
let selected = new Set();

async function api(path, options={}) {
  const res = await fetch(path, {headers:{'Content-Type':'application/json'}, ...options});
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error');
  return data;
}

async function loadRaffles(){
  raffles = await api('/api/raffles');
  const sel = $('#raffleSelect');
  sel.innerHTML = raffles.map(r=>`<option value="${r.id}">${r.title}</option>`).join('');
  if (raffles.length){
    currentRaffle = raffles[0];
    sel.value = currentRaffle.id;
    await onRaffleChange();
  }
}

async function onRaffleChange(){
  const id = Number($('#raffleSelect').value);
  currentRaffle = raffles.find(r=>r.id===id);
  const nums = await api(`/api/raffles/${id}/numbers`);
  sold = new Set(nums.sold);
  selected = new Set();
  $('#raffleInfo').textContent = `${currentRaffle.main_prize} | Precio: $${Number(currentRaffle.ticket_price).toLocaleString('es-CO')} | Mínimo: ${currentRaffle.min_purchase}`;
  renderGrid();
  renderWinners();
}

function renderGrid(){
  const filter = $('#search').value.trim();
  const wrap = $('#grid');
  wrap.innerHTML='';
  for(let i=1;i<=Number(currentRaffle.total_numbers);i++){
    const n=pad(i); if(filter && !n.includes(filter)) continue;
    const b=document.createElement('button'); b.className='num'; b.textContent=n;
    if(sold.has(n)){b.classList.add('sold'); b.disabled=true;}
    if(selected.has(n)) b.classList.add('selected');
    b.onclick=()=>{selected.has(n)?selected.delete(n):selected.add(n); renderGrid();};
    wrap.appendChild(b);
  }
  $('#selInfo').textContent=`Seleccionados: ${selected.size} • Total: $${(selected.size*Number(currentRaffle.ticket_price)).toLocaleString('es-CO')}`;
}

async function buy(e){
  e.preventDefault();
  const fd = new FormData(e.target);
  const customer = Object.fromEntries(fd.entries());
  try{
    const out = await api('/api/orders', {method:'POST', body: JSON.stringify({raffle_id: currentRaffle.id, numbers:[...selected], customer})});
    $('#msg').textContent = `Compra exitosa. Orden #${out.order_id} • Total $${out.total.toLocaleString('es-CO')}`;
    const pdfContent = `COMPROBANTE PLACEHOLDER\nOrden: ${out.order_id}\nNúmeros: ${out.numbers.join(', ')}`;
    const blob = new Blob([pdfContent], {type:'application/pdf'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`orden-${out.order_id}.pdf`; a.click();
    await onRaffleChange();
    e.target.reset();
  }catch(err){ $('#msg').textContent = err.message; }
}

async function lookup(){
  const key = $('#lookup').value.trim();
  const out = await api(`/api/tickets/query?key=${encodeURIComponent(key)}`);
  $('#lookupOut').innerHTML = out.map(o=>`<li>Orden #${o.order_id} • ${o.numbers}</li>`).join('') || '<li>Sin resultados</li>';
}

async function setWinners(e){
  e.preventDefault();
  const fd = new FormData(e.target);
  const results = [
    {winner_type:'main', label:'Premio principal', winning_number: fd.get('main') || '0000'},
    {winner_type:'subprize', label:'Subpremio', winning_number: fd.get('sub') || '0000'},
  ];
  await api(`/api/admin/raffles/${currentRaffle.id}/draw-results`, {method:'POST', body: JSON.stringify({results})});
  await renderWinners();
}

async function renderWinners(){
  const winners = await api(`/api/raffles/${currentRaffle.id}/winners`);
  $('#winners').innerHTML = winners.map(w=>`<div class="wcard"><b>${w.label}</b><br>Número: ${w.winning_number}<br>Ganador: ${w.owner}</div>`).join('') || '<p>Sin ganadores publicados.</p>';
}

async function createRaffle(e){
  e.preventDefault();
  const fd=new FormData(e.target); const payload=Object.fromEntries(fd.entries());
  await api('/api/admin/raffles', {method:'POST', body: JSON.stringify(payload)});
  e.target.reset();
  await loadRaffles();
}

$('#raffleSelect').addEventListener('change', onRaffleChange);
$('#search').addEventListener('input', renderGrid);
const quickButtons = document.querySelectorAll('.quick');
quickButtons.forEach(b=>b.addEventListener('click', ()=>{
  const q = Number(b.dataset.q); selected = new Set();
  for(let i=1;i<=Number(currentRaffle.total_numbers)&&selected.size<q;i++){const n=pad(i); if(!sold.has(n)) selected.add(n);} renderGrid();
}));
$('#checkout').addEventListener('submit', buy);
$('#lookupBtn').addEventListener('click', lookup);
$('#winnersForm').addEventListener('submit', setWinners);
$('#createRaffle').addEventListener('submit', createRaffle);

loadRaffles();
