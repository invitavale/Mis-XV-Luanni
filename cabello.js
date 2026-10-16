/* =====================================================================
   Cabello continuo de Rapunzel (con la imagen real de cabello)
   La foto del mechón se "estira" a lo largo de un recorrido que nace en la
   portada, serpentea por toda la invitación pasando por DETRÁS de tarjetas,
   separadores y adornos (y por delante en algunas esquinas) y termina
   enredado en Flynn. Se dibuja en lienzos (canvas) por tramos y se va
   desenrollando con el scroll.
   ===================================================================== */
(function () {
  'use strict';

  var TEX_SRC = 'img/cabello-textura.webp';
  var TEX_LOOP = 1738;      // filas que se repiten sin costura
  var TEX_W = 256;          // ancho de la textura (borde a borde = ±1.12 del grosor)
  var TEX_U = 1.12;
  var TEX_HALF = 85;        // medio grosor del mechón original, en px de la textura
  var TILE = 1024;          // alto de cada lienzo (px CSS)
  var STEP = 5;             // separación entre cortes del mallado (px)

  var page, backBox, frontBox, tex = null;
  var geo = null, shown = 0, target = 0, drawn = 0, raf = 0, lastKey = '';
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function rel(el) {
    var p = page.getBoundingClientRect(), r = el.getBoundingClientRect();
    return { l: r.left - p.left, t: r.top - p.top, r: r.right - p.left, b: r.bottom - p.top, w: r.width, h: r.height };
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // Catmull-Rom centrípeta
  function spline(pts, perSeg) {
    var out = [], P = [pts[0]].concat(pts, [pts[pts.length - 1]]);
    for (var i = 0; i < P.length - 3; i++) {
      var p0 = P[i], p1 = P[i + 1], p2 = P[i + 2], p3 = P[i + 3];
      var t0 = 0;
      var t1 = t0 + Math.pow(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1e-3, 0.5);
      var t2 = t1 + Math.pow(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) || 1e-3, 0.5);
      var t3 = t2 + Math.pow(Math.hypot(p3[0] - p2[0], p3[1] - p2[1]) || 1e-3, 0.5);
      for (var j = 0; j < perSeg; j++) {
        var t = t1 + (t2 - t1) * (j / perSeg), pt = [0, 0];
        for (var k = 0; k < 2; k++) {
          var A1 = (t1 - t) / (t1 - t0) * p0[k] + (t - t0) / (t1 - t0) * p1[k];
          var A2 = (t2 - t) / (t2 - t1) * p1[k] + (t - t1) / (t2 - t1) * p2[k];
          var A3 = (t3 - t) / (t3 - t2) * p2[k] + (t - t2) / (t3 - t2) * p3[k];
          var B1 = (t2 - t) / (t2 - t0) * A1 + (t - t0) / (t2 - t0) * A2;
          var B2 = (t3 - t) / (t3 - t1) * A2 + (t - t1) / (t3 - t1) * A3;
          pt[k] = (t2 - t) / (t2 - t1) * B1 + (t - t1) / (t2 - t1) * B2;
        }
        out.push(pt);
      }
    }
    out.push(pts[pts.length - 1].slice());
    return out;
  }
  function resample(pts, step) {
    var out = [pts[0]], acc = 0;
    for (var i = 1; i < pts.length; i++) {
      var a = out[out.length - 1], b = pts[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      while (acc + d >= step) {
        var f = (step - acc) / d, n = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
        out.push(n); a = n; d = Math.hypot(b[0] - a[0], b[1] - a[1]); acc = 0;
      }
      acc += d;
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  // ---------- recorrido ----------
  function controlPoints() {
    var W = page.clientWidth;
    var hero = rel(document.querySelector('.hero-section'));
    var rap = rel(document.getElementById('heroRapunzel'));
    var txt = rel(document.querySelector('.hero-section .hero-text'));
    var fl = rel(document.getElementById('flynn'));
    var foot = rel(document.querySelector('.climb-footer'));
    var footCard = rel(document.querySelector('.climb-footer .footer-content'));

    var w0 = rap.w * 0.45;                       // grosor de la columna de cabello del recorte
    var x0 = rap.l + rap.w * 0.305, y0 = rap.t + rap.h * 0.80;
    var wE = fl.h * 0.0756;                      // grosor del mechón que sale de Flynn
    var E = [fl.r - 8, fl.t + fl.h * 0.657];

    var pts = [], fronts = [], H = hero.h;
    var edgeR = W - w0 * 0.40;

    // Portada: baja por la derecha junto al texto y barre hacia la izquierda abajo
    var R = H - y0;
    // Rapunzel está abajo a la derecha: el cabello sale de la portada y entra al contenido
    pts.push([x0, y0], [x0, y0 + rap.h * 0.10]);
    pts.push([x0 - W * 0.04, Math.max(H + 40, y0 + rap.h * 0.25)]);

    var sel = ['.countdown-section .card', '.events-section .card', '.gallery-section .card',
               '.party-section .party-grid', '.gifts-section .card', '.rsvp-section .card'];
    var cards = sel.map(function (s) { return rel(document.querySelector(s)); });
    var wrap = { 1: true, 4: true };   // en estas pasa por delante de la esquina

    cards.forEach(function (c, i) {
      var s = (i % 2 === 0) ? -1 : 1;    // lado por donde entra: izq, der, izq...
      var cx = (c.l + c.r) / 2, cw = c.w;
      var e = s > 0 ? c.r : c.l;
      var nextTop = i < cards.length - 1 ? cards[i + 1].t : footCard.t;
      var gh = nextTop - c.b;

      if (wrap[i]) {
        // entra por delante de la esquina superior, sale por el costado y se mete por detrás
        var k = Math.min(140, cw * 0.32);
        pts.push([e - s * k * 1.05, c.t - Math.min(60, gh * 0.35)]);
        pts.push([e - s * k * 0.30, c.t + k * 0.30]);
        pts.push([e + s * Math.min(22, (s > 0 ? W - c.r : c.l) * 0.6), c.t + c.h * 0.30]);
        fronts.push({ e: e, t: c.t, s: s, k: k, top: (i > 0 ? cards[i - 1].b : c.t - 200) + 4 });
        pts.push([cx + s * cw * 0.05, c.t + c.h * 0.62]);
      } else {
        // cruza en diagonal por DETRÁS de la tarjeta
        pts.push([cx + s * cw * 0.30, c.t - Math.min(40, gh * 0.25)]);
        pts.push([cx + s * cw * 0.14, c.t + c.h * 0.36]);
        pts.push([cx - s * cw * 0.12, c.t + c.h * 0.66]);
      }
      pts.push([cx - s * cw * 0.30, c.b + Math.min(34, gh * 0.22)]);
      // en el hueco: vuelta amplia hacia el otro lado (pasa detrás del separador)
      if (i < cards.length - 1) {
        pts.push([W / 2 - s * W * 0.36, c.b + gh * 0.55]);
      }
    });

    // Pie: detrás de la tarjeta de despedida y entra horizontal al mechón de Flynn
    var xr = Math.min(W - wE, Math.max(E[0] + 110, W * 0.82));
    pts.push([W * 0.55, footCard.t + footCard.h * 0.5]);
    pts.push([xr, (footCard.b + E[1]) / 2 - 10]);
    pts.push([Math.min(xr - 10, E[0] + 90), E[1] - 26]);
    pts.push([E[0] + 34, E[1]]);
    pts.push(E);

    return { pts: pts, w0: w0, wE: wE, fronts: fronts, W: W, Htot: page.scrollHeight,
             tieTop: [x0, rap.t + rap.h * 0.90, w0], tieEnd: [E[0], E[1], wE] };
  }

  // ---------- lienzos ----------
  function makeTiles(box, W, Htot, dpr, onlyRanges) {
    box.innerHTML = '';
    box.style.height = Htot + 'px';
    var tiles = [];
    for (var y = 0; y < Htot; y += TILE) {
      var h = Math.min(TILE, Htot - y);
      if (onlyRanges && !onlyRanges.some(function (r) { return r[1] > y && r[0] < y + h; })) { tiles.push(null); continue; }
      var cv = document.createElement('canvas');
      cv.width = Math.ceil(W * dpr); cv.height = Math.ceil(h * dpr);
      cv.style.cssText = 'position:absolute;left:0;top:' + y + 'px;width:' + W + 'px;height:' + h + 'px;';
      box.appendChild(cv);
      var ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, -y * dpr);
      ctx.imageSmoothingQuality = 'high';
      tiles.push({ ctx: ctx, y: y, h: h });
    }
    return tiles;
  }

  // dibuja un tramo (cuadrilátero casi paralelogramo) de la textura:
  // la transformación afín sale de 3 esquinas y el recorte usa las 4 (con un
  // pequeño traslape a lo largo para que no queden rayitas entre tramos)
  function quad(ctx, s0, s1, s2, d0, d1, d2, clipPts, vy0, vy1) {
    var den = s0[0] * (s1[1] - s2[1]) + s1[0] * (s2[1] - s0[1]) + s2[0] * (s0[1] - s1[1]);
    if (Math.abs(den) < 1e-6) return;
    var a = (d0[0] * (s1[1] - s2[1]) + d1[0] * (s2[1] - s0[1]) + d2[0] * (s0[1] - s1[1])) / den;
    var b = (d0[1] * (s1[1] - s2[1]) + d1[1] * (s2[1] - s0[1]) + d2[1] * (s0[1] - s1[1])) / den;
    var c = (d0[0] * (s2[0] - s1[0]) + d1[0] * (s0[0] - s2[0]) + d2[0] * (s1[0] - s0[0])) / den;
    var d = (d0[1] * (s2[0] - s1[0]) + d1[1] * (s0[0] - s2[0]) + d2[1] * (s1[0] - s0[0])) / den;
    var e = (d0[0] * (s1[0] * s2[1] - s2[0] * s1[1]) + d1[0] * (s2[0] * s0[1] - s0[0] * s2[1]) + d2[0] * (s0[0] * s1[1] - s1[0] * s0[1])) / den;
    var f = (d0[1] * (s1[0] * s2[1] - s2[0] * s1[1]) + d1[1] * (s2[0] * s0[1] - s0[0] * s2[1]) + d2[1] * (s0[0] * s1[1] - s1[0] * s0[1])) / den;
    var sy0 = Math.max(0, Math.floor(vy0) - 48), sy1 = Math.min(tex.height, Math.ceil(vy1) + 48);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(clipPts[0][0], clipPts[0][1]);
    for (var i = 1; i < clipPts.length; i++) ctx.lineTo(clipPts[i][0], clipPts[i][1]);
    ctx.closePath();
    ctx.clip();
    ctx.transform(a, b, c, d, e, f);
    ctx.drawImage(tex, 0, sy0, TEX_W, sy1 - sy0, 0, sy0, TEX_W, sy1 - sy0);
    ctx.restore();
  }

  function drawQuads(from, to) {
    var g = geo;
    for (var i = from; i < to && i < g.c.length - 1; i++) {
      var c0 = g.c[i], c1 = g.c[i + 1], n0 = g.n[i], n1 = g.n[i + 1];
      var h0 = g.w[i] * 0.5 * TEX_U, h1 = g.w[i + 1] * 0.5 * TEX_U;
      var R0 = [c0[0] - n0[0] * h0, c0[1] - n0[1] * h0], L0 = [c0[0] + n0[0] * h0, c0[1] + n0[1] * h0];
      var R1 = [c1[0] - n1[0] * h1, c1[1] - n1[1] * h1];
      var v0 = g.v[i] % TEX_LOOP, v1 = v0 + (g.v[i + 1] - g.v[i]);
      var sR0 = [0, v0], sL0 = [TEX_W, v0], sC1 = [TEX_W / 2, v1];
      // recorte: contorno real del mechón (±1 del grosor) con un traslape mínimo a lo largo
      var e0 = g.w[i] * 0.5, e1 = g.w[i + 1] * 0.5;
      var tx = c1[0] - c0[0], ty = c1[1] - c0[1], tl = Math.hypot(tx, ty) || 1; tx = tx / tl * 0.8; ty = ty / tl * 0.8;
      var clipPts = [
        [c0[0] - n0[0] * e0 - tx, c0[1] - n0[1] * e0 - ty], [c0[0] + n0[0] * e0 - tx, c0[1] + n0[1] * e0 - ty],
        [c1[0] + n1[0] * e1 + tx, c1[1] + n1[1] * e1 + ty], [c1[0] - n1[0] * e1 + tx, c1[1] - n1[1] * e1 + ty]];
      var yMin = Math.min(clipPts[0][1], clipPts[1][1], clipPts[2][1], clipPts[3][1]) - 3, yMax = Math.max(clipPts[0][1], clipPts[1][1], clipPts[2][1], clipPts[3][1]) + 3;
      [g.back, g.front].forEach(function (tiles) {
        if (!tiles) return;
        var a = Math.max(0, Math.floor(yMin / TILE)), b = Math.min(tiles.length - 1, Math.floor(yMax / TILE));
        for (var t = a; t <= b; t++) {
          var T = tiles[t];
          if (!T) continue;
          quad(T.ctx, sR0, sL0, sC1, R0, L0, c1, clipPts, v0, v1);
        }
      });
    }
  }

  function build() {
    if (!page || !tex) return;
    var cp = controlPoints();
    var key = cp.W + 'x' + cp.Htot + ':' + cp.pts.map(function (p) { return Math.round(p[0]) + ',' + Math.round(p[1]); }).join(';');
    if (key === lastKey) return;
    lastKey = key;

    var c = resample(spline(cp.pts, 24), STEP);
    var L = c.length, len = [0], n = [], w = [], v = [0];
    for (var i = 1; i < L; i++) len.push(len[i - 1] + Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]));
    var total = len[L - 1];
    for (i = 0; i < L; i++) {
      var a = c[Math.max(0, i - 2)], b = c[Math.min(L - 1, i + 2)];
      var dx = b[0] - a[0], dy = b[1] - a[1], m = Math.hypot(dx, dy) || 1;
      n.push([-dy / m, dx / m]);
      w.push(cp.wE + (cp.w0 - cp.wE) * Math.pow(1 - len[i] / total, 1.15));
    }
    // coordenada a lo largo de la textura: avanza según el grosor para no deformar el pelo
    for (i = 1; i < L; i++) v.push(v[i - 1] + (len[i] - len[i - 1]) * TEX_HALF / (w[i] * 0.5));

    var maxY = [], my = -1e9;
    for (i = 0; i < L; i++) { my = Math.max(my, c[i][1]); maxY.push(my); }

    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var frontRanges = cp.fronts.map(function (f) { return [f.top, f.t + f.k + 20]; });
    var back = makeTiles(backBox, cp.W, cp.Htot, dpr, null);
    var front = cp.fronts.length ? makeTiles(frontBox, cp.W, cp.Htot, dpr, frontRanges) : null;
    if (front) {
      // la capa de adelante solo se ve sobre la esquina de algunas tarjetas
      front.forEach(function (T) {
        if (!T) return;
        T.ctx.beginPath();
        cp.fronts.forEach(function (f) {
          var e = f.e, t = f.t, s = f.s, k = f.k;
          T.ctx.moveTo(e - s * k, f.top); T.ctx.lineTo(e - s * k, t); T.ctx.lineTo(e, t + k);
          T.ctx.lineTo(e + s * 400, t + k); T.ctx.lineTo(e + s * 400, f.top); T.ctx.closePath();
        });
        T.ctx.clip();
      });
    } else frontBox.innerHTML = '';

    geo = { c: c, n: n, w: w, v: v, len: len, total: total, maxY: maxY, back: back, front: front };

    // lazo donde nace el cabello (bajo Rapunzel) y flor donde se une con Flynn
    var tt = document.getElementById('hairTieTop'), te = document.getElementById('hairTieEnd');
    if (tt) {
      var tw = clamp(cp.tieTop[2] * 1.75, 90, 230), th = tw * 422 / 320;
      tt.style.width = tw + 'px';
      tt.style.left = (cp.tieTop[0] - tw * 0.40) + 'px';
      tt.style.top = (cp.tieTop[1] - th * 0.24) + 'px';
    }
    if (te) {
      var fw = clamp(cp.tieEnd[2] * 2.6, 64, 120), fh = fw * 256 / 247;
      te.style.width = fw + 'px';
      te.style.left = (cp.tieEnd[0] - fw * 0.45) + 'px';
      te.style.top = (cp.tieEnd[1] - fh * 0.45) + 'px';
    }
    drawn = 0;
    if (reduceMotion) shown = target = total;
    shown = Math.min(shown, total);
    target = Math.min(Math.max(target, shown), total);
    update(true);
  }

  // ---------- revelado con el scroll ----------
  function idxAt(s) {
    var len = geo.len, lo = 0, hi = len.length - 1;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (len[mid] < s) lo = mid + 1; else hi = mid; }
    return lo;
  }
  function computeTarget() {
    var limitY = -page.getBoundingClientRect().top + window.innerHeight * 0.92;
    var lo = 0, hi = geo.maxY.length - 1, ans = 0;
    while (lo <= hi) { var mid = (lo + hi) >> 1; if (geo.maxY[mid] <= limitY) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    if (geo.maxY[geo.maxY.length - 1] - limitY < 120) return geo.total;
    return Math.min(geo.total, geo.len[ans] + 40);
  }
  function paint() {
    var to = shown >= geo.total ? geo.c.length - 1 : idxAt(shown);
    if (to > drawn) { drawQuads(drawn, to); drawn = to; }
    var te = document.getElementById('hairTieEnd');
    if (te) te.style.opacity = shown >= geo.total - 30 ? '1' : '0';
  }
  function tick() {
    raf = 0;
    var d = target - shown;
    if (d <= 1) { shown = target; paint(); return; }
    shown += Math.min(d, d * 0.10 + 6);
    paint();
    raf = requestAnimationFrame(tick);
  }
  function update(force) {
    if (!geo) return;
    var t = reduceMotion ? geo.total : computeTarget();
    target = Math.max(target, t);
    if (force && shown > 0) paint();
    if (reduceMotion) { shown = target; paint(); return; }
    if (!raf) raf = requestAnimationFrame(tick);
  }

  // ---------- inicio ----------
  var timer = 0;
  function schedule() { clearTimeout(timer); timer = setTimeout(build, 90); }

  function init() {
    page = document.getElementById('page');
    backBox = document.getElementById('hairBack');
    frontBox = document.getElementById('hairFront');
    if (!page || !backBox) return;
    var im = new Image();
    im.onload = function () { tex = im; build(); };
    im.src = TEX_SRC;
    window.addEventListener('resize', schedule);
    window.addEventListener('load', schedule);
    window.addEventListener('scroll', function () { update(false); }, { passive: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
    if (window.ResizeObserver) new ResizeObserver(schedule).observe(page);
    Array.prototype.forEach.call(document.images, function (img) { if (!img.complete) img.addEventListener('load', schedule); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // muestra todo el cabello de una vez (útil para capturas)
  window.__hairRevealAll = function () { if (geo) { target = shown = geo.total; paint(); } };
})();
