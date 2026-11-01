// mess-map.js - interactive map of all messes (Leaflet). Used on index.html and messes.html.
// Pins come from the messes saved in the database; coordinates come from each mess's Google Maps link.
// Leaflet is loaded here (with backup sources), so the pages only need <script src="mess-map.js" defer>.
(function () {
  "use strict";

  var box = document.getElementById("messMap");
  var status = document.getElementById("mapStatus");
  if (!box) return;

  function setStatus(t) { if (status) status.textContent = t; }

  // ---- load Leaflet (CSS + JS) from the first CDN that works ----
  var CDNS = [
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/",
    "https://unpkg.com/leaflet@1.9.4/dist/",
    "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/"
  ];

  function loadLeaflet(done) {
    if (window.L) return done(true);
    var i = 0;
    (function next() {
      if (i >= CDNS.length) return done(false);
      var base = CDNS[i++];
      var css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = base + "leaflet.css";
      document.head.appendChild(css);
      var js = document.createElement("script");
      js.src = base + "leaflet.js";
      js.onload = function () { window.L ? done(true) : next(); };
      js.onerror = next;
      document.head.appendChild(js);
    })();
  }

  setStatus("Loading map…");
  loadLeaflet(function (ok) {
    if (!ok) { setStatus("The map could not be loaded. Please check your internet connection."); return; }
    init();
  });

  function init() {
    var COLLEGE = [18.6478, 73.7628]; // Akurdi (PCCOE)

    var LAYERS = {
      street: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 19, attribution: "Tiles © Esri — Street Map" }),
      osm: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        { maxZoom: 19, attribution: "© OpenStreetMap contributors" }),
      sat: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 19, attribution: "Tiles © Esri — Satellite" }),
      topo: L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
        { maxZoom: 17, attribution: "© OpenTopoMap, © OpenStreetMap contributors" })
    };

    var map = L.map(box).setView(COLLEGE, 14);
    var current = LAYERS.street.addTo(map);
    var pinLayer = L.layerGroup().addTo(map);
    var userMarker = null;
    var points = []; // {id,name,type,price,lat,lng,marker}

    // ---- map style tabs ----
    document.querySelectorAll(".map-tabs button").forEach(function (b) {
      b.addEventListener("click", function () {
        var layer = LAYERS[b.dataset.layer];
        if (!layer || layer === current) return;
        map.removeLayer(current);
        current = layer.addTo(map);
        document.querySelectorAll(".map-tabs button").forEach(function (x) { x.classList.remove("active"); });
        b.classList.add("active");
      });
    });

    // ---- reading coordinates out of a Google Maps link ----
    function coordsFromText(t) {
      var s = String(t || "");
      var pats = [
        /!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/,
        /@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/,
        /[?&](?:q|ll|query|destination|center)=(-?\d{1,2}(?:\.\d+)?)(?:,|%2C)(-?\d{1,3}(?:\.\d+)?)/i
      ];
      for (var i = 0; i < pats.length; i++) {
        var m = s.match(pats[i]);
        if (m) {
          var lat = Number(m[1]), lng = Number(m[2]);
          if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat: lat, lng: lng };
        }
      }
      return null;
    }

    // veg / nonveg / both, from the mess type text
    function typeOf(t) {
      t = String(t || "").toLowerCase();
      var nonveg = /non[\s-]*veg/.test(t);
      var veg = /veg/.test(t.replace(/non[\s-]*veg/g, ""));
      if (/both|&/.test(t) || (nonveg && veg)) return "both";
      if (nonveg) return "nonveg";
      if (veg) return "veg";
      return "other";
    }

    function pinIcon(type) {
      return L.divIcon({
        className: "mess-pin",
        html: '<span class="pin-' + type + '"></span>',
        iconSize: [26, 26],
        iconAnchor: [13, 26],
        popupAnchor: [0, -24]
      });
    }

    function findCard(id) {
      var el = document.getElementById(id);
      return el && el.classList.contains("college-card") ? el : null;
    }

    function popupFor(p) {
      var card = findCard(p.id);
      var wrap = document.createElement("div");
      wrap.className = "map-pop";

      var title = document.createElement("b");
      title.textContent = p.name;
      wrap.appendChild(title);

      var label = { veg: "🟢 Veg", nonveg: "🔴 Non-Veg", both: "🔴 Veg & Non-Veg", other: "" }[p.type];
      if (label) { var d = document.createElement("div"); d.textContent = label; wrap.appendChild(d); }

      if (p.price) { var dp = document.createElement("div"); dp.textContent = p.price.split("|")[0].trim(); wrap.appendChild(dp); }

      if (card) {
        var rate = card.querySelector(".dyn-overall");
        if (rate && rate.textContent.trim()) { var dr = document.createElement("div"); dr.textContent = rate.textContent.trim(); wrap.appendChild(dr); }
      }

      var btns = document.createElement("div");
      btns.className = "map-pop-btns";
      var view = document.createElement("button");
      view.type = "button";
      view.textContent = "View card";
      view.addEventListener("click", function () {
        var c = findCard(p.id);
        if (!c) { window.location.href = "messes.html#" + encodeURIComponent(p.id); return; } // front page: open the card
        c.style.display = "block";
        c.scrollIntoView({ behavior: "smooth", block: "center" });
        c.classList.add("highlight");
        setTimeout(function () { c.classList.remove("highlight"); }, 3000);
      });
      var dir = document.createElement("a");
      dir.target = "_blank";
      dir.rel = "noopener";
      dir.href = "https://www.google.com/maps/dir/?api=1&destination=" + p.lat + "," + p.lng;
      dir.textContent = "Directions";
      btns.appendChild(view);
      btns.appendChild(dir);
      wrap.appendChild(btns);
      return wrap;
    }

    function draw(items) {
      pinLayer.clearLayers();
      points = [];
      items.forEach(function (it) {
        if (it.lat == null) return;
        var m = L.marker([it.lat, it.lng], { icon: pinIcon(it.type), title: it.name });
        m.bindPopup(function () { return popupFor(it); });
        m.addTo(pinLayer);
        it.marker = m;
        points.push(it);
      });
      if (points.length) {
        map.fitBounds(L.latLngBounds(points.map(function (p) { return [p.lat, p.lng]; })).pad(0.25), { maxZoom: 16 });
      }
      var missing = items.length - points.length;
      setStatus(points.length + " mess" + (points.length === 1 ? "" : "es") + " on the map" +
        (missing > 0 ? " (" + missing + " without a map location yet)" : "") + ".");
    }

    // all messes come from the database (same list as the cards)
    async function loadItems() {
      var res = await fetch("/api/messes?basic=1", { cache: "no-store" });
      if (!res.ok) throw new Error("failed");
      var data = await res.json();
      return Object.keys(data || {}).filter(function (k) { return data[k] && data[k].mapLink; }).map(function (k) {
        var m = data[k];
        return { id: k, name: m.name || "Mess", type: typeOf(m.type), price: m.price || "", href: m.mapLink };
      });
    }

    async function refresh() {
      var items;
      try {
        items = await loadItems();
      } catch (e) {
        setStatus("Could not load the messes. Please refresh the page.");
        return;
      }
      var unresolved = [];
      items.forEach(function (it) {
        var c = coordsFromText(it.href);
        if (c) { it.lat = c.lat; it.lng = c.lng; } else unresolved.push(it.href);
      });
      draw(items); // show what we already know right away

      if (!unresolved.length) return;
      try {
        var res = await fetch("/api/resolve-map", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ urls: unresolved })
        });
        if (!res.ok) return;
        var found = await res.json();
        items.forEach(function (it) {
          if (it.lat == null && found[it.href]) { it.lat = found[it.href].lat; it.lng = found[it.href].lng; }
        });
        draw(items);
      } catch (e) { /* keep the pins we have */ }
    }

    // ---- Find Nearest to Me ----
    function km(a, b) {
      var R = 6371, rad = Math.PI / 180;
      var dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
      var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
      return 2 * R * Math.asin(Math.sqrt(x));
    }

    var result = document.getElementById("mapNearest");
    var nearBtn = document.getElementById("mapNearBtn");
    if (nearBtn && result) nearBtn.addEventListener("click", function () {
      result.textContent = "";
      if (!navigator.geolocation) { result.textContent = "Your browser does not support location."; return; }
      if (!points.length) { result.textContent = "No messes with a map location yet."; return; }
      result.textContent = "Finding your location…";

      navigator.geolocation.getCurrentPosition(function (pos) {
        var me = [pos.coords.latitude, pos.coords.longitude];
        if (userMarker) map.removeLayer(userMarker);
        userMarker = L.marker(me, {
          icon: L.divIcon({ className: "me-pin", html: "<span></span>", iconSize: [18, 18], iconAnchor: [9, 9] }),
          title: "You are here"
        }).addTo(map);

        var ranked = points.map(function (p) { return { p: p, d: km(me, [p.lat, p.lng]) }; })
          .sort(function (a, b) { return a.d - b.d; });
        var top = ranked.slice(0, 3);

        map.fitBounds(L.latLngBounds([me, [top[0].p.lat, top[0].p.lng]]).pad(0.4), { maxZoom: 17 });
        top[0].p.marker.openPopup();

        result.textContent = "";
        var head = document.createElement("div");
        head.textContent = "📍 Nearest to you:";
        result.appendChild(head);
        top.forEach(function (r, i) {
          var line = document.createElement("div");
          var b = document.createElement("button");
          b.type = "button";
          b.textContent = r.p.name;
          b.addEventListener("click", function () { map.setView([r.p.lat, r.p.lng], 17); r.p.marker.openPopup(); });
          line.appendChild(document.createTextNode((i + 1) + ". "));
          line.appendChild(b);
          line.appendChild(document.createTextNode(" — " + (r.d < 1 ? Math.round(r.d * 1000) + " m" : r.d.toFixed(1) + " km")));
          result.appendChild(line);
        });
      }, function () {
        result.textContent = "Location access denied. Allow location in your browser to use this.";
      }, { enableHighAccuracy: true, timeout: 12000 });
    });

    refresh();
    window.addEventListener("load", function () { map.invalidateSize(); });
    setTimeout(function () { map.invalidateSize(); }, 600);
  }
})();
