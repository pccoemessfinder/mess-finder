// extras.js - visitor counter + Website Guide. Add  <script src="extras.js" defer></script>  to a page.
(function () {
  "use strict";

  // load the extra styles (kept in their own file so style.css stays untouched)
  var link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "extras.css";
  document.head.appendChild(link);

  function getId() {
    try {
      var id = localStorage.getItem("voterId");
      if (!id) {
        id = window.crypto && crypto.randomUUID ? crypto.randomUUID()
          : "v-" + Date.now() + "-" + Math.random().toString(36).slice(2, 12);
        localStorage.setItem("voterId", id);
      }
      return id;
    } catch (e) {
      return "v-" + Math.random().toString(36).slice(2, 14) + Date.now();
    }
  }

  // ---------- Website Guide ----------
  var GUIDE = [
    ["🔍", "Search & Filter", "Type a mess name in the search box, or use All / Veg / Non-Veg to narrow the list.", "messes.html", "Try"],
    ["🗺️", "Interactive Map", "See every mess as a pin: green = Veg, red = Non-Veg, orange = both. Switch the map style, tap a pin for details, or press “Find Nearest to Me”.", "messes.html#mess-map", "Try"],
    ["📍", "Find Mess Near Me", "Uses your GPS and opens Google Maps with messes near you.", "messes.html", "Try"],
    ["❤️", "Favorites", "Tap “Add to Favorite” on a mess. Open ❤️ Favorites on the home page to see them all.", "index.html", "Open"],
    ["⭐", "Your Rating vs Overall Rating", "Pick 1–5 stars and press Submit Rating. “Your Rating” is your own score (you can change it later); “Overall Rating” is the average of everyone's ratings.", "messes.html", "Try"],
    ["📋", "Weekly Menu & Contact", "Every card has a Weekly Menu pop-up, a Location button for Google Maps and a WhatsApp button to chat with the mess.", "messes.html", "Try"],
    ["🏪", "Mess Owners", "Owners can register, then log in to edit the menu, photo, timings, WhatsApp number and map location — or delete their mess with their password.", "owner-login.html", "Open"],
    ["💬", "Contact & Suggestions", "Send us a message or a suggestion to improve Mess Finder.", "contact.html", "Open"],
    ["🌙", "Dark Mode & Languages", "On the home page, switch between dark and light mode and choose English, मराठी or हिन्दी.", "index.html", "Open"]
  ];

  function buildGuide() {
    var modal = document.createElement("div");
    modal.className = "mf-modal";
    modal.id = "guideModal";
    var box = document.createElement("div");
    box.className = "mf-modal-box";

    var close = document.createElement("button");
    close.className = "mf-close";
    close.setAttribute("aria-label", "Close");
    close.textContent = "×";
    box.appendChild(close);

    var h = document.createElement("h2");
    h.textContent = "📖 Website Guide";
    box.appendChild(h);
    var sub = document.createElement("p");
    sub.className = "mf-sub";
    sub.textContent = "Everything you can do on PCCOE/DYP Mess Finder.";
    box.appendChild(sub);

    GUIDE.forEach(function (g) {
      var item = document.createElement("div");
      item.className = "guide-item";
      var text = document.createElement("div");
      var t = document.createElement("h4");
      t.textContent = g[0] + " " + g[1];
      var p = document.createElement("p");
      p.textContent = g[2];
      text.appendChild(t);
      text.appendChild(p);
      var a = document.createElement("a");
      a.className = "guide-try";
      a.href = g[3];
      a.textContent = g[4];
      item.appendChild(text);
      item.appendChild(a);
      box.appendChild(item);
    });

    modal.appendChild(box);
    document.body.appendChild(modal);

    function hide() { modal.classList.remove("open"); }
    close.addEventListener("click", hide);
    modal.addEventListener("click", function (e) { if (e.target === modal) hide(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") hide(); });
    // a "Try" link to the page we are already on should just close the guide
    box.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest("a.guide-try");
      if (a) hide();
    });
    return modal;
  }

  // ---------- pieces placed in the navbar ----------
  function makePill() {
    var pill = document.createElement("span");
    pill.className = "visitor-pill";
    pill.title = "Unique visitors, and people on the site right now";
    pill.innerHTML =
      '<span class="v-live"></span>👥 <span><b data-v="total">–</b> Visitors</span>' +
      '<span class="v-active"><i></i><span data-v="active">0</span> active</span>';
    return pill;
  }

  function mount() {
    var modal = buildGuide();

    var btn = document.createElement("button");
    btn.className = "guide-btn";
    btn.type = "button";
    btn.textContent = "📖 Website Guide";
    btn.addEventListener("click", function () { modal.classList.add("open"); });

    var pill = makePill();

    var controls = document.querySelector("nav .nav-controls");
    if (controls) {
      controls.appendChild(btn);
      controls.appendChild(pill);
    } else {
      var ul = document.querySelector("nav ul");
      if (!ul) return;
      var li1 = document.createElement("li");
      li1.appendChild(btn);
      var li2 = document.createElement("li");
      li2.appendChild(pill);
      ul.appendChild(li1);
      ul.appendChild(li2);
    }
    startCounter(pill);
  }

  // ---------- visitor counter ----------
  function startCounter(pill) {
    var totalEl = pill.querySelector('[data-v="total"]');
    var activeEl = pill.querySelector('[data-v="active"]');

    function tick() {
      if (document.hidden) return;
      fetch("/api/visit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitorId: getId() })
      })
        .catch(function () {})
        .then(function () { return fetch("/api/stats", { cache: "no-store" }); })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
        .then(function (s) {
          totalEl.textContent = s.total;
          activeEl.textContent = Math.max(1, s.active);
        })
        .catch(function () { /* offline: keep the last numbers */ });
    }

    tick();
    setInterval(tick, 30000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) tick(); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
