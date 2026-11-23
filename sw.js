// 篓子指数手机版的 service worker（用户 #866–#870）。
// 只做一件事：把“外壳”（页面、脚本、图标）存在手机上，从桌面图标打开时不等网络，没网也能开。
// 数据（m.json、key.json、d/ 下的加密文件）一律不经过这里，由 app.js 自己下载、存进 IndexedDB：
// 每晚数据更新不用换外壳，外壳更新也碰不到已经存好的数据。

// 发布时 phone_site.py 把下一行引号里的占位符换成外壳文件的哈希。外壳一变 sw.js 就跟着变，浏览器发现后自动装新版本。
// 占位符全文只能出现这一次：构建是整串替换，别处（包括注释）再写一遍也会被换掉。
const VERSION = 'f88c0680d2ce';
const CACHE = 'lz-shell-' + VERSION;
// 没经过构建（开发时直接开 phone/app）：占位符还在，就什么都不缓存，改了文件刷新就能看到。
const DEV = VERSION.startsWith('__');
// 外壳文件，和 phone_site.py 复制到网站上的一一对应；'./' 是从桌面图标打开的地址（manifest 的 start_url）。
const SHELL = ['./', 'index.html', 'app.js', 'data.js', 'manifest.webmanifest',
               'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];
const HERE = new URL('./', self.location.href);   // 网站所在的目录，比如 https://….github.io/basket/

self.addEventListener('install', e => {
  // 新外壳存好就立刻接手（skipWaiting），不等旧页面全关；页面收到 controllerchange 会提示重新打开。
  e.waitUntil((DEV ? Promise.resolve() : precache()).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  // 删掉旧版本的外壳（只删 lz-shell- 开头的，别的缓存不碰），再接管已经开着的页面。
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('lz-shell-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const key = DEV ? null : shellKey(e.request);
  if (!key) return;   // 不是外壳：不拦，照常走网络（数据文件、别的网站都从这里放过）
  // 先用手机上存的（秒开、没网也行）；缓存里没有或读不出来，再去网上取。
  e.respondWith(caches.open(CACHE).then(c => c.match(key)).catch(() => null).then(hit => hit || fetch(e.request)));
});

// 外壳先全部取到手，再一起写进缓存：有一个取不到就整次作废，旧版本照常用、下次打开再试，不会半新半旧。
async function precache() {
  const got = await Promise.all(SHELL.map(async f => {
    // cache:'reload' 绕过浏览器自己的缓存；再加 ?v=版本，让 GitHub Pages 前面的 CDN 也给新的，
    // 免得刚发布那一会儿拿到新 sw.js 配旧 app.js。
    const r = await fetch(new Request(new URL(f + '?v=' + VERSION, HERE), {cache: 'reload'}));
    if (!r.ok) throw new Error('外壳文件取不到：' + f + '（' + r.status + '）');
    // 当场读完、重新包一份再等别的：实测 Chromium 里没读完的回应攒到 3 个，后面的请求就发不出去，安装一直卡着；
    // 重新包的回应也去掉了“跳转过”的标记，Chrome 不许拿跳转过的回应回答“打开页面”。
    return [f, new Response(await r.blob(), {status: r.status, statusText: r.statusText, headers: r.headers})];
  }));
  const c = await caches.open(CACHE);
  await Promise.all(got.map(([f, r]) => c.put(f, r)));
}

// 这个请求用哪一份外壳回答；null = 不拦。
function shellKey(req) {
  if (req.method !== 'GET') return null;
  const url = new URL(req.url);
  if (url.origin !== HERE.origin || !url.pathname.startsWith(HERE.pathname)) return null;
  const rel = url.pathname.slice(HERE.pathname.length);   // 只看路径，查询串（?t=…）不管
  if (rel === '' || rel === 'index.html') return req.mode === 'navigate' ? 'index.html' : (rel || './');
  return SHELL.includes(rel) ? rel : null;   // 打开 m.json、d/… 之类的页面也放过，方便直接查看
}
