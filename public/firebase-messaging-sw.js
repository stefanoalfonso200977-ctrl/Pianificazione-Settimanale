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
    icon: '/icon-192.png'
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});