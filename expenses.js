
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

const businessCategories = ["Inventory Re-up","Stocks","Supplier Payment","Mananahi Payment","Packaging","Courier Cost","Lalamove","Salary","Supplies","Ads","Refund","Losses","Bills","Food for Staff","Emergency","Other"];
const personalCategories = ["Owner Draw / Personal Advance","Food","Coffee","Gym","Transpo","Clothes","Wants","Family","Savings","Bills","Other"];
const inventoryCategories = new Set(["Inventory Re-up","Stocks","Supplier Payment","Mananahi Payment"]);
let expenses=[];

function fillDefaults(){
  $('expense_date').value=todayKey();
  $('monthFilter').value=currentMonth();
  populateCategories();
}
function populateCategories(){
  const opts = $('expense_type').value==='Business' ? businessCategories : personalCategories;
  $('category').innerHTML = opts.map(x=>`<option value="${x}">${x}</option>`).join('');
  $('deduct_owner_pay').value = $('expense_type').value==='Personal' ? 'YES' : 'NO';
}
function clearForm(){
  $('expenseForm').reset(); fillDefaults(); $('formMsg').textContent='—';
}
async function saveExpense(ev){
  ev.preventDefault(); $('btnSaveExpense').disabled=true; $('formMsg').textContent='Saving…';
  try{
    if(!await ensureSession(true)) return;
    const payload={
      expense_date:$('expense_date').value,
      type:$('expense_type').value,
      category:$('category').value,
      amount:Number($('amount').value||0),
      payment_method:$('payment_method').value,
      supplier:$('supplier').value.trim()||null,
      deduct_owner_pay:$('deduct_owner_pay').value,
      notes:$('notes').value.trim()||null,
      spent_by:$('spent_by').value.trim()||currentEmail,
      encoded_by:currentEmail
    };
    const {data,error}=await supa.from('expenses').insert(payload).select('*').single();
    if(error) throw error;
    await syncIntegratedToSheets('expense', data);
    $('formMsg').textContent='Saved ✅';
    clearForm();
    await loadExpenses();
  }catch(e){ showErr(e.message||String(e)); $('formMsg').textContent='Save failed'; }
  finally{ $('btnSaveExpense').disabled=false; }
}
function filtered(){
  const month=$('monthFilter').value;
  const type=$('typeFilter').value;
  const q=($('search').value||'').toLowerCase().trim();
  return expenses.filter(x=>{
    if(month && String(x.expense_date||'').slice(0,7)!==month) return false;
    if(type!=='all' && x.type!==type) return false;
    if(!q) return true;
    return [x.category,x.supplier,x.notes,x.spent_by].filter(Boolean).join(' ').toLowerCase().includes(q);
  });
}
function render(){
  const list=filtered();
  const business=list.filter(x=>x.type==='Business').reduce((a,x)=>a+Number(x.amount||0),0);
  const inventory=list.filter(x=>x.type==='Business' && inventoryCategories.has(x.category)).reduce((a,x)=>a+Number(x.amount||0),0);
  const ownerAdv=list.filter(x=>x.deduct_owner_pay==='YES').reduce((a,x)=>a+Number(x.amount||0),0);
  const personal=list.filter(x=>x.type==='Personal' && x.deduct_owner_pay!=='YES').reduce((a,x)=>a+Number(x.amount||0),0);
  $('kpiBusiness').textContent=MONEY(business);
  $('kpiInventory').textContent=MONEY(inventory);
  $('kpiOwnerAdv').textContent=MONEY(ownerAdv);
  $('kpiPersonal').textContent=MONEY(personal);
  $('expenseList').innerHTML=list.length?list.map(x=>`
    <div class="item">
      <div class="row" style="justify-content:space-between"><div><strong>${x.category}</strong><div class="muted">${x.expense_date} • ${x.type} • ${x.payment_method}</div></div><div class="num">${MONEY(x.amount)}</div></div>
      <div class="row" style="margin-top:8px"><span class="pill">${x.supplier||'No supplier'}</span><span class="pill ${x.deduct_owner_pay==='YES'?'warn':''}">Deduct Owner Pay: ${x.deduct_owner_pay}</span><span class="pill">By: ${x.spent_by||'—'}</span></div>
      ${x.notes?`<p class="muted">${x.notes}</p>`:''}
    </div>`).join(''):'<div class="item muted">No expenses found.</div>';
}
async function loadExpenses(){
  try{ expenses=await fetchAll('expenses','*','created_at'); render(); }
  catch(e){ showErr('Failed to load expenses: '+(e.message||e)); }
}
async function init(){
  if(!await ensureSession(true)) return;
  $('btnLogout').addEventListener('click',logout);
  $('expense_type').addEventListener('change',populateCategories);
  $('expenseForm').addEventListener('submit',saveExpense);
  $('btnClear').addEventListener('click',clearForm);
  $('btnRefresh').addEventListener('click',loadExpenses);
  ['monthFilter','typeFilter','search'].forEach(id=>$(id).addEventListener('input',render));
  ['monthFilter','typeFilter'].forEach(id=>$(id).addEventListener('change',render));
  fillDefaults();
  await loadExpenses();
}
init();
