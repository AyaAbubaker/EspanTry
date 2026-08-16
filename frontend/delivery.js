(function(){
  "use strict";
  const store=window.ESPANStore;
  if(!store.requireRole(["delivery"])) { location.replace("auth.html#loginSection"); return; }
  let user=store.currentUser();
  const content=document.getElementById("deliveryContent"),tabs=document.querySelector(".delivery-tabs"),toastEl=document.getElementById("toast");
  let tab="mine";
  let knownNotifications=new Set((store.data.notifications||[]).map(n=>n.id));
  const esc=(v="")=>String(v).replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
  const money=n=>new Intl.NumberFormat("ar-LY").format(n||0)+" د.ل";
  const date=v=>new Intl.DateTimeFormat("ar-LY",{dateStyle:"medium",timeStyle:"short"}).format(new Date(v));
  function toast(m){toastEl.textContent=m;toastEl.classList.add("show");clearTimeout(toastEl.t);toastEl.t=setTimeout(()=>toastEl.classList.remove("show"),2400)}
  function stats(){
    const orders=store.data.orders,mine=orders.filter(o=>o.deliveryId===user.id);
    document.getElementById("deliveryStats").innerHTML=`<div class="stat"><strong>${mine.filter(o=>!["تم التسليم","ملغي"].includes(o.status)).length}</strong><small>مسندة إليّ</small></div><div class="stat"><strong>${mine.filter(o=>o.status==="خرج للتوصيل").length}</strong><small>في الطريق</small></div><div class="stat"><strong>${mine.filter(o=>o.status==="تم التسليم").length}</strong><small>مسلّمة</small></div><div class="stat"><strong>${mine.filter(o=>o.status==="تم التسليم"&&!o.cashHandedOver&&o.paymentMethod==="نقدًا").length}</strong><small>تحصيلات تنتظر التسليم</small></div>`;
  }
  function cashStatus(order){
    if(order.paymentMethod!=="نقدًا") return `<div class="cash-status transfer">الدفع تحويل مصرفي — لا توجد عهدة نقدية</div>`;
    if(order.cashConfirmed) return `<div class="cash-status confirmed">✓ الإدارة أكدت استلام المبلغ</div>`;
    if(order.cashHandedOver) return `<div class="cash-status waiting">✓ سجلت تسليم المبلغ — بانتظار تأكيد الإدارة</div>`;
    return `<label class="cash-check"><input type="checkbox" data-cash-handover="${order.id}"> <span>سلّمت مبلغ ${money(order.total)} للإدارة</span></label>`;
  }
  function card(order,kind){
    const items=(order.items||[]).map(i=>`<small>${esc(i.productName)} × ${i.quantity}</small>`).join("");
let actions="";

if(kind==="mine"){
  if(order.status==="جاهز للتوصيل"){
    actions=`<button class="primary" data-start="${order.id}">بدأت التوصيل</button>`;
  }
  else if(order.status==="خرج للتوصيل"){
    actions=`<button class="primary" data-delivered="${order.id}">تأكيد التسليم</button>`;
  }
  else{
    actions=`<span class="delivery-waiting">الطلب مسند إليك، وبانتظار أن يصبح جاهزًا للتوصيل.</span>`;
  }
} 
    if(kind==="delivered") actions=``;
    return `<article class="delivery-card"><div><span class="status ${order.status==="تم التسليم"?"done":""}">${esc(order.status)}</span><h3>${esc(order.id)} · ${esc(order.productName)}</h3><p>${esc(order.customerName)} · ${esc(order.customerPhone||"بدون رقم")}</p><p>${esc(order.address||"لا يوجد عنوان")} · ${date(order.createdAt)}</p><div class="delivery-items">${items}</div></div><div class="meta"><div><small>الكمية</small><strong>${order.quantity}</strong></div><div><small>الإجمالي</small><strong>${money(order.total)}</strong></div><div><small>الدفع</small><strong>${esc(order.paymentMethod)}</strong></div><div><small>ملاحظات</small><strong>${esc(order.notes||"لا يوجد")}</strong></div></div><div class="actions">${actions}</div>${kind==="delivered"?`<div class="cash-zone">${cashStatus(order)}</div>`:""}</article>`;
  }
  function render(){
    const data=store.data,orders=data.orders;let list=[];
    if(tab==="mine")list=orders.filter(o=>o.deliveryId===user.id&&!['تم التسليم','ملغي'].includes(o.status));
    if(tab==="delivered")list=orders.filter(o=>o.deliveryId===user.id&&o.status==="تم التسليم");
    if(tab==="profile"){
      content.innerHTML=`<div class="profile-card"><h2>بياناتي</h2><form id="profileForm"><label>الاسم<input name="full_name" value="${esc(user.full_name)}"></label><label>رقم الهاتف<input name="phone" value="${esc(user.phone)}"></label><label>المدينة<input name="city" value="${esc(user.city||"")}"></label><label>كلمة المرور الحالية<input name="currentPassword" type="password" required placeholder="مطلوبة لتأكيد التعديل"></label><label>كلمة مرور جديدة<input name="newPassword" type="password" minlength="8" placeholder="اختياري"></label><button class="primary">حفظ التعديلات</button></form></div>`;stats();return;
    }
    const unread=(data.notifications||[]).filter(n=>!n.read);
    const alert=unread.length?`<div class="delivery-alert"><strong>🔔 ${esc(unread[0].title)}</strong><span>${esc(unread[0].message)}</span></div>`:"";
    content.innerHTML=alert+(list.length?`<div class="delivery-list">${list.map(o=>card(o,tab)).join("")}</div>`:`<div class="empty"><h2>لا توجد طلبات في هذا القسم</h2><p>ستظهر الطلبات بمجرد تجهيزها أو إسنادها إليك.</p></div>`);stats();
  }
  tabs.onclick=e=>{const b=e.target.closest("[data-tab]");if(!b)return;tab=b.dataset.tab;tabs.querySelectorAll("button").forEach(x=>x.classList.toggle("active",x===b));render()};
  content.onclick=async e=>{
    const start=e.target.closest("[data-start]");if(start){try{await store.updateOrderAsync(start.dataset.start,{status:"خرج للتوصيل"});toast("تم تسجيل بدء التوصيل");render();}catch(err){toast(err.message)}}
    const done=e.target.closest("[data-delivered]");if(done){try{await store.updateOrderAsync(done.dataset.delivered,{status:"تم التسليم"});toast("تم تأكيد تسليم الطلب");tab="delivered";tabs.querySelectorAll("button").forEach(x=>x.classList.toggle("active",x.dataset.tab===tab));render();}catch(err){toast(err.message)}}
  };
  content.onchange=async e=>{
    const cash=e.target.closest("[data-cash-handover]");
    if(cash&&cash.checked){if(!confirm("تأكيد أنك سلّمت قيمة الطلب للإدارة؟")){cash.checked=false;return;}try{await store.updateCashAsync(cash.dataset.cashHandover,{handedOver:true});toast("تم تسجيل تسليم المبلغ للإدارة");render();}catch(err){cash.checked=false;toast(err.message||"تعذر تسجيل التحصيل");}}
  };
  content.onsubmit=e=>{if(e.target.id!=="profileForm")return;e.preventDefault();const result=store.updateProfile(user.id,Object.fromEntries(new FormData(e.target)));if(result.ok){user=result.user;toast("تم حفظ البيانات");render();}else toast(result.message)};
  document.getElementById("deliveryName").textContent=user.full_name;
  document.getElementById("todayLabel").textContent=new Intl.DateTimeFormat("ar-LY",{weekday:"long",day:"numeric",month:"long"}).format(new Date());
  document.getElementById("logoutButton").onclick=()=>{store.logout();location.href="auth.html#loginSection"};
  render();setInterval(async()=>{
    try{await store.refreshAsync();}catch(_){return;}
    const fresh=(store.data.notifications||[]).find(n=>!n.read&&!knownNotifications.has(n.id));
    (store.data.notifications||[]).forEach(n=>knownNotifications.add(n.id));
    if(fresh){
      toast(`${fresh.title}: ${fresh.message}`);
      if("Notification" in window && Notification.permission==="granted"){ try{new Notification(`ESPAN — ${fresh.title}`,{body:fresh.message});}catch(_){}}
    }
    render();
  },5000);
  document.addEventListener("click",()=>{if("Notification" in window&&Notification.permission==="default")Notification.requestPermission().catch(()=>{});},{once:true});
}());
