(function () {
  "use strict";

  const store = window.ESPANStore;

  if (!store || !store.requireRole(["admin"])) {
    window.location.replace("auth.html#loginSection");
    return;
  }

  /* =========================================================
     DOM
  ========================================================= */

  const content = document.getElementById("adminContent");
  const viewTitle = document.getElementById("viewTitle");

  const modal = document.getElementById("appModal");
  const modalTitle = document.getElementById("modalTitle");
  const modalLabel = document.getElementById("modalLabel");
  const modalBody = document.getElementById("modalBody");

  const toastElement = document.getElementById("toast");

  const state = {
    view: "dashboard",
    search: "",
    orderStatus: "all",
    uploadedFrames: [],
    searchTimer: null,
    chartTimer: null
  };

  const viewNames = {
    dashboard: "نظرة عامة",
    products: "المنتجات والمخزون",
    orders: "الطلبات",
    offers: "العروض",
    complaints: "الشكاوى",
    users: "المستخدمون والصلاحيات",
    collections: "التحصيلات",
    audit: "سجل النشاط"
  };

  const orderStatuses = [
    "طلب جديد",
    "تم التأكيد",
    "قيد التجهيز",
    "جاهز للتوصيل",
    "خرج للتوصيل",
    "تم التسليم",
    "ملغي"
  ];

  /* =========================================================
     HELPERS
  ========================================================= */

  function db() {
    return store.data;
  }

  function escapeHTML(value = "") {
    return String(value).replace(
      /[&<>'"]/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          "'": "&#39;",
          '"': "&quot;"
        })[char]
    );
  }

  function money(value) {
    return `${new Intl.NumberFormat("ar-LY", {
      maximumFractionDigits: 2
    }).format(Number(value || 0))} د.ل`;
  }

  function dateText(value, withTime = false) {
    if (!value) return "—";

    try {
      return new Intl.DateTimeFormat(
        "ar-LY",
        withTime
          ? {
              dateStyle: "medium",
              timeStyle: "short"
            }
          : {
              dateStyle: "medium"
            }
      ).format(new Date(value));
    } catch (_) {
      return value;
    }
  }

  function roleLabel(role) {
    return (
      {
        admin: "مدير",
        delivery: "توصيل",
        customer: "عميل"
      }[role] || role
    );
  }

  function statusClass(status) {
    return (
      {
        "طلب جديد": "new",
        "قيد المراجعة": "new",
        "تم التأكيد": "preparing",
        "قيد التجهيز": "preparing",
        "جاهز للتوصيل": "preparing",
        "خرج للتوصيل": "shipping",
        "تم التسليم": "delivered",
        "ملغي": "cancelled"
      }[status] || ""
    );
  }

  function toast(message) {
    if (!toastElement) {
      console.log(message);
      return;
    }

    toastElement.textContent = message;
    toastElement.classList.add("show");

    clearTimeout(toastElement.timer);

    toastElement.timer = setTimeout(() => {
      toastElement.classList.remove("show");
    }, 3000);
  }

  function sectionTop(title, description, action = "") {
    return `
      <div class="section-top">
        <div>
          <h2>${escapeHTML(title)}</h2>
          <p>${escapeHTML(description)}</p>
        </div>

        ${action}
      </div>
    `;
  }

  function emptyState(title, text) {
    return `
      <div class="empty-state">
        <h3>${escapeHTML(title)}</h3>
        <p>${escapeHTML(text)}</p>
      </div>
    `;
  }

  function openModal(title, label, body) {
    modalTitle.textContent = title;
    modalLabel.textContent = label;
    modalBody.innerHTML = body;

    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");
  }

  function closeModal() {
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden", "true");

    modalBody.innerHTML = "";
    state.uploadedFrames = [];
  }

  /* =========================================================
     CURRENT USER
  ========================================================= */

  function setCurrentUser() {
    const user = store.currentUser();

    if (!user) return;

    const name = document.getElementById("sidebarName");
    const avatar = document.getElementById("sidebarAvatar");

    if (name) {
      name.textContent = user.full_name || "مدير ESPAN";
    }

    if (avatar) {
      avatar.textContent =
        String(user.full_name || "E").trim().charAt(0) || "E";
    }
  }

  /* =========================================================
     BADGES
  ========================================================= */

  function refreshBadges() {
    const data = db();

    if (!data) return;

    const newOrders = (data.orders || []).filter((order) =>
      ["طلب جديد", "قيد المراجعة"].includes(order.status)
    ).length;

    const newComplaints = (data.complaints || []).filter(
      (item) => item.status === "جديدة"
    ).length;

    const unread = (data.notifications || []).filter(
      (item) => !item.read
    ).length;

    [
      ["ordersBadge", newOrders],
      ["complaintsBadge", newComplaints],
      ["notificationCount", unread]
    ].forEach(([id, count]) => {
      const element = document.getElementById(id);

      if (!element) return;

      element.textContent = count;
      element.classList.toggle("show", count > 0);
    });
  }

  /* =========================================================
     DASHBOARD
  ========================================================= */

  function monthlySales(orders = []) {
    const result = [];

    const formatter = new Intl.DateTimeFormat("ar-LY", {
      month: "short"
    });

    for (let offset = 5; offset >= 0; offset -= 1) {
      const date = new Date();

      date.setDate(1);
      date.setHours(0, 0, 0, 0);
      date.setMonth(date.getMonth() - offset);

      const year = date.getFullYear();
      const month = date.getMonth();

      const value = orders
        .filter((order) => {
          if (order.status !== "تم التسليم") return false;

          const orderDate = new Date(
            order.updatedAt || order.createdAt
          );

          return (
            orderDate.getFullYear() === year &&
            orderDate.getMonth() === month
          );
        })
        .reduce(
          (sum, order) => sum + Number(order.total || 0),
          0
        );

      result.push({
        label: formatter.format(date),
        value
      });
    }

    return result;
  }

  function renderDashboard() {
    const data = db();

    const orders = data.orders || [];
    const users = data.users || [];
    const products = data.products || [];
    const activity = data.activity || [];

    const now = new Date();

    const thisMonthOrders = orders.filter((order) => {
      const date = new Date(order.createdAt);

      return (
        date.getMonth() === now.getMonth() &&
        date.getFullYear() === now.getFullYear()
      );
    });

    const monthRevenue = orders
      .filter((order) => {
        if (order.status !== "تم التسليم") return false;

        const date = new Date(
          order.updatedAt || order.createdAt
        );

        return (
          date.getMonth() === now.getMonth() &&
          date.getFullYear() === now.getFullYear()
        );
      })
      .reduce(
        (sum, order) => sum + Number(order.total || 0),
        0
      );

    const customers = users.filter(
      (user) => user.role === "customer"
    ).length;

    const deliveryCount = users.filter(
      (user) => user.role === "delivery"
    ).length;

    const activeProducts = products.filter(
      (product) => Number(product.quantity) > 0
    ).length;

    const threshold = Number(
      data.settings?.lowStockThreshold || 3
    );

    const lowStock = products
      .filter(
        (product) =>
          Number(product.quantity) <= threshold
      )
      .sort(
        (a, b) =>
          Number(a.quantity) - Number(b.quantity)
      );

    const sales = monthlySales(orders);

    const recentOrders = orders
      .slice()
      .sort(
        (a, b) =>
          new Date(b.createdAt) -
          new Date(a.createdAt)
      )
      .slice(0, 6);

    content.innerHTML = `
      ${sectionTop(
        "أهلًا بك في لوحة ESPAN",
        "تابع المبيعات والمخزون والطلبات من مكان واحد.",
        `
          <button
            class="primary-action"
            data-action="add-product"
          >
            ＋ إضافة منتج جديد
          </button>
        `
      )}

      <div class="kpi-grid">

        <article
          class="kpi-card"
          style="--tone:#687052"
        >
          <span class="kpi-icon">د.ل</span>
          <small>مبيعات الشهر</small>
          <strong>${money(monthRevenue)}</strong>
          <em>${thisMonthOrders.length} طلب خلال الشهر</em>
        </article>

        <article
          class="kpi-card"
          style="--tone:#436b80"
        >
          <span class="kpi-icon">▣</span>
          <small>الطلبات الجديدة</small>
          <strong>
            ${
              orders.filter((order) =>
                ["طلب جديد", "قيد المراجعة"].includes(
                  order.status
                )
              ).length
            }
          </strong>
          <em>تحتاج متابعة الإدارة</em>
        </article>

        <article
          class="kpi-card"
          style="--tone:#b49363"
        >
          <span class="kpi-icon">▦</span>
          <small>المنتجات المتوفرة</small>
          <strong>${activeProducts}</strong>
          <em>من أصل ${products.length} منتج</em>
        </article>

        <article
          class="kpi-card"
          style="--tone:#8b5f7b"
        >
          <span class="kpi-icon">♙</span>
          <small>العملاء المسجلون</small>
          <strong>${customers}</strong>
          <em>${deliveryCount} مندوب توصيل</em>
        </article>

      </div>

      <div class="dashboard-grid">

        <article class="panel-card">

          <div class="panel-head">
            <div>
              <h3>المبيعات الشهرية</h3>
              <span>
                إجمالي الطلبات المسلّمة خلال آخر 6 أشهر
              </span>
            </div>

            <strong>
              ${money(
                sales.reduce(
                  (sum, item) => sum + item.value,
                  0
                )
              )}
            </strong>
          </div>

          <div class="chart-wrap">
            <canvas id="salesChart"></canvas>
          </div>

        </article>

        <article class="panel-card">

          <div class="panel-head">
            <div>
              <h3>تنبيه المخزون</h3>
              <span>الحد الأدنى: ${threshold} قطع</span>
            </div>

            <a href="#" data-go="products">
              عرض الكل
            </a>
          </div>

          <div class="stock-list">

            ${
              lowStock.length
                ? lowStock
                    .slice(0, 6)
                    .map(
                      (product) => `
                        <div class="stock-item">

                          <img
                            src="${escapeHTML(
                              product.image
                            )}"
                            alt=""
                          >

                          <div>
                            <strong>
                              ${escapeHTML(
                                product.name
                              )}
                            </strong>

                            <small>
                              ${escapeHTML(
                                product.category
                              )}
                            </small>
                          </div>

                          <b>
                            ${product.quantity} قطعة
                          </b>

                        </div>
                      `
                    )
                    .join("")
                : `
                    <div class="empty-state">
                      <p>
                        المخزون في حالة جيدة.
                      </p>
                    </div>
                  `
            }

          </div>

        </article>

      </div>

      <div class="recent-grid">

        <article class="panel-card">

          <div class="panel-head">
            <div>
              <h3>أحدث الطلبات</h3>
              <span>آخر حركة في المتجر</span>
            </div>

            <a href="#" data-go="orders">
              كل الطلبات
            </a>
          </div>

          ${
            recentOrders.length
              ? `
                <div class="table-wrap">

                  <table class="simple-table">

                    <thead>
                      <tr>
                        <th>الطلب</th>
                        <th>العميل</th>
                        <th>الإجمالي</th>
                        <th>الحالة</th>
                      </tr>
                    </thead>

                    <tbody>
                      ${recentOrders
                        .map(
                          (order) => `
                            <tr>

                              <td>
                                <strong>
                                  ${escapeHTML(
                                    order.id
                                  )}
                                </strong>

                                <br>

                                <small>
                                  ${dateText(
                                    order.createdAt
                                  )}
                                </small>
                              </td>

                              <td>
                                ${escapeHTML(
                                  order.customerName
                                )}
                              </td>

                              <td>
                                ${money(order.total)}
                              </td>

                              <td>
                                <span
                                  class="status-pill ${statusClass(
                                    order.status
                                  )}"
                                >
                                  ${escapeHTML(
                                    order.status
                                  )}
                                </span>
                              </td>

                            </tr>
                          `
                        )
                        .join("")}
                    </tbody>

                  </table>

                </div>
              `
              : emptyState(
                  "لا توجد طلبات",
                  "ستظهر الطلبات الجديدة هنا."
                )
          }

        </article>

        <article class="panel-card">

          <div class="panel-head">
            <div>
              <h3>آخر النشاطات</h3>
              <span>
                سجل مختصر للتغييرات
              </span>
            </div>
          </div>

          <div class="activity-list">
            ${(activity || [])
              .slice(0, 7)
              .map(
                (item) => `
                  <div class="activity-item">
                    <strong>
                      ${escapeHTML(item.text)}
                    </strong>

                    <small>
                      ${escapeHTML(
                        item.actor
                      )} · ${dateText(
                        item.createdAt,
                        true
                      )}
                    </small>
                  </div>
                `
              )
              .join("")}
          </div>

        </article>

      </div>
    `;

    requestAnimationFrame(() => {
      drawSalesChart(sales);
    });
  }

  function drawSalesChart(items) {
    const canvas = document.getElementById(
      "salesChart"
    );

    if (!canvas) return;

    const ratio = window.devicePixelRatio || 1;

    const width = canvas.clientWidth || 700;
    const height = canvas.clientHeight || 280;

    canvas.width = width * ratio;
    canvas.height = height * ratio;

    const ctx = canvas.getContext("2d");

    ctx.scale(ratio, ratio);

    ctx.clearRect(0, 0, width, height);

    const padding = {
      top: 20,
      right: 18,
      bottom: 40,
      left: 18
    };

    const chartWidth =
      width - padding.left - padding.right;

    const chartHeight =
      height - padding.top - padding.bottom;

    const max = Math.max(
      ...items.map((item) => item.value),
      100
    );

    ctx.font = '11px "Cairo"';
    ctx.textAlign = "center";

    ctx.strokeStyle = "rgba(95,70,53,.12)";
    ctx.fillStyle = "#777168";

    for (let line = 0; line <= 4; line += 1) {
      const y =
        padding.top +
        (chartHeight * line) / 4;

      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
    }

    const slot = chartWidth / items.length;

    items.forEach((item, index) => {
      const barWidth = Math.min(
        48,
        slot * 0.55
      );

      const barHeight =
        (item.value / max) *
        (chartHeight - 12);

      const x =
        padding.left +
        slot * index +
        (slot - barWidth) / 2;

      const y =
        padding.top +
        chartHeight -
        barHeight;

      const gradient =
        ctx.createLinearGradient(
          0,
          y,
          0,
          y + barHeight
        );

      gradient.addColorStop(
        0,
        "#687052"
      );

      gradient.addColorStop(
        1,
        "#a7aa8d"
      );

      ctx.fillStyle = gradient;

      roundRect(
        ctx,
        x,
        y,
        barWidth,
        barHeight,
        8
      );

      ctx.fillStyle = "#777168";

      ctx.fillText(
        item.label,
        x + barWidth / 2,
        height - 13
      );

      if (item.value) {
        ctx.fillStyle = "#2f241d";

        ctx.font =
          'bold 10px "Cairo"';

        ctx.fillText(
          new Intl.NumberFormat("ar-LY", {
            notation: "compact"
          }).format(item.value),
          x + barWidth / 2,
          Math.max(13, y - 6)
        );

        ctx.font =
          '11px "Cairo"';
      }
    });
  }

  function roundRect(
    ctx,
    x,
    y,
    width,
    height,
    radius
  ) {
    const r = Math.min(
      radius,
      width / 2,
      height / 2
    );

    ctx.beginPath();

    ctx.moveTo(x + r, y);

    ctx.arcTo(
      x + width,
      y,
      x + width,
      y + height,
      r
    );

    ctx.arcTo(
      x + width,
      y + height,
      x,
      y + height,
      r
    );

    ctx.arcTo(
      x,
      y + height,
      x,
      y,
      r
    );

    ctx.arcTo(
      x,
      y,
      x + width,
      y,
      r
    );

    ctx.closePath();
    ctx.fill();
  }

  /* =========================================================
     PRODUCTS
  ========================================================= */

  function renderProducts() {
    const data = db();

    const products =
      (data.products || []).slice();

    const threshold = Number(
      data.settings?.lowStockThreshold || 3
    );

    const warningCount = products.filter(
      (product) =>
        Number(product.quantity) <= threshold
    ).length;

    content.innerHTML = `
      ${sectionTop(
        "المنتجات والمخزون",
        "أضف المنتجات وعدّل السعر والكمية والصور وتابع حالة المخزون.",
        `
          <button
            class="primary-action"
            data-action="add-product"
          >
            ＋ إضافة منتج جديد
          </button>
        `
      )}

      <div class="filter-bar">

        <input
          id="productSearch"
          autocomplete="off"
          placeholder="ابحث باسم المنتج أو التصنيف"
        >

        <select id="stockFilter">
          <option value="all">
            كل حالات المخزون
          </option>

          <option value="low">
            قريب من النفاد
          </option>

          <option value="out">
            نفد المخزون
          </option>
        </select>

        <span
          class="badge ${
            warningCount
              ? "danger"
              : "success"
          }"
        >
          ${warningCount} تنبيه مخزون
        </span>

      </div>

      ${
        products.length
          ? `
            <div class="table-wrap">

              <table class="data-table">

                <thead>
                  <tr>
                    <th>المنتج</th>
                    <th>السعر</th>
                    <th>المخزون</th>
                    <th>المبيعات</th>
                    <th>التقييم</th>
                    <th>الصور</th>
                    <th>الحالة</th>
                    <th>الإجراءات</th>
                  </tr>
                </thead>

                <tbody id="productsTableBody">

                  ${products
                    .map((product) => {
                      const offer =
                        store.getActiveOffer(
                          product.id
                        );

                      const low =
                        Number(
                          product.quantity
                        ) <= threshold;

                      const searchable = [
                        product.name,
                        product.category,
                        product.description
                      ]
                        .join(" ")
                        .toLowerCase();

                      return `
                        <tr
                          data-product-row
                          data-search="${escapeHTML(
                            searchable
                          )}"
                          data-stock="${
                            Number(
                              product.quantity
                            ) === 0
                              ? "out"
                              : low
                              ? "low"
                              : "ok"
                          }"
                        >

                          <td>
                            <div class="product-cell">

                              <div
                                class="${
                                  product.frames
                                    ?.length > 1
                                    ? "product-thumb-360"
                                    : ""
                                }"
                              >
                                <img
                                  src="${escapeHTML(
                                    product.image
                                  )}"
                                  alt=""
                                >
                              </div>

                              <div>
                                <strong>
                                  ${escapeHTML(
                                    product.name
                                  )}
                                </strong>

                                <small>
                                  ${escapeHTML(
                                    product.category
                                  )}
                                </small>
                              </div>

                            </div>
                          </td>

                          <td>
                            <strong>
                              ${money(
                                product.price
                              )}
                            </strong>

                            ${
                              offer
                                ? `
                                  <small
                                    class="stock-warning-text"
                                  >
                                    عرض:
                                    ${
                                      offer.type ===
                                      "percentage"
                                        ? `${offer.value}%`
                                        : money(
                                            offer.value
                                          )
                                    }
                                    ${
                                      Number(
                                        offer.minQuantity ||
                                          1
                                      ) > 1
                                        ? ` عند ${offer.minQuantity}+ قطع`
                                        : ""
                                    }
                                  </small>
                                `
                                : ""
                            }
                          </td>

                          <td>
                            <strong>
                              ${Number(
                                product.quantity
                              )}
                            </strong>
                            قطعة

                            ${
                              low
                                ? `
                                  <small
                                    class="stock-warning-text"
                                  >
                                    باقي
                                    ${Number(
                                      product.quantity
                                    )}
                                    فقط
                                  </small>
                                `
                                : ""
                            }
                          </td>

                          <td>
                            <strong>
                              ${
                                product.soldCount ||
                                0
                              }
                            </strong>
                            قطعة
                          </td>

                          <td>
                            <span
                              class="rating-admin"
                            >
                              ★
                              ${Number(
                                product.reviewAverage ||
                                  0
                              ).toFixed(1)}
                            </span>

                            <small>
                              ${
                                product.reviewCount ||
                                0
                              }
                              تقييم
                            </small>
                          </td>

                          <td>
                            ${
                              product.frames
                                ?.length > 1
                                ? `
                                  <span
                                    class="badge success"
                                  >
                                    360° ·
                                    ${
                                      product.frames
                                        .length
                                    }
                                    صور
                                  </span>
                                `
                                : `
                                  <span
                                    class="badge"
                                  >
                                    صورة ثابتة
                                  </span>
                                `
                            }
                          </td>

                          <td>
                            <span
                              class="badge ${
                                Number(
                                  product.quantity
                                ) === 0
                                  ? "danger"
                                  : low
                                  ? "warning"
                                  : "success"
                              }"
                            >
                              ${
                                Number(
                                  product.quantity
                                ) === 0
                                  ? "غير متوفر"
                                  : low
                                  ? "قريب من النفاد"
                                  : "متوفر"
                              }
                            </span>
                          </td>

                          <td>
                            <div class="row-actions">

                              <button
                                class="icon-button"
                                title="تعديل المنتج"
                                data-action="edit-product"
                                data-id="${
                                  product.id
                                }"
                              >
                                ✎
                              </button>

                              <button
                                class="icon-button"
                                title="تفاصيل المنتج"
                                data-action="view-product"
                                data-id="${
                                  product.id
                                }"
                              >
                                ◉
                              </button>

                              <button
                                class="icon-button danger-icon"
                                title="حذف المنتج"
                                data-action="delete-product"
                                data-id="${
                                  product.id
                                }"
                              >
                                ⌫
                              </button>

                            </div>
                          </td>

                        </tr>
                      `;
                    })
                    .join("")}

                </tbody>
              </table>

            </div>

            <div
              id="productNoResults"
              class="empty-state"
              hidden
            >
              <h3>لا توجد نتائج</h3>
              <p>
                جرّبي كلمة بحث مختلفة.
              </p>
            </div>
          `
          : emptyState(
              "لا توجد منتجات",
              "أضيفي أول منتج من الزر أعلاه."
            )
      }
    `;
  }

  function applyProductFilters() {
    const input =
      document.getElementById(
        "productSearch"
      );

    const stock =
      document.getElementById(
        "stockFilter"
      );

    if (!input || !stock) return;

    const term = input.value
      .trim()
      .toLowerCase();

    let visible = 0;

    document
      .querySelectorAll(
        "[data-product-row]"
      )
      .forEach((row) => {
        const matchesText =
          !term ||
          (
            row.dataset.search || ""
          ).includes(term);

        const matchesStock =
          stock.value === "all" ||
          row.dataset.stock ===
            stock.value;

        row.hidden = !(
          matchesText &&
          matchesStock
        );

        if (!row.hidden) {
          visible += 1;
        }
      });

    const empty =
      document.getElementById(
        "productNoResults"
      );

    if (empty) {
      empty.hidden = visible !== 0;
    }
  }

  /* =========================================================
     PRODUCT FORM — الإصلاح الأساسي
  ========================================================= */

  function productForm(product = null) {
    if (product) {
      if (
        Array.isArray(product.frames) &&
        product.frames.length
      ) {
        state.uploadedFrames = [
          ...product.frames
        ];
      } else if (product.image) {
        state.uploadedFrames = [
          product.image
        ];
      } else {
        state.uploadedFrames = [];
      }
    } else {
      state.uploadedFrames = [];
    }

    openModal(
      product
        ? "تعديل المنتج"
        : "إضافة منتج جديد",
      "إدارة المنتجات",
      `
        <form
          id="productForm"
          novalidate
        >

          <input
            type="hidden"
            name="id"
            value="${
              product?.id || ""
            }"
          >

          <div class="form-grid">

            <label>
              اسم المنتج

              <input
                name="name"
                required
                value="${escapeHTML(
                  product?.name || ""
                )}"
              >
            </label>

            <label>
              التصنيف

              <input
                name="category"
                required
                value="${escapeHTML(
                  product?.category ||
                    "أعمال خشبية"
                )}"
              >
            </label>

            <label>
              السعر بالدينار

              <input
                name="price"
                type="number"
                min="0"
                step="0.01"
                required
                value="${
                  product?.price ?? ""
                }"
              >
            </label>

            <label>
              الكمية في المخزون

              <input
                name="quantity"
                type="number"
                min="0"
                step="1"
                required
                value="${
                  product?.quantity ?? 1
                }"
              >
            </label>

            <label class="full">
              وصف المنتج

              <textarea
                name="description"
                required
              >${escapeHTML(
                product?.description || ""
              )}</textarea>
            </label>

            <div class="full">

              <label
                class="upload-zone"
                for="productImages"
              >

                <input
                  id="productImages"
                  type="file"
                  accept="image/*"
                  multiple
                >

                <strong>
                  اضغط لاختيار صور المنتج
                </strong>

                <span>
                  حمّل أكثر من صورة
                  لتفعيل عرض 360°
                </span>

                <small>
                  حتى 8 صور.
                </small>

              </label>

              <div
                id="imagePreview"
                class="image-preview-grid"
              >

                ${state.uploadedFrames
                  .map(
                    (src) => `
                      <img
                        src="${escapeHTML(
                          src
                        )}"
                        alt=""
                      >
                    `
                  )
                  .join("")}

              </div>

              <div
                class="viewer-note"
                id="viewerNote"
              >
                ${
                  state.uploadedFrames
                    .length > 1
                    ? `عرض 360° جاهز من ${state.uploadedFrames.length} صور.`
                    : "حمّل صورتين أو أكثر لتفعيل العرض التفاعلي 360°."
                }
              </div>

            </div>

          </div>

          <div class="form-actions">

            <button
              type="submit"
              class="primary-action"
              id="saveProductButton"
            >
              ${
                product
                  ? "حفظ التعديلات"
                  : "إضافة المنتج"
              }
            </button>

            <button
              type="button"
              class="ghost-action"
              id="cancelProductButton"
            >
              إلغاء
            </button>

          </div>

        </form>
      `
    );

    bindProductForm();
  }

  function bindProductForm() {
    const form =
      document.getElementById(
        "productForm"
      );

    if (!form) {
      console.error(
        "ESPAN: productForm not found"
      );
      return;
    }

    const saveButton =
      document.getElementById(
        "saveProductButton"
      );

    const cancelButton =
      document.getElementById(
        "cancelProductButton"
      );

    const imagesInput =
      document.getElementById(
        "productImages"
      );

    form.onsubmit = async (event) => {
      event.preventDefault();

      await saveProductForm(form);
    };

    if (saveButton) {
      saveButton.onclick = async (
        event
      ) => {
        event.preventDefault();

        await saveProductForm(form);
      };
    }

    if (cancelButton) {
      cancelButton.onclick = () => {
        closeModal();
      };
    }

    if (imagesInput) {
      imagesInput.onchange = async () => {
        try {
          await processImages(
            imagesInput.files
          );

          toast(
            "تم تجهيز الصور"
          );
        } catch (error) {
          console.error(error);

          toast(
            "تعذر قراءة الصور"
          );
        }
      };
    }
  }

  async function saveProductForm(form) {
    if (!form) return;

    if (
      form.dataset.saving === "1"
    ) {
      return;
    }

    const id = Number(
      form.elements.id.value || 0
    );

    const name = String(
      form.elements.name.value || ""
    ).trim();

    const category = String(
      form.elements.category.value ||
        ""
    ).trim();

    const description = String(
      form.elements.description.value ||
        ""
    ).trim();

    const price = Number(
      form.elements.price.value
    );

    const quantity = Number(
      form.elements.quantity.value
    );

    if (name.length < 2) {
      toast("اكتب اسم المنتج");
      form.elements.name.focus();
      return;
    }

    if (!category) {
      toast("اكتب تصنيف المنتج");
      form.elements.category.focus();
      return;
    }

    if (
      !Number.isFinite(price) ||
      price < 0
    ) {
      toast("السعر غير صحيح");
      form.elements.price.focus();
      return;
    }

    if (
      !Number.isInteger(quantity) ||
      quantity < 0
    ) {
      toast(
        "الكمية يجب أن تكون رقمًا صحيحًا"
      );

      form.elements.quantity.focus();

      return;
    }

    if (!description) {
      toast("اكتب وصف المنتج");

      form.elements.description.focus();

      return;
    }

    const existing = id
      ? db().products.find(
          (product) =>
            Number(product.id) === id
        )
      : null;

    let frames = [];

    if (
      state.uploadedFrames.length
    ) {
      frames = [
        ...state.uploadedFrames
      ];
    } else if (
      existing?.frames?.length
    ) {
      frames = [
        ...existing.frames
      ];
    }

    const image =
      frames[0] ||
      existing?.image ||
      "Images/ESPAN-logo-transparent.png";

    const payload = {
      name,
      category,
      description,
      price,
      quantity,
      image,
      frames:
        frames.length > 1
          ? frames
          : []
    };

    const button =
      document.getElementById(
        "saveProductButton"
      );

    try {
      form.dataset.saving = "1";

      if (button) {
        button.disabled = true;

        button.textContent = id
          ? "جارٍ حفظ التعديلات..."
          : "جارٍ إضافة المنتج...";
      }

      console.log(
        "ESPAN PRODUCT SAVE",
        {
          id,
          payload
        }
      );

      let saved;

      /*
       * نستخدم Store نفسه حتى يتولى
       * Authentication والمسار الصحيح.
       */

      if (
        typeof store.upsertProductAsync !==
        "function"
      ) {
        throw new Error(
          "دالة حفظ المنتجات غير موجودة في store.js"
        );
      }

      saved =
        await store.upsertProductAsync({
          ...(existing || {}),
          ...payload,
          ...(id ? { id } : {})
        });

      console.log(
        "ESPAN PRODUCT SAVE RESPONSE",
        saved
      );

      if (
        !saved ||
        saved.ok === false
      ) {
        throw new Error(
          saved?.message ||
            "الخادم رفض حفظ المنتج"
        );
      }

      /*
       * إعادة تحميل البيانات من السيرفر
       */
      await store.refreshAsync();

      /*
       * نحدد id الذي رجع من السيرفر.
       */
      const savedId = Number(
        saved.id ||
          saved.product?.id ||
          id
      );

      const persisted =
        store.data.products.find(
          (product) =>
            Number(product.id) ===
            savedId
        );

      if (!persisted) {
        throw new Error(
          "تم إرسال المنتج لكن لم يظهر بعد إعادة تحميل قاعدة البيانات."
        );
      }

      /*
       * فحص حقيقي للقيم.
       */
      if (
        String(
          persisted.name || ""
        ).trim() !== name
      ) {
        throw new Error(
          "اسم المنتج لم يُحفظ في قاعدة البيانات."
        );
      }

      if (
        Math.abs(
          Number(persisted.price) -
            price
        ) > 0.001
      ) {
        throw new Error(
          `السعر لم يُحفظ. السعر الحالي: ${persisted.price}`
        );
      }

      if (
        Number(
          persisted.quantity
        ) !== quantity
      ) {
        throw new Error(
          `المخزون لم يُحفظ. القيمة الموجودة في قاعدة البيانات: ${persisted.quantity}`
        );
      }

      toast(
        id
          ? "✓ تم تعديل المنتج وحفظه"
          : "✓ تمت إضافة المنتج"
      );

      closeModal();

      renderProducts();

      refreshBadges();
    } catch (error) {
      console.error(
        "ESPAN PRODUCT SAVE ERROR",
        error
      );

      toast(
        error.message ||
          "حدث خطأ أثناء حفظ المنتج"
      );
    } finally {
      form.dataset.saving = "0";

      if (button) {
        button.disabled = false;

        button.textContent = id
          ? "حفظ التعديلات"
          : "إضافة المنتج";
      }
    }
  }

  async function processImages(files) {
    const limited = Array.from(
      files || []
    ).slice(0, 8);

    const results = [];

    for (const file of limited) {
      results.push(
        await resizeImage(file)
      );
    }

    state.uploadedFrames = results;

    const preview =
      document.getElementById(
        "imagePreview"
      );

    const note =
      document.getElementById(
        "viewerNote"
      );

    if (preview) {
      preview.innerHTML = results
        .map(
          (src) => `
            <img
              src="${src}"
              alt=""
            >
          `
        )
        .join("");
    }

    if (note) {
      note.textContent =
        results.length > 1
          ? `عرض 360° جاهز من ${results.length} صور.`
          : "صورة واحدة فقط؛ حمّل صورتين أو أكثر لتفعيل 360°.";
    }
  }

  function resizeImage(file) {
    return new Promise(
      (resolve, reject) => {
        const reader =
          new FileReader();

        reader.onerror = reject;

        reader.onload = () => {
          const image = new Image();

          image.onerror = reject;

          image.onload = () => {
            const max = 680;

            const scale = Math.min(
              1,
              max /
                Math.max(
                  image.width,
                  image.height
                )
            );

            const canvas =
              document.createElement(
                "canvas"
              );

            canvas.width = Math.max(
              1,
              Math.round(
                image.width * scale
              )
            );

            canvas.height = Math.max(
              1,
              Math.round(
                image.height * scale
              )
            );

            const ctx =
              canvas.getContext("2d");

            ctx.drawImage(
              image,
              0,
              0,
              canvas.width,
              canvas.height
            );

            resolve(
              canvas.toDataURL(
                "image/jpeg",
                0.72
              )
            );
          };

          image.src = reader.result;
        };

        reader.readAsDataURL(file);
      }
    );
  }

  function productDetails(product) {
    if (!product) {
      toast("المنتج غير موجود");
      return;
    }

    const pricing =
      store.priceInfo(product);

    openModal(
      "تفاصيل المنتج",
      product.name,
      `
        <div class="product-details-modal">

          <img
            class="product-details-image"
            src="${escapeHTML(
              product.image
            )}"
            alt=""
          >

          <div class="product-details-copy">

            <span
              class="badge ${
                Number(product.quantity) >
                0
                  ? "success"
                  : "danger"
              }"
            >
              ${
                Number(product.quantity) >
                0
                  ? "متوفر"
                  : "غير متوفر"
              }
            </span>

            <h3>
              ${escapeHTML(product.name)}
            </h3>

            <p>
              ${escapeHTML(
                product.description ||
                  "لا يوجد وصف"
              )}
            </p>

            <div class="details-grid">

              <div>
                <small>التصنيف</small>
                <strong>
                  ${escapeHTML(
                    product.category
                  )}
                </strong>
              </div>

              <div>
                <small>السعر</small>
                <strong>
                  ${money(pricing.final)}
                </strong>
              </div>

              <div>
                <small>المخزون</small>
                <strong>
                  ${Number(
                    product.quantity
                  )}
                  قطعة
                </strong>
              </div>

              <div>
                <small>التقييم</small>
                <strong>
                  ★
                  ${Number(
                    product.reviewAverage ||
                      0
                  ).toFixed(1)}
                </strong>
              </div>

            </div>

            <div class="form-actions">

              <button
                type="button"
                class="primary-action"
                id="detailsEditProduct"
              >
                تعديل المنتج
              </button>

            </div>

          </div>

        </div>
      `
    );

    const editButton =
      document.getElementById(
        "detailsEditProduct"
      );

    if (editButton) {
      editButton.onclick = () => {
        closeModal();

        productForm(product);
      };
    }
  }

  /* =========================================================
     ORDERS
  ========================================================= */

  function renderOrders() {
    const data = db();

    const deliveries = (
      data.users || []
    ).filter(
      (user) =>
        user.role === "delivery" &&
        user.status === "active"
    );

    const orders = (
      data.orders || []
    )
      .filter(
        (order) =>
          state.orderStatus ===
            "all" ||
          order.status ===
            state.orderStatus
      )
      .sort(
        (a, b) =>
          new Date(b.createdAt) -
          new Date(a.createdAt)
      );

    content.innerHTML = `
      ${sectionTop(
        "إدارة الطلبات",
        "تابع حالة الطلب وأكّده ثم عيّن مندوب التوصيل."
      )}

      <div class="filter-bar">

        <select id="orderStatusFilter">

          <option value="all">
            كل الحالات
          </option>

          ${orderStatuses
            .map(
              (status) => `
                <option
                  value="${status}"
                  ${
                    state.orderStatus ===
                    status
                      ? "selected"
                      : ""
                  }
                >
                  ${status}
                </option>
              `
            )
            .join("")}

        </select>

        <button
          class="secondary-action"
          data-action="export-orders"
        >
          تصدير CSV
        </button>

      </div>

      <div class="order-list">

        ${
          orders.length
            ? orders
                .map(
                  (order) => `
                    <article
                      class="order-card order-card-v2"
                    >

                      <div class="order-main">

                        <strong>
                          ${escapeHTML(
                            order.id
                          )}
                          ·
                          ${escapeHTML(
                            order.productName
                          )}
                        </strong>

                        <span>
                          ${escapeHTML(
                            order.customerName
                          )}
                          ·
                          ${escapeHTML(
                            order.customerPhone ||
                              "بدون رقم"
                          )}
                          ·
                          ${dateText(
                            order.createdAt,
                            true
                          )}
                        </span>

                        <div
                          class="admin-order-items"
                        >
                          ${(order.items || [])
                            .map(
                              (item) => `
                                <small>
                                  ${escapeHTML(
                                    item.productName
                                  )}
                                  ×
                                  ${item.quantity}
                                  —
                                  ${money(
                                    item.total
                                  )}
                                </small>
                              `
                            )
                            .join("")}
                        </div>

                      </div>

                      <div class="order-meta">

                        <div>
                          <small>القطع</small>
                          <strong>
                            ${order.quantity}
                          </strong>
                        </div>

                        <div>
                          <small>الإجمالي</small>
                          <strong>
                            ${money(
                              order.total
                            )}
                          </strong>
                        </div>

                        <div>
                          <small>الدفع</small>
                          <strong>
                            نقدًا
                          </strong>
                        </div>

                        <div>
                          <small>المندوب</small>
                          <strong>
                            ${escapeHTML(
                              order.deliveryName ||
                                "لم يحدد"
                            )}
                          </strong>
                        </div>

                      </div>

                      <div>

                        <span
                          class="status-pill ${statusClass(
                            order.status
                          )}"
                        >
                          ${escapeHTML(
                            order.status
                          )}
                        </span>

                        <small
                          style="
                            display:block;
                            margin-top:7px;
                            color:var(--muted)
                          "
                        >
                          ${escapeHTML(
                            order.address ||
                              "لا يوجد عنوان"
                          )}
                        </small>

                      </div>

                      <div class="order-actions">

                        <select
                          data-order-status="${
                            order.id
                          }"
                        >

                          ${orderStatuses
                            .map(
                              (status) => `
                                <option
                                  ${
                                    order.status ===
                                    status
                                      ? "selected"
                                      : ""
                                  }
                                >
                                  ${status}
                                </option>
                              `
                            )
                            .join("")}

                        </select>

                        <select
                          data-order-delivery="${
                            order.id
                          }"
                        >

                          <option value="">
                            اختر المندوب
                          </option>

                          ${deliveries
                            .map(
                              (user) => `
                                <option
                                  value="${
                                    user.id
                                  }"
                                  ${
                                    String(
                                      order.deliveryId
                                    ) ===
                                    String(
                                      user.id
                                    )
                                      ? "selected"
                                      : ""
                                  }
                                >
                                  ${escapeHTML(
                                    user.full_name
                                  )}
                                </option>
                              `
                            )
                            .join("")}

                        </select>

                      </div>

                    </article>
                  `
                )
                .join("")
            : emptyState(
                "لا توجد طلبات",
                "ستظهر الطلبات الجديدة هنا."
              )
        }

      </div>
    `;
  }

  /* =========================================================
     OFFERS
  ========================================================= */

  function renderOffers() {
    const data = db();

    content.innerHTML = `
      ${sectionTop(
        "العروض والخصومات",
        "العرض يأخذ السعر الحالي من المنتج، ويُطبّق فقط عند تحقق شرط الكمية."
      )}

      <div class="offer-layout">

        <form
          class="form-card"
          id="offerForm"
        >

          <h3>
            إضافة عرض مشروط
          </h3>

          <div class="form-grid">

            <label class="full">
              اسم العرض

              <input
                name="title"
                required
                placeholder="مثال: عرض شراء 5 سلالم"
              >
            </label>

            <label class="full">
              المنتج

              <select
                name="productId"
                id="offerProduct"
                required
              >

                <option value="">
                  اختر المنتج
                </option>

                ${(data.products || [])
                  .map(
                    (product) => `
                      <option
                        value="${
                          product.id
                        }"
                      >
                        ${escapeHTML(
                          product.name
                        )}
                        —
                        ${money(
                          product.price
                        )}
                      </option>
                    `
                  )
                  .join("")}

              </select>
            </label>

            <label>
              الحد الأدنى للكمية

              <input
                name="minQuantity"
                required
                type="number"
                min="1"
                step="1"
                value="1"
              >

              <small>
                مثال: 5 يعني العرض يبدأ
                من 5 قطع
              </small>
            </label>

            <label>
              نوع الخصم

              <select name="type">
                <option
                  value="percentage"
                >
                  نسبة من السعر الحالي
                </option>

                <option
                  value="fixed_amount"
                >
                  مبلغ يُخصم من السعر
                </option>
              </select>
            </label>

            <label>
              قيمة الخصم

              <input
                name="value"
                required
                type="number"
                min="1"
                step="0.01"
              >
            </label>

            <label>
              السعر الأساسي

              <input
                id="offerBasePrice"
                value="اختر المنتج"
                disabled
              >
            </label>

            <label>
              تاريخ البداية

              <input
                name="startDate"
                type="date"
              >
            </label>

            <label>
              تاريخ النهاية

              <input
                name="endDate"
                type="date"
              >
            </label>

            <label class="full">
              <span>
                <input
                  type="checkbox"
                  name="active"
                  checked
                >
                تفعيل العرض فورًا
              </span>
            </label>

            <div
              class="full viewer-note"
              id="offerPreview"
            >
              السعر النهائي سيُحسب
              من سعر المنتج الحالي.
            </div>

          </div>

          <div class="form-actions">

            <button
              type="submit"
              class="primary-action"
              id="saveOfferButton"
            >
              حفظ العرض
            </button>

          </div>

        </form>

        <div>

          <div class="panel-head">
            <div>
              <h3>
                العروض الحالية
              </h3>

              <span>
                ${
                  (data.offers || [])
                    .length
                }
                عرض
              </span>
            </div>
          </div>

          <div class="offer-cards">

            ${
              (data.offers || [])
                .length
                ? data.offers
                    .map((offer) => {
                      const product =
                        data.products.find(
                          (item) =>
                            Number(
                              item.id
                            ) ===
                            Number(
                              offer.productId
                            )
                        );

                      if (!product) {
                        return "";
                      }

                      const minQty =
                        Math.max(
                          1,
                          Number(
                            offer.minQuantity ||
                              1
                          )
                        );

                      const pricing =
                        store.priceInfo(
                          product,
                          minQty
                        );

                      return `
                        <article
                          class="offer-card"
                        >

                          <img
                            src="${escapeHTML(
                              product.image
                            )}"
                            alt=""
                          >

                          <div>

                            <strong>
                              ${escapeHTML(
                                offer.title
                              )}
                            </strong>

                            <small>
                              ${escapeHTML(
                                product.name
                              )}
                            </small>

                            <small>
                              ${
                                minQty > 1
                                  ? `يبدأ من ${minQty} قطع`
                                  : "من أول قطعة"
                              }
                            </small>

                            <span
                              class="badge ${
                                offer.active
                                  ? "success"
                                  : ""
                              }"
                            >
                              ${
                                offer.active
                                  ? "مفعّل"
                                  : "متوقف"
                              }
                            </span>

                          </div>

                          <div>

                            <strong>
                              ${money(
                                pricing.final
                              )}
                            </strong>

                            <small>
                              السعر بعد تحقق الشرط
                            </small>

                            <div
                              class="row-actions"
                            >

                              <button
                                class="icon-button"
                                data-action="toggle-offer"
                                data-id="${
                                  offer.id
                                }"
                              >
                                ${
                                  offer.active
                                    ? "Ⅱ"
                                    : "▶"
                                }
                              </button>

                              <button
                                class="icon-button"
                                data-action="delete-offer"
                                data-id="${
                                  offer.id
                                }"
                              >
                                ⌫
                              </button>

                            </div>

                          </div>

                        </article>
                      `;
                    })
                    .join("")
                : emptyState(
                    "لا توجد عروض",
                    "أضف أول عرض."
                  )
            }

          </div>

        </div>

      </div>
    `;

    bindOfferForm();
  }

  function updateOfferPreview() {
    const form =
      document.getElementById(
        "offerForm"
      );

    if (!form) return;

    const productId = Number(
      form.elements.productId.value ||
        0
    );

    const product =
      db().products.find(
        (item) =>
          Number(item.id) ===
          productId
      );

    const base =
      document.getElementById(
        "offerBasePrice"
      );

    const preview =
      document.getElementById(
        "offerPreview"
      );

    if (!product) {
      if (base) {
        base.value =
          "اختر المنتج";
      }

      if (preview) {
        preview.textContent =
          "اختر منتجًا أولًا.";
      }

      return;
    }

    const minQuantity = Math.max(
      1,
      Number(
        form.elements.minQuantity
          .value || 1
      )
    );

    const type =
      form.elements.type.value;

    const value = Math.max(
      0,
      Number(
        form.elements.value.value ||
          0
      )
    );

    let final = Number(
      product.price || 0
    );

    if (value > 0) {
      if (type === "percentage") {
        final = Math.max(
          0,
          final *
            (1 - value / 100)
        );
      } else {
        final = Math.max(
          0,
          final - value
        );
      }
    }

    if (base) {
      base.value = money(
        product.price
      );
    }

    if (preview) {
      preview.textContent = `${
        minQuantity > 1
          ? `عند شراء ${minQuantity} قطع أو أكثر`
          : "من أول قطعة"
      }: ${money(
        product.price
      )} ← ${money(final)} للقطعة.`;
    }
  }

  function bindOfferForm() {
    const form =
      document.getElementById(
        "offerForm"
      );

    if (!form) return;

    form.oninput =
      updateOfferPreview;

    form.onchange =
      updateOfferPreview;

    form.onsubmit = async (
      event
    ) => {
      event.preventDefault();

      const formData =
        Object.fromEntries(
          new FormData(form)
        );

      const product =
        db().products.find(
          (item) =>
            Number(item.id) ===
            Number(formData.productId)
        );

      if (!product) {
        toast("اختَر المنتج");
        return;
      }

      const value = Number(
        formData.value
      );

      const minQuantity =
        Number(
          formData.minQuantity
        );

      if (
        !Number.isInteger(
          minQuantity
        ) ||
        minQuantity < 1
      ) {
        toast(
          "شرط الكمية غير صحيح"
        );
        return;
      }

      if (
        !Number.isFinite(value) ||
        value <= 0
      ) {
        toast(
          "قيمة الخصم غير صحيحة"
        );
        return;
      }

      if (
        formData.type ===
          "percentage" &&
        value >= 100
      ) {
        toast(
          "النسبة يجب أن تكون أقل من 100%"
        );
        return;
      }

      if (
        formData.type ===
          "fixed_amount" &&
        value >=
          Number(product.price)
      ) {
        toast(
          "الخصم أكبر من سعر المنتج"
        );
        return;
      }

      const button =
        document.getElementById(
          "saveOfferButton"
        );

      try {
        if (button) {
          button.disabled = true;
          button.textContent =
            "جارٍ الحفظ...";
        }

        const result =
          await store.addOfferAsync({
            ...formData,
            minQuantity,
            value,
            active:
              form.elements.active
                .checked
          });

        if (
          !result ||
          result.ok === false
        ) {
          throw new Error(
            result?.message ||
              "تعذر حفظ العرض"
          );
        }

        await store.refreshAsync();

        toast(
          "تم حفظ العرض"
        );

        renderOffers();
      } catch (error) {
        console.error(error);

        toast(
          error.message ||
            "تعذر حفظ العرض"
        );
      } finally {
        if (button) {
          button.disabled = false;

          button.textContent =
            "حفظ العرض";
        }
      }
    };

    updateOfferPreview();
  }

  /* =========================================================
     COMPLAINTS
  ========================================================= */

  function renderComplaints() {
    const complaints = (
      db().complaints || []
    )
      .slice()
      .sort(
        (a, b) =>
          new Date(b.createdAt) -
          new Date(a.createdAt)
      );

    content.innerHTML = `
      ${sectionTop(
        "الشكاوى وخدمة ما بعد البيع",
        "راجع الشكوى واكتب رد الإدارة وغيّر حالتها."
      )}

      <div class="filter-bar">

        <span class="badge danger">
          ${
            complaints.filter(
              (item) =>
                item.status ===
                "جديدة"
            ).length
          }
          جديدة
        </span>

      </div>

      <div class="complaint-list">

        ${
          complaints.length
            ? complaints
                .map(
                  (item) => `
                    <article
                      class="complaint-card"
                    >

                      <header>

                        <div>

                          <span
                            class="badge ${
                              item.status ===
                              "مغلقة"
                                ? "success"
                                : item.status ===
                                  "قيد المعالجة"
                                ? "warning"
                                : "danger"
                            }"
                          >
                            ${escapeHTML(
                              item.status
                            )}
                          </span>

                          <h3>
                            ${escapeHTML(
                              item.customerName
                            )}
                            ·
                            ${escapeHTML(
                              item.productName ||
                                item.orderId
                            )}
                          </h3>

                          <small>
                            ${escapeHTML(
                              item.orderId
                            )}
                            ·
                            ${dateText(
                              item.createdAt,
                              true
                            )}
                          </small>

                        </div>

                        <button
                          class="secondary-action"
                          data-action="reply-complaint"
                          data-id="${
                            item.id
                          }"
                        >
                          الرد / تغيير الحالة
                        </button>

                      </header>

                      <p>
                        ${escapeHTML(
                          item.message
                        )}
                      </p>

                      ${
                        item.reply
                          ? `
                            <div
                              class="complaint-reply"
                            >
                              <strong>
                                رد الإدارة:
                              </strong>

                              ${escapeHTML(
                                item.reply
                              )}
                            </div>
                          `
                          : ""
                      }

                    </article>
                  `
                )
                .join("")
            : emptyState(
                "لا توجد شكاوى",
                "لا توجد شكاوى حاليًا."
              )
        }

      </div>
    `;
  }

  function complaintForm(item) {
    openModal(
      "الرد على الشكوى",
      item.id,
      `
        <div
          class="complaint-reply"
          style="margin-bottom:14px"
        >
          <strong>
            ${escapeHTML(
              item.customerName
            )}:
          </strong>

          ${escapeHTML(item.message)}
        </div>

        <form id="complaintReplyForm">

          <div class="form-grid">

            <label>
              حالة الشكوى

              <select name="status">

                <option
                  ${
                    item.status ===
                    "جديدة"
                      ? "selected"
                      : ""
                  }
                >
                  جديدة
                </option>

                <option
                  ${
                    item.status ===
                    "قيد المعالجة"
                      ? "selected"
                      : ""
                  }
                >
                  قيد المعالجة
                </option>

                <option
                  ${
                    item.status ===
                    "مغلقة"
                      ? "selected"
                      : ""
                  }
                >
                  مغلقة
                </option>

              </select>
            </label>

            <label class="full">
              رد الإدارة

              <textarea
                name="reply"
              >${escapeHTML(
                item.reply || ""
              )}</textarea>
            </label>

          </div>

          <div class="form-actions">

            <button
              type="submit"
              class="primary-action"
            >
              حفظ
            </button>

          </div>

        </form>
      `
    );

    const form =
      document.getElementById(
        "complaintReplyForm"
      );

    if (form) {
      form.onsubmit = async (
        event
      ) => {
        event.preventDefault();

        const payload =
          Object.fromEntries(
            new FormData(form)
          );

        try {
          const result =
            await store.updateComplaintAsync(
              item.id,
              payload
            );

          if (
            result?.ok === false
          ) {
            throw new Error(
              result.message
            );
          }

          if (!existing && result?.recoveryCode) {
            alert(
              "تم إنشاء المستخدم بنجاح ✅\n\n" +
              "رمز استرجاع الحساب:\n\n" +
              result.recoveryCode +
              "\n\nسلّمي هذا الرمز لصاحب الحساب واطلبي منه حفظه في مكان آمن."
            );
          }

          await store.refreshAsync();

          toast(
            "تم حفظ الرد والحالة"
          );

          closeModal();

          renderComplaints();
        } catch (error) {
          toast(
            error.message ||
              "تعذر حفظ الشكوى"
          );
        }
      };
    }
  }

  /* =========================================================
     USERS
  ========================================================= */

  function userCard(user) {
    const searchable = [
      user.full_name,
      user.phone,
      user.city,
      user.address
    ]
      .join(" ")
      .toLowerCase();

    const editButton =
      user.role === "admin"
        ? `
          <button
            class="icon-button"
            title="تعديل المدير"
            data-action="edit-user"
            data-id="${user.id}"
          >
            ✎
          </button>
        `
        : "";

    const protectedAdmin =
      user.id === "admin-1";

    const statusButton =
      protectedAdmin
        ? ""
        : `
          <button
            class="icon-button"
            data-action="toggle-user"
            data-id="${user.id}"
          >
            ${
              user.status ===
              "active"
                ? "Ⅱ"
                : "▶"
            }
          </button>
        `;

    return `
      <article
        class="user-card"
        data-user-card
        data-search="${escapeHTML(
          searchable
        )}"
      >

        <span class="user-avatar">
          ${escapeHTML(
            user.full_name?.charAt(0) ||
              "E"
          )}
        </span>

        <div>

          <h3>
            ${escapeHTML(
              user.full_name
            )}
          </h3>

          <small>
            ${escapeHTML(user.phone)}
            ·
            ${escapeHTML(
              user.city ||
                "بدون مدينة"
            )}
          </small>

          <span
            class="badge role-${user.role}"
          >
            ${roleLabel(user.role)}
          </span>

          <span
            class="badge ${
              user.status === "active"
                ? "success"
                : "danger"
            }"
          >
            ${
              user.status === "active"
                ? "نشط"
                : "موقوف"
            }
          </span>

        </div>

        <div class="row-actions">

          ${editButton}
          ${statusButton}

          ${
            protectedAdmin
              ? `
                <span class="badge">
                  مدير رئيسي
                </span>
              `
              : `
                <button
                  class="icon-button"
                  data-action="delete-user"
                  data-id="${user.id}"
                >
                  ⌫
                </button>
              `
          }

        </div>

      </article>
    `;
  }

  function renderUsers() {
    const users =
      db().users || [];

    const admins = users.filter(
      (user) =>
        user.role === "admin"
    );

    const deliveries =
      users.filter(
        (user) =>
          user.role === "delivery"
      );

    const customers = users.filter(
      (user) =>
        user.role === "customer"
    );

    const group = (
      title,
      description,
      items
    ) => `
      <section
        class="user-role-section"
      >

        <div class="panel-head">
          <div>
            <h3>${title}</h3>
            <span>
              ${description}
              ·
              ${items.length}
            </span>
          </div>
        </div>

        <div class="user-cards">
          ${
            items.length
              ? items
                  .map(userCard)
                  .join("")
              : emptyState(
                  "لا توجد حسابات",
                  ""
                )
          }
        </div>

      </section>
    `;

    content.innerHTML = `
      ${sectionTop(
        "المستخدمون والصلاحيات",
        "المديرون ومندوبي التوصيل والعملاء منفصلون.",
        `
          <button
            class="primary-action"
            data-action="add-user"
          >
            ＋ إضافة مستخدم
          </button>
        `
      )}

      <div class="filter-bar">

        <input
          id="userSearch"
          autocomplete="off"
          placeholder="ابحث بالاسم أو رقم الهاتف"
        >

      </div>

      <div id="usersGroups">

        ${group(
          "المديرون",
          "حسابات إدارة النظام",
          admins
        )}

        ${group(
          "مندوبي التوصيل",
          "حسابات التوصيل",
          deliveries
        )}

        ${group(
          "العملاء",
          "الحسابات المسجلة",
          customers
        )}

      </div>

      <div
        id="userNoResults"
        class="empty-state"
        hidden
      >
        <h3>لا توجد نتائج</h3>
      </div>
    `;
  }

  function applyUserSearch() {
    const input =
      document.getElementById(
        "userSearch"
      );

    if (!input) return;

    const term = input.value
      .trim()
      .toLowerCase();

    let visible = 0;

    document
      .querySelectorAll(
        "[data-user-card]"
      )
      .forEach((card) => {
        card.hidden =
          Boolean(term) &&
          !(
            card.dataset.search || ""
          ).includes(term);

        if (!card.hidden) {
          visible += 1;
        }
      });

    document
      .querySelectorAll(
        ".user-role-section"
      )
      .forEach((section) => {
        section.hidden =
          !section.querySelector(
            "[data-user-card]:not([hidden])"
          );
      });

    const empty =
      document.getElementById(
        "userNoResults"
      );

    if (empty) {
      empty.hidden = visible !== 0;
    }
  }

  function userForm(user = null) {
    if (
      user &&
      user.role !== "admin"
    ) {
      toast(
        "تعديل البيانات متاح للمديرين فقط"
      );
      return;
    }

    const roleField = user
      ? `
        <input
          type="hidden"
          name="role"
          value="admin"
        >

        <label>
          الصلاحية
          <input
            value="مدير"
            disabled
          >
        </label>
      `
      : `
        <label>
          الصلاحية

          <select name="role">
            <option value="customer">
              عميل
            </option>

            <option value="delivery">
              مندوب توصيل
            </option>

            <option value="admin">
              مدير
            </option>
          </select>

        </label>
      `;

    openModal(
      user
        ? "تعديل بيانات المدير"
        : "إضافة مستخدم",
      "المستخدمون والصلاحيات",
      `
        <form id="userForm">

          <div class="form-grid">

            <label>
              الاسم الكامل

              <input
                name="full_name"
                required
                value="${escapeHTML(
                  user?.full_name || ""
                )}"
              >
            </label>

            <label>
              رقم الهاتف

              <input
                name="phone"
                required
                value="${escapeHTML(
                  user?.phone || ""
                )}"
              >
            </label>

            ${roleField}

            <label>
              الحالة

              <select name="status">
                <option
                  value="active"
                  ${
                    user?.status !==
                    "inactive"
                      ? "selected"
                      : ""
                  }
                >
                  نشط
                </option>

                <option
                  value="inactive"
                  ${
                    user?.status ===
                    "inactive"
                      ? "selected"
                      : ""
                  }
                >
                  موقوف
                </option>
              </select>
            </label>

            <label>
              المدينة

              <input
                name="city"
                value="${escapeHTML(
                  user?.city || ""
                )}"
              >
            </label>

            <label>
              العنوان

              <input
                name="address"
                value="${escapeHTML(
                  user?.address || ""
                )}"
              >
            </label>

            <label class="full">
              كلمة المرور

              <input
                name="password"
                type="password"
                minlength="8"
                ${
                  user ? "" : "required"
                }
                placeholder="${
                  user
                    ? "اتركها فارغة للاحتفاظ بالحالية"
                    : "8 أحرف على الأقل"
                }"
              >
            </label>

          </div>

          <div class="form-actions">

            <button
              type="submit"
              class="primary-action"
            >
              ${
                user
                  ? "حفظ بيانات المدير"
                  : "إضافة المستخدم"
              }
            </button>

          </div>

        </form>
      `
    );

    const form =
      document.getElementById(
        "userForm"
      );

    if (form) {
      form.onsubmit = async (
        event
      ) => {
        event.preventDefault();

        const formData =
          Object.fromEntries(
            new FormData(form)
          );

        const existing = user;

        try {
          const result =
            await store.upsertUserAsync({
              ...(existing || {}),
              ...formData,
              ...(existing
                ? {
                    id:
                      existing.id
                  }
                : {}),
              password:
                formData.password ||
                undefined
            });

          if (
            result?.ok === false
          ) {
            throw new Error(
              result.message
            );
          }

          await store.refreshAsync();

          toast(
            existing
              ? "تم تعديل المدير"
              : "تم إضافة المستخدم"
          );

          closeModal();

          renderUsers();
        } catch (error) {
          toast(
            error.message ||
              "تعذر حفظ المستخدم"
          );
        }
      };
    }
  }

  /* =========================================================
     COLLECTIONS
  ========================================================= */

  function renderCollections() {
    const delivered = (
      db().orders || []
    )
      .filter(
        (order) =>
          order.status ===
            "تم التسليم" &&
          order.paymentMethod ===
            "نقدًا"
      )
      .sort(
        (a, b) =>
          new Date(
            b.updatedAt ||
              b.createdAt
          ) -
          new Date(
            a.updatedAt ||
              a.createdAt
          )
      );

    content.innerHTML = `
      ${sectionTop(
        "تحصيلات مندوبي التوصيل",
        "تابع الطلبات النقدية المسلّمة وتأكيد استلام المبلغ."
      )}

      <div class="collection-list">

        ${
          delivered.length
            ? delivered
                .map(
                  (order) => `
                    <article
                      class="collection-card"
                    >

                      <div>
                        <strong>
                          ${escapeHTML(
                            order.id
                          )}
                        </strong>

                        <span>
                          ${escapeHTML(
                            order.deliveryName ||
                              "بدون مندوب"
                          )}
                          ·
                          ${escapeHTML(
                            order.customerName
                          )}
                        </span>
                      </div>

                      <div>
                        <small>
                          قيمة التحصيل
                        </small>

                        <strong>
                          ${money(
                            order.total
                          )}
                        </strong>
                      </div>

                      <div>
                        ${
                          order.cashConfirmed
                            ? "✓ تم تأكيد الاستلام"
                            : order.cashHandedOver
                            ? "المندوب سلّم المبلغ"
                            : "لم يتم تسليم المبلغ"
                        }
                      </div>

                      <div>

                        ${
                          order.cashHandedOver &&
                          !order.cashConfirmed
                            ? `
                              <button
                                class="primary-action"
                                data-action="confirm-cash"
                                data-id="${
                                  order.id
                                }"
                              >
                                تأكيد استلام المبلغ
                              </button>
                            `
                            : ""
                        }

                      </div>

                    </article>
                  `
                )
                .join("")
            : emptyState(
                "لا توجد تحصيلات",
                ""
              )
        }

      </div>
    `;
  }

  /* =========================================================
     AUDIT
  ========================================================= */

  function renderAudit() {
    const term =
      state.search.toLowerCase();

    const rows = (
      db().activity || []
    ).filter((item) =>
      [item.text, item.actor]
        .join(" ")
        .toLowerCase()
        .includes(term)
    );

    content.innerHTML = `
      ${sectionTop(
        "سجل النشاط",
        "كل التغييرات التي تمت داخل النظام."
      )}

      <div class="filter-bar">

        <input
          id="auditSearch"
          value="${escapeHTML(
            state.search
          )}"
          placeholder="ابحث في السجل"
        >

      </div>

      <div class="audit-list">

        ${
          rows.length
            ? rows
                .map(
                  (item) => `
                    <article>

                      <span
                        class="audit-dot"
                      ></span>

                      <div>

                        <strong>
                          ${escapeHTML(
                            item.text
                          )}
                        </strong>

                        <small>
                          ${escapeHTML(
                            item.actor
                          )}
                          ·
                          ${dateText(
                            item.createdAt,
                            true
                          )}
                        </small>

                      </div>

                    </article>
                  `
                )
                .join("")
            : emptyState(
                "لا توجد نتائج",
                ""
              )
        }

      </div>
    `;
  }

  /* =========================================================
     RENDER
  ========================================================= */

  function render() {
    if (viewTitle) {
      viewTitle.textContent =
        viewNames[state.view];
    }

    document
      .querySelectorAll(
        "#sideNav [data-view]"
      )
      .forEach((button) => {
        button.classList.toggle(
          "active",
          button.dataset.view ===
            state.view
        );
      });

    const renderer = {
      dashboard: renderDashboard,
      products: renderProducts,
      orders: renderOrders,
      offers: renderOffers,
      complaints:
        renderComplaints,
      users: renderUsers,
      collections:
        renderCollections,
      audit: renderAudit
    }[state.view];

    if (renderer) {
      renderer();
    }

    refreshBadges();
  }

  function switchView(view) {
    if (!viewNames[view]) return;

    state.view = view;
    state.search = "";

    render();

    document
      .getElementById("sidebar")
      ?.classList.remove("show");

    document
      .getElementById(
        "drawerOverlay"
      )
      ?.classList.remove(
        "sidebar-open"
      );
  }

  /* =========================================================
     CSV
  ========================================================= */

  function exportCSV() {
    const rows = [
      [
        "رقم الطلب",
        "العميل",
        "الهاتف",
        "المنتج",
        "الكمية",
        "الإجمالي",
        "الحالة",
        "المندوب",
        "التاريخ"
      ]
    ];

    (db().orders || []).forEach(
      (order) => {
        rows.push([
          order.id,
          order.customerName,
          order.customerPhone,
          order.productName,
          order.quantity,
          order.total,
          order.status,
          order.deliveryName,
          order.createdAt
        ]);
      }
    );

    const csv =
      "\uFEFF" +
      rows
        .map((row) =>
          row
            .map(
              (cell) =>
                `"${String(
                  cell ?? ""
                ).replace(
                  /"/g,
                  '""'
                )}"`
            )
            .join(",")
        )
        .join("\n");

    const link =
      document.createElement("a");

    link.href =
      URL.createObjectURL(
        new Blob([csv], {
          type: "text/csv;charset=utf-8"
        })
      );

    link.download =
      "espan-orders.csv";

    link.click();

    URL.revokeObjectURL(
      link.href
    );
  }

  /* =========================================================
     CONTENT EVENTS
  ========================================================= */

  document
    .getElementById("sideNav")
    ?.addEventListener(
      "click",
      (event) => {
        const button =
          event.target.closest(
            "[data-view]"
          );

        if (button) {
          switchView(
            button.dataset.view
          );
        }
      }
    );

  content.addEventListener(
    "click",
    async (event) => {
      const go =
        event.target.closest(
          "[data-go]"
        );

      if (go) {
        event.preventDefault();

        switchView(
          go.dataset.go
        );

        return;
      }

      const target =
        event.target.closest(
          "[data-action]"
        );

      if (!target) return;

      const action =
        target.dataset.action;

      const id =
        target.dataset.id;

      const data = db();

      if (
        action === "add-product"
      ) {
        productForm();
        return;
      }

      if (
        action === "edit-product"
      ) {
        const product =
          data.products.find(
            (item) =>
              Number(item.id) ===
              Number(id)
          );

        productForm(product);
        return;
      }

      if (
        action === "view-product"
      ) {
        const product =
          data.products.find(
            (item) =>
              Number(item.id) ===
              Number(id)
          );

        productDetails(product);
        return;
      }

      if (
        action ===
          "delete-product" &&
        confirm(
          "هل تريد حذف هذا المنتج؟"
        )
      ) {
        try {
          await store.deleteProductAsync(
            id
          );

          await store.refreshAsync();

          toast(
            "تم حذف المنتج"
          );

          renderProducts();
        } catch (error) {
          toast(
            error.message ||
              "تعذر حذف المنتج"
          );
        }

        return;
      }

      if (
        action ===
        "export-orders"
      ) {
        exportCSV();
        return;
      }

      if (
        action === "add-user"
      ) {
        userForm();
        return;
      }

      if (
        action === "edit-user"
      ) {
        const user =
          data.users.find(
            (item) =>
              String(item.id) ===
              String(id)
          );

        userForm(user);
        return;
      }

      if (
        action === "toggle-user"
      ) {
        const user =
          data.users.find(
            (item) =>
              String(item.id) ===
              String(id)
          );

        if (!user) return;

        try {
          await store.upsertUserAsync({
            ...user,
            status:
              user.status ===
              "active"
                ? "inactive"
                : "active"
          });

          await store.refreshAsync();

          toast(
            "تم تحديث المستخدم"
          );

          renderUsers();
        } catch (error) {
          toast(
            error.message ||
              "تعذر تحديث المستخدم"
          );
        }

        return;
      }

      if (
        action === "delete-user"
      ) {
        if (
          !confirm(
            "هل تريد حذف المستخدم؟"
          )
        ) {
          return;
        }

        try {
          await store.deleteUserAsync(
            id
          );

          await store.refreshAsync();

          toast(
            "تم حذف المستخدم"
          );

          renderUsers();
        } catch (error) {
          toast(
            error.message ||
              "تعذر حذف المستخدم"
          );
        }

        return;
      }

      if (
        action ===
        "reply-complaint"
      ) {
        const complaint =
          data.complaints.find(
            (item) =>
              String(item.id) ===
              String(id)
          );

        if (complaint) {
          complaintForm(
            complaint
          );
        }

        return;
      }

      if (
        action ===
        "toggle-offer"
      ) {
        const offer =
          data.offers.find(
            (item) =>
              String(item.id) ===
              String(id)
          );

        if (!offer) return;

        try {
          await store.addOfferAsync({
            ...offer,
            active: !offer.active
          });

          await store.refreshAsync();

          toast(
            "تم تحديث العرض"
          );

          renderOffers();
        } catch (error) {
          toast(
            error.message ||
              "تعذر تحديث العرض"
          );
        }

        return;
      }

      if (
        action ===
          "delete-offer" &&
        confirm(
          "هل تريد حذف العرض؟"
        )
      ) {
        try {
          await store.deleteOfferAsync(
            id
          );

          await store.refreshAsync();

          toast(
            "تم حذف العرض"
          );

          renderOffers();
        } catch (error) {
          toast(
            error.message ||
              "تعذر حذف العرض"
          );
        }

        return;
      }

      if (
        action ===
        "confirm-cash"
      ) {
        try {
          await store.updateCashAsync(
            id,
            {
              confirmed: true
            }
          );

          await store.refreshAsync();

          toast(
            "تم تأكيد استلام المبلغ"
          );

          renderCollections();
        } catch (error) {
          toast(
            error.message ||
              "تعذر تأكيد التحصيل"
          );
        }
      }
    }
  );

  content.addEventListener(
    "change",
    async (event) => {
      if (
        event.target.id ===
        "stockFilter"
      ) {
        applyProductFilters();
        return;
      }

      if (
        event.target.id ===
        "orderStatusFilter"
      ) {
        state.orderStatus =
          event.target.value;

        renderOrders();

        return;
      }

      if (
        event.target.matches(
          "[data-order-status]"
        )
      ) {
        try {
          await store.updateOrderAsync(
            event.target.dataset
              .orderStatus,
            {
              status:
                event.target.value
            }
          );

          await store.refreshAsync();

          toast(
            "تم تحديث حالة الطلب"
          );

          renderOrders();
        } catch (error) {
          toast(
            error.message ||
              "تعذر تحديث الطلب"
          );
        }

        return;
      }

      if (
        event.target.matches(
          "[data-order-delivery]"
        )
      ) {
        const orderId =
          event.target.dataset
            .orderDelivery;

        const deliveryId =
          event.target.value;

        try {
          if (deliveryId) {
            await store.assignDeliveryAsync(
              orderId,
              deliveryId
            );

            toast(
              "تم تعيين المندوب وإرسال إشعار له"
            );
          } else {
            await store.updateOrderAsync(
              orderId,
              {
                deliveryId: "",
                deliveryName: ""
              }
            );

            toast(
              "تم إلغاء تعيين المندوب"
            );
          }

          await store.refreshAsync();

          renderOrders();
        } catch (error) {
          toast(
            error.message ||
              "تعذر تعيين المندوب"
          );
        }
      }
    }
  );

  content.addEventListener(
    "input",
    (event) => {
      if (
        event.target.id ===
        "productSearch"
      ) {
        applyProductFilters();
        return;
      }

      if (
        event.target.id ===
        "userSearch"
      ) {
        applyUserSearch();
        return;
      }

      if (
        event.target.id ===
        "auditSearch"
      ) {
        state.search =
          event.target.value;

        clearTimeout(
          state.searchTimer
        );

        state.searchTimer =
          setTimeout(
            renderAudit,
            200
          );
      }
    }
  );

  /* =========================================================
     MODAL GENERAL EVENTS
  ========================================================= */

  document
    .getElementById("modalClose")
    ?.addEventListener(
      "click",
      closeModal
    );

  modal?.addEventListener(
    "click",
    (event) => {
      if (event.target === modal) {
        closeModal();
      }
    }
  );

  /* =========================================================
     LOGOUT
  ========================================================= */

  document
    .getElementById(
      "logoutButton"
    )
    ?.addEventListener(
      "click",
      () => {
        store.logout();

        window.location.href =
          "auth.html#loginSection";
      }
    );

  /* =========================================================
     SIDEBAR
  ========================================================= */

  const overlay =
    document.getElementById(
      "drawerOverlay"
    );

  document
    .getElementById(
      "menuToggle"
    )
    ?.addEventListener(
      "click",
      () => {
        document
          .getElementById(
            "sidebar"
          )
          ?.classList.toggle(
            "show"
          );

        overlay?.classList.toggle(
          "sidebar-open"
        );
      }
    );

  /* =========================================================
     NOTIFICATIONS
  ========================================================= */

  const drawer =
    document.getElementById(
      "notificationDrawer"
    );

  function renderNotifications() {
    const list =
      document.getElementById(
        "notificationList"
      );

    if (!list) return;

    const notifications =
      db().notifications || [];

    list.innerHTML =
      notifications.length
        ? notifications
            .map(
              (item) => `
                <article
                  class="notification-item ${
                    item.read
                      ? ""
                      : "unread"
                  }"
                  data-notification="${
                    item.id
                  }"
                >

                  <strong>
                    ${escapeHTML(
                      item.title
                    )}
                  </strong>

                  <p>
                    ${escapeHTML(
                      item.message
                    )}
                  </p>

                  <small>
                    ${dateText(
                      item.createdAt,
                      true
                    )}
                  </small>

                </article>
              `
            )
            .join("")
        : emptyState(
            "لا توجد إشعارات",
            ""
          );
  }

  function closeDrawer() {
    drawer?.classList.remove(
      "show"
    );

    overlay?.classList.remove(
      "show"
    );
  }

  document
    .getElementById(
      "notificationButton"
    )
    ?.addEventListener(
      "click",
      () => {
        renderNotifications();

        drawer?.classList.add(
          "show"
        );

        overlay?.classList.add(
          "show"
        );
      }
    );

  document
    .getElementById(
      "closeNotifications"
    )
    ?.addEventListener(
      "click",
      closeDrawer
    );

  document
    .getElementById(
      "markAllNotifications"
    )
    ?.addEventListener(
      "click",
      async () => {
        await store.markAllNotifications();

        renderNotifications();

        refreshBadges();
      }
    );

  document
    .getElementById(
      "notificationList"
    )
    ?.addEventListener(
      "click",
      async (event) => {
        const item =
          event.target.closest(
            "[data-notification]"
          );

        if (!item) return;

        await store.markNotification(
          item.dataset.notification
        );

        renderNotifications();

        refreshBadges();
      }
    );

  overlay?.addEventListener(
    "click",
    () => {
      closeDrawer();

      document
        .getElementById(
          "sidebar"
        )
        ?.classList.remove(
          "show"
        );

      overlay.classList.remove(
        "sidebar-open"
      );
    }
  );

  /* =========================================================
     AUTO REFRESH
  ========================================================= */

  window.addEventListener(
    "espan:database-change",
    refreshBadges
  );

  setInterval(async () => {
    try {
      await store.refreshAsync();

      refreshBadges();
    } catch (_) {
      /* ignore temporary network errors */
    }
  }, 15000);

  /* =========================================================
     START
  ========================================================= */

  const todayLabel =
    document.getElementById(
      "todayLabel"
    );

  if (todayLabel) {
    todayLabel.textContent =
      new Intl.DateTimeFormat(
        "ar-LY",
        {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric"
        }
      ).format(new Date());
  }

  setCurrentUser();

  render();
})();