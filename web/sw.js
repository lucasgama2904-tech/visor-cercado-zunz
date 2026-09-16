// Service worker del visor de tramos. En obra no siempre hay señal: una vez
// que el modelo se abrió una vez con datos, tiene que seguir sirviendo desde
// caché sin conexión.
//
// Subí la versión del cache cada vez que reemplaces modelo.frag o
// tramos.json en producción, para forzar la actualización.
const CACHE = "visor-cercado-v5";

const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.bundle.js",
  "./fragments-worker.mjs",
  "./modelo.frag",
  "./tramos.json",
  "./manifest.webmanifest",
  "./LOGO.svg",
];

// Si el servidor de origen redirige (ej. "/index.html" -> "/index"), la
// Response que llega tiene response.redirected = true. Cachear esa Response
// tal cual rompe la navegación después: Chrome no sirve una Response
// redirigida para un pedido "navigate" ("Response served by service worker
// has redirections"). Por eso se reconstruye una Response limpia antes de
// guardarla.
async function fetchAndStripRedirect(url) {
  const response = await fetch(url, { redirect: "follow", cache: "reload" });
  if (!response.redirected) return response;
  const body = await response.blob();
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        Promise.all(
          PRECACHE_URLS.map((url) =>
            fetchAndStripRedirect(url).then((res) => cache.put(url, res)),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  if (new URL(request.url).origin !== self.location.origin) return;

  // Navegación (abrir la página, con o sin ?p=código): siempre servir el
  // index.html cacheado, ignorando la query string.
  if (request.mode === "navigate") {
    event.respondWith(
      caches
        .match("./index.html")
        .then((cached) => cached || fetch(request))
        .catch(() => caches.match("./index.html")),
    );
    return;
  }

  // Resto de recursos: cache primero, con actualización en segundo plano.
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      const network = fetch(request)
        .then(async (response) => {
          if (response && response.ok) {
            const toCache = response.redirected
              ? new Response(await response.clone().blob(), {
                  status: response.status,
                  statusText: response.statusText,
                  headers: response.headers,
                })
              : response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, toCache));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
