(function () {
  "use strict";
  const store = window.ESPANStore;
  let user = store.currentUser();
  if (!user || user.role !== "customer") { location.replace("auth.html#loginSection"); return; }

  const content = document.getElementById("viewContent");
  const title = document.getElementById("pageTitle");
  const intro = document.getElementById("pageIntro");
  const menu = document.getElementById("mainMenu");
  const toastEl = document.getElementById("toast");
  const state = { view: "products", availability: "all", sort: "rating", offersOnly: false, accountSection: "profile" };
  let knownUnread = new Set((store.data.notifications || []).filter(n=>!n.read).map(n=>n.id));

  const esc = (v = "") => String(v).replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
  const money = n => `${new Intl.NumberFormat("ar-LY", { maximumFractionDigits: 0 }).format(Number(n || 0))} د.ل`;
  const dateText = v => v ? new Intl.DateTimeFormat("ar-LY", { dateStyle: "medium", timeStyle: "short" }).format(new Date(v)) : "—";
  const stars = n => `${"★".repeat(Math.round(Number(n || 0)))}${"☆".repeat(5 - Math.round(Number(n || 0)))}`;
  const data = () => store.data;
  const products = () => data().products || [];
  function toast(message) { toastEl.textContent = message; toastEl.classList.add("show"); clearTimeout(toastEl.t); toastEl.t = setTimeout(() => toastEl.classList.remove("show"), 2800); }
  function counts() {
    const d=data();
    document.getElementById("favoriteCount").textContent = (d.favorites || []).length;
    document.getElementById("cartCount").textContent = (d.cart || []).reduce((s, x) => s + Number(x.quantity || 0), 0);
    const unread=(d.notifications||[]).filter(n=>!n.read).length;
    document.getElementById("notificationCount").textContent=unread;
    document.getElementById("notificationCount").classList.toggle("has-unread",unread>0);
  }
  function productById(id) { return products().find(p => Number(p.id) === Number(id)); }
  function reviewFor(orderId, productId) { return (data().reviews || []).find(r => r.userId === user.id && r.orderId === orderId && Number(r.productId) === Number(productId)); }
  function activeOffers(){
    const now=new Date();
    return (data().offers||[]).filter(o=>o.active&&(!o.startDate||new Date(`${o.startDate}T00:00:00`)<=now)&&(!o.endDate||new Date(`${o.endDate}T23:59:59`)>=now));
  }

  function filteredProducts() {
    let list = products().slice();
    if (state.availability === "in") list = list.filter(p => Number(p.quantity) > 0);
    if (state.availability === "out") list = list.filter(p => Number(p.quantity) <= 0);
    if (state.offersOnly) list = list.filter(p => Boolean(store.priceInfo(p).offer));
    const sorts = {
      rating: (a,b) => Number(b.reviewAverage||0) - Number(a.reviewAverage||0),
      low: (a,b) => store.priceInfo(a).final - store.priceInfo(b).final,
      high: (a,b) => store.priceInfo(b).final - store.priceInfo(a).final
    };
    return list.sort(sorts[state.sort] || sorts.rating);
  }

  function offerAnnouncements(){
    const offers=activeOffers();
    if(!offers.length) return "";
    return `<section class="offer-announcements"><div class="announcement-label">إعلان</div><div class="announcement-track">${offers.map(offer=>{
      const product=productById(offer.productId); if(!product)return "";
      const minQty=Math.max(1,Number(offer.minQuantity||1));
      const pricing=store.priceInfo(product,minQty);
      const discount=offer.type==="percentage"?`خصم ${offer.value}% من السعر الحالي`:`خصم ${money(offer.value)} من سعر القطعة الحالي`;
      const condition=minQty>1?`عند شراء ${minQty} قطع أو أكثر`:`من أول قطعة`;
      return `<article class="offer-announcement"><div><strong>${esc(offer.title)}</strong><span>${esc(product.name)} — ${discount} — ${condition}</span></div><div class="announcement-price">${money(pricing.final)} <small>للقطعة عند تحقق الشرط</small></div></article>`;
    }).join("")}</div></section>`;
  }

  function productCard(p) {
    const saved = (data().favorites || []).includes(Number(p.id));
    const pricing = store.priceInfo(p, 1), available = Number(p.quantity) > 0;
    return `<article class="product-card">
      <div class="product-image ${p.frames?.length > 1 ? "has-360" : ""}">
        <img src="${esc(p.image)}" alt="${esc(p.name)}">
        <span class="availability ${available ? "" : "out"}">${available ? `متوفر · ${p.quantity}` : "غير متوفر"}</span>
        ${pricing.offer ? `<span class="offer-badge">${esc(pricing.offer.title)}</span>` : ""}
        <button class="favorite-button ${saved ? "saved" : ""}" data-favorite="${p.id}">${saved ? "♥" : "♡"}</button>
      </div>
      <div class="product-body">
        <span class="product-category">${esc(p.category || "أعمال خشبية")}</span>
        <h3>${esc(p.name)}</h3><p class="product-desc">${esc(p.description || "")}</p>
        <div class="rating-line"><span>${stars(p.reviewAverage)}</span><small>${Number(p.reviewAverage||0).toFixed(1)} (${p.reviewCount||0}) · بيع ${p.soldCount||0}</small></div>
        <div class="price-row"><span class="price">${money(pricing.original)}</span><small>${pricing.offer ? `${pricing.offer.minQuantity>1?`عرض عند ${pricing.offer.minQuantity}+ قطع`:`عرض متاح`}` : (p.frames?.length > 1 ? "عرض 360°" : "ESPAN")}</small></div>${pricing.offer ? `<div class="offer-condition-note">${pricing.offer.type==="percentage"?`خصم ${pricing.offer.value}%`:`خصم ${money(pricing.offer.value)}`} ${Number(pricing.offer.minQuantity||1)>1?`عند شراء ${pricing.offer.minQuantity} قطع أو أكثر`:`من أول قطعة`}</div>` : ""}
        <div class="card-actions"><a class="btn secondary" href="product.html?id=${p.id}">التفاصيل</a><button class="btn primary" data-cart-add="${p.id}" ${available ? "" : "disabled"}>${available ? "أضف للسلة" : "نفد المخزون"}</button></div>
      </div></article>`;
  }

  function renderProducts() {
    title.textContent = "المنتجات";
    intro.textContent = "تصفحي المنتجات والعروض واختاري ما يناسبك.";
    const list = filteredProducts();
    content.innerHTML = `${offerAnnouncements()}<div class="shop-toolbar simple-toolbar">
      <select id="availabilityFilter"><option value="all">كل المنتجات</option><option value="in" ${state.availability==="in"?"selected":""}>المتوفر</option><option value="out" ${state.availability==="out"?"selected":""}>غير المتوفر</option></select>
      <select id="sortFilter"><option value="rating" ${state.sort==="rating"?"selected":""}>الأعلى تقييمًا</option><option value="low" ${state.sort==="low"?"selected":""}>السعر: الأقل</option><option value="high" ${state.sort==="high"?"selected":""}>السعر: الأعلى</option></select>
      <label class="offer-toggle"><input id="offersOnly" type="checkbox" ${state.offersOnly?"checked":""}> العروض فقط</label>
    </div>${list.length ? `<div class="products-grid">${list.map(productCard).join("")}</div>` : `<div class="empty-state"><h2>لا توجد منتجات مطابقة</h2><p>غيّري خيارات التصفية.</p></div>`}`;
  }

  function renderFavorites() {
    title.textContent = "المفضلة"; intro.textContent = "إذا رجع منتج غير متوفر للمخزون، يصلك إشعار تلقائي.";
    const list = products().filter(p => (data().favorites||[]).includes(Number(p.id)));
    content.innerHTML = list.length ? `<div class="products-grid">${list.map(productCard).join("")}</div>` : `<div class="empty-state"><h2>المفضلة فارغة</h2><p>اضغطي على القلب في أي منتج.</p></div>`;
  }

  function renderCart() {
    title.textContent = "السلة";
    intro.textContent = "راجعي الكميات والعنوان ثم أرسلي الطلب؛ الدفع نقدًا عند الاستلام فقط.";
    const cart = data().cart || [];
    const lines = cart.map(item => {
      const p = productById(item.productId);
      if (!p) return null;
      const quantity = Number(item.quantity || 1);
      const pricing = store.priceInfo(p, quantity);
      return { item, p, pricing, quantity, line: pricing.final * quantity };
    }).filter(Boolean);
    const total = lines.reduce((sum, row) => sum + row.line, 0);
    const totalQty = lines.reduce((sum, row) => sum + row.quantity, 0);

    content.innerHTML = lines.length ? `
      <div class="cart-layout cart-layout-v2">
        <div class="cart-list">
          <div class="cart-list-head"><strong>منتجات السلة</strong><span>${lines.length} منتج · ${totalQty} قطعة</span></div>
          ${lines.map(({item,p,pricing,quantity,line})=>`
            <article class="cart-item cart-item-v2" data-cart-row="${p.id}">
              <img src="${esc(p.image)}" alt="${esc(p.name)}">
              <div class="cart-info">
                <span class="cart-category">${esc(p.category||"أعمال خشبية")}</span>
                <h3>${esc(p.name)}</h3>
                <small>${money(pricing.final)} للقطعة · المتوفر ${p.quantity}${pricing.offer ? (pricing.eligible ? ` · ✓ تم تطبيق ${esc(pricing.offer.title)}` : ` · العرض يبدأ من ${pricing.minQuantity} قطع`) : ""}</small>
                <div class="qty-control qty-control-v2">
                  <button type="button" aria-label="تقليل الكمية" data-cart-qty="${p.id}" data-delta="-1" ${quantity<=1?"disabled":""}>−</button>
                  <input class="cart-qty-input" type="number" min="1" max="${p.quantity}" value="${quantity}" data-cart-set="${p.id}" aria-label="الكمية">
                  <button type="button" aria-label="زيادة الكمية" data-cart-qty="${p.id}" data-delta="1" ${quantity>=Number(p.quantity)?"disabled":""}>＋</button>
                </div>
              </div>
              <div class="cart-line-total"><small>الإجمالي</small><strong>${money(line)}</strong></div>
              <button type="button" class="remove-cart" data-cart-remove="${p.id}">حذف</button>
            </article>`).join("")}
        </div>

        <form id="cartCheckout" class="checkout-card checkout-card-v2">
          <span>ملخص الطلب</span>
          <h2>${money(total)}</h2>
          <div class="checkout-summary-lines">
            <div><span>عدد القطع</span><strong>${totalQty}</strong></div>
            <div><span>طريقة الدفع</span><strong>نقدًا عند الاستلام</strong></div>
          </div>
          <label>عنوان التوصيل
            <input name="address" required value="${esc([user.city,user.address].filter(Boolean).join(" - "))}" placeholder="المدينة - المنطقة - الشارع">
          </label>
          <input type="hidden" name="paymentMethod" value="نقدًا">
          <label>ملاحظات
            <textarea name="notes" placeholder="وقت مناسب، لون، ملاحظة..."></textarea>
          </label>
          <button class="btn primary wide">إرسال الطلب</button>
          <small class="cash-note">الدفع المتوفر حاليًا: نقدًا فقط.</small>
        </form>
      </div>` :
      `<div class="empty-state"><h2>السلة فارغة</h2><p>أضيفي منتجات من صفحة المنتجات.</p><button class="btn primary" data-go-products>تصفح المنتجات</button></div>`;
  }

  function profileHTML() {
    return `<form id="profileForm">
      <h2>بياناتي</h2>
      <p class="profile-security-note">لأمان الحساب، اكتبي كلمة المرور الحالية قبل حفظ أي تعديل.</p>
      <div class="form-grid">
        <label>الاسم الكامل<input name="full_name" required value="${esc(user.full_name||"")}"></label>
        <label>رقم الهاتف<input name="phone" required value="${esc(user.phone||"")}"></label>
        <label>المدينة<input name="city" value="${esc(user.city||"")}"></label>
        <label>العنوان<input name="address" value="${esc(user.address||"")}"></label>
        <label class="full">كلمة المرور الحالية<input name="currentPassword" type="password" required autocomplete="current-password" placeholder="مطلوبة لتأكيد التعديل"></label>
        <label class="full">كلمة مرور جديدة <small>اختياري</small><input name="newPassword" type="password" minlength="8" autocomplete="new-password" placeholder="اتركيها فارغة إذا لا تريدين تغييرها"></label>
      </div>
      <button class="btn primary">حفظ التعديلات</button>
    </form>`;
  }

  function orderItemsHTML(order) { return (order.items||[]).map(i=>`<div class="mini-order-item"><img src="${esc(i.image)}" alt=""><span><b>${esc(i.productName)}</b><small>${i.quantity} × ${money(i.unitPrice)}</small></span><strong>${money(i.total)}</strong></div>`).join(""); }
  function reviewsHTML(order) {
    if (order.status !== "تم التسليم") return "";
    return `<div class="review-zone"><h4>قيّمي المنتجات بعد الاستلام</h4>${(order.items||[]).map(item=>{ const existing=reviewFor(order.id,item.productId); if(existing) return `<div class="review-done"><b>${esc(item.productName)}</b><span>${stars(existing.rating)}</span><small>${esc(existing.comment||"تم إرسال التقييم")}</small></div>`; return `<form class="review-form" data-review-form><input type="hidden" name="orderId" value="${order.id}"><input type="hidden" name="productId" value="${item.productId}"><b>${esc(item.productName)}</b><select name="rating" required><option value="">النجوم</option><option value="5">★★★★★ ممتاز</option><option value="4">★★★★ جيد جدًا</option><option value="3">★★★ جيد</option><option value="2">★★ مقبول</option><option value="1">★ ضعيف</option></select><input name="comment" placeholder="تعليق اختياري"><button class="btn secondary">إرسال التقييم</button></form>`; }).join("")}</div>`;
  }
  function pendingEditHTML(order){
    if(order.status!=="طلب جديد") return "";
    return `<details class="pending-edit"><summary>تعديل الطلب قبل تأكيد الإدارة</summary><form data-pending-edit="${order.id}"><div class="pending-items">${(order.items||[]).map(item=>`<label><span>${esc(item.productName)}</span><input type="number" min="0" max="${Number(item.quantity)+(Number(productById(item.productId)?.quantity)||0)}" value="${item.quantity}" data-edit-item="${item.productId}"><small>0 = حذف المنتج من الطلب</small></label>`).join("")}</div><div class="form-grid"><label class="full">عنوان التوصيل<input name="address" value="${esc(order.address||"")}"></label><input type="hidden" name="paymentMethod" value="نقدًا"><label>الدفع<input value="نقدًا فقط" disabled></label><label>ملاحظات<input name="notes" value="${esc(order.notes||"")}"></label></div><div class="pending-actions"><button class="btn primary">حفظ التعديل</button><button class="btn danger-button" type="button" data-cancel-order="${order.id}">إلغاء الطلب بالكامل</button></div></form></details>`;
  }
  function ordersHTML() {
    const list=(data().orders||[]).filter(o=>o.userId===user.id).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    if(!list.length) return `<div class="empty-state"><h2>لا توجد طلبات</h2><p>طلباتك الجديدة ستظهر هنا.</p></div>`;
    return `<div class="orders-stack">${list.map(o=>`<article class="customer-order"><header><div><span>${esc(o.id)}</span><h3>${esc(o.productName)}</h3><small>${dateText(o.createdAt)}</small></div><span class="status ${o.status==="تم التسليم"?"delivered":""}">${esc(o.status)}</span></header>${orderItemsHTML(o)}<div class="order-total"><span>${o.deliveryName?`المندوب: ${esc(o.deliveryName)}`:"لم يتم تعيين مندوب بعد"}</span><strong>${money(o.total)}</strong></div>${o.status!=="ملغي"?`<button class="btn secondary" data-reorder="${o.id}">اطلب مرة أخرى</button>`:""}${pendingEditHTML(o)}${reviewsHTML(o)}</article>`).join("")}</div>`;
  }
  function complaintsHTML() {
    const myOrders=(data().orders||[]).filter(o=>o.userId===user.id&&o.status==="تم التسليم");
    const mine=(data().complaints||[]).filter(c=>c.userId===user.id);
    const complained=new Set(mine.map(c=>Number(c.productId||0)).filter(Boolean));
    const choices=[]; const seen=new Set();
    myOrders.slice().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).forEach(order=>{
      (order.items||[]).forEach(item=>{
        const pid=Number(item.productId);
        if(!pid||seen.has(pid)||complained.has(pid)) return;
        seen.add(pid); choices.push({orderId:order.id,productId:pid,productName:item.productName});
      });
    });
    const form=choices.length?`<form id="complaintForm" class="complaint-form"><h2>إرسال شكوى</h2><p>يمكن إرسال شكوى واحدة فقط لكل منتج تم استلامه.</p><label>المنتج<select name="complaintKey" required>${choices.map(x=>`<option value="${esc(x.orderId)}|${x.productId}">${esc(x.productName)} — ${esc(x.orderId)}</option>`).join("")}</select></label><textarea name="message" required minlength="3" placeholder="اكتبي تفاصيل الشكوى"></textarea><button class="btn primary">إرسال</button></form>`:(myOrders.length?`<div class="locked-note">تم إرسال شكوى لكل المنتجات المؤهلة لديك. لكل منتج شكوى واحدة فقط.</div>`:`<div class="locked-note">الشكاوى تتفعّل بعد استلام طلب.</div>`);
    return `<div class="complaints-wrap">${form}<div>${mine.length?mine.map(c=>`<div class="complaint-history"><strong>${esc(c.productName||c.orderId)} · ${esc(c.status)}</strong><small>${esc(c.orderId||"")}</small><p>${esc(c.message)}</p>${c.reply?`<div><b>رد الإدارة:</b> ${esc(c.reply)}</div>`:""}</div>`).join(""):`<div class="empty-state"><p>لا توجد شكاوى سابقة.</p></div>`}</div></div>`;
  }
  function renderNotifications(){
    title.textContent="الإشعارات"; intro.textContent="تأكيد الطلب، رجوع المنتجات للمخزون، وحالة طلباتك تظهر هنا.";
    const list=(data().notifications||[]).slice().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    content.innerHTML=`<div class="notifications-head"><strong>${list.filter(n=>!n.read).length} غير مقروء</strong>${list.length?`<button class="btn secondary" data-read-all>تحديد الكل كمقروء</button>`:""}</div>${list.length?`<div class="customer-notifications">${list.map(n=>`<article class="customer-notification ${n.read?"":"unread"}" data-notification="${n.id}"><div><span>${esc(n.title)}</span><p>${esc(n.message)}</p></div><small>${dateText(n.createdAt)}</small></article>`).join("")}</div>`:`<div class="empty-state"><h2>لا توجد إشعارات</h2><p>أي تحديث مهم سيظهر هنا.</p></div>`}`;
  }
  function renderAccount() {
    title.textContent=`حسابي — ${user.full_name}`; intro.textContent="تابعي الطلبات وعدّلي بياناتك.";
    const section=state.accountSection;
    content.innerHTML=`<div class="account-layout"><aside class="side-menu"><button data-section="profile" class="${section==="profile"?"active":""}">بياناتي</button><button data-section="orders" class="${section==="orders"?"active":""}">طلباتي</button><button data-section="complaints" class="${section==="complaints"?"active":""}">الشكاوى</button><button id="logout" class="logout">تسجيل الخروج</button></aside><div class="panel">${section==="profile"?profileHTML():section==="orders"?ordersHTML():complaintsHTML()}</div></div>`;
  }

  function render() { ({products:renderProducts,cart:renderCart,favorites:renderFavorites,notifications:renderNotifications,account:renderAccount}[state.view]||renderProducts)(); counts(); }
  function switchView(view) { state.view=view; menu.querySelectorAll("[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===view)); render(); }

  menu.addEventListener("click",e=>{const b=e.target.closest("[data-view]");if(b)switchView(b.dataset.view);});
  content.addEventListener("change",async e=>{
    if(e.target.id==="availabilityFilter"){state.availability=e.target.value;renderProducts();}
    if(e.target.id==="sortFilter"){state.sort=e.target.value;renderProducts();}
    if(e.target.id==="offersOnly"){state.offersOnly=e.target.checked;renderProducts();}
    if(e.target.matches("[data-cart-set]")){
      const productId=Number(e.target.dataset.cartSet);
      const product=productById(productId);
      const requested=Math.max(1,Math.min(Number(product?.quantity||1),Number(e.target.value||1)));
      try{ await store.updateCartItemAsync(productId,requested); toast("تم تحديث الكمية"); }catch(err){ toast(err.message||"تعذر تحديث الكمية"); }
      renderCart();counts();
    }
  });
  content.addEventListener("click",async e=>{
    const fav=e.target.closest("[data-favorite]"); if(fav){try{const r=await store.toggleFavoriteAsync(Number(fav.dataset.favorite));toast(r.favorite?"تمت الإضافة للمفضلة":"تمت الإزالة من المفضلة");render();}catch(err){toast(err.message||"تعذر تحديث المفضلة");}return;}
    const add=e.target.closest("[data-cart-add]"); if(add){try{await store.addToCartAsync(Number(add.dataset.cartAdd),1);toast("تمت الإضافة للسلة");counts();}catch(err){toast(err.message||"تعذر الإضافة للسلة");}return;}
    const qty=e.target.closest("[data-cart-qty]"); if(qty){
      const item=(data().cart||[]).find(x=>Number(x.productId)===Number(qty.dataset.cartQty));
      if(!item)return;
      const next=Math.max(1,Number(item.quantity)+Number(qty.dataset.delta));
      try{await store.updateCartItemAsync(item.productId,next);toast("تم تحديث الكمية");}catch(err){toast(err.message||"تعذر تحديث الكمية");}
      renderCart();counts();return;
    }
    const rem=e.target.closest("[data-cart-remove]"); if(rem){try{await store.removeCartItemAsync(Number(rem.dataset.cartRemove));toast("تم حذف المنتج من السلة");}catch(err){toast(err.message||"تعذر حذف المنتج");}renderCart();counts();return;}
    if(e.target.closest("[data-go-products]")){switchView("products");return;}
    const sec=e.target.closest("[data-section]"); if(sec){state.accountSection=sec.dataset.section;renderAccount();return;}
    const re=e.target.closest("[data-reorder]"); if(re){if(!confirm("إنشاء طلب جديد بنفس المنتجات وبالأسعار الحالية؟"))return;try{const r=await store.reorderAsync(re.dataset.reorder);toast(`تم إنشاء الطلب ${r.order.id}`);}catch(err){toast(err.message||"تعذر إعادة الطلب");}renderAccount();return;}
    const cancel=e.target.closest("[data-cancel-order]"); if(cancel){if(!confirm("هل تريدين إلغاء الطلب قبل تأكيد الإدارة؟ ستعود الكميات للمخزون."))return;try{await store.cancelPendingOrderAsync(cancel.dataset.cancelOrder);toast("تم إلغاء الطلب");}catch(err){toast(err.message||"تعذر إلغاء الطلب");}renderAccount();return;}
    const notification=e.target.closest("[data-notification]"); if(notification){await store.markNotificationAsync(notification.dataset.notification);knownUnread.delete(notification.dataset.notification);renderNotifications();return;}
    if(e.target.closest("[data-read-all]")){await store.markAllNotificationsAsync();knownUnread.clear();renderNotifications();return;}
    if(e.target.id==="logout"){store.logout();location.href="auth.html#loginSection";}
  });
  content.addEventListener("submit",async e=>{
    e.preventDefault(); const form=e.target, values=Object.fromEntries(new FormData(form));
    if(form.id==="cartCheckout"){values.paymentMethod="نقدًا";try{const r=await store.checkoutCartAsync(values);toast(`تم إرسال الطلب ${r.order.id}`);state.accountSection="orders";switchView("account");}catch(err){toast(err.message||"تعذر إرسال الطلب");}}
    if(form.id==="profileForm"){const r=store.updateProfile(user.id,values);if(r.ok){user=r.user;toast("تم حفظ البيانات");renderAccount();}else toast(r.message);}
    if(form.id==="complaintForm"){try{const [orderId,productId]=String(values.complaintKey||"").split("|");await store.addComplaintAsync({orderId,productId:Number(productId),message:values.message});toast("تم إرسال الشكوى");renderAccount();}catch(err){toast(err.message);}}
    if(form.matches("[data-review-form]")){try{await store.addReviewAsync({...values,rating:Number(values.rating),productId:Number(values.productId)});toast("شكرًا، تم حفظ تقييمك");}catch(err){toast(err.message||"تعذر حفظ التقييم");}renderAccount();}
    if(form.matches("[data-pending-edit]")){
      const items=[...form.querySelectorAll("[data-edit-item]")].map(input=>({productId:Number(input.dataset.editItem),quantity:Number(input.value||0)}));
      try{await store.updatePendingOrderAsync(form.dataset.pendingEdit,{items,address:values.address,paymentMethod:values.paymentMethod,notes:values.notes});toast("تم حفظ تعديل الطلب");}catch(err){toast(err.message||"تعذر تعديل الطلب");}renderAccount();
    }
  });

  window.addEventListener("espan:database-change",counts);
  counts(); render();
  setInterval(async()=>{
    try{await store.refreshAsync();}catch(_){return;}
    const unread=(data().notifications||[]).filter(n=>!n.read);
    const fresh=unread.find(n=>!knownUnread.has(n.id));
    unread.forEach(n=>knownUnread.add(n.id));
    if(fresh) toast(`${fresh.title}: ${fresh.message}`);
    counts();
    if(["products","notifications"].includes(state.view)) render();
  },15000);
}());
