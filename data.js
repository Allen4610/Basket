// 篓子指数手机版：数据的约定（phone_site.py 写，这里读；两边必须一模一样）。app.js 只调这里的函数，不自己拆字节。
// 普通脚本（不是模块）：浏览器里是 self.LZ，node 里 require 得到 LZ。安卓 Chrome 和 node 24 都能跑：
// 只用 crypto.subtle、DecompressionStream、Blob、Response、TextEncoder / TextDecoder、atob，不用别的库。
//
// 口令 → 钥匙：先规整（NFKC：全角的字母数字变成半角，输入法全角状态下打的也认；再小写，只留 a-z 0-9。所以 "ABCD-efgh 1234"、
//   "ＡＢＣＤ－ｅｆｇｈ　１２３４" 和 "abcdefgh1234" 是同一个；和 phone_site.norm 一模一样，测试里逐个字比过），
//   再 PBKDF2-HMAC-SHA256(口令, key.json 的 salt, key.json 的 iter 遍, 32 字节) → AES-256-GCM 钥匙（导不出来，只能解密）。
//   key.json 的 check 是加密的 "lz-ok"：解得开、读出来是它，口令就对。
// 每个加密文件 = 12 字节 IV + 密文（最后 16 字节是校验）；解密后是 gzip，再解压才是内容。内容里的数都是小端：
//   底子 d/<底子>/NNN.bin  最多 PER 只。N = 这一块一共几根：日期 int32[N] | 开 f32[N] | 高 f32[N] | 低 f32[N] | 收 f32[N] | 量 f32[N]
//                         （一共 24·N 字节）。名单里每只记着它在第几块（file）、块里从第几根起（off）、几根（count）。
//                         每只是做底子时它的最后 keep 根去掉最后一根：最后一根总在“最近”里（接法 0），拼起来还是最后 keep 根。
//                         （白天做的底子，最后一根是盘中的半根，晚上会改；放在“最近”里，晚上只换这一根，不用整只重发、重做底子。）
//   名单 d/c-….bin        UTF-8 的 JSON：{v, made, asof, us_asof, groups, units, base, keep,
//                           list: [[代码, 显示代码, 名字, 拼音首字母, 英文名, 类别, 小数位, file, off, count, 最新价, 涨跌%], …],
//                           lists: [{name, idx: [名单里第几个, …]}, …]}     不在底子里的 file = -1（新加的，做底子时只有一根的）
//   最近 d/r-….bin        int32 版本（=1）、int32 条数；每条：int32 名单里第几个、int32 接法、float32 比例、int32 几根，
//                         再一根根：int32 日期、float32 开 高 低 收 量（每根 24 字节）。
//                         接法：0 = 底子后面接上；1 = 整只换成这些；2 = 底子的开高低收先乘比例（float64 乘完存成 float32，量不动）再接上。
//                         底子里有的，平常都有一条（至少是最后那一根）；没有条目的 = 就是底子那一段。
var LZ = (function () {
  'use strict';
  const FIELDS = ['d', 'o', 'h', 'l', 'c', 'v'];
  const subtle = () => globalThis.crypto.subtle;
  const EMPTY = Object.freeze({ d: new Int32Array(0), o: new Float32Array(0), h: new Float32Array(0), l: new Float32Array(0), c: new Float32Array(0), v: new Float32Array(0) });
  const LITTLE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;   // 手机、电脑都是小端；直接按类型数组读底子要靠这个

  // ArrayBuffer 或任何视图（node 的 Buffer 也是视图）→ Uint8Array，不拷贝
  function bytes(x) {
    if (x instanceof ArrayBuffer) return new Uint8Array(x);
    if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
    throw new TypeError('要的是 ArrayBuffer');
  }

  function fromB64(s) {
    const t = atob(s), u = new Uint8Array(t.length);
    for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i);
    return u;
  }

  // 口令规整，和 phone_site.norm 一模一样：NFKC（全角字母数字变半角）→ 小写 → 只留 a-z 0-9。
  // 先去掉的几个字（U+A7F1、U+1CCD6–U+1CCF9）比 Python 3.12 的 Unicode 15.0 新：这里认得、会 NFKC 成字母数字，Python 不认得、
  // 最后会去掉。两边都先去掉，结果才一样。换了更新的浏览器 / node 多出来的，测试会逐个字比出来，两边一起加。
  function norm(pass) {
    return String(pass == null ? '' : pass).replace(/[\uA7F1\u{1CCD6}-\u{1CCF9}]/gu, '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  // 口令 → AES-GCM 钥匙（只能解密、导不出来，可以直接存进 IndexedDB）
  async function deriveKey(pass, keyinfo) {
    const raw = await subtle().importKey('raw', new TextEncoder().encode(norm(pass)), 'PBKDF2', false, ['deriveKey']);
    return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(keyinfo.salt), iterations: keyinfo.iter },
      raw, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  }

  // 解密 + 解压；口令不对或文件坏了会抛错
  async function open(key, buf) {
    const u = bytes(buf);
    if (u.byteLength < 28) throw new Error('文件太短，不是加密文件');
    const gz = await subtle().decrypt({ name: 'AES-GCM', iv: u.subarray(0, 12) }, key, u.subarray(12));
    return new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }

  async function checkKey(key, keyinfo) {
    try {
      return new TextDecoder().decode(await open(key, fromB64(keyinfo.check))) === 'lz-ok';
    } catch (e) {
      return false;
    }
  }

  function parseCatalog(buf) {
    return JSON.parse(new TextDecoder().decode(bytes(buf)));
  }

  // 最近 → Map(名单里第几个 → {mode, scale, d, o, h, l, c, v})
  function parseRecent(buf) {
    const u = bytes(buf), dv = new DataView(u.buffer, u.byteOffset, u.byteLength), out = new Map();
    if (u.byteLength < 8 || dv.getInt32(0, true) !== 1) throw new Error('“最近”的格式不认识');
    const count = dv.getInt32(4, true);
    let p = 8;
    for (let k = 0; k < count; k++) {
      if (p + 16 > u.byteLength) throw new Error('“最近”文件不完整');
      const idx = dv.getInt32(p, true), mode = dv.getInt32(p + 4, true), scale = dv.getFloat32(p + 8, true), n = dv.getInt32(p + 12, true);
      p += 16;
      if (n < 0 || p + 24 * n > u.byteLength) throw new Error('“最近”文件不完整');
      const e = { mode, scale, d: new Int32Array(n), o: new Float32Array(n), h: new Float32Array(n), l: new Float32Array(n), c: new Float32Array(n), v: new Float32Array(n) };
      for (let i = 0; i < n; i++, p += 24) {
        e.d[i] = dv.getInt32(p, true);
        e.o[i] = dv.getFloat32(p + 4, true);
        e.h[i] = dv.getFloat32(p + 8, true);
        e.l[i] = dv.getFloat32(p + 12, true);
        e.c[i] = dv.getFloat32(p + 16, true);
        e.v[i] = dv.getFloat32(p + 20, true);
      }
      out.set(idx, e);
    }
    return out;
  }

  // 解开的底子一块里的一只：直接是这一块里的视图（不拷贝，只读着用）
  function slice(chunkBuf, off, count) {
    if (!LITTLE) throw new Error('这台设备不是小端的，读不了');
    let u = bytes(chunkBuf);
    if (u.byteLength % 24) throw new Error('底子文件的大小不对');
    if (u.byteOffset % 4) u = u.slice();                                  // 类型数组要 4 字节对齐（解压出来的本来就是）
    const N = u.byteLength / 24;
    if (!(off >= 0 && count >= 0 && off + count <= N)) throw new RangeError('超出了这一块');
    const at = k => u.byteOffset + (k * N + off) * 4, b = u.buffer;
    return { d: new Int32Array(b, at(0), count), o: new Float32Array(b, at(1), count), h: new Float32Array(b, at(2), count),
      l: new Float32Array(b, at(3), count), c: new Float32Array(b, at(4), count), v: new Float32Array(b, at(5), count) };
  }

  function cat(a, b) {
    const out = new a.constructor(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  }

  // 底子（可以是 null）+ 最近里这一只的条目（可以没有）→ 拼好的日线。不改两样输入；没有条目时直接用底子的视图（只读着用）。
  function merge(base, entry) {
    const B = base || EMPTY;
    if (!entry) return { d: B.d, o: B.o, h: B.h, l: B.l, c: B.c, v: B.v };
    if (entry.mode === 1) return { d: entry.d, o: entry.o, h: entry.h, l: entry.l, c: entry.c, v: entry.v };
    if (entry.mode !== 0 && entry.mode !== 2) throw new Error('不认识的接法 ' + entry.mode);
    const out = {};
    for (const k of FIELDS) out[k] = cat(B[k], entry[k]);
    if (entry.mode === 2) {
      const s = entry.scale, n = B.d.length;                              // 比例接法：底子那段开高低收乘比例（float64 乘，存进 Float32Array 时舍入成 float32）
      for (const k of ['o', 'h', 'l', 'c']) {
        const x = out[k], y = B[k];
        for (let i = 0; i < n; i++) x[i] = y[i] * s;
      }
    }
    return out;
  }

  return { norm, deriveKey, checkKey, open, parseCatalog, parseRecent, slice, merge, EMPTY };
})();
if (typeof module !== 'undefined') module.exports = LZ; else self.LZ = LZ;
