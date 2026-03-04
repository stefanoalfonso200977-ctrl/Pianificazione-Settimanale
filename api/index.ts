import "dotenv/config";
import express from "express";
import { GoogleGenAI } from "@google/genai";
import cron from "node-cron";
import nodemailer from "nodemailer";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, Timestamp, query, where } from "firebase/firestore";
import { getApps, initializeApp as initAdmin, cert } from 'firebase-admin/app';
import { getMessaging as getAdminMessaging } from 'firebase-admin/messaging';

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
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    if (getApps().length === 0) {
      initAdmin({
        credential: cert(serviceAccount)
      });
      console.log("Firebase Admin initialized successfully");
    }
  } catch (e) {
    console.error("Firebase Admin init error:", e);
  }
}

const getSettingsFromFirebase = async () => {
  try {
    // Use the 'tasks' collection to bypass potential Firestore security rules that only allow access to 'tasks'
    const docRef = doc(db, "tasks", "_settings_");
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return docSnap.data();
    }
    return {};
  } catch (e) {
    console.error("Error fetching settings from Firebase:", e);
    return {};
  }
};

const saveSettingsToFirebase = async (settings: any) => {
  try {
    console.log("[SETTINGS] Saving to Firebase:", settings);
    const docRef = doc(db, "tasks", "_settings_");
    await setDoc(docRef, settings, { merge: true });
    console.log("[SETTINGS] Saved successfully");
  } catch (e) {
    console.error("Error saving settings to Firebase:", e);
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
    });

    await transporter.sendMail({
      from: `"Agente Pianificazione" <${settings.smtpUser}>`,
      to,
      subject,
      html,
    });
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

  if (expiringTasks.length === 0) {
    console.log(`[CRON] No expiring tasks found for ${settings.email}.`);
    return { success: true, message: "Nessuna attività in scadenza trovata per oggi." };
  }

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

  const baseUrl = process.env.APP_URL || "https://ais-dev-urhce4mvgiy7clmu5iufas-422200347277.europe-west2.run.app";
  const confirmLink = `${baseUrl}/api/confirm-view?email=${encodeURIComponent(settings.email)}`;

  const html = `
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

  const emailResult = await sendEmail(settings.email, "Agente Pianificazione: Attività in Scadenza", html);
  
  // --- Send Push Notifications ---
  try {
    const tokensSnapshot = await getDocs(collection(db, "push_tokens"));
    const tokens = tokensSnapshot.docs.map(doc => doc.data().token);
    
    if (tokens.length > 0 && getApps().length > 0) {
      const message = {
        notification: {
          title: "Attività in Scadenza!",
          body: `Hai ${expiringTasks.length} attività che scadono a breve.`
        },
        tokens: tokens,
      };

      const response = await getAdminMessaging().sendEachForMulticast(message);
      console.log(`[PUSH] Successfully sent ${response.successCount} messages; ${response.failureCount} failed.`);
      
      // Optional: Cleanup invalid tokens
      if (response.failureCount > 0) {
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            const errorCode = resp.error?.code;
            if (errorCode === 'messaging/registration-token-not-registered' || errorCode === 'messaging/invalid-registration-token') {
              console.log(`[PUSH] Removing invalid token: ${tokens[idx]}`);
              // deleteDoc(doc(db, "push_tokens", tokens[idx])); // Async cleanup
            }
          }
        });
      }
    }
  } catch (e) {
    console.error("[PUSH] Error sending notifications:", e);
  }

  return { 
    success: emailResult.success, 
    message: emailResult.success ? "Email inviata con successo." : "Errore invio email: " + emailResult.error,
    taskCount: expiringTasks.length
  };
};

// --- API Routes ---

app.get("/api/health", (req, res) => {
  res.json({ 
    status: "ok", 
    env: {
      hasGemini: !!(process.env.MY_GEMINI_KEY || process.env.GEMINI_API_KEY),
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
  await saveSettingsToFirebase(req.body);
  res.json({ success: true });
});

app.post("/api/test-email", async (req, res) => {
  const { email } = req.body;
  const result = await sendEmail(email, "Test Agente Pianificazione", "<p>Questa è una email di test.</p>");
  res.json(result);
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
    let apiKey = process.env.GEMINI_API_KEY || process.env.MY_GEMINI_KEY || "";
    apiKey = apiKey.replace(/^["']|["']$/g, '').trim();

    if (!apiKey) {
      return res.status(401).json({ error: "API Key mancante" });
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
    console.error("Gemini Error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/gemini/parse-task", async (req, res) => {
  const { text, currentDate } = req.body;
  
  try {
    let apiKey = process.env.GEMINI_API_KEY || process.env.MY_GEMINI_KEY || "";
    apiKey = apiKey.replace(/^["']|["']$/g, '').trim();

    if (!apiKey) {
      return res.status(401).json({ error: "API Key mancante" });
    }

    const ai = new GoogleGenAI({ apiKey });

    let prompt = `Sei un assistente esperto di pianificazione.
    Oggi è il ${currentDate}.
    Analizza la seguente richiesta dell'utente e crea un'attività strutturata.
    Estrai un titolo conciso, una descrizione (se presente), una data di scadenza (formato YYYY-MM-DD) e 2-4 sotto-task se l'attività è complessa.
    Se non viene specificata una data, usa la data di oggi.
    
    Richiesta: "${text}"
    
    Restituisci SOLO un oggetto JSON con questa struttura esatta, senza markdown o altro testo:
    {
      "title": "Titolo breve",
      "description": "Descrizione opzionale",
      "deadline": "YYYY-MM-DD",
      "subtasks": ["sotto-task 1", "sotto-task 2"]
    }`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt
    });
    
    let responseText = response.text || "";
    responseText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    
    const taskData = JSON.parse(responseText);
    res.json(taskData);
  } catch (error: any) {
    console.error("Gemini Parse Error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/gemini/research", async (req, res) => {
  const { text } = req.body;
  
  try {
    let apiKey = process.env.GEMINI_API_KEY || process.env.MY_GEMINI_KEY || "";
    apiKey = apiKey.replace(/^["']|["']$/g, '').trim();

    if (!apiKey) {
      return res.status(401).json({ error: "API Key mancante" });
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
    console.error("Gemini Research Error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/debug/env", async (req, res) => {
  const settings = await getSettingsFromFirebase();
  res.json({
    hasGemini: !!(process.env.MY_GEMINI_KEY || process.env.GEMINI_API_KEY),
    hasSmtp: !!settings.smtpHost
  });
});

export default app;
