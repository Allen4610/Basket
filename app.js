// 篓子指数手机版的界面（用户 #866–#870）。
// 看任意一只（A 股、ETF、A 股指数、美股、篓子、电脑上列表里的）日 / 周 / 月 K 线。数据全存在手机上（IndexedDB），
// 没网也能看；电脑每晚做好新数据，手机打开时自己下载。解密、拆字节都在 data.js（LZ），这里不碰字节格式。
//
// 手势照通达信手机版（一只手就能用）：
//   点一下 = 开 / 关十字线；按住不动 = 出十字线并跟着手指走，松手留着；十字线开着时拖 = 十字线跟着走（拖到边上图自己往那边滚）；
//   十字线关着时左右拖 = 平移（松手有惯性）；上下快速一划 = 下一只 / 上一只；两指捏合 = 缩放（两指中间那根不动）；
//   − / + 也能缩放（按住连续缩放）。鼠标：点 = 点一下，拖 = 平移，滚轮 = 以鼠标处为中心缩放，十字线开着时移动 = 跟着走。
// 以后的框选强弱、成分、叠加：画图在 draw()，手势在“手势”一节，数据在 series()，各自加就行。
(function () {
  'use strict';

  // ---------- 小工具 ----------
  const EL = {};
  const $ = id => EL[id] || (EL[id] = document.getElementById(id));
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const now = () => performance.now();
  const fin = x => typeof x === 'number' && isFinite(x);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fix = (x, d) => (fin(x) ? x.toFixed(d) : '--');
  const pctText = x => (fin(x) ? (x > 0 ? '+' : '') + x.toFixed(2) + '%' : '--');
  const cls = x => (fin(x) && x !== 0 ? (x > 0 ? 'up' : 'dn') : '');
  const ymd = d => { const s = String(d); return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8); };
  const dayNo = d => Date.UTC((d / 1e4) | 0, (((d / 100) | 0) % 100) - 1, d % 100) / 864e5;   // 1970-01-01 起第几天
  const week = d => '周' + '四五六日一二三'[((dayNo(d) % 7) + 7) % 7];                       // 1970-01-01 是周四
  const monday = d => { const n = dayNo(d); return n - (((n + 3) % 7) + 7) % 7; };           // 那一周的周一（第几天）
  const idle = fn => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 200));
  // 量：1.23万手、4.56亿股（单位跟着类别：A 股手、美股股）
  function vol(v, unit) {
    if (!fin(v)) return '--';
    const f = x => (x >= 1000 ? x.toFixed(0) : x >= 100 ? x.toFixed(1) : x.toFixed(2));
    return (v >= 1e8 ? f(v / 1e8) + '亿' : v >= 1e4 ? f(v / 1e4) + '万' : String(Math.round(v))) + unit;
  }
  // 改字和颜色：一样就不动（读数每帧都可能调，省掉没必要的重排）
  function put(id, text, c) {
    const el = $(id);
    if (el.textContent !== text) el.textContent = text;
    if (c != null && el.className !== c) el.className = c;
  }
  // 提示条。要点的那种（有新版本，点了重新打开）优先：别的提示只盖住它一会儿，过完又回到它
  let toastT = 0, sticky = null;
  function toast(text, ms, onTap) {
    const el = $('toast');
    ms = ms || 1600;
    if (onTap) sticky = { text, onTap, until: Date.now() + ms };
    el.textContent = text;
    el.onclick = onTap || null;
    el.classList.toggle('tap', !!onTap);
    el.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(() => {
      if (sticky && Date.now() < sticky.until - 300) return toast(sticky.text, sticky.until - Date.now(), sticky.onTap);
      sticky = null;
      el.classList.remove('on', 'tap');
    }, ms);
  }

  // ---------- 界面上的偏好（localStorage；读写都可能失败，失败就当没有） ----------
  const pref = {
    get(k, d) { try { const s = localStorage.getItem('lz.' + k); return s == null ? d : JSON.parse(s); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('lz.' + k, JSON.stringify(v)); } catch (e) { /* 存不了就算了 */ } },
  };

  // ---------- 手机上的存储（IndexedDB 库 "lz"，一个表 "kv"） ----------
  // 键：key = 解密钥匙（CryptoKey，导不出来）；ver = 正在用的 m.json；f:<路径> = 下载下来的加密文件原样。
  // 万一 IndexedDB 用不了（隐私模式之类），退回内存：这次打开照样能看，关掉就没了。
  const db = {
    h: null, mem: null,
    open() {
      return new Promise(res => {
        let r;
        try { r = indexedDB.open('lz', 1); } catch (e) { db.mem = new Map(); return res(); }
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => { db.h = r.result; db.h.onversionchange = () => db.h.close(); res(); };
        r.onerror = r.onblocked = () => { db.mem = new Map(); res(); };
      });
    },
    req(fn) {
      if (db.mem) return Promise.resolve(fn(null));
      return new Promise((res, rej) => {
        const r = fn(db.h.transaction('kv', 'readonly').objectStore('kv'));
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    },
    get(k) { return db.mem ? Promise.resolve(db.mem.get(k)) : db.req(s => s.get(k)); },
    keys() { return db.mem ? Promise.resolve([...db.mem.keys()]) : db.req(s => s.getAllKeys()); },
    // 写：puts = [[键, 值], …]，dels = [键, …]，在同一个事务里做，整个事务完成才算写进去（换版本时就靠这个“要么全成要么全不成”）
    write(puts, dels) {
      if (db.mem) {
        (dels || []).forEach(k => db.mem.delete(k));
        (puts || []).forEach(([k, v]) => db.mem.set(k, v));
        return Promise.resolve();
      }
      return new Promise((res, rej) => {
        const t = db.h.transaction('kv', 'readwrite'), s = t.objectStore('kv');
        (dels || []).forEach(k => s.delete(k));
        (puts || []).forEach(([k, v]) => s.put(v, k));
        t.oncomplete = () => res();
        t.onerror = t.onabort = () => rej(t.error || new Error('写不进手机'));
      });
    },
    clear() {
      if (db.mem) { db.mem.clear(); return Promise.resolve(); }
      return new Promise((res, rej) => {
        const t = db.h.transaction('kv', 'readwrite');
        t.objectStore('kv').clear();
        t.oncomplete = () => res();
        t.onerror = t.onabort = () => rej(t.error);
      });
    },
  };

  // 存着的偏好可能是坏的（旧版本写的、被别的东西改过）：形状不对就当没有，别让整个页面起不来
  function codesOf(x) { return Array.isArray(x) ? x.filter(c => typeof c === 'string') : []; }
  function listOf(x) { return x && typeof x === 'object' ? { name: String(x.name || '最近'), codes: codesOf(x.codes) } : { name: '最近', codes: [] }; }

  // ---------- 状态 ----------
  const PER = ['d', 'w', 'm'];
  const S = {
    key: null,             // 解密钥匙
    ver: null,             // 正在用的 m.json
    cat: null, rec: new Map(), rows: [], byCode: new Map(), lists: [], live: false,
    have: new Set(),       // 手机上已经存好的加密文件（路径）
    mem: new Map(),        // 存不进手机的文件先放内存（这次打开能用）
    gen: 0,                // 清数据时 +1：还在路上的旧下载就不往里写了
    dl: null,              // 正在下载：{kind: 'cat' | 'first' | 'new', m}
    offline: false, reg: null, shell: '',
    code: null, i: -1, ser: null,
    per: PER.includes(pref.get('per', 'd')) ? pref.get('per', 'd') : 'd',
    bw: clamp(+pref.get('bw', 7) || 7, 2, 40),   // 柱宽（CSS px）：缩放就是改它，转屏不变，所以横屏看得更多
    off: 0,                // 离最右边（最新一根）往左挪了几根（可以带小数）
    cross: null,           // 十字线 {i: 第几根, y: 手指高度（不在价格区 = null）}
    recent: codesOf(pref.get('recent', [])).slice(0, 60),
    list: listOf(pref.get('list', null)),   // 当前列表：‹ › 和上下一划在这里面走
    idx: null, res: [], more: false, vis: null,
    t: { start: Math.round(now()) },   // 计时（给自动检查看）
  };

  // ---------- 下载和读文件 ----------
  async function getJSON(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  const inflight = new Map();   // 正在下载的：路径 → Promise<ArrayBuffer>
  // 正在看的那只缺的块正在下：后台补块的先停一停，等它下完再接着补（网慢时它不用跟别的分带宽）
  const hot = new Set();
  function urgent(p) {
    if (hot.has(p)) return;
    hot.add(p);
    const d = () => hot.delete(p);
    p.then(d, d);
  }
  // 下载一个加密文件，存进手机（存不进去就先放内存），大小必须和 m.json 里记的一样。
  // low = 后台补的底子块：告诉浏览器排在后面；要看的、名单和最近排前面
  function download(path, size, low) {
    let p = inflight.get(path);
    if (p) return p;
    const gen = S.gen;
    p = (async () => {
      const r = await fetch(path, { cache: 'no-store', priority: low ? 'low' : 'high' });
      if (!r.ok) throw new Error('下载不到（' + r.status + '）');
      const buf = await r.arrayBuffer();
      if (size != null && buf.byteLength !== size) throw new Error('下载的文件不完整');
      if (gen === S.gen) {
        try { await db.write([['f:' + path, buf]]); S.have.add(path); S.mem.delete(path); }
        catch (e) { S.mem.set(path, buf); S.diskFull = true; }
      }
      return buf;
    })();
    inflight.set(path, p);
    const done = () => { if (inflight.get(path) === p) inflight.delete(path); };
    p.then(done, done);
    return p;
  }
  // 拿一个加密文件：手机上有就用手机上的，没有就下载
  async function file(path, size) {
    if (S.mem.has(path)) return S.mem.get(path);
    if (S.have.has(path)) {
      try { const b = await db.get('f:' + path); if (b) return b; } catch (e) { /* 读不出来就重新下载 */ }
      S.have.delete(path);
    }
    return download(path, size);
  }
  // 拿到并解开；手机上那份坏了（解不开）就删掉，重新下载一次
  async function openFile(path, size) {
    const enc = await file(path, size);
    try { return await LZ.open(S.key, enc); } catch (e) {
      S.have.delete(path); S.mem.delete(path);
      db.write(null, ['f:' + path]).catch(() => {});
      return LZ.open(S.key, await download(path, size));
    }
  }

  // 解开的底子块，最近用过的 24 块（键是路径，换了底子自然对不上）
  const chunks = new Map();
  function chunk(k) {
    const f = S.ver.files[k], path = f[0];
    let p = chunks.get(path);
    if (p) { chunks.delete(path); chunks.set(path, p); return p; }
    p = openFile(path, f[1]);
    chunks.set(path, p);
    p.catch(() => { if (chunks.get(path) === p) chunks.delete(path); });
    while (chunks.size > 24) chunks.delete(chunks.keys().next().value);
    return p;
  }

  // ---------- 一只的 K 线 ----------
  // 拼好的日线（拷一份，不占着整块底子）+ 合好的周线月线，最近 32 只
  const sers = new Map();
  function entry(i) {
    let p = sers.get(i);
    if (p) { sers.delete(i); sers.set(i, p); return p; }
    const x = S.rows[i], e = S.rec.get(i);
    p = (async () => {
      const base = x[7] >= 0 && !(e && e.mode === 1) ? LZ.slice(await chunk(x[7]), x[8], x[9]) : null;
      const m = LZ.merge(base, e);
      return { code: x[0], dg: x[6], day: { d: m.d.slice(), o: m.o.slice(), h: m.h.slice(), l: m.l.slice(), c: m.c.slice(), v: m.v.slice() }, p: {} };
    })();
    sers.set(i, p);
    p.catch(() => { if (sers.get(i) === p) sers.delete(i); });
    while (sers.size > 32) sers.delete(sers.keys().next().value);
    return p;
  }
  async function series(i, per) {
    const en = await entry(i);
    return en.p[per] || (en.p[per] = build(en, per));
  }
  // 周线、月线从日线合：周按那一周的周一归，月按年月归；日期 = 最后一个交易日，开 = 第一天开，高最高，低最低，收 = 最后一天收，量相加
  function build(en, per) {
    const s = en.day, n0 = s.d.length;
    let d, o, h, l, c, v;
    if (per === 'd') ({ d, o, h, l, c, v } = s);
    else {
      const D = [], O = [], H = [], L = [], C = [], V = [];
      let key = NaN;
      for (let i = 0; i < n0; i++) {
        const k = per === 'w' ? monday(s.d[i]) : (s.d[i] / 100) | 0;
        if (k !== key) { key = k; D.push(s.d[i]); O.push(s.o[i]); H.push(s.h[i]); L.push(s.l[i]); C.push(s.c[i]); V.push(s.v[i]); continue; }
        const j = D.length - 1;
        D[j] = s.d[i];
        if (s.h[i] > H[j]) H[j] = s.h[i];
        if (s.l[i] < L[j]) L[j] = s.l[i];
        C[j] = s.c[i];
        V[j] += s.v[i];
      }
      d = Int32Array.from(D); o = Float64Array.from(O); h = Float64Array.from(H); l = Float64Array.from(L); c = Float64Array.from(C); v = Float64Array.from(V);
    }
    const n = d.length, pc = new Float64Array(n);   // 昨收 = 前一根的收盘（第一根没有）
    pc[0] = NaN;
    for (let i = 1; i < n; i++) pc[i] = c[i - 1];
    // 均线在整段上算（不是只算看得见的），所以图最左边的均线也是对的
    const ma = MAS.map(([k]) => {
      const out = new Float64Array(n).fill(NaN);
      let sum = 0;
      for (let i = 0; i < n; i++) { sum += c[i]; if (i >= k) sum -= c[i - k]; if (i >= k - 1) out[i] = sum / k; }
      return out;
    });
    return { code: en.code, per, n, d, o, h, l, c, v, pc, ma, axis: axisWidth(h, l, en.dg) };
  }
  // 右边价格轴的宽度：按这一只最大的价格算一次（拖动时不变，图不会左右跳）
  function axisWidth(h, l, dg) {
    let mx = 0;
    for (let i = 0; i < h.length; i++) mx = Math.max(mx, Math.abs(h[i]), Math.abs(l[i]));
    ctx.font = '10.5px ' + FONT;
    return Math.max(46, Math.ceil(ctx.measureText(fix(mx, dg)).width + 11));
  }

  // ---------- 打开一只 ----------
  // 名字、读数、图一起换：数据到手才换（解好的一般就是一瞬间）；160 毫秒还没到，才先换名字、图上写“正在取”。
  // keep = 换了数据版本后重开同一只：缩放、离最新一根的距离、十字线（按日期）都不变。
  let openTok = 0;
  function open(code, keep) {
    const i = S.byCode.get(code);
    if (i == null) return Promise.resolve(false);
    const tok = ++openTok, crossDate = keep && S.cross && S.ser ? S.ser.d[S.cross.i] : null;
    S.want = code;
    pref.set('code', code);
    const show = (s, note) => {
      if (!keep) { S.off = 0; S.cross = null; A.v = 0; if (A.z) { S.bw = A.z.to; A.z = null; } }   // −/+ 刚按、还在缓：直接到位
      S.code = code; S.i = i;
      if (s) {
        setSer(s);
        if (crossDate != null) { const j = s.d.indexOf(crossDate); S.cross = j >= 0 ? { i: j, y: null } : null; }
      } else { S.ser = null; S.cross = null; }
      msg(note || ''); header(); redraw();
    };
    const slow = setTimeout(() => { if (tok === openTok) show(null, '正在取这一只…'); }, 160);
    const got = series(i, S.per);
    hotChunk(i);
    return got.then(s => {
      clearTimeout(slow);
      if (tok !== openTok) return true;
      show(s);
      prefetch();
      return true;
    }, () => {
      clearTimeout(slow);
      if (tok !== openTok) return true;
      show(null, S.offline || navigator.onLine === false ? '这一只还没存到手机上，联网后再看' : '这一只没取到，过一会儿再试');
      return false;
    });
  }
  function setSer(s) {
    S.ser = s;
    if (G.axis !== s.axis) { G.axis = s.axis; layout(); }
  }
  // 要看的这只，它那一块正在下（刚开始下，或者后台正好在补）：标成急的，后台补块的等它下完
  function hotChunk(i) {
    const x = S.rows[i], e = S.rec.get(i);
    if (!x || x[7] < 0 || (e && e.mode === 1) || !S.ver) return;   // 不用底子的（整段换掉的）不用等
    const f = S.ver.files[x[7]], p = f && inflight.get(f[0]);
    if (p) urgent(p);
  }
  // 当前列表里前后两只先解好放着，‹ › 和一划就是瞬间的
  function prefetch() {
    const L = curList(), j = L.indexOf(S.code);
    if (j < 0 || L.length < 2) return;
    const near = [L[(j + 1) % L.length], L[(j - 1 + L.length) % L.length]];
    setTimeout(() => near.forEach(c => { const i = S.byCode.get(c); if (i != null) series(i, S.per).catch(() => {}); }), 60);
  }
  // 换周期：同一只重新打开（回到最新一根，十字线收起，柱宽不变）
  function setPer(p) {
    if (!PER.includes(p)) return Promise.resolve(false);
    S.per = p; pref.set('per', p);
    perButtons();
    const code = S.want || S.code;
    return code ? open(code) : Promise.resolve(false);
  }
  function perButtons() {
    document.querySelectorAll('[data-a="d"],[data-a="w"],[data-a="m"]').forEach(b => b.classList.toggle('on', b.dataset.a === S.per));
  }
  // 当前列表（搜索结果 / 选的列表 / 默认“最近”）；空的就退到最近看过，再退到桌面
  function curList() {
    let L = (S.list.codes || []).filter(c => S.byCode.has(c));
    if (!L.length) L = S.recent.filter(c => S.byCode.has(c));
    if (!L.length) { const d = S.lists.find(l => l.name === '桌面'); if (d) L = d.codes; }
    return L;
  }
  function go(dir, flick) {
    const L = curList();
    if (!L.length) return;
    let j = L.indexOf(S.want || S.code);   // 连按时按“正在打开的那只”往下数
    j = j < 0 ? (dir > 0 ? 0 : L.length - 1) : (j + dir + L.length) % L.length;
    open(L[j]);
    if (flick) toast((dir > 0 ? '下一只：' : '上一只：') + S.rows[S.byCode.get(L[j])][2] + '（' + (j + 1) + '/' + L.length + '）', 1300);
  }
  function addRecent(code) {
    S.recent = [code].concat(S.recent.filter(c => c !== code)).slice(0, 60);
    pref.set('recent', S.recent);
  }
  function defaultCode() {
    if (S.byCode.has('G:东财:1.000001')) return 'G:东财:1.000001';   // 上证指数
    const d = S.lists.find(l => l.name === '桌面');
    return (d && d.codes[0]) || (S.rows[0] && S.rows[0][0]);
  }

  // ---------- 换数据版本 ----------
  // 新的名单 + 最近 用起来：当前这只重新取，缩放和离最新一根的距离不变
  function apply(m, cat, rec) {
    const newBase = !S.ver || S.ver.base !== m.base;
    S.ver = m; S.cat = cat; S.rec = rec; S.rows = cat.list;
    S.byCode = new Map();
    cat.list.forEach((x, i) => S.byCode.set(x[0], i));
    S.lists = (cat.lists || []).map(l => ({ name: String(l.name), codes: l.idx.map(i => cat.list[i] && cat.list[i][0]).filter(Boolean) }));
    const t = String(cat.made || '').slice(11);
    S.live = String(cat.made || '').slice(0, 10) === cat.asof && t >= '09:15' && t < '15:00';   // 盘中做的：今天这一根还没走完
    S.idx = null;
    if (newBase) chunks.clear();
    sers.clear();
    const l = S.lists.find(x => x.name === S.list.name);    // 电脑上的列表改了：跟着改
    if (l && S.list.name !== '搜索' && S.list.name !== '最近') S.list = { name: l.name, codes: l.codes };
    status();
    const want = S.want || S.code;
    if (want && S.byCode.has(want)) open(want, want === S.code);
    else { const c = pref.get('code', null); open(S.byCode.has(c) ? c : defaultCode()); }
    if (sheet === 'list') renderList();
    if (sheet === 'menu') renderMenu();
    if (sheet === 'search') renderSearch();
    idle(() => { if (!S.idx) buildIndex(); });
  }

  // ---------- 检查更新 ----------
  // 每次打开、隔了 30 分钟以上回到前台、刚联上网时：取 m.json，手机上没有的文件下载下来。
  //   第一次：先下名单和最近（马上能查能看），底子在后台 3 个一起下；正在看的那只缺哪块就先下哪块。
  //   同一份底子：只下新的名单和最近（很小），换上。
  //   换了底子：旧的照常用，新的全部下好再一起换（一个事务写 ver），然后删掉用不着的。
  //   没网 / 出错：手上的数据照常用，状态里写着，下次再试。手上能用的数据绝不先删。
  const sync = { busy: null, ok: 0, tried: 0 };
  function checkUpdate(why) {
    if (!S.key) return Promise.resolve();
    if (sync.busy) {
      if (why === 'manual' || why === 'all') toast(S.dl ? '正在下载数据，等这一轮下完再点' : '正在检查，稍等');
      return sync.busy;
    }
    sync.tried = Date.now();
    sync.busy = doCheck(why).catch(e => {
      S.dl = null; status();
      if (why !== 'start' && why !== 'visible' && why !== 'online' && $('lock').hidden) toast('更新没成功：' + errText(e) + '，下次再试', 2600);
    }).finally(() => { sync.busy = null; status(); if (sheet === 'menu') renderMenu(); });
    return sync.busy;
  }
  // 浏览器给的错误是英文的，换成人话；自己抛的本来就是中文
  function errText(e) {
    if (!e) return '出错了';
    if (e.name === 'OperationError') return '文件解不开';
    if (e.name === 'QuotaExceededError') return '手机空间不够';
    if (e instanceof TypeError) return '网络断了';
    return /[一-鿿]/.test(e.message || '') ? e.message : '出错了';
  }
  async function doCheck(why) {
    const force = why === 'all', loud = why === 'manual' || force;
    let m;
    try { m = await getJSON('m.json?t=' + Date.now()); } catch (e) {
      S.offline = true;
      if (S.dl && S.dl.kind === 'cat') S.dl = null;
      status();
      if (!S.cat && why === 'first') toast('连不上网，联网后再打开', 2600);
      if (loud) toast('连不上网，稍后再试');
      return;
    }
    S.offline = false; sync.ok = Date.now();
    if (!m || m.v !== 1 || !Array.isArray(m.files) || !m.cat || !m.rec) throw new Error('网上的数据格式不认识');
    shellCheck(m.shell);
    await refreshHave();
    const cur = S.ver, gen = S.gen;
    const complete = !!cur && cur.files.every(f => S.have.has(f[0]));
    if (!cur || (cur.base !== m.base && !complete)) {
      // 第一次（或者手上的底子本来就没下全，没有完整的旧数据要护着）：先名单和最近，再底子
      if (!S.cat) { S.dl = { kind: 'cat', m }; status(); }
      await take(m, force, gen);
      await fill(m, force, 'first', gen);
    } else if (cur.base === m.base) {
      if (m.ver !== cur.ver || force) { await take(m, force, gen); if (loud && !force) toast('换上新数据了：数据到 ' + S.cat.asof); }
      else if (loud) toast('已经是最新的了');
      await fill(m, force, 'first', gen);
      if (force) toast('全部重新下载好了');
    } else {
      // 换了底子：先下新名单解一下（钥匙对不对先弄清楚，免得白下 60 多 MB），底子全部下好再一起换
      const [cat, rec] = await loadCR(m, force);
      if (loud) toast('有新的底子，后台下载，下好了自动换上', 2400);
      await fill(m, force, 'new', gen);
      await commit(m, cat, rec, gen);
      if (loud) toast('换上新数据了：数据到 ' + S.cat.asof);
    }
  }
  // 名单和最近：下好（手机上有就用手机上的）并解开
  async function loadCR(m, force) {
    if (force) [m.cat, m.rec].forEach(f => { S.have.delete(f[0]); S.mem.delete(f[0]); });
    try {
      const [cb, rb] = await Promise.all([openFile(m.cat[0], m.cat[1]), openFile(m.rec[0], m.rec[1])]);
      return [LZ.parseCatalog(cb), LZ.parseRecent(rb)];
    } catch (e) {
      if (e && e.name === 'OperationError' && !(await keyStillGood())) throw new Error('口令换过了');
      throw e;
    }
  }
  // 换上这一版：先写 ver（一个事务），再用起来，再清掉用不着的文件
  async function commit(m, cat, rec, gen) {
    if (gen !== S.gen) throw new Error('数据刚清掉了');
    await db.write([['ver', m]]);
    if (S.dl && S.dl.kind === 'cat') S.dl = null;
    apply(m, cat, rec);
    cleanup(m);
  }
  async function take(m, force, gen) {
    const [cat, rec] = await loadCR(m, force);
    await commit(m, cat, rec, gen);
  }
  // 底子各块：3 个一起下；force = 全部重新下（旧的一直能用，新的到一个覆盖一个）
  async function fill(m, force, kind, gen) {
    const todo = m.files.filter(f => force || !S.have.has(f[0]));
    if (!todo.length) return;
    S.dl = { kind, m, done: m.files.length - todo.length, total: m.files.length }; status();
    let k = 0, err = null;
    const worker = async () => {
      for (;;) {
        while (hot.size && gen === S.gen) await Promise.race(hot).catch(() => {});   // 正在看的那块先下完
        if (k >= todo.length || err || gen !== S.gen) return;
        const f = todo[k++];
        if (force || !S.have.has(f[0])) {         // 没有的才下（要看的那块可能刚才已经抢先下了）
          try { await download(f[0], f[1], true); } catch (e) { err = e; return; }
        }
        if (S.dl) S.dl.done++;
        status();
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    S.dl = null; status();
    if (err) { if (err instanceof TypeError || navigator.onLine === false) S.offline = true; throw err; }
  }
  // 手机上实际存着哪些文件：每次检查前从库里重新数一遍。同一个网址开着两个窗口（桌面图标和浏览器）时，
  // 另一个可能已经下好了新底子、删掉了旧的；不重新数的话这边会以为都没有，又下一遍 60 多 MB
  async function refreshHave() {
    const gen = S.gen, before = new Set(S.have);
    let ks;
    try { ks = await db.keys(); } catch (e) { return; }
    if (gen !== S.gen) return;                       // 数的时候数据被清掉了：别把旧的记回来
    const fresh = new Set((ks || []).filter(k => typeof k === 'string' && k.startsWith('f:')).map(k => k.slice(2)));
    S.have.forEach(p => { if (!before.has(p)) fresh.add(p); });   // 数的时候刚下好的
    S.have = fresh;
  }
  // 删掉手机上这一版用不着的文件（旧底子、旧名单）
  async function cleanup(m) {
    const keep = new Set([m.cat[0], m.rec[0]].concat(m.files.map(f => f[0])));
    const drop = [...S.have].filter(p => !keep.has(p));
    [...S.mem.keys()].forEach(p => { if (!keep.has(p)) S.mem.delete(p); });
    if (!drop.length) return;
    try { await db.write(null, drop.map(p => 'f:' + p)); drop.forEach(p => S.have.delete(p)); } catch (e) { /* 下次再删 */ }
  }
  // 新文件解不开：是电脑上换了口令（钥匙对不上 key.json），还是文件坏了
  async function keyStillGood() {
    let info;
    try { info = await getJSON('key.json?t=' + Date.now()); } catch (e) { return true; }
    if (await LZ.checkKey(S.key, info)) return true;
    S.keyBad = true;
    status();
    // 旧数据还解得开：可以先接着看（下次打开还会问），不能把人关在门外
    showLock('电脑上换了口令。输入新口令（电脑上双击“看手机口令”能看到），手机上的数据会重新下载。', !!S.cat);
    return false;
  }
  // 外壳（页面、脚本）有新版本：让 service worker 去取（它装好后页面会提示重新打开）
  async function shellCheck(want) {
    try {
      if (!want || !S.reg || !window.caches) return;
      const have = (await caches.keys()).filter(k => k.startsWith('lz-shell-')).map(k => k.slice(9));
      if (have.length && !have.includes(want)) S.reg.update().catch(() => {});
    } catch (e) { /* 没有就算了 */ }
  }

  // ---------- 状态文字 ----------
  function status() {
    const c = S.cat, d = S.dl, day = c ? String(c.asof).slice(5) + (S.live ? ' 盘中' : '') : '';
    let t = '', frac = -1;
    if (d && d.kind === 'cat') t = '下载名单…';
    else if (d) {
      t = (d.kind === 'new' ? '更新中 ' : '下载中 ') + d.done + '/' + d.total;
      frac = d.done / d.total;
    } else if (c) t = '数据到 ' + day;
    const core = d ? t : day, pre = S.keyBad ? '口令换了，没更新' : S.offline ? '离线' : '';
    if (pre) t = pre + (t ? ' · ' + t : '');
    put('h-st', t);
    // 窄屏上“离线 · 数据到 11-23 盘中”这种长的放不下：换短一点的说法，不让日期被截掉半截（完整的在菜单里）
    if (pre) {
      const el = $('h-st'), short = S.keyBad ? '口令换了' : '离线';
      for (const s2 of [short + (core ? ' · ' + core : ''), short]) { if (el.scrollWidth <= el.clientWidth) break; put('h-st', s2); }
    }
    put('o-st', d || S.offline ? t : '');
    const p = $('prog');
    p.classList.toggle('on', frac >= 0);
    if (frac >= 0) p.style.width = (frac * 100).toFixed(1) + '%';
  }

  // ---------- 查找 ----------
  // 每只先把要比的字段整理好（只做一次）：显示代码、拼音首字母、名字、英文名。整理办法和输入的字完全一样
  // （全角转半角、小写、去掉空格、撇号、横线、点、&、·），所以 “bank of america”、“mcdonald's”、“coca cola”（名单里是 coca-cola）
  // 这样的英文全名，和“中证传媒剔除”这样中间有点的名字都找得到；代码 BRK.B 打 brkb 也行。
  // 每一只先看拼在一起的那一串里有没有，没有就跳过（大多数都没有），有才细排名次。一万只一次 < 1 毫秒。
  const nf = s => String(s == null ? '' : s).normalize('NFKC').toLowerCase();
  const qnorm = s => nf(s).replace(/[\s'’＇.\-‐-―·&]/g, '');
  function buildIndex() {
    const N = S.rows.length, f = new Array(N), hay = new Array(N);
    for (let i = 0; i < N; i++) {
      const x = S.rows[i], s = qnorm(x[1]), p = qnorm(x[3]), n = qnorm(x[2]), a = qnorm(x[4]);
      f[i] = [s, p, n, a];
      hay[i] = s + '\u0001' + p + '\u0001' + n + '\u0001' + a;
    }
    S.idx = { f, hay };
  }
  // 名次：代码一样 0 > 代码开头 1 > 拼音开头 2 > 名字开头 3 > 英文开头 4 > 拼音含 5 > 名字含 6 > 英文含 7；
  // 同名次按类别、再按代码（名单本来就是这个顺序）；最多 60 只。
  // 名次 0..r 已经凑够 60 只时，后面名次 ≥ r 的再也挤不进前 60（同名次排在后面），就不用再细看了：只敲一个字时省一大半。
  const RANK = [(x, q) => x[0] === q, (x, q) => x[0].startsWith(q), (x, q) => x[1].startsWith(q), (x, q) => x[2].startsWith(q),
    (x, q) => x[3].startsWith(q), (x, q) => x[1].includes(q), (x, q) => x[2].includes(q), (x, q) => x[3].includes(q)];
  function search(q0) {
    if (!S.idx) buildIndex();
    const q = qnorm(q0);
    S.more = false;
    if (!q) return [];
    const { f, hay } = S.idx, b = [[], [], [], [], [], [], [], []];
    let cap = RANK.length;
    for (let i = 0; i < hay.length && cap > 0; i++) {
      if (hay[i].indexOf(q) < 0) continue;
      const x = f[i];
      for (let r = 0; r < cap; r++) {
        if (!RANK[r](x, q)) continue;
        b[r].push(i);
        let n = 0;
        for (let j = 0; j <= r; j++) n += b[j].length;
        if (n >= 60) cap = r;
        break;
      }
    }
    S.more = cap < RANK.length;
    const out = [];
    for (const x of b) for (const i of x) { if (out.length >= 60) return out; out.push(i); }
    return out;
  }
  function rowHTML(i) {
    const x = S.rows[i];
    if (!x) return '';
    const g = (S.cat.groups || [])[x[5]] || '';
    return '<div class="row' + (x[0] === S.code ? ' cur' : '') + '" data-i="' + i + '"><div class="rn"><b>' + esc(x[2]) + '</b><small>' +
      (x[1] === g ? '' : esc(x[1])) + '<span class="tag">' + esc(g) + '</span></small></div><div class="rv"><span class="' + cls(x[11]) + '">' +
      fix(x[10], x[6]) + '</span><em class="' + cls(x[11]) + '">' + pctText(x[11]) + '</em></div></div>';
  }

  // ---------- 面板：同时只开一个；开的时候记一笔历史，手机的返回键就是关面板 ----------
  let sheet = null, hiding = null;   // hiding = 已经关了、正等键盘收下去才滑走的面板
  function openSheet(name) {
    if (sheet === name) return;
    if (sheet) { $('sh-' + sheet).classList.remove('on'); history.replaceState({ lz: name }, ''); }
    else history.pushState({ lz: name }, '');
    sheet = name;
    $('sh-' + name).classList.add('on');
    $('mask').classList.toggle('on', name !== 'search');
  }
  // 关搜索时键盘往往还没收：先收键盘，等页面高度恢复了再让面板滑走——下面的图已经按整屏大小画好，不会先压扁再跳一下
  function hideSheet() {
    if (!sheet) return;
    const name = sheet, el = $('sh-' + name);
    sheet = null;
    const done = () => {
      if (hiding === name) hiding = null;
      if (sheet === name) return;              // 等的时候又打开了：别关
      el.style.transform = '';                 // 往下拖着关的：从手指放开的地方接着滑下去
      el.classList.remove('on');
      if (!sheet) $('mask').classList.remove('on');
      orient();
      redraw();
    };
    if (name !== 'search') return done();
    hiding = name;
    $('s-in').blur();
    afterKeyboard(done);
  }
  // 键盘：弹出前记下页面大小；收键盘时页面还被压着（宽没变、高少了一截），就等它恢复（最多 350 毫秒）再做下一步
  const kb = { w: 0, h: 0 };
  function kbMark() { kb.w = innerWidth; kb.h = innerHeight; }
  const kbUp = () => innerWidth === kb.w && innerHeight < kb.h - 60;
  function afterKeyboard(fn) {
    if (!kbUp()) return fn();
    let t = 0;
    const done = () => { clearTimeout(t); removeEventListener('resize', chk); fn(); };
    const chk = () => { if (!kbUp()) done(); };
    addEventListener('resize', chk);
    t = setTimeout(done, 350);
  }
  // 界面上关（取消、点空白、选好了）也走 history.back()，和返回键一样，历史记录不会越攒越多
  function closeSheet() {
    if (!sheet) return;
    if (history.state && history.state.lz) {
      history.back();
      setTimeout(() => { if (sheet && !(history.state && history.state.lz)) hideSheet(); }, 400);
    } else hideSheet();
  }
  window.addEventListener('popstate', hideSheet);
  // 面板顶上的小横条：按住往下拖，面板跟着手指走；拖过 80 px 或者快速一甩就关，不然弹回去
  document.querySelectorAll('.sheet .grab').forEach(gb => {
    const sh = gb.parentElement;
    let y0 = null, t0 = 0;
    gb.addEventListener('pointerdown', e => {
      y0 = e.clientY; t0 = now();
      try { gb.setPointerCapture(e.pointerId); } catch (_) { /* 合成的事件没法抓 */ }
      sh.style.transition = 'none';
    });
    gb.addEventListener('pointermove', e => { if (y0 != null) sh.style.transform = 'translate3d(0,' + Math.max(0, e.clientY - y0) + 'px,0)'; });
    const end = e => {
      if (y0 == null) return;
      const dy = e.clientY - y0, shut = e.type === 'pointerup' && (dy > 80 || (dy > 24 && dy / Math.max(1, now() - t0) > 0.5));
      y0 = null;
      sh.style.transition = '';
      if (shut) closeSheet(); else sh.style.transform = '';
    };
    gb.addEventListener('pointerup', end);
    gb.addEventListener('pointercancel', end);
  });

  // 搜索
  function openSearch() {
    if (!hiding) kbMark();                   // 键盘还没弹出来：这就是整屏的大小
    openSheet('search');
    const inp = $('s-in');
    inp.value = '';
    renderSearch();
    try { inp.focus({ preventScroll: true }); } catch (e) { inp.focus(); }
  }
  // 每敲一个字：先只画屏幕上看得见的十几行（离输入框最近的那些），其余的等手停下来再补在上面——
  // 一次画 60 行在手机上要二三十毫秒，打字会卡
  let moreT = 0;
  function renderSearch() {
    const q = $('s-in').value.trim(), t = now();
    let res, lab;
    if (!S.cat) { res = []; lab = '名单还没下载好，稍等一下'; }
    else if (q) { res = search(q); lab = !res.length ? '' : S.more ? '找到 60 只以上，多打几个字更准' : '找到 ' + res.length + ' 只'; }
    else { res = S.recent.map(c => S.byCode.get(c)).filter(i => i != null); lab = '最近看过'; }
    S.res = res;
    const el = $('s-res'), first = Math.max(8, Math.ceil(el.clientHeight / 56) + 1);
    clearTimeout(moreT);
    if (el.scrollTop) el.scrollTop = 0;   // 先回到最下面再换内容（版面还是干净的，不用多算一遍）
    el.innerHTML = res.length ? res.slice(0, first).map(rowHTML).join('') : '<div class="empty">' + (!S.cat ? '' : q ? '没找到' : '还没看过别的。<br>输入代码、拼音首字母或名字') + '</div>';
    if (res.length > first) moreT = setTimeout(() => { if (S.res === res) el.insertAdjacentHTML('beforeend', res.slice(first).map(rowHTML).join('')); }, 180);
    put('s-lab', lab);
    S.t.search = Math.round((now() - t) * 100) / 100;
  }
  function pick(i, name, codes) {
    const code = S.rows[i] && S.rows[i][0];
    if (!code) return;
    addRecent(code);
    S.list = { name, codes: name === '最近' ? S.recent.slice() : codes };
    pref.set('list', S.list);
    closeSheet();
    open(code);
  }

  // 列表
  let lTab = '最近';
  const tabNames = () => ['最近'].concat(S.lists.map(l => l.name));
  const tabCodes = n => (n === '最近' ? S.recent.filter(c => S.byCode.has(c)) : (S.lists.find(l => l.name === n) || { codes: [] }).codes);
  function openList() {
    lTab = tabNames().includes(S.list.name) ? S.list.name : '最近';
    renderList();
    openSheet('list');
    const rows = $('l-rows'), cur = rows.querySelector('.row.cur');   // 正在看的那只滚到中间
    if (cur) rows.scrollTop = cur.offsetTop - rows.offsetTop - (rows.clientHeight - cur.offsetHeight) / 2;
  }
  function renderList() {
    $('l-tabs').innerHTML = tabNames().map(n => '<button data-t="' + esc(n) + '"' + (n === lTab ? ' class="on"' : '') + '>' + esc(n) + '</button>').join('');
    const codes = tabCodes(lTab);
    $('l-rows').innerHTML = codes.length ? codes.map(c => rowHTML(S.byCode.get(c))).join('')
      : '<div class="empty">' + (!S.cat ? '名单还没下载好' : lTab === '最近' ? '还没看过别的' : '这个列表是空的') + '</div>';
    $('l-rows').scrollTop = 0;
  }

  // 菜单
  function openMenu() { renderMenu(); openSheet('menu'); }
  function renderMenu() {
    const c = S.cat, m = S.ver;
    let h = '';
    if (c) {
      h = 'A 股数据到 <b>' + esc(c.asof || '--') + '</b>' + (S.live ? '（盘中做的，今天这一根没走完）' : '') +
        '<br>美股数据到 <b>' + esc(c.us_asof || '--') + '</b><br>电脑上做的时间 <b>' + esc(c.made) + '</b><br>共 ' + S.rows.length + ' 只';
      if (m) { const got = m.files.filter(f => S.have.has(f[0])).length; h += '，手机上存了 ' + got + '/' + m.files.length + ' 块' + (S.dl ? '（正在下载）' : ''); }
      if (S.offline) h += '<br><span class="up">现在连不上网，用的是手机上存的</span>';
      if (S.diskFull) h += '<br><span class="up">手机空间不够，有些数据没存下</span>';
    } else h = S.dl ? '正在下载名单…' : '还没有数据';
    $('m-info').innerHTML = h;
    const ver = () => put('m-ver', '页面版本 ' + (S.shell || '开发版') + (m && m.shell && S.shell && m.shell !== S.shell ? '（网上已有新版本 ' + m.shell + '，正在换）' : ''));
    ver();
    if (window.caches) caches.keys().then(ks => { const k = ks.find(x => x.startsWith('lz-shell-')); S.shell = k ? k.slice(9) : ''; ver(); }).catch(() => {});
    resetWipe();
  }
  let wipeArm = 0, wipeT = 0;
  function resetWipe() { wipeArm = 0; clearTimeout(wipeT); put('m-wipe', '清掉口令和数据（换口令时用）'); }
  async function menuAct(a) {
    if (a === 'check') { closeSheet(); checkUpdate('manual'); }
    else if (a === 'all') { closeSheet(); toast('重新下载全部数据，旧的先照常用', 2000); checkUpdate('all'); }
    else if (a === 'wipe') {
      if (!wipeArm) { wipeArm = 1; put('m-wipe', '再点一下就清掉（口令和手机上的全部数据）'); wipeT = setTimeout(resetWipe, 4000); return; }
      resetWipe();
      await wipe();
      closeSheet();
      showLock();
    }
  }
  // 清掉口令和数据：整个库清空，界面回到输口令。菜单里点的（比如手机要给别人用）连界面记录也清掉：
  // 最近看过、当前列表、上次看的那只、周期、柱宽（localStorage 里 lz. 开头的全部）。
  // keepPrefs = 电脑上换了口令、输新口令时顺带清旧数据：这些记录留着，用起来和原来一样
  async function wipe(keepPrefs) {
    S.gen++;
    try { await db.clear(); } catch (e) { /* 清不掉也照样当没有 */ }
    Object.assign(S, { key: null, ver: null, cat: null, rec: new Map(), rows: [], byCode: new Map(), lists: [], dl: null, idx: null, ser: null, code: null, want: null, i: -1, cross: null, keyBad: false });
    S.have.clear(); S.mem.clear(); chunks.clear(); sers.clear();
    if (!keepPrefs) {
      clearTimeout(bwT);                     // 等着存的柱宽别再写回去
      try {
        for (let k = localStorage.length - 1; k >= 0; k--) { const n = localStorage.key(k); if (n && n.startsWith('lz.')) localStorage.removeItem(n); }
      } catch (e) { /* 存不了也删不了：就当没有 */ }
      Object.assign(S, { recent: [], list: listOf(null), per: 'd', bw: 7, off: 0 });
      perButtons();
    }
    header(); status(); msg(''); redraw();
  }

  // ---------- 输口令 ----------
  const TIP = '第一次用：输入电脑上的口令（电脑上双击“看手机口令”就能看到）。只要输这一次，以后直接打开。';
  let lockTok = 0;
  function showLock(tip, canSkip) {
    lockTok++;
    put('lk-tip', tip || TIP);
    put('lk-err', '');
    $('lk-skip').hidden = !canSkip;
    eye(false);
    if (!sheet && !hiding) kbMark();
    $('lock').hidden = false;
  }
  // 撤掉输口令那一屏：键盘还没收下去就等它收完（下面的界面直接是整屏大小，不跳）
  function hideLock() {
    const tok = lockTok;
    $('lk-in').blur();
    afterKeyboard(() => { if (tok === lockTok) $('lock').hidden = true; });
  }
  // 口令框平时显示圆点（手机键盘当它是密码，不记、不联想）；点“显示”换成明文看清楚，再点“隐藏”换回去
  function eye(show) {
    const inp = $('lk-in'), b = $('lk-eye');
    inp.type = show ? 'text' : 'password';
    put('lk-eye', show ? '隐藏' : '显示');
    b.setAttribute('aria-pressed', show ? 'true' : 'false');
  }
  // 让浏览器在手机空间紧张时也别清掉这些数据（装到桌面的一般自动同意；在浏览器里开的可能要过一阵才同意，所以每次打开都问一下）
  function keepData() {
    try {
      const st = navigator.storage;
      if (!st || !st.persist) return;
      (st.persisted ? st.persisted() : Promise.resolve(false))
        .then(p => p || st.persist()).then(p => { S.t.persist = !!p; }).catch(() => {});
    } catch (e) { /* 不支持就算了 */ }
  }
  async function unlock(ev) {
    if (ev) ev.preventDefault();
    const inp = $('lk-in'), btn = $('lk-go');
    if (!LZ.norm(inp.value)) { put('lk-err', '先输入口令'); return; }
    if (btn.disabled) return;
    btn.disabled = true; put('lk-go', '核对中…'); put('lk-err', '');
    try {
      let info;
      try { info = await getJSON('key.json?t=' + Date.now()); } catch (e) { put('lk-err', '连不上网，联网后再试'); return; }
      const key = await LZ.deriveKey(inp.value, info);
      if (!(await LZ.checkKey(key, info))) { put('lk-err', '口令不对，再输一遍'); inp.select(); return; }
      inp.value = '';
      eye(false);
      inp.blur();
      if (S.ver || S.have.size) await wipe(true);      // 换口令前存的数据新钥匙解不开，清掉重新下（最近看过这些记录留着）
      S.key = key; S.keyBad = false;
      try { await db.write([['key', key]]); } catch (e) { /* 存不住：这次能用，下次再输 */ }
      keepData();
      hideLock();
      S.dl = { kind: 'cat', m: null }; status();
      Promise.resolve(sync.busy).then(() => checkUpdate('first'));   // 清数据前那一轮还没收尾的话，等它收完再开始
    } catch (e) {
      put('lk-err', '出错了，再试一次');
    } finally { btn.disabled = false; put('lk-go', '打开'); }
  }

  // ---------- 抬头、读数 ----------
  function header() {
    const x = S.rows[S.i];
    if (!x) { put('h-n', '篓子指数'); ['h-c', 'h-px', 'h-pc', 'h-d', 'o-n', 'o-px', 'o-pc'].forEach(id => put(id, '')); readout(); status(); return; }
    const g = (S.cat.groups || [])[x[5]] || '', pc = x[11], px = fix(x[10], x[6]), s = S.ser && S.ser.code === x[0] ? S.ser : null;
    put('h-n', x[2]);
    $('h-c').innerHTML = (x[1] === g ? '' : esc(x[1]) + ' ') + '<span class="tag">' + esc(g) + '</span>';
    put('h-px', px, cls(pc)); put('h-pc', pctText(pc), cls(pc));
    let d = '';
    if (s) { const last = s.d[s.n - 1]; d = String(last).slice(0, 4) === String(S.cat.asof).slice(0, 4) ? ymd(last).slice(5) : ymd(last); }
    put('h-d', d);
    put('o-n', x[2]); put('o-px', px, cls(pc)); put('o-pc', pctText(pc), cls(pc));
    readout();
    status();                            // 价格变宽变窄了，状态那一段放不放得下要重新看
  }
  // 读数：十字线开着显示那一根，关着显示最后一根。开高低收按比昨收高低上色（通达信的习惯）
  let rdKey = '';
  function readout() {
    const s = S.ser, x = S.rows[S.i];
    const i = !s || !s.n || !x ? -1 : S.cross ? clamp(S.cross.i, 0, s.n - 1) : s.n - 1;
    const key = [S.i, s && s.code, s && s.per, i, s && s.n, !!S.cross, land, G.w, S.ver && S.ver.ver].join();
    if (key === rdKey) return;
    rdKey = key;
    $('ov').classList.toggle('x', !!S.cross);   // 横屏十字线开着：名字后面直接接读数（最新价那两项先收起，一行放得下）
    const ids = ['r-d', 'r-o', 'r-h', 'r-l', 'r-c', 'r-p', 'r-a', 'r-v', 'r-m0', 'r-m1', 'r-m2', 'r-m3'];
    if (i < 0 || s.code !== x[0]) { ids.forEach(k => put(k, '')); $('o-rd').innerHTML = ''; $('o-ma').innerHTML = ''; return; }
    const dg = x[6], pc = s.pc[i], c = s.c[i], unit = String((S.cat.units || [])[x[5]] || '');
    fitMA(s, dg);
    const pct = fin(pc) && pc ? (c / pc - 1) * 100 : null, amp = fin(pc) && pc ? (s.h[i] - s.l[i]) / pc * 100 : null;
    const col = v => (fin(pc) ? (v > pc ? 'up' : v < pc ? 'dn' : '') : '');
    const day = ymd(s.d[i]) + ' ' + week(s.d[i]);
    put('r-d', day);
    put('r-o', fix(s.o[i], dg), col(s.o[i])); put('r-h', fix(s.h[i], dg), col(s.h[i])); put('r-l', fix(s.l[i], dg), col(s.l[i]));
    put('r-c', fix(c, dg), col(c)); put('r-p', pctText(pct), cls(pct));
    put('r-a', fin(amp) ? amp.toFixed(2) + '%' : '--'); put('r-v', vol(s.v[i], unit));
    s.ma.forEach((a, k) => put('r-m' + k, fix(a[i], dg)));
    // 横屏顶上那一行：十字线开着时接在名字后面。每一项（“开 3912.45”）是一个整体，放不下整项折行，数字不会被截。
    // 写进 innerHTML 的字一律转义（单位、名字这些是数据里来的）
    const v = (t, c2) => '<i' + (c2 ? ' class="' + c2 + '"' : '') + '>' + esc(t) + '</i>';
    const it = (lab, t, c2) => '<span>' + (lab ? lab + ' ' : '') + v(t, c2) + '</span>';
    $('o-rd').innerHTML = S.cross ? it('', day) + it('开', fix(s.o[i], dg), col(s.o[i])) + it('高', fix(s.h[i], dg), col(s.h[i])) + it('低', fix(s.l[i], dg), col(s.l[i])) +
      it('收', fix(c, dg), col(c)) + it('', pctText(pct), cls(pct)) + it('振幅', fin(amp) ? amp.toFixed(2) + '%' : '--') + it('量', vol(s.v[i], unit)) : '';
    $('o-ma').innerHTML = MAS.map(([k], j) => '<span class="m' + k + '">MA' + k + ' ' + esc(fix(s.ma[j][i], dg)) + '</span>').join('');
  }
  // 竖屏均线那一行：这一只最宽的均线值带着 “MA” 一行放不下，就只写 5 10 20 60（颜色认得出是哪条）；还放不下才折到下一行。
  // 按这一只最宽的值定一次（换一只、换周期、屏幕宽度变了才重新量），十字线移动时不会一会儿有一会儿没有
  let fitKey = '';
  function fitMA(s, dg) {
    const key = land ? 'land' : [s.code, s.per, s.n, dg, G.w].join();
    if (key === fitKey) return;
    fitKey = key;
    const rd = $('rd');
    if (land) return;                        // 横屏不显示这一块
    let mx = 0;
    for (const a of s.ma) for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > mx) mx = v; }   // NaN 比较是 false，自动跳过
    const w = fix(mx, dg), line = rd.querySelector('.ma');
    for (let k = 0; k < 4; k++) put('r-m' + k, w);   // 先放最宽的量一量；readout 接着写真的值（同一帧里，看不到）
    rd.classList.remove('nma');
    const gap = parseFloat(getComputedStyle(line).columnGap) || 0;
    let need = gap * (line.children.length - 1);
    for (const sp of line.children) need += sp.getBoundingClientRect().width;
    if (need > line.clientWidth + 0.5) rd.classList.add('nma');
  }
  function msg(t) { put('msg', t || ''); }

  // ---------- K 线：画 ----------
  const UP = 'rgb(248,41,71)', DN = 'rgb(84,255,255)', TX = '#d8d9dd', MU = '#7c808a', LN = '#272a31', BG = '#141619', BOX = '#3a3e47';
  const MAS = [[5, '#d8d9dd'], [10, '#d9a441'], [20, '#b06bd6'], [60, '#4a9eff']];
  const FONT = 'system-ui, -apple-system, Roboto, "Noto Sans CJK SC", "Microsoft YaHei", sans-serif';
  const cv = $('cv'), ctx = cv.getContext('2d', { alpha: false });
  // 版面（CSS px）：价格区 [top, pb]，量 [vt, vb]，最下面一条写日期；右边 axis 宽的价格轴
  const G = { w: 0, h: 0, P: 1, axis: 46, top: 6, pb: 0, vt: 0, vb: 0, date: 18, pw: 0, yt: 0, ky: 1, hi: 0 };
  let land = false;
  function layout() {
    G.top = land ? 38 : 6;                         // 横屏顶上压着名字和读数两行
    const avail = Math.max(60, G.h - G.top - G.date);
    G.pb = G.top + Math.round(avail * 0.78) - 4;
    G.vt = G.pb + 10;
    G.vb = G.h - G.date;
    G.pw = Math.max(40, G.w - G.axis);
  }
  // 第 i 根的中心：最新一根在最右边留半根的空
  const xOf = i => G.pw - S.bw * (S.ser.n - i - S.off);
  const offMax = () => (S.ser ? Math.max(0, S.ser.n - (G.pw - S.bw / 2) / S.bw) : 0);
  // 手指所在的那一根（只在看得见的里面挑）；y 在价格区里才画横线
  function crossAt(x, y) {
    const s = S.ser;
    if (!s) return null;
    const a = Math.max(0, Math.ceil(s.n - S.off - G.pw / S.bw)), b = Math.min(s.n - 1, Math.floor(s.n - S.off));
    return { i: clamp(Math.round(s.n - S.off - (G.pw - x) / S.bw), a, Math.max(a, b)), y: y >= G.top && y <= G.pb ? y : null };
  }
  // 价格轴上“好看”的刻度：1、2、2.5、5 × 10 的几次方
  function ticks(lo, hi, want) {
    const span = hi - lo;
    if (!(span > 0)) return [];
    const raw = span / want, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag, out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9 && out.length < 20; v += step) out.push(v);
    return out;
  }
  // 只在需要时、在下一帧画（拖动时一帧最多画一次）
  let raf = 0, dirty = false;
  function redraw() { dirty = true; if (!raf) raf = requestAnimationFrame(tick); }
  function tick(t) {
    raf = 0;
    const live = animate(t);
    if (dirty || live) { dirty = false; draw(); }
    if (live) raf = requestAnimationFrame(tick);
  }
  function draw() {
    const c = ctx, P = G.P, W = cv.width, H = cv.height, D = v => Math.round(v * P);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = BG; c.fillRect(0, 0, W, H);
    const s = S.ser, x0 = S.rows[S.i];
    S.vis = null;
    if (!s || !s.n || !x0 || G.w < 40 || G.h < 80) { readout(); return; }
    const n = s.n, bw = S.bw, pw = G.pw, dg = x0[6];
    S.off = clamp(S.off, 0, offMax());
    if (S.cross) S.cross.i = clamp(S.cross.i, 0, n - 1);
    const i0 = Math.max(0, Math.ceil(n - S.off - (pw + bw / 2) / bw)), i1 = Math.min(n - 1, Math.floor(n - S.off + 0.5));   // 画的（含露出一半的）
    const f0 = Math.max(0, Math.ceil(n - S.off - pw / bw)), f1 = Math.min(n - 1, Math.floor(n - S.off));                  // 中心在图里的
    // 两指放大、惯性滑动之后，十字线那一根可能已经出了图：贴到最近的看得见的那一根（竖线不会画到价格轴上，读数也是看得见的那根）
    if (S.cross && f0 <= f1) S.cross.i = clamp(S.cross.i, f0, f1);
    let hi = -Infinity, lo = Infinity, vmax = 0, ih = -1, il = -1;
    for (let i = f0; i <= f1; i++) {
      if (s.h[i] > hi) { hi = s.h[i]; ih = i; }
      if (s.l[i] < lo) { lo = s.l[i]; il = i; }
      if (s.v[i] > vmax) vmax = s.v[i];
    }
    if (ih < 0) { readout(); return; }
    if (!(hi > lo)) { const e = Math.abs(hi) * 0.01 || 0.01; hi += e; lo -= e; }
    const yt = G.top + 16, yb = G.pb - 14, ky = (yb - yt) / (hi - lo), Y = p => yt + (hi - p) * ky;
    G.yt = yt; G.ky = ky; G.hi = hi;
    c.font = (10.5 * P) + 'px ' + FONT; c.textBaseline = 'middle';
    const hair = Math.max(1, Math.round(P * 0.75));

    // 横格线、两区之间、价格轴左边的线
    const tk = ticks(lo - (G.pb - yb) / ky, hi + (yt - G.top) / ky, Math.max(2, Math.floor((G.pb - G.top) / 56)));
    c.fillStyle = LN;
    for (const v of tk) { const y = Y(v); if (y > G.top + 5 && y < G.pb - 5) c.fillRect(0, D(y), D(pw), hair); }
    c.fillRect(0, D(G.pb + 5), W, hair);
    c.fillRect(D(pw), 0, hair, D(G.vb));

    // K 线和量：同色的拼成一条路径一次填，快
    const wk = Math.max(1, Math.round(P)), bw0 = Math.max(1, Math.round(bw * 0.72 * P));
    const bwD = bw0 > wk && (bw0 - wk) % 2 ? bw0 - 1 : bw0, hb = bwD >> 1, hw = wk >> 1;   // 实体和影线同奇偶，影线正好在正中
    const vb = D(G.vb), vk = vmax > 0 ? (G.vb - G.vt) / vmax : 0;
    const up = new Path2D(), dn = new Path2D(), vu = new Path2D(), vd = new Path2D();
    for (let i = i0; i <= i1; i++) {
      const cx = D(xOf(i)), o = s.o[i], cl = s.c[i], isUp = cl >= o, p = isUp ? up : dn;
      const yh = D(Y(s.h[i])), yl = D(Y(s.l[i])), yo = D(Y(o)), yc = D(Y(cl));
      p.rect(cx - hw, yh, wk, Math.max(1, yl - yh));
      p.rect(cx - hb, Math.min(yo, yc), bwD, Math.max(1, Math.abs(yo - yc)));
      if (s.v[i] > 0) {
        const vh = Math.max(1, Math.round(s.v[i] * vk * P)), pc = s.pc[i];
        ((pc === pc ? cl >= pc : isUp) ? vu : vd).rect(cx - hb, vb - vh, bwD, vh);   // 量按比昨收涨跌上色
      }
    }
    c.save();
    c.beginPath(); c.rect(0, 0, D(pw), H); c.clip();
    c.globalAlpha = 0.82; c.fillStyle = UP; c.fill(vu); c.fillStyle = DN; c.fill(vd);
    c.globalAlpha = 1; c.fillStyle = UP; c.fill(up); c.fillStyle = DN; c.fill(dn);
    // 均线（只在价格区里）
    c.beginPath(); c.rect(0, D(G.top), D(pw), D(G.pb - G.top)); c.clip();
    c.lineWidth = Math.max(1, P); c.lineJoin = 'round';
    s.ma.forEach((a, k) => {
      c.beginPath();
      let on = false;
      for (let i = i0; i <= i1; i++) {
        const v = a[i];
        if (v !== v) { on = false; continue; }
        const X = xOf(i) * P, Yv = Y(v) * P;
        if (on) c.lineTo(X, Yv); else { c.moveTo(X, Yv); on = true; }
      }
      c.strokeStyle = MAS[k][1]; c.stroke();
    });
    // 最新价的虚线
    const last = s.c[n - 1], ly = Y(last), lcol = fin(x0[11]) && x0[11] < 0 ? DN : UP;
    if (ly >= G.top && ly <= G.pb) {
      c.globalAlpha = 0.5; c.strokeStyle = lcol; c.lineWidth = hair; c.setLineDash([2 * P, 3 * P]);
      c.beginPath(); c.moveTo(0, D(ly) + hair / 2); c.lineTo(D(pw), D(ly) + hair / 2); c.stroke();
      c.setLineDash([]); c.globalAlpha = 1;
    }
    c.restore();

    // 看得见的最高、最低：一小段引线 + 价格（通达信那样）
    c.font = (10 * P) + 'px ' + FONT; c.fillStyle = TX;
    const mark = (i, p) => {
      const x = xOf(i), y = clamp(Y(p), G.top + 6, G.pb - 6), left = x > pw / 2, x2 = left ? x - 16 : x + 16;
      c.fillRect(D(Math.min(x, x2)), D(y), D(16), hair);
      c.textAlign = left ? 'right' : 'left';
      c.fillText(fix(p, dg), D(left ? x2 - 3 : x2 + 3), D(y));
    };
    mark(ih, s.h[ih]);
    if (il !== ih || s.l[il] !== s.h[ih]) mark(il, s.l[il]);

    // 价格轴的字、量的最大值
    c.font = (10.5 * P) + 'px ' + FONT; c.textAlign = 'left'; c.fillStyle = MU;
    for (const v of tk) { const y = Y(v); if (y > G.top + 7 && y < G.pb - 7) c.fillText(fix(v, dg), D(pw + 5), D(y)); }
    c.fillText(vol(vmax, ''), D(pw + 5), D(G.vt + 7));
    const tag = (y, text, bg, fg) => {
      c.fillStyle = bg; c.fillRect(D(pw) + hair, D(y - 8), W - D(pw) - hair, D(16));
      c.fillStyle = fg; c.textAlign = 'left'; c.fillText(text, D(pw + 5), D(y));
    };
    if (ly >= G.top && ly <= G.pb) tag(ly, fix(last, dg), lcol, lcol === DN ? '#0c1d20' : '#fff');

    // 最下面：第一根、最后一根的日期
    const dy = D(G.vb + G.date / 2 + 1);
    c.fillStyle = MU;
    c.textAlign = 'left'; c.fillText(ymd(s.d[f0]), D(3), dy);
    c.textAlign = 'right'; c.fillText(ymd(s.d[f1]), D(pw - 3), dy);

    // 十字线：竖线对着那一根，横线在手指高度；轴上标价格和日期
    if (S.cross) {
      const ci = S.cross.i, cx = D(xOf(ci));
      c.fillStyle = 'rgba(216,217,221,.6)';
      c.fillRect(cx - (hair >> 1), D(G.top), hair, D(G.vb - G.top));
      if (S.cross.y != null) {
        const y = clamp(S.cross.y, G.top, G.pb);
        c.fillRect(0, D(y), D(pw), hair);
        tag(y, fix(hi - (y - yt) / ky, dg), BOX, TX);
      }
      const t = ymd(s.d[ci]), tw = Math.ceil(c.measureText(t).width + 12 * P), bx = clamp(cx - (tw >> 1), 0, Math.max(0, D(pw) - tw));
      c.fillStyle = BOX; c.fillRect(bx, D(G.vb + 1), tw, D(G.date - 2));
      c.fillStyle = TX; c.textAlign = 'center'; c.fillText(t, bx + tw / 2, dy);
    }
    S.vis = { i0: f0, i1: f1, hi: s.h[ih], lo: s.l[il], ih, il, bars: f1 - f0 + 1 };
    if (!S.t.first) S.t.first = Math.round(now());
    readout();
  }

  // ---------- 动画：惯性、按钮缩放、十字线贴边滚动 ----------
  const A = { v: 0, vt: 0, z: null, et: 0 };
  function animate(t) {
    let live = false;
    if (A.v && S.ser) {   // 惯性：速度每帧打 0.95 折，慢到 0.02 px/ms 停；撞到头也停
      const dt = clamp(t - A.vt, 0, 50), mx = offMax(), o = S.off + A.v * dt / S.bw;
      A.vt = t;
      S.off = clamp(o, 0, mx);
      A.v *= Math.pow(0.95, dt / 16.67);
      if (Math.abs(A.v) < 0.02 || o <= 0 || o >= mx) A.v = 0; else live = true;
    }
    if (A.z && S.ser) {   // − / + 的缩放用 120 毫秒缓过去
      const k = clamp((t - A.z.t0) / 120, 0, 1), e = 1 - Math.pow(1 - k, 3);
      setBw(A.z.from + (A.z.to - A.z.from) * e, A.z.ai, A.z.ax);
      if (k >= 1) A.z = null; else live = true;
    }
    if (g && g.kind === 'cross' && g.edge && S.ser) {   // 十字线拖到边上：图往那边滚（每秒 15 根）
      const dt = clamp(t - A.et, 0, 50);
      A.et = t;
      S.off = clamp(S.off + g.edge * dt * 0.015, 0, offMax());
      S.cross = crossAt(g.x, g.y);
      live = g.edge > 0 ? S.off < offMax() : S.off > 0;
    }
    return live;
  }
  // 换柱宽：钉住第 ai 根在屏幕 ax 处（十字线那根）；不给就钉住右边（离最新一根的距离不变）
  function setBw(w, ai, ax) {
    w = clamp(w, 2, 40);
    if (ai != null && S.ser) S.off = S.ser.n - ai - (G.pw - ax) / w;
    S.bw = w;
    S.off = clamp(S.off, 0, offMax());
  }
  // 手一碰：惯性停；−/+ 的缩放动画直接到位（不停在半路：按了几下就是几下）
  function stopAnim() {
    A.v = 0;
    if (A.z) { if (S.ser) setBw(A.z.to, A.z.ai, A.z.ax); A.z = null; saveBw(); redraw(); }
  }
  function zoomStep(f) {
    if (!S.ser) return;
    const ai = S.cross ? S.cross.i : null;
    A.v = 0;
    A.z = { from: S.bw, to: clamp((A.z ? A.z.to : S.bw) * f, 2, 40), t0: now(), ai, ax: ai != null ? xOf(ai) : 0 };
    redraw(); saveBw();
  }
  // 以屏幕上 x 处那一根为中心缩放（滚轮）
  function zoomAt(w, x) {
    const u = S.ser.n - S.off - (G.pw - x) / S.bw;
    S.bw = clamp(w, 2, 40);
    S.off = clamp(S.ser.n - u - (G.pw - x) / S.bw, 0, offMax());
  }
  let bwT = 0;
  function saveBw() { clearTimeout(bwT); bwT = setTimeout(() => pref.set('bw', Math.round(S.bw * 100) / 100), 500); }

  // ---------- 手势（Pointer Events：手指、鼠标一样处理） ----------
  const pts = new Map();   // 按着的：pointerId → {x, y}
  let g = null, lpT = 0;   // g = 这一次手势：press（刚按下）/ pan / cross / flick / pinch / idle
  const pos = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const press = (p, mouse) => { const t = now(); return { kind: 'press', mouse, x0: p.x, y0: p.y, x: p.x, y: p.y, lx: p.x, t0: t, tr: [[t, p.x]], edge: 0 }; };
  cv.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    try { cv.setPointerCapture(e.pointerId); } catch (_) { /* 合成的事件没法抓 */ }
    const p = pos(e);
    pts.set(e.pointerId, p);
    const caught = !!A.v;                // 图还在惯性滑：这一下是“接住”，只让它停（松手不开关十字线，像原生的列表那样）
    stopAnim();
    if (!S.ser) return;
    if (pts.size === 1) {
      g = press(p, e.pointerType === 'mouse');
      g.caught = caught;
      clearTimeout(lpT);
      lpT = setTimeout(longPress, 380);
    } else if (pts.size === 2) {
      clearTimeout(lpT);
      const [a, b] = [...pts.values()], mx = (a.x + b.x) / 2;
      g = { kind: 'pinch', d0: Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)), bw0: S.bw, u0: S.ser.n - S.off - (G.pw - mx) / S.bw };
    }
  });
  function longPress() {   // 按住 380 毫秒不动：十字线出在这里，跟着手指走
    if (!g || g.kind !== 'press' || !S.ser) return;
    g.kind = 'cross';
    S.cross = crossAt(g.x0, g.y0);
    try { if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(8); } catch (_) { /* 不震也行 */ }
    redraw();
  }
  cv.addEventListener('pointermove', e => {
    const p = pos(e);
    if (!pts.has(e.pointerId)) {        // 鼠标没按着在动：十字线开着就跟着走
      if (e.pointerType === 'mouse' && S.cross && !g && S.ser) { S.cross = crossAt(p.x, p.y); redraw(); }
      return;
    }
    pts.set(e.pointerId, p);
    if (!g || !S.ser) return;
    if (g.kind === 'pinch') { if (pts.size >= 2) pinch(); return; }
    const dx = p.x - g.x0, dy = p.y - g.y0;
    if (g.kind === 'press' || g.kind === 'lean') {
      const d2 = dx * dx + dy * dy, ax = Math.abs(dx), ay = Math.abs(dy);
      if (g.kind === 'press' && d2 < 64) return;   // 8 px 以内还算没动
      clearTimeout(lpT);
      // 横的不比竖的少：平移；竖的比横的两倍还多：上下一划。斜着起手（大拇指往上划常这样）先不动，
      // 走到 24 px 再看：偏竖（竖 > 横 1.5 倍）算一划，偏横算平移（平移从按下的地方算起，图跟手不跳）
      if (g.mouse) g.kind = 'pan';
      else if (S.cross) g.kind = 'cross';
      else if (ax >= ay) g.kind = 'pan';
      else if (ay > 2 * ax) g.kind = 'flick';
      else if (d2 >= 576) g.kind = ay > 1.5 * ax ? 'flick' : 'pan';
      else { g.kind = 'lean'; g.x = p.x; g.y = p.y; return; }
    } else if (g.kind === 'flick' && Math.abs(dx) >= 8 && Math.abs(dy) <= 2 * Math.abs(dx)) {
      // 起手偏竖、后来横着走多了：改成平移，从手指现在的位置接着拖（图不跳）
      g.kind = 'pan'; g.lx = p.x; g.tr = [[now(), p.x]];
    }
    g.x = p.x; g.y = p.y;
    if (g.kind === 'pan') {
      S.off = clamp(S.off + (p.x - g.lx) / S.bw, 0, offMax());
      g.lx = p.x;
      g.tr.push([now(), p.x]);
      if (g.tr.length > 16) g.tr.shift();
      if (S.cross) S.cross = crossAt(p.x, p.y);
      redraw();
    } else if (g.kind === 'cross') {
      S.cross = crossAt(p.x, p.y);
      const edge = p.x < 22 ? 1 : p.x > G.pw - 22 ? -1 : 0;   // 贴着左边：往更早滚；贴着右边：往最新滚
      if (edge && !g.edge) A.et = now();
      g.edge = edge;
      redraw();
    }
  });
  function pinch() {   // 两指：柱宽跟着两指距离变，两指中间那一根一直在两指中间
    const [a, b] = [...pts.values()], d = Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)), mx = (a.x + b.x) / 2;
    S.bw = clamp(g.bw0 * d / g.d0, 2, 40);
    S.off = clamp(S.ser.n - g.u0 - (G.pw - mx) / S.bw, 0, offMax());
    redraw();
  }
  function up(e) {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    clearTimeout(lpT);
    if (!g) return;
    if (g.kind === 'pinch') {             // 松开一根：剩下那根接着拖（十字线开着就不动）
      saveBw();
      if (pts.size === 1) { const q = press([...pts.values()][0], false); q.kind = S.cross ? 'idle' : 'pan'; g = q; }
      else if (!pts.size) g = null;
      return;
    }
    if (pts.size) return;
    const gg = g, p = pos(e), dt = now() - gg.t0;
    g = null;
    if (e.type === 'pointercancel' || !S.ser) { redraw(); return; }
    if (gg.kind === 'press') {
      // 点一下（< 300 毫秒）：开 / 关十字线；按得稍久又没到长按：当成要看这一根。接住惯性的那一下只是停住，十字线不动
      if (!gg.caught) S.cross = dt < 300 && S.cross ? null : crossAt(p.x, p.y);
      redraw();
    } else if (gg.kind === 'pan') fling(gg);
    else if (gg.kind === 'flick') {
      const dx = p.x - gg.x0, dy = p.y - gg.y0;
      if (Math.abs(dy) > 70 && Math.abs(dy) > 2 * Math.abs(dx) && dt < 450) go(dy < 0 ? 1 : -1, true);   // 往上一划下一只，往下上一只
    } else redraw();
  }
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('contextmenu', e => e.preventDefault());
  // 松手时的速度：最后 80 毫秒里移动的距离 / 时间；手指停住了再松就没有惯性
  function fling(gg) {
    const t = now(), tr = gg.tr.filter(q => t - q[0] <= 80);
    if (tr.length < 2 || t - tr[tr.length - 1][0] > 50) return;
    const a = tr[0], b = tr[tr.length - 1], v = (b[1] - a[1]) / Math.max(8, b[0] - a[0]);
    if (Math.abs(v) < 0.05) return;
    A.v = clamp(v, -5, 5); A.vt = t;
    redraw();
  }
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    if (!S.ser) return;
    stopAnim();
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1, dx = e.deltaX * k, dy = e.deltaY * k, p = pos(e);
    if (Math.abs(dx) > Math.abs(dy)) S.off = clamp(S.off - dx / S.bw, 0, offMax());   // 触控板左右划：平移
    else zoomAt(S.bw * Math.exp(-dy * 0.0015), p.x);
    if (S.cross) S.cross = crossAt(p.x, p.y);
    redraw(); saveBw();
  }, { passive: false });

  // 按住不放连续执行（− / +）：先执行一次，350 毫秒后每 120 毫秒一次
  function hold(btn, fn) {
    let t1 = 0, t2 = 0;
    const stop = () => { clearTimeout(t1); clearInterval(t2); t1 = t2 = 0; };
    btn.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      try { btn.setPointerCapture(e.pointerId); } catch (_) { /* 合成的事件没法抓 */ }
      stop(); fn();
      t1 = setTimeout(() => { t2 = setInterval(fn, 120); }, 350);
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(k => btn.addEventListener(k, stop));
    btn.addEventListener('click', e => { if (e.detail === 0) fn(); });   // 键盘按的（没有指针）
  }

  // ---------- 横竖屏、画布大小 ----------
  // 横屏 = 宽 > 高，而且手机自己没说是竖着拿（键盘弹出来把竖屏页面压得比宽还矮时，手机还是说“竖着”，就不切）。
  // 电脑上测试没有这个说法时只看宽高。搜索面板开着（键盘在）也不切，等关了再说
  function isLand() {
    let t = '';
    try { t = (screen.orientation && screen.orientation.type) || ''; } catch (e) { /* 不支持就只看宽高 */ }
    return innerWidth > innerHeight && !t.startsWith('portrait');
  }
  function orient() {
    if (sheet === 'search' || hiding === 'search') return;
    const l = isLand();
    if (l === land) return;
    land = l;
    document.documentElement.classList.toggle('land', l);
    S.cross = null;                      // 转屏：十字线收起；柱宽和离最新一根的距离不变（横屏看得更多）
    rdKey = '';
    layout(); redraw();
    if (!l) status();                    // 回到竖屏：抬头那行状态按现在的宽度重新挑长短
  }
  window.addEventListener('resize', orient);
  try { screen.orientation.addEventListener('change', orient); } catch (e) { /* 老浏览器：resize 也够用 */ }
  function size(e) {
    const r = e.contentRect, dp = e.devicePixelContentBoxSize && e.devicePixelContentBoxSize[0];
    G.w = r.width; G.h = r.height;
    G.P = dp && r.width ? dp.inlineSize / r.width : window.devicePixelRatio || 1;
    const W = dp ? dp.inlineSize : Math.round(r.width * G.P), H = dp ? dp.blockSize : Math.round(r.height * G.P);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    layout();
    draw();                              // 当场画：改了画布大小会清空，等下一帧就会闪一下
  }
  const ro = new ResizeObserver(es => size(es[es.length - 1]));
  try { ro.observe($('cw'), { box: 'device-pixel-content-box' }); } catch (e) { ro.observe($('cw')); }

  // ---------- 按钮 ----------
  const ACT = {
    d: () => setPer('d'), w: () => setPer('w'), m: () => setPer('m'),
    prev: () => go(-1), next: () => go(1),
    list: () => (S.cat ? openList() : toast('名单还没下载好，稍等一下')),
    search: openSearch, menu: openMenu,
  };
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-a]');
    if (b && ACT[b.dataset.a]) ACT[b.dataset.a]();
  });
  document.querySelectorAll('[data-z]').forEach(b => hold(b, () => zoomStep(b.dataset.z === '+' ? 1.25 : 0.8)));
  $('mask').addEventListener('click', closeSheet);
  $('s-x').addEventListener('click', closeSheet);
  $('s-in').addEventListener('input', renderSearch);
  $('s-in').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); if (S.res.length) pick(S.res[0], $('s-in').value.trim() ? '搜索' : '最近', S.res.map(i => S.rows[i][0])); }
  });
  $('s-res').addEventListener('click', e => {
    const r = e.target.closest('.row');
    if (r) pick(+r.dataset.i, $('s-in').value.trim() ? '搜索' : '最近', S.res.map(i => S.rows[i][0]));
  });
  $('l-tabs').addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (b) { lTab = b.dataset.t; renderList(); } });
  $('l-rows').addEventListener('click', e => { const r = e.target.closest('.row'); if (r) pick(+r.dataset.i, lTab, tabCodes(lTab)); });
  $('sh-menu').addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (b) menuAct(b.dataset.m); });
  $('lk-f').addEventListener('submit', unlock);
  $('lk-skip').addEventListener('click', hideLock);
  $('lk-eye').addEventListener('mousedown', e => e.preventDefault());   // 点“显示”时输入框不丢焦点，键盘不收
  $('lk-eye').addEventListener('click', () => eye($('lk-in').type === 'password'));
  $('lk-in').addEventListener('focus', () => { if (innerWidth !== kb.w) kbMark(); });   // 转过屏再输：按现在的大小记
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheet) closeSheet(); });

  // 回到前台：离上次检查超过 30 分钟就再查；刚联上网也查
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.key && Date.now() - Math.max(sync.ok, sync.tried) >= 30 * 60e3) checkUpdate('visible');
  });
  window.addEventListener('online', () => { if (S.key && S.offline) checkUpdate('online'); });

  // ---------- service worker：外壳存在手机上；有新版本时提示重新打开 ----------
  function regSW() {
    if (!('serviceWorker' in navigator)) return;
    const had = !!navigator.serviceWorker.controller;   // 第一次装时也会触发 controllerchange，那时不提示
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (had) toast('已更新到新版本，点这里重新打开', 30000, () => location.reload());
    });
    navigator.serviceWorker.register('sw.js').then(r => { S.reg = r; }).catch(() => { /* 本机测试没有也行 */ });
    if (window.caches) caches.keys().then(ks => { const k = ks.find(x => x.startsWith('lz-shell-')); S.shell = k ? k.slice(9) : ''; }).catch(() => {});
  }

  // ---------- 启动 ----------
  async function start() {
    // 上次关掉（或者手机把它收掉）时开着面板：那一笔历史还在，退回去把它去掉（不然要按两下返回才出得去）。
    // 回到的是这一页自己的那一笔，页面不会重新打开；随后的 popstate 时没有面板开着，什么也不做
    if (history.state && history.state.lz) history.back();
    orient(); perButtons(); header(); status();
    await db.open();
    let key = null, ver = null, keys = [];
    try { [key, ver, keys] = await Promise.all([db.get('key'), db.get('ver'), db.keys()]); } catch (e) { /* 当成空的 */ }
    S.have = new Set((keys || []).filter(k => typeof k === 'string' && k.startsWith('f:')).map(k => k.slice(2)));
    if (!key) { showLock(); regSW(); return; }
    S.key = key;
    keepData();
    if (ver && ver.cat && ver.rec) {
      try {
        const [cb, rb] = await Promise.all([openFile(ver.cat[0], ver.cat[1]), openFile(ver.rec[0], ver.rec[1])]);
        apply(ver, LZ.parseCatalog(cb), LZ.parseRecent(rb));
      } catch (e) { msg('手机上的数据读不出来，联网后会重新下载'); }
    }
    S.t.ready = Math.round(now());
    regSW();
    checkUpdate('start');
  }

  // 给自动检查用的把手（界面不用它）
  window.App = {
    state() {
      const s = S.ser, x = S.rows[S.i];
      return {
        code: S.code, name: x ? x[2] : null, per: S.per, bw: S.bw, off: S.off, land, sheet,
        cross: S.cross && s ? { i: S.cross.i, y: S.cross.y, date: s.d[S.cross.i] } : null,
        n: s ? s.n : 0, last: s ? { d: s.d[s.n - 1], c: s.c[s.n - 1] } : null, cat: x ? { last: x[10], pct: x[11], digits: x[6] } : null,
        vis: S.vis, list: { name: S.list.name, n: curList().length, at: curList().indexOf(S.code) },
        status: $('h-st').textContent, ver: S.ver && S.ver.ver, base: S.ver && S.ver.base, have: S.have.size,
        files: S.ver ? S.ver.files.length : 0, dl: S.dl ? S.dl.kind : null, offline: S.offline, busy: !!sync.busy,
        anim: !!(A.v || A.z), shell: S.shell, t: Object.assign({}, S.t), history: history.length,
      };
    },
    open: code => open(code),
    setPer,
    bars() {   // 当前这只当前周期的 K 线（普通数组），核对周线月线用
      const s = S.ser;
      if (!s) return null;
      const a = x => Array.from(x);
      return { code: s.code, per: s.per, d: a(s.d), o: a(s.o), h: a(s.h), l: a(s.l), c: a(s.c), v: a(s.v), pc: a(s.pc), ma: s.ma.map(a) };
    },
    search(q) { const t = now(), r = search(q); return { ms: now() - t, more: S.more, codes: r.map(i => S.rows[i][0]) }; },
  };

  start();
})();
