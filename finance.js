
const $ = (id)=>document.getElementById(id);
const OWNER_EMAILS = Array.isArray(window.__OWNER_EMAILS__) ? window.__OWNER_EMAILS__.map(x=>String(x).toLowerCase()) : ['gshoeswho@gmail.com'];
const OWNER_PAY_START_DATE = '2026-06-01';
const OWNER_PAY_PERCENT = 0.30;
const MONEY = n => '₱' + Number(n||0).toLocaleString('en-PH',{maximumFractionDigits:2});
const todayKey = ()=>{ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const currentMonth = ()=>todayKey().slice(0,7);
const showErr = (t)=>{ const e=$('authError'); if(e){ e.textContent=t||''; e.style.display=t?'block':'none'; } };
const supa = window.supabase.createClient(window.__SUPABASE_URL__, window.__SUPABASE_ANON_KEY__);
let currentUser = null;
let currentEmail = '';

async function ensureSession(ownerOnly=false){
  showErr('');
  const {data:{session}, error} = await supa.auth.getSession();
  if(error){ showErr(error.message); return null; }
  if(!session){ location.replace('./index.html'); return null; }
  currentUser = session.user;
  currentEmail = currentUser.email || '';
  const chip=$('userChip'); if(chip) chip.textContent = currentEmail;
  if(ownerOnly && !OWNER_EMAILS.includes(String(currentEmail).toLowerCase())){
    showErr('Owner-only page. This account cannot view this page.');
    return null;
  }
  return session;
}
async function logout(){ await supa.auth.signOut(); location.replace('./index.html'); }
function csvEscape(v){ const s=String(v??''); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s; }
async function fetchAll(table, select='*', orderCol='created_at'){
  const pageSize=1000; let from=0; let all=[];
  while(true){
    let q=supa.from(table).select(select);
    if(orderCol) q=q.order(orderCol,{ascending:false});
    const {data,error}=await q.range(from,from+pageSize-1);
    if(error) throw error;
    const batch=Array.isArray(data)?data:[];
    all=all.concat(batch);
    if(batch.length<pageSize) break;
    from+=pageSize;
  }
  return all;
}
async function syncIntegratedToSheets(recordType, payload){
  const url = String(window.__GOOGLE_SHEETS_WEB_APP_URL__ || '').trim();
  if(!url) return;
  try{
    await fetch(url,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({recordType, ...payload})});
  }catch(e){ console.warn('Google sync skipped', e); }
}
function normalizeStatus(s){ return String(s||'pending').toLowerCase(); }
function methodLabel(v){ return v || '—'; }

const inventoryCategories = new Set(["Inventory Re-up","Stocks","Supplier Payment","Mananahi Payment"]);
let payments=[], expenses=[];

function monthVal(){ return $('monthFilter').value || currentMonth(); }
function calc(){
  const month=monthVal();
  const startOK = month >= OWNER_PAY_START_DATE.slice(0,7);
  if(!startOK){
    return {moneyIn:0,businessOut:0,inventory:0,operating:0,netProfit:0,ownerTarget:0,ownerAdv:0,remaining:0,over:0,cashAfter:0, personalNon:0};
  }
  const verified=payments.filter(p=>p.status==='verified' && String(p.payment_date||p.verified_at||'').slice(0,7)===month);
  const moneyIn=verified.reduce((a,p)=>a+Number(p.amount||0),0);
  const ex=expenses.filter(e=>String(e.expense_date||'').slice(0,7)===month);
  const businessOut=ex.filter(e=>e.type==='Business').reduce((a,e)=>a+Number(e.amount||0),0);
  const inventory=ex.filter(e=>e.type==='Business' && inventoryCategories.has(e.category)).reduce((a,e)=>a+Number(e.amount||0),0);
  const operating=businessOut-inventory;
  const ownerAdv=ex.filter(e=>e.deduct_owner_pay==='YES').reduce((a,e)=>a+Number(e.amount||0),0);
  const personalNon=ex.filter(e=>e.type==='Personal' && e.deduct_owner_pay!=='YES').reduce((a,e)=>a+Number(e.amount||0),0);
  const netProfit=moneyIn-businessOut;
  const ownerTarget=Math.max(netProfit,0)*OWNER_PAY_PERCENT;
  const remaining=Math.max(ownerTarget-ownerAdv,0);
  const over=Math.max(ownerAdv-ownerTarget,0);
  const cashAfter=netProfit-ownerAdv;
  return {moneyIn,businessOut,inventory,operating,netProfit,ownerTarget,ownerAdv,remaining,over,cashAfter,personalNon};
}
function render(){
  const c=calc();
  $('moneyIn').textContent=MONEY(c.moneyIn);
  $('businessOut').textContent=MONEY(c.businessOut);
  $('netProfit').textContent=MONEY(c.netProfit);
  $('ownerTarget').textContent=MONEY(c.ownerTarget);
  $('ownerAdvances').textContent=MONEY(c.ownerAdv);
  $('remainingOwnerPay').textContent=MONEY(c.remaining);
  $('overAdvance').textContent=MONEY(c.over);
  $('cashAfterDraws').textContent=MONEY(c.cashAfter);
  const rows=[
    ['Verified Money In',c.moneyIn],
    ['Inventory / Supplier Expenses',c.inventory],
    ['Operating Expenses',c.operating],
    ['Business Expenses Total',c.businessOut],
    ['Net Profit Before Owner Pay',c.netProfit],
    ['Owner Pay Target 30%',c.ownerTarget],
    ['Owner Advances / Personal Deduct YES',c.ownerAdv],
    ['Remaining Owner Pay',c.remaining],
    ['Over Advance',c.over],
    ['Business Cash After Owner Draws',c.cashAfter],
    ['Personal Non-Deduct Spending',c.personalNon]
  ];
  $('breakdownRows').innerHTML=rows.map(r=>`<tr><td>${r[0]}</td><td class="right">${MONEY(r[1])}</td></tr>`).join('');
}
async function loadAll(){
  try{
    payments=await fetchAll('payments','*','created_at');
    expenses=await fetchAll('expenses','*','created_at');
    render();
  }catch(e){ showErr('Failed to load finance data: '+(e.message||e)); }
}
async function init(){
  if(!await ensureSession(true)) return;
  $('btnLogout').addEventListener('click',logout);
  $('monthFilter').value=currentMonth();
  $('monthFilter').addEventListener('change',render);
  $('btnRefresh').addEventListener('click',loadAll);
  await loadAll();
}
init();
