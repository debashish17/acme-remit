/* Orb + liquid background, from the "Voice stage concept v6" design (Claude Design).
   Pure canvas; no framework. The app drives it with setState/setTick/setLevelSource. */

const THEMES = {
  blue: {
    idle: [
      [60, 120, 255],
      [40, 70, 210],
      [190, 225, 255],
    ],
    listening: [
      [110, 214, 255],
      [70, 140, 255],
      [230, 245, 255],
    ],
    thinking: [
      [30, 50, 190],
      [60, 100, 240],
      [120, 190, 255],
    ],
    speaking: [
      [150, 225, 255],
      [50, 110, 255],
      [245, 250, 255],
    ],
    base: ["#04060b", "#070a12", "#0a0e19"],
  },
  mono: {
    idle: [
      [200, 200, 200],
      [120, 120, 120],
      [255, 255, 255],
    ],
    listening: [
      [235, 235, 235],
      [170, 170, 170],
      [255, 255, 255],
    ],
    thinking: [
      [90, 90, 90],
      [160, 160, 160],
      [230, 230, 230],
    ],
    speaking: [
      [255, 255, 255],
      [140, 140, 140],
      [210, 210, 210],
    ],
    base: ["#000", "#000", "#000"],
  },
};
const PRESET = {
  idle: { amp: 0, swirl: 0, wave: 0, breathe: 1, spin: 0.18 },
  listening: { amp: 1, swirl: 0, wave: 0, breathe: 0.3, spin: 0.28 },
  thinking: { amp: 0.15, swirl: 1, wave: 0, breathe: 0.2, spin: 0.9 },
  speaking: { amp: 0.55, swirl: 0, wave: 1, breathe: 0.2, spin: 0.32 },
};
const KEYS = ["amp", "swirl", "wave", "breathe", "spin"];
const WHITE = [255, 255, 255];
const lerp = (a, b, k) => a + (b - a) * k;
const rgb = (c, a) =>
  `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
const mix = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const hash = (i) => {
  const x = Math.sin(i * 127.1 + 3.7) * 43758.5453;
  return x - Math.floor(x);
};

export function createOrb({ orbCanvas, bgCanvas, logoCanvas, orbWrap }) {
  const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const P = {
    theme: "blue",
    st: "idle",
    tick: 0,
    kickT: -9,
    kickDir: 1,
    lv: 0,
    env: 0,
    tgt: 0,
    nxt: 0,
    levelFn: null,
  };
  const cur = {
    amp: 0,
    swirl: 0,
    wave: 0,
    breathe: 1,
    spin: 0.18,
    tick: 0,
    pal: THEMES.blue.idle.map((c) => c.slice()),
  };
  const CV = { amp: 0, swirl: 0, wave: 0, breathe: 0, spin: 0 };

  function level(t) {
    if (P.levelFn) {
      const v = P.levelFn();
      if (v !== null && v !== undefined) return v;
    }
    if (P.st !== "listening" && P.st !== "speaking") return 0;
    if (t > P.nxt) {
      P.tgt = Math.random() < 0.16 ? 0.05 : 0.35 + Math.random() * 0.65;
      P.nxt = t + 70 + Math.random() * 130;
    }
    P.env += (P.tgt - P.env) * 0.16;
    return P.env;
  }

  /* orb geometry: a Fibonacci sphere that can gather into a check mark */
  const cx = orbCanvas.getContext("2d");
  let W = 0,
    H = 0;
  const DPR = Math.min(2, devicePixelRatio || 1);
  new ResizeObserver(() => {
    W = orbCanvas.clientWidth;
    H = orbCanvas.clientHeight;
    orbCanvas.width = W * DPR;
    orbCanvas.height = H * DPR;
  }).observe(orbCanvas);
  const N = 1300,
    SPH = [],
    DS = new Float32Array(N),
    DV = new Float32Array(N),
    TK = [],
    TJ = new Float32Array(N);
  const L1 = Math.hypot(0.36, 0.36),
    L2 = Math.hypot(0.72, 0.8);
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2,
      r = Math.sqrt(1 - y * y),
      th = i * 2.39996;
    SPH.push([Math.cos(th) * r, y, Math.sin(th) * r]);
    const u = hash(i * 3.1) * (L1 + L2),
      j = (hash(i + 5.3) - 0.5) * 0.09;
    let tx, ty, nx, ny;
    if (u < L1) {
      const k = u / L1;
      tx = lerp(-0.52, -0.16, k);
      ty = lerp(0.04, 0.4, k);
      nx = 0.707;
      ny = -0.707;
    } else {
      const k = (u - L1) / L2;
      tx = lerp(-0.16, 0.56, k);
      ty = lerp(0.4, -0.4, k);
      nx = 0.743;
      ny = 0.669;
    }
    TK.push([tx + nx * j, ty + ny * j]);
    TJ[i] = hash(i * 1.7 + 2);
  }

  /* liquid glass background */
  const bx = bgCanvas.getContext("2d");
  let BW = 0,
    BH = 0;
  const BS = 0.5;
  new ResizeObserver(() => {
    BW = Math.ceil(bgCanvas.clientWidth * BS);
    BH = Math.ceil(bgCanvas.clientHeight * BS);
    bgCanvas.width = BW;
    bgCanvas.height = BH;
  }).observe(bgCanvas);
  const OC = { x: 0, y: 0, r: 200 };
  const BLOBS = [
    { c: 1, r: 0.62, x: 0.72, y: 0.3, ax: 0.14, ay: 0.1, sp: 0.05, ph: 0 },
    { c: 0, r: 0.45, x: 0.3, y: 0.75, ax: 0.16, ay: 0.08, sp: 0.043, ph: 2 },
    { c: 2, r: 0.26, x: 0.62, y: 0.55, ax: 0.18, ay: 0.14, sp: 0.06, ph: 4 },
    { c: 0, r: 0.36, x: 0.9, y: 0.85, ax: 0.08, ay: 0.1, sp: 0.037, ph: 1 },
    { c: 1, r: 0.4, x: 0.1, y: 0.2, ax: 0.1, ay: 0.12, sp: 0.031, ph: 3 },
  ];
  function blob(x, y, r, col, a) {
    const g = bx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgb(col, a));
    g.addColorStop(0.45, rgb(col, a * 0.55));
    g.addColorStop(1, rgb(col, 0));
    bx.fillStyle = g;
    bx.beginPath();
    bx.arc(x, y, r, 0, 6.283);
    bx.fill();
  }
  function drawBg(T, lv) {
    if (!BW) return;
    const D = Math.max(BW, BH),
      base = THEMES[P.theme].base;
    const g = bx.createLinearGradient(0, 0, BW, BH);
    g.addColorStop(0, base[0]);
    g.addColorStop(0.6, base[1]);
    g.addColorStop(1, base[2]);
    bx.fillStyle = g;
    bx.fillRect(0, 0, BW, BH);
    bx.globalCompositeOperation = "lighter";
    for (const b of BLOBS) {
      const t = T * b.sp + b.ph;
      const x = (b.x + b.ax * Math.sin(t) + b.ax * 0.4 * Math.sin(t * 2.3)) * BW,
        y = (b.y + b.ay * Math.cos(t * 1.2)) * BH;
      const r = b.r * D * (1 + 0.06 * Math.sin(t * 1.7) + lv * 0.08);
      blob(x, y, r * 0.6, cur.pal[b.c], b.c === 2 ? 0.06 : 0.1);
      blob(x - r * 0.12, y - r * 0.14, r * 0.2, cur.pal[2], 0.03);
    }
    blob(
      OC.x * BS,
      OC.y * BS,
      OC.r * BS * (1.2 + lv * 0.4 + cur.tick * 0.3),
      cur.pal[0],
      0.12 + lv * 0.12 + cur.tick * 0.08,
    );
    bx.globalCompositeOperation = "source-over";
  }

  const lg = logoCanvas ? logoCanvas.getContext("2d") : null;
  function drawLogo(T) {
    if (!lg) return;
    lg.clearRect(0, 0, 44, 44);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * 6.283 + T * 0.4;
      lg.fillStyle = rgb(cur.pal[i % 3], 0.95);
      lg.beginPath();
      lg.arc(22 + Math.cos(a) * 13, 22 + Math.sin(a) * 13, 3.4, 0, 6.283);
      lg.fill();
    }
    lg.fillStyle = "#f3f6f8";
    lg.beginPath();
    lg.arc(22, 22, 4.5, 0, 6.283);
    lg.fill();
  }

  let rot = 0,
    last = 0,
    frame = 0;
  function draw(t) {
    const dt = Math.min(0.05, (t - last) / 1000 || 0.016);
    last = t;
    const pr = PRESET[P.st],
      tp = THEMES[P.theme][P.st],
      k = RM ? 1 : 1 - Math.pow(0.02, dt);
    if (!RM)
      for (const key of KEYS) {
        CV[key] += ((pr[key] - cur[key]) * 10 - CV[key] * 2.9) * dt;
        cur[key] += CV[key] * dt;
      }
    else
      for (const key of KEYS) {
        cur[key] = pr[key];
        CV[key] = 0;
      }
    cur.pal = cur.pal.map((c, i) => mix(c, tp[i], k));
    cur.tick = lerp(cur.tick, P.tick, RM ? 1 : 1 - Math.pow(0.08, dt));
    P.lv = lerp(P.lv, level(t), 0.35);
    const T = RM ? 0 : t / 1000;
    rot += RM ? 0 : dt * cur.spin;
    if (frame++ % 4 === 0) {
      const r = orbWrap.getBoundingClientRect();
      OC.x = r.left + r.width / 2;
      OC.y = r.top + r.height / 2;
      OC.r = Math.max(r.width * 1.25, Math.min(innerWidth, innerHeight) * 0.3);
    }
    drawBg(T, P.lv);
    cx.setTransform(DPR, 0, 0, DPR, 0, 0);
    cx.clearRect(0, 0, W, H);
    const R = (Math.min(W, H) * 0.36) / 1.9,
      ox = W / 2,
      oy = H / 2,
      lv = P.lv;
    cx.globalCompositeOperation = "lighter";
    for (let g = 0; g < 3; g++) {
      const a = T * (0.35 + g * 0.17) + g * 2.1;
      const gx = ox + Math.cos(a) * R * 0.38,
        gy = oy + Math.sin(a * 1.3) * R * 0.32,
        gr = R * (1.45 + lv * 0.55 + g * 0.12);
      const grd = cx.createRadialGradient(gx, gy, 0, gx, gy, gr);
      grd.addColorStop(0, rgb(cur.pal[g], 0.16 + lv * 0.14));
      grd.addColorStop(1, rgb(cur.pal[g], 0));
      cx.fillStyle = grd;
      cx.beginPath();
      cx.arc(gx, gy, gr, 0, 6.283);
      cx.fill();
    }
    const palAt = (u) =>
      u < 0.5 ? mix(cur.pal[0], cur.pal[1], u * 2) : mix(cur.pal[1], cur.pal[2], (u - 0.5) * 2);
    const cr = Math.cos(rot),
      sr = Math.sin(rot),
      tilt = 0.42,
      ct = Math.cos(tilt),
      st = Math.sin(tilt);
    const kickF = (T - P.kickT) * 2.6 - 1.1,
      ss = R / 110;
    for (let i = 0; i < N; i++) {
      const [x0, y0, z0] = SPH[i];
      let x = x0 * cr - z0 * sr,
        z = x0 * sr + z0 * cr,
        y = y0;
      const y2 = y * ct - z * st;
      z = y * st + z * ct;
      y = y2;
      let d = 0.025 * cur.breathe * Math.sin(T * 1.3 + y0 * 3);
      d +=
        cur.amp *
        lv *
        0.22 *
        Math.sin(x0 * 4 + T * 5) *
        Math.sin(y0 * 4 + T * 3.7) *
        Math.sin(z0 * 4 + T * 4.3) *
        2;
      d += cur.wave * lv * 0.14 * Math.sin((1 - z) * 7 - T * 9);
      let a = 1;
      if (cur.swirl > 0.01) {
        const band = Math.sin(Math.asin(y0) * 9 - T * 5 + Math.atan2(z0, x0));
        a = lerp(1, 0.2 + 0.8 * Math.max(0, band), cur.swirl);
      }
      if (!RM) {
        if (Math.abs(y0 - kickF) < 0.09) DV[i] += P.kickDir * 0.012;
        DV[i] += (d - DS[i]) * 0.07 - DV[i] * 0.12;
        DS[i] += DV[i];
        d = DS[i];
      } else {
        DS[i] = d;
        DV[i] = 0;
      }
      const s = 1 + d,
        p = 2.6 / (2.6 + z * s),
        front = (1 - z) / 2;
      let px = ox + x * s * R * p,
        py = oy + y * s * R * p,
        al = (0.12 + 0.8 * front) * a,
        sz = (0.55 + 1.45 * front) * p * ss;
      let c = mix(
        palAt(0.5 + 0.5 * Math.sin(Math.atan2(z0, x0) + y0 * 1.6 + T * 0.35)),
        WHITE,
        0.1 + 0.5 * front * front,
      );
      if (cur.tick > 0.002) {
        let tk = Math.min(1, Math.max(0, cur.tick * 1.7 - TJ[i] * 0.7));
        tk = tk * tk * (3 - 2 * tk);
        px = lerp(px, ox + TK[i][0] * R * 1.15, tk);
        py = lerp(py, oy + TK[i][1] * R * 1.15, tk);
        al = lerp(al, 0.9, tk);
        sz = lerp(sz, 1.5 * ss, tk);
        c = mix(c, WHITE, tk * 0.6);
      }
      cx.fillStyle = rgb(c, al);
      cx.beginPath();
      cx.arc(px, py, sz, 0, 6.283);
      cx.fill();
    }
    cx.globalCompositeOperation = "source-over";
    drawLogo(T);
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);

  return {
    get state() {
      return P.st;
    },
    setState(s) {
      if (!PRESET[s] || s === P.st) return;
      P.kickT = performance.now() / 1000;
      P.kickDir = s === "speaking" || s === "idle" ? -1 : 1;
      P.st = s;
    },
    setTheme(th) {
      if (THEMES[th]) P.theme = th;
    },
    /** 1 gathers the particles into a check mark (confirmed); 0 releases them. */
    setTick(v) {
      P.tick = v;
    },
    kick() {
      P.kickT = performance.now() / 1000;
      P.kickDir = 1;
    },
    /** A function returning 0..1 (e.g. mic level), or null for the built-in envelope. */
    setLevelSource(fn) {
      P.levelFn = fn;
    },
  };
}
