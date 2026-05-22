
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

let payments=[], orders=[];
const PAYMENT_BUCKET = 'payment-proofs';

function fillDate(){ if($('payment_date')) $('payment_date').value = todayKey(); }

async function uploadProof(file, orderId, ref){
  if(!file) return null;
  const safe=x=>String(x||'file').replace(/[^a-zA-Z0-9_-]/g,'-');
  const ext=(file.name.split('.').pop()||'jpg').toLowerCase();
  const path=`payments/${todayKey()}/${safe(orderId)}-${safe(ref)}-${Date.now()}.${ext}`;
  const {error}=await supa.storage.from(PAYMENT_BUCKET).upload(path,file,{cacheControl:'3600',upsert:false,contentType:file.type||'image/jpeg'});
  if(error) throw error;
  return supa.storage.from(PAYMENT_BUCKET).getPublicUrl(path).data.publicUrl;
}

async function loadOrders(){
  try{
    orders = await fetchAll(
      'orders',
      'id,order_id,customer_name,paid_product,paid_shipping,status,payment_status,paid_verified_total,created_at,order_date',
      'created_at'
    );

    // Smart sorting:
    // 1. Unpaid / partial orders first
    // 2. Newest created/order date first
    // 3. Fully paid orders lower
    const priority = (o)=>{
      const ps = String(o.payment_status || 'unpaid').toLowerCase();
      if(ps === 'unpaid') return 0;
      if(ps === 'partial') return 1;
      if(ps === '' || ps === 'pending') return 2;
      return 9;
    };

    orders = (orders || []).sort((a,b)=>{
      const pa = priority(a), pb = priority(b);
      if(pa !== pb) return pa - pb;
      const da = new Date(a.created_at || a.order_date || 0).getTime();
      const db = new Date(b.created_at || b.order_date || 0).getTime();
      return db - da;
    });

    const sel=$('orderSelect');

    sel.innerHTML = '<option value="">Manual / no order link</option>' + orders.slice(0,2000).map(o=>{
      const total = Number(o.paid_product||0)+Number(o.paid_shipping||0);
      const paid = Number(o.paid_verified_total||0);
      const remaining = Math.max(total - paid, 0);
      const ps = String(o.payment_status || 'unpaid').toUpperCase();
      const labelAmount = remaining > 0 ? `Remaining ${MONEY(remaining)}` : `Paid ${MONEY(total)}`;
      return `<option value="${o.id}">${o.order_id||o.id} — ${o.customer_name||'No name'} — ${labelAmount} — ${ps}</option>`;
    }).join('');

    // Auto-select newest unpaid/partial order when the form is empty.
    const newestOpen = orders.find(o=>{
      const ps = String(o.payment_status || 'unpaid').toLowerCase();
      return ps === 'unpaid' || ps === 'partial' || ps === '' || ps === 'pending';
    });

    if(newestOpen && !$('order_id').value && !$('amount').value){
      sel.value = newestOpen.id;
      handleOrderSelect();
      $('formMsg').textContent = 'Newest unpaid/partial order auto-selected ✅';
    }

  }catch(e){ console.warn(e); }
}


function selectedOrder(){
  const id=$('orderSelect').value;
  return orders.find(o=>String(o.id)===String(id));
}

function handleOrderSelect(){
  const o=selectedOrder();
  if(!o) return;
  $('order_id').value = o.order_id || '';
  $('customer_name').value = o.customer_name || '';

  const total = Number(o.paid_product||0)+Number(o.paid_shipping||0);
  const paid = Number(o.paid_verified_total||0);
  const remaining = Math.max(total - paid, 0);

  // Default amount should be remaining balance, not full order total.
  $('amount').value = remaining || total || '';

  $('formMsg').textContent = `Linked ${o.order_id || 'order'} • Remaining ${MONEY(remaining || total || 0)}`;
}

function useLatestOrder(){
  const newestOpen = orders.find(o=>{
    const ps = String(o.payment_status || 'unpaid').toLowerCase();
    return ps === 'unpaid' || ps === 'partial' || ps === '' || ps === 'pending';
  }) || orders[0];

  if(!newestOpen){
    $('formMsg').textContent = 'No order found';
    return;
  }

  $('orderSelect').value = newestOpen.id;
  handleOrderSelect();
}


async function checkDuplicate(ref, currentId=''){
  if(!ref) return null;
  const {data,error}=await supa.from('payments').select('id,order_id,amount,status').eq('reference_number',ref).limit(1);
  if(error || !data?.length) return null;
  const found=data[0];
  if(currentId && String(found.id)===String(currentId)) return null;
  return found;
}

async function savePayment(ev){
  ev.preventDefault();
  $('btnSavePayment').disabled=true; $('formMsg').textContent='Saving…';
  try{
    if(!await ensureSession()) return;
    const ref=$('reference_number').value.trim();
    let status=$('payment_status').value;
    let notes=$('notes').value.trim();
    const dup=await checkDuplicate(ref);
    if(dup && status!=='duplicate'){
      status='duplicate';
      notes = `[AUTO DUPLICATE WARNING] Possible duplicate of ${dup.order_id}. ${notes||''}`.trim();
    }
    const proofFile=$('proof').files[0]||null;
    const proofUrl=await uploadProof(proofFile, $('order_id').value, ref);
    const o=selectedOrder();
    const payload={
      order_db_id: o ? String(o.id) : null,
      order_id: $('order_id').value.trim() || null,
      customer_name: $('customer_name').value.trim() || null,
      payment_date: $('payment_date').value || todayKey(),
      amount: Number($('amount').value||0),
      payment_method: $('payment_method').value,
      reference_number: ref || null,
      proof_image_url: proofUrl,
      status,
      notes: notes || null,
      submitted_by: currentEmail,
      verified_by: status==='verified' ? currentEmail : null,
      verified_at: status==='verified' ? new Date().toISOString() : null
    };
    const {data,error}=await supa.from('payments').insert(payload).select('*').single();
    if(error) throw error;
    if(status==='verified') await afterVerifiedPayment(data);
    $('formMsg').textContent = status==='duplicate' ? 'Saved as duplicate ⚠️' : 'Saved ✅';
    clearForm();
    await loadPayments();
  }catch(e){ showErr(e.message||String(e)); $('formMsg').textContent='Save failed'; }
  finally{ $('btnSavePayment').disabled=false; $('proof').value=''; }
}

async function afterVerifiedPayment(payment){
  if(payment.order_db_id){
    await recomputeOrderPayment(payment.order_db_id);
  }
  await syncIntegratedToSheets('payment', payment);
}

async function recomputeOrderPayment(orderDbId){
  const {data:order,error:orderErr}=await supa.from('orders').select('*').eq('id',orderDbId).single();
  if(orderErr || !order) return;
  const {data:payRows,error:payErr}=await supa.from('payments').select('amount').eq('order_db_id',String(orderDbId)).eq('status','verified');
  if(payErr) return;
  const paid=(payRows||[]).reduce((a,p)=>a+Number(p.amount||0),0);
  const orderTotal=Number(order.paid_product||0)+Number(order.paid_shipping||0);
  let payment_status = paid <= 0 ? 'unpaid' : (paid >= orderTotal ? 'verified' : 'partial');
  const patch={paid_verified_total:paid,payment_status,last_payment_verified_at:new Date().toISOString()};
  if(payment_status==='verified' && String(order.status||'pending').toLowerCase()==='pending') patch.status='processing';
  await supa.from('orders').update(patch).eq('id',orderDbId);
}

async function updatePaymentStatus(id,status){
  try{
    if(!await ensureSession()) return;
    const patch={status};
    if(status==='verified'){ patch.verified_by=currentEmail; patch.verified_at=new Date().toISOString(); }
    const {data,error}=await supa.from('payments').update(patch).eq('id',id).select('*').single();
    if(error) throw error;
    if(status==='verified') await afterVerifiedPayment(data);
    await loadPayments();
  }catch(e){ showErr(e.message||String(e)); }
}

function clearForm(){
  $('paymentForm').reset();
  fillDate();
  $('payment_status').value='pending';
  $('formMsg').textContent='—';
}

function filtered(){
  const q=($('search').value||'').toLowerCase().trim();
  const st=$('statusFilter').value;
  const m=$('methodFilter').value;
  return payments.filter(p=>{
    if(st!=='all' && p.status!==st) return false;
    if(m!=='all' && p.payment_method!==m) return false;
    if(!q) return true;
    return [p.order_id,p.customer_name,p.reference_number,p.notes].filter(Boolean).join(' ').toLowerCase().includes(q);
  });
}

function render(){
  const list=filtered();
  const verified=payments.filter(p=>p.status==='verified').reduce((a,p)=>a+Number(p.amount||0),0);
  $('kpiVerified').textContent=MONEY(verified);
  $('kpiPending').textContent=payments.filter(p=>p.status==='pending').length;
  $('kpiReview').textContent=payments.filter(p=>p.status==='needs_review').length;
  $('kpiCount').textContent=payments.length;
  const mount=$('paymentList');
  mount.innerHTML = list.length ? list.map(p=>{
    const pill = p.status==='verified'?'ok':p.status==='needs_review'?'warn':p.status==='rejected'||p.status==='duplicate'?'bad':'warn';
    return `<div class="item">
      <div class="row" style="justify-content:space-between"><div><strong style="font-size:18px">${p.order_id||'Manual Payment'}</strong><div class="muted">${p.customer_name||'No customer'} • ${p.payment_date||''}</div></div><div class="num">${MONEY(p.amount)}</div></div>
      <div class="row" style="margin-top:10px"><span class="pill ${pill}">${String(p.status).replace('_',' ').toUpperCase()}</span><span class="pill">${p.payment_method||'—'}</span><span class="pill">REF: ${p.reference_number||'—'}</span><span class="pill">By: ${p.submitted_by||'—'}</span></div>
      ${p.notes?`<p class="muted">${p.notes}</p>`:''}
      <div class="row" style="margin-top:12px">${p.proof_image_url?`<a class="btn" target="_blank" href="${p.proof_image_url}">View Proof</a>`:''}<button class="btn good" onclick="updatePaymentStatus('${p.id}','verified')">Verify</button><button class="btn warn" onclick="updatePaymentStatus('${p.id}','needs_review')">Needs Review</button><button class="btn danger" onclick="updatePaymentStatus('${p.id}','rejected')">Reject</button><button class="btn danger" onclick="updatePaymentStatus('${p.id}','duplicate')">Duplicate</button><button class="btn danger" onclick="updatePaymentStatus('${p.id}','voided')">Void</button></div>
    </div>`;
  }).join('') : '<div class="item muted">No payments found.</div>';
}

async function loadPayments(){
  try{
    payments = await fetchAll('payments','*','created_at');
    render();
  }catch(e){ showErr('Failed to load payments: '+(e.message||e)); }
}

async function init(){
  if(!await ensureSession()) return;
  $('btnLogout').addEventListener('click',logout);
  $('paymentForm').addEventListener('submit',savePayment);
  $('btnClear').addEventListener('click',clearForm);
  $('btnRefresh').addEventListener('click',loadPayments);
  $('orderSelect').addEventListener('change',handleOrderSelect);
  $('btnUseLatestOrder')?.addEventListener('click',useLatestOrder);
  ['search','statusFilter','methodFilter'].forEach(id=>$(id).addEventListener('input',render));
  ['statusFilter','methodFilter'].forEach(id=>$(id).addEventListener('change',render));
  fillDate();
  await loadOrders();
  await loadPayments();
}
window.updatePaymentStatus=updatePaymentStatus;
init();
