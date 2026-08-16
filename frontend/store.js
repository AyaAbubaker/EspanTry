(function () {
  "use strict";

  const USER_KEY = "espanUser";
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const normalizePhone = (phone = "") => String(phone).replace(/[\s()+-]/g, "").replace(/^218/, "0");
  const emptyDatabase = () => ({
    products: Array.isArray(window.ESPAN_DEFAULT_PRODUCTS) ? clone(window.ESPAN_DEFAULT_PRODUCTS) : [],
    users: [], orders: [], offers: [], complaints: [], notifications: [], activity: [], favorites: [], cart: [], reviews: [], reports: null,
    settings: { businessName: "ESPAN Woodwork", adminWhatsApp: "0913219196", businessPhone: "0913219196", whatsappWebhook: "", lowStockThreshold: 3, autoWhatsAppHint: true }
  });
  let db = emptyDatabase();
  localStorage.removeItem("espanApiToken");

  function setSession(user) {
    // Session token is stored only in an HttpOnly cookie by the server.
    // Keep only non-sensitive user display data in localStorage.
    localStorage.removeItem("espanApiToken");
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user)); else localStorage.removeItem(USER_KEY);
  }

  function request(method, url, body, useAuth = true) {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url, false);
    xhr.setRequestHeader("Accept", "application/json");
    if (body !== undefined) xhr.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
    try {
      xhr.send(body === undefined ? null : JSON.stringify(body));
    } catch (error) {
      return { ok: false, status: 0, message: "تعذر الاتصال بالخادم. شغّلي المشروع من ملف «تشغيل-المشروع.sh» ثم افتحي الرابط الذي يظهر في Terminal.", error };
    }
    let payload = {};
    try { payload = xhr.responseText ? JSON.parse(xhr.responseText) : {}; } catch (_) { payload = {}; }
    payload.status = xhr.status;
    if (xhr.status >= 200 && xhr.status < 300) return { ok: payload.ok !== false, ...payload };
    if (xhr.status === 401) setSession(null);
    return { ok: false, message: payload.message || `خطأ من الخادم (${xhr.status})`, ...payload };
  }

  function refresh() {
    const result = request("GET", "/api/bootstrap");
    if (result.ok && result.data) {
      if (result.authenticated === false) setSession(null);
      db = result.data;
      window.dispatchEvent(new CustomEvent("espan:database-change"));
    }
    return clone(db);
  }

  async function requestAsync(method, url, body, useAuth = true) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json;charset=UTF-8";
    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        credentials: "same-origin"
      });
    } catch (error) {
      return { ok: false, status: 0, message: "تعذر الاتصال بالخادم. تأكدي أن المشروع شغال من start.sh.", error };
    }
    let payload = {};
    try { payload = await response.json(); } catch (_) { payload = {}; }
    payload.status = response.status;
    if (response.ok) return { ok: payload.ok !== false, ...payload };
    if (response.status === 401) setSession(null);
    return { ok: false, message: payload.message || `خطأ من الخادم (${response.status})`, ...payload };
  }

  async function refreshAsync() {
    const result = await requestAsync("GET", "/api/bootstrap");
    if (result.ok && result.data) {
      if (result.authenticated === false) setSession(null);
      db = result.data;
      window.dispatchEvent(new CustomEvent("espan:database-change"));
    }
    return clone(db);
  }

  function currentUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || "null"); } catch (_) { return null; }
  }
  function roleHome(role) { return role === "admin" ? "admin.html" : role === "delivery" ? "delivery.html" : "account.html"; }
  function redirectUrl(url) { return url; }
  function persistNow() { return true; }

  function login(phone, password) {
    const result = request("POST", "/api/auth/login", { phone: normalizePhone(phone), password }, false);
    if (result.ok) {
      setSession(result.user);
      refresh();
      result.redirect = roleHome(result.user?.role || "customer");
    }
    return result;
  }
  function registerCustomer(data) {
    const result = request("POST", "/api/auth/register", { ...data, phone: normalizePhone(data.phone) }, false);
    if (result.ok) { setSession(result.user); refresh(); }
    return result;
  }
function logout() {
  try {
    request("POST", "/api/auth/logout", {});
  } catch (_) {}

  setSession(null);
  db = emptyDatabase();
}
  function requireRole(roles) {
    const user = currentUser();
    return Boolean(user && roles.includes(user.role));
  }

  function getActiveOffer(productId) {
    const now = new Date();
    return db.offers.find((offer) => Number(offer.productId) === Number(productId) && offer.active && (!offer.startDate || new Date(`${offer.startDate}T00:00:00`) <= now) && (!offer.endDate || new Date(`${offer.endDate}T23:59:59`) >= now)) || null;
  }
  function priceInfo(product, quantity = 1) {
    const original = Number(product?.price || 0);
    const offer = getActiveOffer(product?.id);
    if (!offer) return { original, final: original, offer: null, eligible: false, minQuantity: 1, savings: 0 };
    const minQuantity = Math.max(1, Number(offer.minQuantity || 1));
    const eligible = Number(quantity || 0) >= minQuantity;
    let final = original;
    if (eligible) {
      if (offer.type === "percentage") final = Math.max(0, original * (1 - Number(offer.value || 0) / 100));
      else final = Math.max(0, original - Number(offer.value || 0));
    }
    final = Math.round(final * 100) / 100;
    return { original, final, offer, eligible, minQuantity, savings: Math.max(0, Math.round((original - final) * 100) / 100) };
  }

  function ensure(result) {
    if (!result.ok) throw new Error(result.message || "تعذر تنفيذ العملية.");
    refresh();
    return result;
  }
  function upsertProduct(data) {
    const id = Number(data?.id || 0);
    const result = id
      ? request("PUT", `/api/products/${encodeURIComponent(id)}`, { ...data, id: undefined })
      : request("POST", "/api/products", data);
    return ensure(result).product;
  }
  async function upsertProductAsync(data) {
    const id = Number(data?.id || 0);
    const result = id
      ? await requestAsync("PUT", `/api/products/${encodeURIComponent(id)}`, { ...data, id: undefined })
      : await requestAsync("POST", "/api/products", data);
    if (!result.ok) throw new Error(result.message || "تعذر حفظ المنتج.");
    await refreshAsync();
    return result.product;
  }
  function deleteProduct(id) { return ensure(request("DELETE", `/api/products/${encodeURIComponent(id)}`)); }
  async function deleteProductAsync(id) {
    const result = await requestAsync("DELETE", `/api/products/${encodeURIComponent(id)}`);
    if (!result.ok) throw new Error(result.message || "تعذر حذف المنتج.");
    await refreshAsync();
    return result;
  }
  function createOrder(data) { const result = request("POST", "/api/orders", data); if (result.ok) refresh(); return result; }
  function updateOrder(id, patch) { const result = request("PATCH", `/api/orders/${encodeURIComponent(id)}`, patch); if (!result.ok) throw new Error(result.message); refresh(); return result.order; }
  function assignDelivery(id, deliveryId) { const result = request("POST", `/api/orders/${encodeURIComponent(id)}/assign`, { deliveryId }); if (!result.ok) throw new Error(result.message); refresh(); return result.order; }
  function addOffer(data) { return ensure(request("POST", "/api/offers", data)); }
  function deleteOffer(id) { return ensure(request("DELETE", `/api/offers/${encodeURIComponent(id)}`)); }
  function addComplaint(data) { const result = request("POST", "/api/complaints", data); if (!result.ok) throw new Error(result.message); refresh(); return result; }
  function updateComplaint(id, patch) { return ensure(request("PATCH", `/api/complaints/${encodeURIComponent(id)}`, patch)); }
  function upsertUser(data) { const result = request("POST", "/api/users", data); if (result.ok) refresh(); return result; }
  function updateProfile(id, data) {
    const result = request("PATCH", `/api/users/${encodeURIComponent(id)}/profile`, data);
    if (result.ok) { setSession(result.user); refresh(); }
    return result;
  }
  function deleteUser(id) { const result = request("DELETE", `/api/users/${encodeURIComponent(id)}`); if (result.ok) refresh(); return result; }
  function updateSettings(patch) { const result = request("PATCH", "/api/settings", patch); if (!result.ok) throw new Error(result.message); refresh(); return db.settings; }
  function markNotification(id, read = true) { request("PATCH", `/api/notifications/${encodeURIComponent(id)}`, { read }); refresh(); }
  function markAllNotifications() { request("POST", "/api/notifications/read-all", {}); refresh(); }
  function toggleFavorite(productId) { const result = request("POST", `/api/favorites/${Number(productId)}/toggle`, {}); if (result.ok) refresh(); return result; }
  function addToCart(productId, quantity = 1) {
    const pid=Number(productId), result=request("POST","/api/cart/items",{productId:pid,quantity:Number(quantity)});
    if(result.ok){ const current=db.cart.find(x=>Number(x.productId)===pid); if(current) current.quantity=Number(result.quantity||current.quantity); else db.cart.push({productId:pid,quantity:Number(result.quantity||quantity)}); window.dispatchEvent(new CustomEvent("espan:database-change")); }
    return result;
  }
  function updateCartItem(productId, quantity) {
    const pid=Number(productId), result=request("PATCH",`/api/cart/items/${pid}`,{quantity:Number(quantity)});
    if(result.ok){ const current=db.cart.find(x=>Number(x.productId)===pid); if(current) current.quantity=Number(result.quantity||quantity); window.dispatchEvent(new CustomEvent("espan:database-change")); }
    return result;
  }
  function removeCartItem(productId) {
    const pid=Number(productId), result=request("DELETE",`/api/cart/items/${pid}`);
    if(result.ok){ db.cart=db.cart.filter(x=>Number(x.productId)!==pid); window.dispatchEvent(new CustomEvent("espan:database-change")); }
    return result;
  }
  function checkoutCart(data) { const result = request("POST", "/api/cart/checkout", data || {}); if (result.ok) refresh(); return result; }
  function reorder(orderId, data = {}) { const result = request("POST", `/api/orders/${encodeURIComponent(orderId)}/reorder`, data); if (result.ok) refresh(); return result; }
  function addReview(data) { const result = request("POST", "/api/reviews", data); if (result.ok) refresh(); return result; }
  function updatePendingOrder(id, data) { const result = request("PUT", `/api/orders/${encodeURIComponent(id)}/customer`, data); if (result.ok) refresh(); return result; }
  function cancelPendingOrder(id) { const result = request("DELETE", `/api/orders/${encodeURIComponent(id)}/customer`); if (result.ok) refresh(); return result; }
  function updateCash(id, patch) { const result = request("PATCH", `/api/orders/${encodeURIComponent(id)}/cash`, patch); if (result.ok) refresh(); return result; }
  function getReports() { const result = request("GET", "/api/admin/reports"); if (result.ok) { db.reports = result.reports; window.dispatchEvent(new CustomEvent("espan:database-change")); } return result; }
  async function createOrderAsync(data) { const r=await requestAsync("POST","/api/orders",data); if(!r.ok) throw new Error(r.message||"تعذر إنشاء الطلب"); await refreshAsync(); return r; }
  async function toggleFavoriteAsync(productId) { const r=await requestAsync("POST",`/api/favorites/${Number(productId)}/toggle`,{}); if(!r.ok) throw new Error(r.message||"تعذر تحديث المفضلة"); await refreshAsync(); return r; }
  async function addToCartAsync(productId, quantity=1) { const r=await requestAsync("POST","/api/cart/items",{productId:Number(productId),quantity:Number(quantity)}); if(!r.ok) throw new Error(r.message||"تعذر إضافة المنتج للسلة"); await refreshAsync(); return r; }
  async function updateCartItemAsync(productId, quantity) { const r=await requestAsync("PATCH",`/api/cart/items/${Number(productId)}`,{quantity:Number(quantity)}); if(!r.ok) throw new Error(r.message||"تعذر تحديث السلة"); await refreshAsync(); return r; }
  async function removeCartItemAsync(productId) { const r=await requestAsync("DELETE",`/api/cart/items/${Number(productId)}`); if(!r.ok) throw new Error(r.message||"تعذر حذف المنتج من السلة"); await refreshAsync(); return r; }
  async function checkoutCartAsync(data) { const r=await requestAsync("POST","/api/cart/checkout",data||{}); if(!r.ok) throw new Error(r.message||"تعذر إرسال الطلب"); await refreshAsync(); return r; }
  async function reorderAsync(orderId, data={}) { const r=await requestAsync("POST",`/api/orders/${encodeURIComponent(orderId)}/reorder`,data); if(!r.ok) throw new Error(r.message||"تعذر إعادة الطلب"); await refreshAsync(); return r; }
  async function addReviewAsync(data) { const r=await requestAsync("POST","/api/reviews",data); if(!r.ok) throw new Error(r.message||"تعذر حفظ التقييم"); await refreshAsync(); return r; }
  async function updatePendingOrderAsync(id,data) { const r=await requestAsync("PUT",`/api/orders/${encodeURIComponent(id)}/customer`,data); if(!r.ok) throw new Error(r.message||"تعذر تعديل الطلب"); await refreshAsync(); return r; }
  async function cancelPendingOrderAsync(id) { const r=await requestAsync("DELETE",`/api/orders/${encodeURIComponent(id)}/customer`); if(!r.ok) throw new Error(r.message||"تعذر إلغاء الطلب"); await refreshAsync(); return r; }
  async function addComplaintAsync(data) { const r=await requestAsync("POST","/api/complaints",data); if(!r.ok) throw new Error(r.message||"تعذر إرسال الشكوى"); await refreshAsync(); return r; }
  async function markNotificationAsync(id, read=true) { const r=await requestAsync("PATCH",`/api/notifications/${encodeURIComponent(id)}`,{read}); if(r.ok) await refreshAsync(); return r; }
  async function markAllNotificationsAsync() { const r=await requestAsync("POST","/api/notifications/read-all",{}); if(r.ok) await refreshAsync(); return r; }
  async function addOfferAsync(data) { const r=await requestAsync("POST","/api/offers",data); if(!r.ok) throw new Error(r.message||"تعذر حفظ العرض"); await refreshAsync(); return r; }
  async function deleteOfferAsync(id) { const r=await requestAsync("DELETE",`/api/offers/${encodeURIComponent(id)}`); if(!r.ok) throw new Error(r.message||"تعذر حذف العرض"); await refreshAsync(); return r; }
  async function updateComplaintAsync(id, patch) { const r=await requestAsync("PATCH",`/api/complaints/${encodeURIComponent(id)}`,patch); if(!r.ok) throw new Error(r.message||"تعذر حفظ الشكوى"); await refreshAsync(); return r; }
  async function upsertUserAsync(data) { const r=await requestAsync("POST","/api/users",data); if(!r.ok) throw new Error(r.message||"تعذر حفظ المستخدم"); await refreshAsync(); return r; }
  async function deleteUserAsync(id) { const r=await requestAsync("DELETE",`/api/users/${encodeURIComponent(id)}`); if(!r.ok) throw new Error(r.message||"تعذر حذف المستخدم"); await refreshAsync(); return r; }
  async function updateOrderAsync(id, patch) { const r=await requestAsync("PATCH",`/api/orders/${encodeURIComponent(id)}`,patch); if(!r.ok) throw new Error(r.message||"تعذر تحديث الطلب"); await refreshAsync(); return r.order; }
  async function assignDeliveryAsync(id, deliveryId) { const r=await requestAsync("POST",`/api/orders/${encodeURIComponent(id)}/assign`,{deliveryId}); if(!r.ok) throw new Error(r.message||"تعذر تعيين المندوب"); await refreshAsync(); return r.order; }
  async function updateCashAsync(id, patch) { const r=await requestAsync("PATCH",`/api/orders/${encodeURIComponent(id)}/cash`,patch); if(!r.ok) throw new Error(r.message||"تعذر تحديث التحصيل"); await refreshAsync(); return r; }

  function getPushPublicKey() { return request("GET", "/api/push/public-key"); }
  function savePushSubscription(subscription) { return request("POST", "/api/push/subscribe", { subscription }); }
  function removePushSubscription(endpoint) { return request("DELETE", "/api/push/unsubscribe", { endpoint }); }

  function orderWhatsAppMessage(order) {
    const items = (order.items || []).map((item, index) => `${index + 1}) ${item.productName} × ${item.quantity} = ${item.total} د.ل`).join("\n");
    return ["طلب جديد من موقع ESPAN", `رقم الطلب: ${order.id}`, `العميل: ${order.customerName}`, `الهاتف: ${order.customerPhone || "غير مسجل"}`, items || `المنتج: ${order.productName} × ${order.quantity}`, `الإجمالي: ${order.total} د.ل`, `العنوان: ${order.address || "غير مسجل"}`, `الدفع: ${order.paymentMethod}`, order.notes ? `ملاحظات: ${order.notes}` : ""].filter(Boolean).join("\n");
  }
  function deliveryWhatsAppMessage(order, stage) {
    if (stage === "picked") return `مرحبًا ${order.customerName}، تم استلام طلبك ${order.id} من ESPAN بواسطة ${order.deliveryName || "مندوب التوصيل"} وهو الآن في الطريق إليك.`;
    return `مرحبًا ${order.customerName}، تم تسليم طلبك ${order.id} بنجاح. نشكرك لاختيار ESPAN.`;
  }
  function whatsappLink(phone, message) {
    let clean = String(phone || "").replace(/\D/g, "");
    if (clean.startsWith("0")) clean = `218${clean.slice(1)}`;
    return `https://wa.me/${clean}?text=${encodeURIComponent(message)}`;
  }
  function exportData() { const result = request("GET", "/api/admin/export"); if (!result.ok) throw new Error(result.message); return JSON.stringify(result, null, 2); }
  function importData(payload) { const result = request("POST", "/api/admin/import", typeof payload === "string" ? JSON.parse(payload) : payload); if (!result.ok) throw new Error(result.message); refresh(); }

  refresh();

  window.ESPANStore = {
    get data() { return clone(db); }, refresh, refreshAsync, currentUser, roleHome, redirectUrl, persistNow,
    login, registerCustomer, logout, requireRole, getActiveOffer, priceInfo,
    upsertProduct, upsertProductAsync, deleteProduct, deleteProductAsync, createOrder, createOrderAsync, updateOrder, updateOrderAsync, assignDelivery, assignDeliveryAsync,
    addOffer, addOfferAsync, deleteOffer, deleteOfferAsync, addComplaint, updateComplaint, updateComplaintAsync, upsertUser, upsertUserAsync, updateProfile,
    deleteUser, deleteUserAsync, updateSettings, markNotification, markNotificationAsync, markAllNotifications, markAllNotificationsAsync, toggleFavorite, toggleFavoriteAsync,
    addToCart, addToCartAsync, updateCartItem, updateCartItemAsync, removeCartItem, removeCartItemAsync, checkoutCart, checkoutCartAsync, reorder, reorderAsync, addReview, addReviewAsync, updatePendingOrder, updatePendingOrderAsync, cancelPendingOrder, cancelPendingOrderAsync, addComplaintAsync, updateCash, updateCashAsync, getReports,
    getPushPublicKey, savePushSubscription, removePushSubscription,
    orderWhatsAppMessage, deliveryWhatsAppMessage, whatsappLink, normalizePhone,
    exportData, importData
  };
}());
