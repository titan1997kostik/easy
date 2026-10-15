/* Easy App Sync offline app-shell cache.
 * Place this file in the same directory/origin as the application HTML.
 * Firebase API/database responses are deliberately NOT cached; only the app shell and static assets are.
 */
'use strict';
var APP_CACHE = 'easy-app-sync-shell-v4';
var RUNTIME_CACHE = 'easy-app-sync-static-v4';

self.addEventListener('install', function(event) {
  event.waitUntil(
    Promise.all([caches.open(APP_CACHE), caches.open(RUNTIME_CACHE)]).then(function(cacheSet) {
      var appCache = cacheSet[0];
      var staticCache = cacheSet[1];
      var appShellPromise = self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clients) {
        return Promise.all(clients.map(function(client) {
          try {
            return fetch(client.url, { cache: 'reload' }).then(function(response) {
              if (response && response.ok) return appCache.put(client.url, response.clone()).catch(function() {});
            }).catch(function() {});
          } catch (error) { return Promise.resolve(); }
        }));
      });
      // Warm the essential external SDK scripts in the same cache used by the fetch handler.
      var sdkUrls = [
        'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
        'https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js',
        'https://cdn.jsdelivr.net/npm/mqtt@5.10.4/dist/mqtt.min.js'
      ];
      var sdkPromise = Promise.all(sdkUrls.map(function(url) {
        return fetch(url).then(function(response) {
          if (response && response.ok) return staticCache.put(url, response.clone()).catch(function() {});
        }).catch(function() {});
      }));
      return Promise.all([appShellPromise, sdkPromise]).then(function() { return self.skipWaiting(); });
    })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(key) {
        return (key.indexOf('easy-app-sync-shell-') === 0 && key !== APP_CACHE) ||
               (key.indexOf('easy-app-sync-static-') === 0 && key !== RUNTIME_CACHE);
      }).map(function(key) { return caches.delete(key); }));
    }).then(function() { return self.clients.claim(); })
  );
});

function isCacheableStatic(request, url) {
  if (request.method !== 'GET') return false;
  var destination = request.destination || '';
  var staticDestination = ['script', 'style', 'font', 'image', 'worker', 'manifest'].indexOf(destination) !== -1;
  var allowedCrossOriginHost = url.origin !== self.location.origin &&
    (url.hostname === 'www.gstatic.com' || url.hostname === 'cdn.jsdelivr.net' ||
     url.hostname === 'unpkg.com' || url.hostname === 'cdnjs.cloudflare.com' ||
     url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com');
  return staticDestination && (url.origin === self.location.origin || allowedCrossOriginHost);
}

function cacheStaticResponse(request, response) {
  if (!response || (!response.ok && response.type !== 'opaque')) return Promise.resolve();
  return caches.open(RUNTIME_CACHE).then(function(cache) {
    return cache.put(request, response.clone()).catch(function() {});
  });
}

self.addEventListener('fetch', function(event) {
  var request = event.request;
  if (!request || request.method !== 'GET') return;
  var url;
  try { url = new URL(request.url); } catch (error) { return; }

  // Cache the app document under its exact URL so a reload works offline after the first online visit.
  if (url.origin === self.location.origin && request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(function(response) {
        if (!response || !response.ok) return response;
        return caches.open(APP_CACHE).then(function(cache) {
          var writes = [cache.put(request, response.clone()).catch(function() {})];
          try {
            var canonical = new Request(url.origin + url.pathname);
            writes.push(cache.put(canonical, response.clone()).catch(function() {}));
          } catch (error) {}
          return Promise.all(writes).then(function() { return response; });
        }).catch(function() { return response; });
      }).catch(function() {
        return caches.open(APP_CACHE).then(function(cache) {
          return cache.match(request).then(function(hit) {
            if (hit) return hit;
            var plainUrl = new URL(request.url); plainUrl.search = '';
            return cache.match(new Request(plainUrl.href)).then(function(plainHit) {
              if (plainHit) return plainHit;
              return cache.match(new URL('./', self.registration.scope).href).then(function(rootHit) {
                if (rootHit) return rootHit;
                return cache.match(new URL('index.html', self.registration.scope).href);
              });
            });
          });
        });
      })
    );
    return;
  }

  // Static scripts (Firebase SDK, MQTT library) are cached after being fetched online.
  // This intentionally excludes firebaseio/database API requests and all dynamic writes.
  if (isCacheableStatic(request, url)) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(function(cache) {
        return cache.match(request).then(function(cached) {
          var network = fetch(request).then(function(response) {
            return cacheStaticResponse(request, response).then(function() { return response; });
          }).catch(function() { return cached || Promise.reject(new Error('Static asset unavailable offline')); });
          return cached || network;
        });
      })
    );
  }
});
