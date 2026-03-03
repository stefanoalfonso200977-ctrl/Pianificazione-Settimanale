import "dotenv/config";
import express from "express";
import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import path from "path";
import cron from "node-cron";
import nodemailer from "nodemailer";

const app = express();

// Middleware
app.use(express.json({ limit: '50mb' })); // Increase limit for file uploads

// --- Data Persistence Helper ---
const DATA_DIR = path.join(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}

const TASKS_FILE = path.join(DATA_DIR, "tasks.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

const readJson = (file: string, defaultVal: any = []) => {
  try {
    if (!fs.existsSync(file)) return defaultVal;
    const data = fs.readFileSync(file, "utf-8");
    return JSON.parse(data);
  } catch (e) {
    console.error(`Error reading ${file}:`, e);
    return defaultVal;
  }
};

const writeJson = (file: string, data: any) => {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(`Error writing ${file}:`, e);
  }
};

// --- Email Logic ---
const sendEmail = async (to: string, subject: string, html: string) => {
  const settings = readJson(SETTINGS_FILE, {});
  
  // If no SMTP settings, log to console (Simulation)
  if (!settings.smtpHost) {
    console.log("--- EMAIL SIMULATION ---");
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`Body: ${html}`);
    console.log("------------------------");
    return { success: true, simulated: true };
  }

  // Real Email Sending
  try {
    const transporter = nodemailer.createTransport({
      host: settings.smtpHost,
      port: settings.smtpPort || 587,
      secure: settings.smtpSecure || false,
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
cron.schedule("0 8 * * *", async () => {
  console.log("Running scheduled task check...");
  await checkAndNotify();
}, {
  timezone: "Europe/Rome"
});

const checkAndNotify = async () => {
  const settings = readJson(SETTINGS_FILE, {});
  if (!settings.email) {
    console.log("No notification email configured.");
    return;
  }

  const tasks = readJson(TASKS_FILE, []);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expiringTasks = tasks.filter((task: any) => {
    if (task.status === "completed") return false;
    const deadline = new Date(task.deadline);
    deadline.setHours(0, 0, 0, 0);
    
    const diffTime = deadline.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    // Check for 3 days before OR exactly today (0 days)
    return diffDays >= 0 && diffDays <= 3;
  });

  if (expiringTasks.length === 0) {
    console.log("No expiring tasks found.");
    return;
  }

  // Build Email Content
  const tasksHtml = expiringTasks.map((t: any) => {
    const deadline = new Date(t.deadline);
    const isToday = deadline.toDateString() === today.toDateString();
    const color = isToday ? "red" : "black";
    const alert = isToday ? "<b style='color: red;'>[SCADENZA OGGI!]</b> " : "";
    
    return `<li style="color: ${color};">
      ${alert}<strong>${t.title}</strong> - ${t.deadline}
    </li>`;
  }).join("");

  const confirmLink = `${process.env.APP_URL || "http://localhost:3000"}/api/confirm-view?email=${encodeURIComponent(settings.email)}`;

  const html = `
    <h2>Riepilogo Attività in Scadenza</h2>
    <p>Ciao, ecco le attività che scadono nei prossimi 3 giorni:</p>
    <ul>${tasksHtml}</ul>
    <p>Per favore, conferma di aver preso visione di queste attività cliccando il link qui sotto:</p>
    <a href="${confirmLink}" style="padding: 10px 20px; background-color: #dc2626; color: white; text-decoration: none; border-radius: 5px;">Conferma Visione</a>
  `;

  await sendEmail(settings.email, "Agente Pianificazione: Attività in Scadenza", html);
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

// Tasks CRUD
app.get("/api/tasks", (req, res) => {
  const tasks = readJson(TASKS_FILE, []);
  res.json(tasks);
});

app.post("/api/tasks", (req, res) => {
  const tasks = readJson(TASKS_FILE, []);
  const newTask = { ...req.body, id: Date.now(), createdAt: new Date().toISOString() };
  tasks.push(newTask);
  writeJson(TASKS_FILE, tasks);
  res.json(newTask);
});

app.put("/api/tasks/:id", (req, res) => {
  const tasks = readJson(TASKS_FILE, []);
  const id = req.params.id;
  const index = tasks.findIndex((t: any) => String(t.id) === id);
  
  if (index !== -1) {
    tasks[index] = { ...tasks[index], ...req.body };
    writeJson(TASKS_FILE, tasks);
    res.json(tasks[index]);
  } else {
    res.status(404).json({ error: "Task not found" });
  }
});

app.delete("/api/tasks/:id", (req, res) => {
  const tasks = readJson(TASKS_FILE, []);
  const id = req.params.id;
  const newTasks = tasks.filter((t: any) => String(t.id) !== id);
  writeJson(TASKS_FILE, newTasks);
  res.json({ success: true });
});

// Settings
app.get("/api/settings", (req, res) => {
  const settings = readJson(SETTINGS_FILE, {});
  res.json(settings);
});

app.post("/api/settings", (req, res) => {
  const settings = readJson(SETTINGS_FILE, {});
  const newSettings = { ...settings, ...req.body };
  writeJson(SETTINGS_FILE, newSettings);
  res.json(newSettings);
});

app.post("/api/test-email", async (req, res) => {
  const { email } = req.body;
  const result = await sendEmail(email, "Test Agente Pianificazione", "<p>Questa è una email di test.</p>");
  res.json(result);
});

app.post("/api/trigger-check", async (req, res) => {
  await checkAndNotify();
  res.json({ success: true, message: "Check triggered" });
});

app.get("/api/confirm-view", (req, res) => {
  // Log confirmation
  console.log(`User ${req.query.email} confirmed view at ${new Date().toISOString()}`);
  res.send("<h1>Conferma ricevuta!</h1><p>Grazie per aver confermato la visione delle attività.</p>");
});

// Gemini Integration (Existing)
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

app.get("/api/debug/env", (req, res) => {
  const settings = readJson(SETTINGS_FILE, {});
  res.json({
    hasGemini: !!(process.env.MY_GEMINI_KEY || process.env.GEMINI_API_KEY),
    hasSmtp: !!settings.smtpHost
  });
});

export default app;
