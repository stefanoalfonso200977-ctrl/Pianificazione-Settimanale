import "dotenv/config";
import express from "express";
import { GoogleGenAI } from "@google/genai";
import cron from "node-cron";
import nodemailer from "nodemailer";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, Timestamp, query, where } from "firebase/firestore";
import { getApps, initializeApp as initAdmin, cert } from 'firebase-admin/app';
import { getMessaging as getAdminMessaging } from 'firebase-admin/messaging';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';

const app = express();

// Middleware
app.use(express.json({ limit: '50mb' }));

// --- Firebase Setup ---
const firebaseConfig = {
  apiKey: "AIzaSyAiYIjjUQWY5QrMwHeSHyGuWSbZzeUeB-U",
  authDomain: "pianificazione-settimana.firebaseapp.com",
  projectId: "pianificazione-settimana",
  storageBucket: "pianificazione-settimana.firebasestorage.app",
  messagingSenderId: "337752358600",
  appId: "1:337752358600:web:72e18f37536b07b7abaffd"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// --- Firebase Admin Setup (for Push Notifications) ---
const initFirebaseAdmin = async () => {
  if (getApps().length > 0) return true; // Already initialized

  let serviceAccount: any = null;

  // 1. Try Environment Variable
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      let data = process.env.FIREBASE_SERVICE_ACCOUNT;
      if (data.startsWith("'") || data.startsWith("\"")) {
        data = data.substring(1, data.length - 1);
      }
      // Fix escaped newlines which often happen in Vercel env vars
      data = data.replace(/\\n/g, '\n');
      serviceAccount = JSON.parse(data);
    } catch (e) {
      console.error("Env Service Account parse error:", e);
    }
  }

  // 2. Try Settings from Firestore (if env var failed or missing)
  if (!serviceAccount) {
    try {
      const settings = await getSettingsFromFirebase();
      if (settings.serviceAccountJson) {
        serviceAccount = JSON.parse(settings.serviceAccountJson);
        console.log("Loaded Service Account from Firestore Settings");
      }
    } catch (e) {
      console.error("Settings Service Account parse error:", e);
    }
  }

  if (serviceAccount) {
    try {
      initAdmin({
        credential: cert(serviceAccount)
      });
      console.log("Firebase Admin initialized successfully");
      return true;
    } catch (e) {
      console.error("Firebase Admin init error:", e);
    }
  }
  return false;
};

// Initialize on startup if possible
initFirebaseAdmin();

// In-memory cache for settings (fallback if Firebase fails)
let cachedSettings: any = {};

const getSettingsFromFirebase = async () => {
  try {
    let firebaseSettings = {};
    if (getApps().length > 0) {
      const adminDb = getAdminFirestore();
      const docSnap = await adminDb.collection("tasks").doc("_settings_").get();
      if (docSnap.exists) {
        firebaseSettings = docSnap.data() || {};
      }
    } else {
      const docRef = doc(db, "tasks", "_settings_");
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        firebaseSettings = docSnap.data() || {};
      }
    }
    
    // Merge with cache
    // CRITICAL: We prioritize cachedSettings (local memory) over firebaseSettings (DB) 
    // because cachedSettings might contain optimistic updates that failed to save to DB.
    // If we let Firebase overwrite cache, we lose the user's unsaved changes in this session.
    if (Object.keys(firebaseSettings).length > 0) {
      cachedSettings = { ...firebaseSettings, ...cachedSettings };
    }
    
    return cachedSettings;
  } catch (e: any) {
    console.error("Error fetching settings from Firebase:", e);
    // Return cache on error
    return cachedSettings;
  }
};

const saveSettingsToFirebase = async (settings: any) => {
  // Update cache immediately
  cachedSettings = { ...cachedSettings, ...settings };
  
  try {
    const keyMasked = settings.geminiApiKey ? `${settings.geminiApiKey.substring(0, 5)}...` : "NONE";
    console.log(`[SETTINGS] Saving to Firebase... (API Key: ${keyMasked})`);
    if (getApps().length > 0) {
      const adminDb = getAdminFirestore();
      await adminDb.collection("tasks").doc("_settings_").set(settings, { merge: true });
      console.log("[SETTINGS] Saved successfully via Admin SDK");
    } else {
      console.log("[SETTINGS] Admin SDK not initialized, falling back to Client SDK");
      if (process.env.VERCEL) {
        console.warn("[SETTINGS] Running on Vercel without FIREBASE_SERVICE_ACCOUNT. This may fail due to permissions.");
      }
      const docRef = doc(db, "tasks", "_settings_");
      await setDoc(docRef, settings, { merge: true });
      console.log("[SETTINGS] Saved successfully via Client SDK");
    }
  } catch (e: any) {
    console.error("Error saving settings to Firebase:", e);
    // We don't throw here anymore to allow the in-memory cache to work for the session
    console.warn("[SETTINGS] Falling back to in-memory storage for this session.");
  }
};

// --- Email Logic ---
const sendEmail = async (to: string, subject: string, html: string) => {
  const settings = await getSettingsFromFirebase();
  
  if (!settings.smtpHost || !settings.smtpUser || !settings.smtpPass) {
    console.log("--- EMAIL SIMULATION (Missing SMTP Settings) ---");
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log("-----------------------------------------------");
    return { success: true, simulated: true };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: settings.smtpHost,
      port: parseInt(settings.smtpPort) || 587,
      secure: parseInt(settings.smtpPort) === 465,
      auth: {
        user: settings.smtpUser,
        pass: settings.smtpPass,
      },
      connectionTimeout: 10000, // 10 seconds
      greetingTimeout: 10000,
      socketTimeout: 10000,
    });

    console.log(`[EMAIL] Attempting to send test email to ${to} via ${settings.smtpHost}...`);
    
    await transporter.sendMail({
      from: `"Agente Pianificazione" <${settings.smtpUser}>`,
      to,
      subject,
      html,
    });
    
    console.log(`[EMAIL] Test email sent successfully to ${to}`);
    return { success: true };
  } catch (error: any) {
    console.error("Email error:", error);
    return { success: false, error: error.message };
  }
};

// --- Cron Job (8:00 AM Rome Time) ---
// Only use node-cron if NOT on Vercel (Vercel uses vercel.json crons)
if (!process.env.VERCEL) {
  cron.schedule("0 8 * * *", async () => {
    const now = new Date().toLocaleString("it-IT", { timeZone: "Europe/Rome" });
    console.log(`[CRON] Triggered at ${now} (Rome Time)`);
    await checkAndNotify();
  }, {
    timezone: "Europe/Rome"
  });
}

const checkAndNotify = async () => {
  const settings = await getSettingsFromFirebase();
  if (!settings.email) {
    console.log("No notification email configured.");
    return { success: false, message: "Email non configurata nelle impostazioni." };
  }

  let tasks: any[] = [];
  try {
    const snapshot = await getDocs(collection(db, "tasks"));
    tasks = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(doc => doc.id !== "_settings_");
  } catch (e: any) {
    console.error("Error fetching tasks for cron:", e);
    return { success: false, message: "Errore nel recupero delle attività: " + e.message };
  }

  // Use a fixed date reference for "today" in Rome time
  const now = new Date();
  const todayStr = now.toLocaleDateString("en-CA", { timeZone: "Europe/Rome" }); // YYYY-MM-DD
  const today = new Date(todayStr);
  today.setHours(0, 0, 0, 0);

  const expiringTasks = tasks.filter((task: any) => {
    if (task.status === "completed" || !task.deadline) return false;
    
    // task.deadline is expected to be YYYY-MM-DD
    const deadline = new Date(task.deadline);
    deadline.setHours(0, 0, 0, 0);
    
    const diffTime = deadline.getTime() - today.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
    
    return diffDays >= 0 && diffDays <= 3;
  });

  const baseUrl = process.env.APP_URL || "https://ais-dev-urhce4mvgiy7clmu5iufas-422200347277.europe-west2.run.app";
  const confirmLink = `${baseUrl}/api/confirm-view?email=${encodeURIComponent(settings.email)}`;

  let html = "";
  if (expiringTasks.length === 0) {
    console.log(`[CRON] No expiring tasks found for ${settings.email}. Sending empty report.`);
    html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
        <h2 style="color: #212E42;">Riepilogo Attività</h2>
        <p>Non ci sono attività in scadenza per i prossimi tre giorni.</p>
        <p style="font-size: 12px; color: #999; margin-top: 40px; border-top: 1px solid #eee; pt: 10px;">
          Questa è una notifica automatica inviata dall'Agente Pianificazione.
        </p>
      </div>
    `;
  } else {
    console.log(`[CRON] Found ${expiringTasks.length} expiring tasks. Sending email to ${settings.email}...`);
    const tasksHtml = expiringTasks.map((t: any) => {
      const deadline = new Date(t.deadline);
      const isToday = deadline.getTime() === today.getTime();
      const color = isToday ? "red" : "black";
      const alert = isToday ? "<b style='color: red;'>[SCADENZA OGGI!]</b> " : "";
      
      return `<li style="color: ${color}; margin-bottom: 10px;">
        ${alert}<strong>${t.title}</strong> - Scadenza: ${t.deadline}
      </li>`;
    }).join("");

    html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
        <h2 style="color: #212E42;">Riepilogo Attività in Scadenza</h2>
        <p>Ciao, ecco le attività che scadono nei prossimi 3 giorni:</p>
        <ul style="line-height: 1.6;">${tasksHtml}</ul>
        <p>Per favore, conferma di aver preso visione di queste attività cliccando il pulsante qui sotto:</p>
        <div style="text-align: center; margin-top: 30px;">
          <a href="${confirmLink}" style="display: inline-block; padding: 12px 24px; background-color: #212E42; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">Conferma Visione</a>
        </div>
        <p style="font-size: 12px; color: #999; margin-top: 40px; border-top: 1px solid #eee; pt: 10px;">
          Questa è una notifica automatica inviata dall'Agente Pianificazione.
        </p>
      </div>
    `;
  }

  const emailResult = await sendEmail(settings.email, "Agente Pianificazione: Attività in Scadenza", html);
  
  let pushResult = { success: false, count: 0, error: null as any };
  // --- Send Push Notifications ---
  try {
    // Ensure Admin SDK is ready
    if (getApps().length === 0) {
       await initFirebaseAdmin();
    }

    const tokensSnapshot = await getDocs(collection(db, "push_tokens"));
    const tokens = tokensSnapshot.docs.map(doc => doc.data().token);
    
    if (tokens.length > 0 && getApps().length > 0) {
      const message = {
        notification: {
          title: "Attività in Scadenza!",
          body: `Hai ${expiringTasks.length} attività che scadono a breve.`
        },
        data: {
          badge: expiringTasks.length.toString(),
          url: "/"
        },
        tokens: tokens,
      };

      const response = await getAdminMessaging().sendEachForMulticast(message);
      console.log(`[PUSH] Successfully sent ${response.successCount} messages; ${response.failureCount} failed.`);
      pushResult = { success: true, count: response.successCount, error: null };
      
      // Optional: Cleanup invalid tokens
      if (response.failureCount > 0) {
        const failedTokens: string[] = [];
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            const errorCode = resp.error?.code;
            console.error(`[PUSH] Error sending to token ${tokens[idx]}:`, resp.error);
            if (errorCode === 'messaging/registration-token-not-registered' || errorCode === 'messaging/invalid-registration-token') {
              console.log(`[PUSH] Removing invalid token: ${tokens[idx]}`);
              failedTokens.push(tokens[idx]);
            }
          }
        });

        if (failedTokens.length > 0) {
          try {
            await Promise.all(failedTokens.map(token => deleteDoc(doc(db, "push_tokens", token))));
            console.log(`[PUSH] Removed ${failedTokens.length} invalid tokens.`);
          } catch (cleanupError) {
            console.error("[PUSH] Error removing invalid tokens:", cleanupError);
          }
        }
      }
    } else {
        if (getApps().length === 0) {
            pushResult = { success: false, count: 0, error: "Admin SDK non inizializzato (Manca FIREBASE_SERVICE_ACCOUNT)" };
        } else {
            pushResult = { success: false, count: 0, error: "Nessun dispositivo registrato per le notifiche (Token non trovati)" };
        }
    }
  } catch (e) {
    console.error("[PUSH] Error sending notifications:", e);
    pushResult = { success: false, count: 0, error: e };
  }

  return { 
    success: emailResult.success, 
    message: emailResult.success ? "Email inviata con successo." : "Errore invio email: " + emailResult.error,
    taskCount: expiringTasks.length,
    simulated: (emailResult as any).simulated,
    push: pushResult
  };
};

// Helper to get a valid API Key
const getValidApiKey = async () => {
  const knownFirebaseKey = "AIzaSyAiYIjjUQWY5QrMwHeSHyGuWSbZzeUeB-U";
  
  // 0. Check Firebase Settings (User configured via UI)
  try {
    const settings = await getSettingsFromFirebase();
    if (settings.geminiApiKey) {
      const cleanKey = settings.geminiApiKey.trim();
      if (cleanKey && cleanKey !== knownFirebaseKey && cleanKey.length > 20) {
        console.log(`[GEMINI] Using API Key from Settings (starts with ${cleanKey.substring(0, 8)}...)`);
        return cleanKey;
      } else {
        console.log(`[GEMINI] Settings has a key (${cleanKey.substring(0, 5)}...) but it looks invalid or is the default Firebase key.`);
      }
    } else {
      console.log("[GEMINI] No API Key found in Settings.");
    }
  } catch (e) {
    console.warn("[GEMINI] Failed to fetch settings for API Key check", e);
  }

  // 1. Check specific prioritized keys first
  const specificKeys = [
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.MY_GEMINI_KEY,
    process.env.API_KEY
  ];
  
  for (let key of specificKeys) {
    if (!key) continue;
    const cleanKey = key.replace(/^["']|["']$/g, '').trim();
    if (cleanKey === knownFirebaseKey) continue;
    
    if (cleanKey.startsWith("AIza") && cleanKey.length > 20) {
      console.log(`[GEMINI] Using API Key from Environment (starts with ${cleanKey.substring(0, 8)}...)`);
      return cleanKey;
    }
  }

  console.log("[GEMINI] No valid API Key found in Environment or Settings.");
  return "";
};

// --- API Routes ---

app.get("/api/health", async (req, res) => {
  const apiKey = await getValidApiKey();
  res.json({ 
    status: "ok", 
    env: {
      hasGemini: !!apiKey,
      region: process.env.VERCEL_REGION || "unknown"
    }
  });
});

// Settings
app.get("/api/settings", async (req, res) => {
  const settings = await getSettingsFromFirebase();
  res.json(settings);
});

app.post("/api/settings", async (req, res) => {
  try {
    await saveSettingsToFirebase(req.body);
    res.json({ success: true });
  } catch (error: any) {
    console.error("Settings Save Error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/test-email", async (req, res) => {
  const { email } = req.body;
  const result = await sendEmail(email, "Test Agente Pianificazione", "<p>Questa è una email di test.</p>");
  res.json(result);
});

app.post("/api/test-push", async (req, res) => {
  try {
    // Ensure Admin SDK is ready
    const adminInitialized = await initFirebaseAdmin();
    if (!adminInitialized) {
      return res.status(500).json({ 
        success: false, 
        error: "Admin SDK non inizializzato. Configura FIREBASE_SERVICE_ACCOUNT nelle impostazioni o variabili d'ambiente." 
      });
    }

    const tokensSnapshot = await getDocs(collection(db, "push_tokens"));
    const tokens = tokensSnapshot.docs.map(doc => doc.data().token);
    
    if (tokens.length === 0) {
      return res.json({ success: false, error: "Nessun dispositivo registrato (Token non trovati)." });
    }

    const message = {
      notification: {
        title: "Test Notifica Push",
        body: "Se leggi questo, le notifiche funzionano!"
      },
      tokens: tokens,
    };

    const response = await getAdminMessaging().sendEachForMulticast(message);
    
    // Cleanup invalid tokens
    if (response.failureCount > 0) {
      const failedTokens: string[] = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const errorCode = resp.error?.code;
          if (errorCode === 'messaging/registration-token-not-registered' || errorCode === 'messaging/invalid-registration-token') {
            failedTokens.push(tokens[idx]);
          }
        }
      });

      if (failedTokens.length > 0) {
        await Promise.all(failedTokens.map(token => deleteDoc(doc(db, "push_tokens", token))));
      }
    }

    res.json({ 
      success: true, 
      count: response.successCount, 
      failures: response.failureCount 
    });

  } catch (error: any) {
    console.error("Test Push Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.all("/api/cron", async (req, res) => {
  // Verify it's a Vercel Cron trigger or a manual POST
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const isManualPost = req.method === 'POST';

  if (!isVercelCron && !isManualPost) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const result = await checkAndNotify();
  res.json(result);
});

app.get("/api/confirm-view", (req, res) => {
  console.log(`User ${req.query.email} confirmed view at ${new Date().toISOString()}`);
  res.send("<h1>Conferma ricevuta!</h1><p>Grazie per aver confermato la visione delle attività.</p>");
});

// Gemini Integration
app.post("/api/gemini/breakdown", async (req, res) => {
  const { taskDescription, files } = req.body;
  
  try {
    const apiKey = await getValidApiKey();

    if (!apiKey) {
      console.error("[GEMINI] No valid API Key found in environment variables or settings");
      return res.status(401).json({ error: "API Key mancante o non valida. Configurala nelle Impostazioni." });
    } else {
      console.log(`[GEMINI] Using API Key starting with: ${apiKey.substring(0, 4)}...`);
    }

    const ai = new GoogleGenAI({ apiKey });

    let prompt = `Sei un assistente esperto di pianificazione. 
    Analizza questa attività: "${taskDescription}".
    Scomponila in 3-5 sotto-task concreti e azionabili.
    Restituisci SOLO un array JSON di stringhe, senza markdown o altro testo.
    Esempio: ["Comprare vernice", "Coprire mobili", "Dipingere parete"]`;

    const parts: any[] = [{ text: prompt }];

    if (files && Array.isArray(files)) {
      for (const file of files) {
        if (file.mimeType.startsWith('image/')) {
          const base64Data = file.data.split(',')[1];
          parts.push({
            inlineData: {
              data: base64Data,
              mimeType: file.mimeType
            }
          });
        }
      }
    }

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts }
    });
    
    let text = response.text || "";
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    
    const subtasks = JSON.parse(text);
    res.json({ subtasks });
  } catch (error: any) {
    // Handle Quota Exceeded Error gracefully
    if (error.message?.includes("429") || error.message?.includes("quota") || error.message?.includes("RESOURCE_EXHAUSTED") || error.status === 429) {
      console.warn("[GEMINI] Quota exceeded (429).");
      return res.status(429).json({ 
        error: "Quota API Gemini esaurita. Il piano gratuito ha dei limiti giornalieri. Riprova più tardi o usa una chiave API diversa nelle Impostazioni." 
      });
    }

    console.error("Gemini Error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/gemini/parse-task", async (req, res) => {
  const { text, currentDate, files } = req.body;
  
  try {
    const apiKey = await getValidApiKey();

    if (!apiKey) {
      console.error("[GEMINI] No valid API Key found in environment variables or settings");
      return res.status(401).json({ error: "API Key mancante o non valida. Configurala nelle Impostazioni." });
    } else {
      console.log(`[GEMINI] Using API Key starting with: ${apiKey.substring(0, 4)}...`);
    }

    const ai = new GoogleGenAI({ apiKey });

    let prompt = `Sei un assistente esperto di pianificazione.
    Oggi è il ${currentDate}.
    
    Analizza questa richiesta dell'utente: "${text}"

    Il tuo obiettivo è strutturare questa richiesta in un'attività chiara e azionabile.

    1. Estrai un TITOLO breve e chiaro.
    2. Scrivi una DESCRIZIONE dettagliata. Se l'utente chiede informazioni (es. "Cerca X", "Come fare Y"), usa i tuoi strumenti per cercare e includi il risultato nella descrizione.
    3. Identifica una SCADENZA (YYYY-MM-DD). Se non specificata, usa la data di oggi.
    4. IMPORTANTE: Se l'attività è complessa (es. "Organizzare viaggio", "Scrivere relazione", "Dipingere casa"), SCOMPONILA in 3-5 sotto-task concreti e sequenziali. Se è semplice, lascia l'array vuoto.

    Restituisci SOLO un oggetto JSON con questa struttura esatta, senza markdown:
    {
      "title": "Titolo dell'attività",
      "description": "Descrizione completa o risultato ricerca",
      "deadline": "YYYY-MM-DD",
      "subtasks": ["Sotto-task 1", "Sotto-task 2", "Sotto-task 3"] 
    }`;

    const parts: any[] = [{ text: prompt }];

    if (files && Array.isArray(files)) {
      for (const file of files) {
        if (file.mimeType.startsWith('image/')) {
          const base64Data = file.data.split(',')[1];
          parts.push({
            inlineData: {
              data: base64Data,
              mimeType: file.mimeType
            }
          });
        }
      }
    }

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts }
    });
    
    let responseText = response.text || "";
    responseText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    
    const taskData = JSON.parse(responseText);
    res.json(taskData);
  } catch (error: any) {
    // Handle Quota Exceeded Error gracefully
    if (error.message?.includes("429") || error.message?.includes("quota") || error.message?.includes("RESOURCE_EXHAUSTED") || error.status === 429) {
      console.warn("[GEMINI] Quota exceeded (429).");
      return res.status(429).json({ 
        error: "Quota API Gemini esaurita. Il piano gratuito ha dei limiti giornalieri. Riprova più tardi o usa una chiave API diversa nelle Impostazioni." 
      });
    }

    console.error("Gemini Parse Error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/gemini/research", async (req, res) => {
  const { text } = req.body;
  
  try {
    const apiKey = await getValidApiKey();

    if (!apiKey) {
      console.error("[GEMINI] No valid API Key found in environment variables or settings");
      return res.status(401).json({ error: "API Key mancante o non valida. Configurala nelle Impostazioni." });
    } else {
      console.log(`[GEMINI] Using API Key starting with: ${apiKey.substring(0, 4)}...`);
    }

    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Esegui una ricerca approfondita su: "${text}". 
      Fornisci un riepilogo dettagliato, strutturato e facile da leggere. 
      Usa il formato Markdown per la risposta.`,
      config: { 
        tools: [{ googleSearch: {} }] 
      }
    });
    
    res.json({ content: response.text || "" });
  } catch (error: any) {
    // Handle Quota Exceeded Error gracefully
    if (error.message?.includes("429") || error.message?.includes("quota") || error.message?.includes("RESOURCE_EXHAUSTED") || error.status === 429) {
      console.warn("[GEMINI] Quota exceeded (429).");
      return res.status(429).json({ 
        error: "Quota API Gemini esaurita. Il piano gratuito ha dei limiti giornalieri. Riprova più tardi o usa una chiave API diversa nelle Impostazioni." 
      });
    }

    console.error("Gemini Research Error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/debug/env", async (req, res) => {
  const settings = await getSettingsFromFirebase();
  const apiKey = await getValidApiKey();
  res.json({
    hasGemini: !!apiKey,
    hasSmtp: !!settings.smtpHost,
    hasServiceAccount: !!process.env.FIREBASE_SERVICE_ACCOUNT
  });
});

export default app;
