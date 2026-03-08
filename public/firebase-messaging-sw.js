importScripts('https://www.gstatic.com/firebasejs/10.10.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.10.0/firebase-messaging-compat.js');

// Parse query parameters to get config
const urlParams = new URLSearchParams(self.location.search);
const apiKey = urlParams.get('apiKey') || "AIzaSyAiYIjjUQWY5QrMwHeSHyGuWSbZzeUeB-U";
const projectId = urlParams.get('projectId') || "pianificazione-settimana";
const messagingSenderId = urlParams.get('messagingSenderId') || "337752358600";
const appId = urlParams.get('appId') || "1:337752358600:web:72e18f37536b07b7abaffd";

firebase.initializeApp({
  apiKey: apiKey,
  authDomain: `${projectId}.firebaseapp.com`,
  projectId: projectId,
  storageBucket: `${projectId}.firebasestorage.app`,
  messagingSenderId: messagingSenderId,
  appId: appId
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png', // Small icon for Android notification bar
    data: payload.data
  };

  // Set app badge if supported
  if (payload.data && payload.data.badge && 'setAppBadge' in navigator) {
    const badgeCount = parseInt(payload.data.badge, 10);
    if (!isNaN(badgeCount)) {
      navigator.setAppBadge(badgeCount).catch(error => {
        console.error('Error setting app badge:', error);
      });
    }
  }

  self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener('notificationclick', function(event) {
  console.log('[firebase-messaging-sw.js] Notification click Received.', event);
  event.notification.close();

  // Clear app badge
  if ('clearAppBadge' in navigator) {
    navigator.clearAppBadge().catch(error => {
      console.error('Error clearing app badge:', error);
    });
  }

  // Open the app
  event.waitUntil(
    clients.matchAll({type: 'window'}).then(function(windowClients) {
      // Check if there is already a window/tab open with the target URL
      for (var i = 0; i < windowClients.length; i++) {
        var client = windowClients[i];
        if (client.url === '/' && 'focus' in client) {
          return client.focus();
        }
      }
      // If not, open a new window/tab
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});

// Fetch handler to satisfy PWA requirements
self.addEventListener('fetch', (event) => {
  // We don't need to do anything special here for now, 
  // but a fetch handler is required for PWA installation criteria in some browsers.
  // We can add caching logic here later if needed.
});