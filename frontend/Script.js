const loader = document.getElementById("loader");
const loaderProgress = document.getElementById("loaderProgress");
const loaderNumber = document.getElementById("loaderNumber");

const header = document.getElementById("header");
const scrollProgress = document.getElementById("scrollProgress");

const menuButton = document.getElementById("menuButton");
const navLinks = document.getElementById("navLinks");

const currentYear = document.getElementById("currentYear");

/* السنة الحالية */

if (currentYear) {
  currentYear.textContent = new Date().getFullYear();
}

/* شاشة التحميل */

if (loader && loaderProgress && loaderNumber) {
  let loadingValue = 0;

  const loadingInterval = setInterval(() => {
    loadingValue += Math.floor(Math.random() * 10) + 5;

    if (loadingValue >= 100) {
      loadingValue = 100;
      clearInterval(loadingInterval);

      setTimeout(() => {
        loader.classList.add("hidden");
      }, 350);
    }

    loaderProgress.style.width = `${loadingValue}%`;
    loaderNumber.textContent = `${loadingValue}%`;
  }, 65);
}

/* الهيدر وشريط تقدم الصفحة */

function updatePageOnScroll() {
  const currentScroll = window.scrollY;

  const pageHeight =
    document.documentElement.scrollHeight -
    window.innerHeight;

  const percentage =
    pageHeight > 0
      ? (currentScroll / pageHeight) * 100
      : 0;

  if (scrollProgress) {
    scrollProgress.style.width = `${percentage}%`;
  }

  if (header) {
    header.classList.toggle(
      "scrolled",
      currentScroll > 65
    );
  }
}

window.addEventListener("scroll", updatePageOnScroll);
updatePageOnScroll();

/* قائمة الهاتف */

if (menuButton && navLinks) {
  menuButton.addEventListener("click", (event) => {
    event.stopPropagation();

    menuButton.classList.toggle("open");
    navLinks.classList.toggle("open");
  });

  navLinks.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      menuButton.classList.remove("open");
      navLinks.classList.remove("open");
    });
  });

  /* إغلاق القائمة عند الضغط خارجها */

  document.addEventListener("click", (event) => {
    const clickedInsideMenu =
      navLinks.contains(event.target);

    const clickedMenuButton =
      menuButton.contains(event.target);

    if (
      navLinks.classList.contains("open") &&
      !clickedInsideMenu &&
      !clickedMenuButton
    ) {
      navLinks.classList.remove("open");
      menuButton.classList.remove("open");
    }
  });
}

/* تحديد رابط القسم النشط */

const sections =
  document.querySelectorAll("main section[id]");

const navigationLinks =
  document.querySelectorAll(
    '.nav-links a[href^="#"]'
  );

function updateActiveLink() {
  let activeSection = "home";

  sections.forEach((section) => {
    const sectionTop = section.offsetTop - 190;
    const sectionBottom =
      sectionTop + section.offsetHeight;

    if (
      window.scrollY >= sectionTop &&
      window.scrollY < sectionBottom
    ) {
      activeSection = section.id;
    }
  });

  navigationLinks.forEach((link) => {
    const linkTarget = link.getAttribute("href");

    link.classList.toggle(
      "active",
      linkTarget === `#${activeSection}`
    );
  });
}

window.addEventListener("scroll", updateActiveLink);
updateActiveLink();

/* إظهار العناصر عند النزول */

const revealElements =
  document.querySelectorAll(".reveal");

if ("IntersectionObserver" in window) {
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          revealObserver.unobserve(entry.target);
        }
      });
    },
    {
      threshold: 0.12,
      rootMargin: "0px 0px -45px 0px"
    }
  );

  revealElements.forEach((element) => {
    revealObserver.observe(element);
  });
} else {
  revealElements.forEach((element) => {
    element.classList.add("visible");
  });
}

/* تحريك إحصائية 100% */

const counter =
  document.querySelector("[data-count]");

let counterStarted = false;

function startCounter() {
  if (!counter || counterStarted) {
    return;
  }

  counterStarted = true;

  const target = Number(counter.dataset.count);
  const duration = 1500;
  const startingTime = performance.now();

  function animateCounter(currentTime) {
    const progress = Math.min(
      (currentTime - startingTime) / duration,
      1
    );

    const currentValue =
      Math.floor(progress * target);

    counter.textContent = `${currentValue}%`;

    if (progress < 1) {
      requestAnimationFrame(animateCounter);
    }
  }

  requestAnimationFrame(animateCounter);
}

if (counter) {
  if ("IntersectionObserver" in window) {
    const counterObserver =
      new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) {
            startCounter();
            counterObserver.disconnect();
          }
        },
        {
          threshold: 0.5
        }
      );

    counterObserver.observe(counter);
  } else {
    startCounter();
  }
}

/* قراءة بيانات المستخدم المسجل */

function getLoggedInUser() {
  const savedUser =
    localStorage.getItem("espanUser");

  if (!savedUser) {
    return null;
  }

  try {
    return JSON.parse(savedUser);
  } catch (error) {
    localStorage.removeItem("espanUser");
    return null;
  }
}

/* الانتقال إلى صفحة تسجيل الدخول */

function redirectToLogin() {
  sessionStorage.setItem(
    "redirectAfterLogin",
    window.location.href
  );

  window.location.href = "auth.html";
}

/* التحقق من تسجيل الدخول */

function requireLogin() {
  const user = getLoggedInUser();

  if (user) {
    return true;
  }

  redirectToLogin();
  return false;
}

/* أزرار تسجيل الدخول */

const openLoginButtons =
  document.querySelectorAll(".open-login");

openLoginButtons.forEach((button) => {
  button.addEventListener("click", (event) => {
    const activeUser = getLoggedInUser();

    if (activeUser) {
      event.preventDefault();
      window.location.href = window.ESPANStore
        ? window.ESPANStore.roleHome(activeUser.role)
        : "account.html";
      return;
    }

    event.preventDefault();
    redirectToLogin();
  });
});

/* تغيير زر تسجيل الدخول بعد دخول المستخدم */

const accountButton =
  document.getElementById("accountButton");

const loggedInUser = getLoggedInUser();

if (accountButton && loggedInUser) {
  accountButton.textContent =
    loggedInUser.full_name ||
    loggedInUser.phone ||
    "حسابي";

  accountButton.href = window.ESPANStore
    ? window.ESPANStore.roleHome(loggedInUser.role)
    : "account.html";
  accountButton.dataset.loggedIn = "true";
  accountButton.classList.remove("open-login");
}

/* أزرار الحجز */

const bookingButtons =
  document.querySelectorAll(".booking-button");

bookingButtons.forEach((button) => {
  button.addEventListener("click", (event) => {
    event.preventDefault();

    if (!requireLogin()) {
      return;
    }

    const bookingTarget =
      button.dataset.bookingUrl ||
      button.getAttribute("href") ||
      (window.ESPANStore
        ? window.ESPANStore.roleHome(loggedInUser?.role || "customer")
        : "account.html");

    window.location.href = bookingTarget;
  });
});

/* أزرار المفضلة */

const favoriteButtons =
  document.querySelectorAll(".favorite-button");

favoriteButtons.forEach((button) => {
  button.addEventListener("click", (event) => {
    event.preventDefault();

    if (!requireLogin()) {
      return;
    }

    button.classList.toggle("active");

    const isFavorite =
      button.classList.contains("active");

    button.setAttribute(
      "aria-pressed",
      String(isFavorite)
    );

    button.setAttribute(
      "aria-label",
      isFavorite
        ? "إزالة من المفضلة"
        : "إضافة إلى المفضلة"
    );
  });
});

/* ضمان بقاء الفيديو صامتًا */

const heroVideo =
  document.querySelector(".hero-video");

if (heroVideo) {
  heroVideo.muted = true;
  heroVideo.defaultMuted = true;
  heroVideo.volume = 0;

  heroVideo
    .play()
    .catch(() => {
      /*
        قد يمنع المتصفح التشغيل التلقائي مؤقتًا.
        سيبقى الفيديو صامتًا عند تشغيله.
      */
    });

  heroVideo.addEventListener(
    "volumechange",
    () => {
      if (
        !heroVideo.muted ||
        heroVideo.volume !== 0
      ) {
        heroVideo.muted = true;
        heroVideo.volume = 0;
      }
    }
  );
}
