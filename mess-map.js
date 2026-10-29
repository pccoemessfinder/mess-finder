// mess-map.js - interactive map of all messes on messes.html (Leaflet).
// Pins come from the cards on the page; coordinates come from each card's Google Maps link.
(function () {
  "use strict";

  var box = document.getElementById("messMap");
  if (!box || !window.L) {
    var st = document.getElementById("mapStatus");
    if (st) st.textContent = "The map could not be loaded. Please check your internet connection.";
    return;
  }

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
  var points = []; // {id,name,type,lat,lng,marker}

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

  function typeOfCard(card) {
    var nv = card.querySelector("span.nonveg");
    var v = card.querySelector("span.veg");
    if (nv) return /veg\s*&|both|and/i.test(nv.textContent) ? "both" : "nonveg";
    if (v) return "veg";
    return "other";
  }

  function collectCards() {
    var out = [];
    document.querySelectorAll(".college-card[id]").forEach(function (card) {
      var h3 = card.querySelector("h3");
      var a = card.querySelector('a[href*="google.com/maps"], a[href*="goo.gl"]');
      if (!h3 || !a) return;
      out.push({ id: card.id, name: h3.textContent.trim(), type: typeOfCard(card), href: a.href });
    });
    return out;
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

    if (card) {
      var price = Array.prototype.find.call(card.querySelectorAll("p"), function (x) { return /₹/.test(x.textContent); });
      if (price) { var dp = document.createElement("div"); dp.textContent = price.textContent.trim(); wrap.appendChild(dp); }
      var rate = card.querySelector(".overall-rating, .dyn-overall");
      if (rate && rate.textContent.trim()) { var dr = document.createElement("div"); dr.textContent = rate.textContent.trim(); wrap.appendChild(dr); }
    }

    var btns = document.createElement("div");
    btns.className = "map-pop-btns";
    var view = document.createElement("button");
    view.type = "button";
    view.textContent = "View card";
    view.addEventListener("click", function () {
      var c = findCard(p.id);
      if (!c) return;
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

  var status = document.getElementById("mapStatus");

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
    status.textContent = points.length + " mess" + (points.length === 1 ? "" : "es") + " on the map" +
      (missing > 0 ? " (" + missing + " without a map location yet)" : "") + ".";
  }

  var seq = 0;
  async function refresh() {
    var mine = ++seq;
    var items = collectCards();
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
      if (mine !== seq) return; // a newer refresh started
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
  document.getElementById("mapNearBtn").addEventListener("click", function () {
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
  // cards of messes stored in the database are added a moment later
  document.addEventListener("messes-ready", refresh);
  window.addEventListener("load", function () { map.invalidateSize(); });
})();
