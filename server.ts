import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import cron from "node-cron";
import nodemailer from "nodemailer";
import { GoogleGenAI } from "@google/genai";
import { format, addDays, isSameDay, parseISO } from "date-fns";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Initialize Database
  const db = new Database("tasks.db");
  db.pragma("journal_mode = WAL");

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      deadline TEXT NOT NULL,
      status TEXT DEFAULT 'pending', -- pending, completed
      subtasks TEXT, -- JSON string
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Migration: Add files column if it doesn't exist
  try {
    db.exec("ALTER TABLE tasks ADD COLUMN files TEXT");
  } catch (e) {
    // Column already exists
  }
  try { db.exec("ALTER TABLE tasks ADD COLUMN notified_3_days INTEGER DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN notified_2_days INTEGER DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN notified_today INTEGER DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN last_notified_overdue TEXT"); } catch (e) {}

  // Middleware
  app.use(express.json({ limit: '50mb' })); // Increase limit for file uploads

  // --- API Routes ---

  // Get all tasks
  app.get("/api/tasks", (req, res) => {
    const tasks = db.prepare("SELECT * FROM tasks ORDER BY deadline ASC").all();
    res.json(tasks.map((t: any) => ({
      ...t,
      subtasks: t.subtasks ? JSON.parse(t.subtasks) : [],
      files: t.files ? JSON.parse(t.files) : []
    })));
  });

  // Get single task
  app.get("/api/tasks/:id", (req, res) => {
    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id) as any;
    if (task) {
      res.json({
        ...task,
        subtasks: task.subtasks ? JSON.parse(task.subtasks) : [],
        files: task.files ? JSON.parse(task.files) : []
      });
    } else {
      res.status(404).json({ error: "Task not found" });
    }
  });

  // Create task
  app.post("/api/tasks", (req, res) => {
    const { title, description, deadline, files } = req.body;
    const stmt = db.prepare("INSERT INTO tasks (title, description, deadline, files) VALUES (?, ?, ?, ?)");
    const info = stmt.run(title, description, deadline, JSON.stringify(files || []));
    
    // Controlla subito le scadenze per inviare eventuali notifiche immediate
    checkDeadlines().catch(console.error);

    res.json({ 
      id: info.lastInsertRowid, 
      title, 
      description, 
      deadline, 
      status: "pending", 
      subtasks: [],
      files: files || []
    });
  });

  // Update task
  app.put("/api/tasks/:id", (req, res) => {
    const { title, description, deadline, status, subtasks, files } = req.body;
    
    const oldTask = db.prepare("SELECT deadline FROM tasks WHERE id = ?").get(req.params.id) as any;
    const deadlineChanged = oldTask && oldTask.deadline !== deadline;

    if (deadlineChanged) {
      const stmt = db.prepare(
        "UPDATE tasks SET title = ?, description = ?, deadline = ?, status = ?, subtasks = ?, files = ?, notified_3_days = 0, notified_2_days = 0, notified_today = 0, last_notified_overdue = NULL WHERE id = ?"
      );
      stmt.run(
        title, 
        description, 
        deadline, 
        status, 
        JSON.stringify(subtasks || []), 
        JSON.stringify(files || []),
        req.params.id
      );
    } else {
      const stmt = db.prepare(
        "UPDATE tasks SET title = ?, description = ?, deadline = ?, status = ?, subtasks = ?, files = ? WHERE id = ?"
      );
      stmt.run(
        title, 
        description, 
        deadline, 
        status, 
        JSON.stringify(subtasks || []), 
        JSON.stringify(files || []),
        req.params.id
      );
    }
    
    // Controlla le scadenze in caso la data sia cambiata
    checkDeadlines().catch(console.error);

    res.json({ success: true });
  });

  // Delete task
  app.delete("/api/tasks/:id", (req, res) => {
    const stmt = db.prepare("DELETE FROM tasks WHERE id = ?");
    stmt.run(req.params.id);
    res.json({ success: true });
  });

  // Settings
  app.get("/api/settings", (req, res) => {
    const email = db.prepare("SELECT value FROM settings WHERE key = 'email'").get() as { value: string } | undefined;
    res.json({ email: email?.value || "" });
  });

  app.post("/api/settings", (req, res) => {
    const { email } = req.body;
    const stmt = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('email', ?)");
    stmt.run(email);
    res.json({ success: true });
  });

  // Debug endpoint to check env vars
  app.get("/api/debug/env", (req, res) => {
    res.json({
      hasGeminiKey: !!process.env.GEMINI_API_KEY,
      hasApiKey: !!process.env.API_KEY,
      geminiKeyLength: process.env.GEMINI_API_KEY?.length || 0,
      apiKeyLength: process.env.API_KEY?.length || 0,
      hasSmtp: !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
    });
  });

  // Backup Database
  app.get("/api/backup", (req, res) => {
    const tasks = db.prepare("SELECT * FROM tasks").all();
    const settings = db.prepare("SELECT * FROM settings").all();
    
    const backupData = {
      timestamp: new Date().toISOString(),
      tasks,
      settings
    };
    
    res.setHeader('Content-Disposition', `attachment; filename="backup-${format(new Date(), 'yyyy-MM-dd')}.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(backupData, null, 2));
  });

  // Restore Database
  app.post("/api/restore", (req, res) => {
    try {
      const { tasks, settings } = req.body;
      
      if (!Array.isArray(tasks) || !Array.isArray(settings)) {
        throw new Error("Invalid backup format");
      }

      // Transaction to ensure integrity
      const restore = db.transaction(() => {
        // Clear existing data
        db.prepare("DELETE FROM tasks").run();
        db.prepare("DELETE FROM settings").run();
        
        // Restore tasks
        const insertTask = db.prepare(`
          INSERT INTO tasks (id, title, description, deadline, status, subtasks, files, created_at, notified_3_days, notified_2_days, notified_today, last_notified_overdue)
          VALUES (@id, @title, @description, @deadline, @status, @subtasks, @files, @created_at, @notified_3_days, @notified_2_days, @notified_today, @last_notified_overdue)
        `);
        
        for (const task of tasks) {
          insertTask.run(task);
        }
        
        // Restore settings
        const insertSetting = db.prepare("INSERT INTO settings (key, value) VALUES (@key, @value)");
        for (const setting of settings) {
          insertSetting.run(setting);
        }
      });
      
      restore();
      res.json({ success: true, message: "Database restored successfully" });
    } catch (error: any) {
      console.error("Restore error:", error);
      res.status(500).json({ error: "Restore failed", details: error.message });
    }
  });

  // Gemini Integration
  app.post("/api/gemini/breakdown", async (req, res) => {
    const { taskDescription, files } = req.body;
    
    const apiKey = process.env.MY_GEMINI_KEY || process.env.GEMINI_API_KEY;

    console.log("Gemini Request Debug:");
    console.log("- MY_GEMINI_KEY length:", process.env.MY_GEMINI_KEY?.length || 0);
    console.log("- GEMINI_API_KEY length:", process.env.GEMINI_API_KEY?.length || 0);
    console.log("- Selected Key Length:", apiKey?.length || 0);
    
    // If still missing, we can't proceed
    if (!apiKey) {
      console.error("CRITICAL: No API Key found in environment variables.");
      return res.status(500).json({ 
        error: "Chiave API mancante", 
        details: "Il sistema non ha trovato una chiave API valida. Contatta l'amministratore." 
      });
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `
        Sei un assistente di produttività. Suddividi il seguente compito complesso in sotto-attività concrete e gestibili.
        Compito: "${taskDescription}"
        
        Se ci sono file allegati, usali come contesto per capire meglio il compito e generare sotto-attività più precise.
        
        Restituisci SOLO un array JSON di stringhe, senza markdown o altro testo.
        Esempio: ["Sotto-attività 1", "Sotto-attività 2"]
      `;

      console.log("Calling Gemini model: gemini-2.5-flash");

      const parts: any[] = [];
      
      if (files && files.length > 0) {
        for (const file of files) {
          // Gemini supports images, pdfs, txt. Word docs might not be fully supported natively, 
          // but we'll pass them if they are converted or just pass the base64.
          // The frontend should send base64 data without the data:mime/type;base64, prefix
          const base64Data = file.data.split(',')[1] || file.data;
          parts.push({
            inlineData: {
              data: base64Data,
              mimeType: file.mimeType
            }
          });
        }
      }
      
      parts.push({ text: prompt });

      const result = await ai.models.generateContent({
        model: "gemini-2.5-flash", 
        contents: { parts },
      });
      
      const text = result.text;
      console.log("Gemini response received");

      if (!text) throw new Error("No text generated");
      
      // Clean up markdown if present
      const jsonStr = text.replace(/```json/g, "").replace(/```/g, "").trim();
      const subtasks = JSON.parse(jsonStr);
      
      res.json({ subtasks });
    } catch (error: any) {
      console.error("Gemini API Error Full:", JSON.stringify(error, null, 2));
      
      // Return the specific error message to the client
      res.status(500).json({ 
        error: "Errore Gemini", 
        details: error.message || "API Key invalid or model error"
      });
    }
  });

  // --- Email Notification Logic ---
  
  const sendEmail = async (to: string, subject: string, html: string, priority: "high" | "normal" = "normal") => {
    console.log(`[EMAIL LOG] To: ${to}, Subject: ${subject}, Priority: ${priority}`);
    
    // Use real SMTP if configured (Required for Vercel/Production)
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      try {
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: parseInt(process.env.SMTP_PORT || "587"),
          secure: process.env.SMTP_SECURE === "true",
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          },
        });

        await transporter.sendMail({
          from: process.env.SMTP_FROM || '"Agente Pianificazione" <noreply@planner.app>',
          to,
          subject,
          html,
          headers: {
            "X-Priority": priority === "high" ? "1" : "3",
          },
        });
        console.log("Email sent successfully via SMTP");
      } catch (error) {
        console.error("Failed to send email via SMTP:", error);
      }
    } else {
      console.log("SMTP not configured. Email simulated (check logs).");
    }
  };

  const checkDeadlines = async () => {
    console.log("Checking deadlines...");
    
    // 1. Check Environment Variable first (Best for Vercel persistence)
    let userEmail = process.env.NOTIFY_EMAIL;
    
    // 2. Fallback to Database Setting (Local dev)
    if (!userEmail) {
      const emailSetting = db.prepare("SELECT value FROM settings WHERE key = 'email'").get() as { value: string } | undefined;
      userEmail = emailSetting?.value;
    }

    if (!userEmail) {
      console.log("No email configured (Env var NOTIFY_EMAIL or DB setting). Skipping notifications.");
      return;
    }

    const tasks = db.prepare("SELECT * FROM tasks WHERE status = 'pending'").all() as any[];
    const today = new Date();
    const todayStr = format(today, 'yyyy-MM-dd');
    const twoDaysFromNow = addDays(today, 2);
    const twoDaysStr = format(twoDaysFromNow, 'yyyy-MM-dd');
    const threeDaysFromNow = addDays(today, 3);
    const threeDaysStr = format(threeDaysFromNow, 'yyyy-MM-dd');

    for (const task of tasks) {
      const deadlineStr = task.deadline.substring(0, 10);
      
      // Check if overdue
      if (deadlineStr < todayStr) {
        if (task.last_notified_overdue !== todayStr) {
          await sendEmail(
            userEmail,
            `SCADUTA: L'attività "${task.title}" è in ritardo`,
            `<h1 style="color: darkred;">ATTIVITÀ SCADUTA</h1><p>Il task "<strong>${task.title}</strong>" era in scadenza il ${format(parseISO(task.deadline), 'dd/MM/yyyy')} e non è stato ancora completato.</p>`,
            "high"
          );
          db.prepare("UPDATE tasks SET last_notified_overdue = ? WHERE id = ?").run(todayStr, task.id);
        }
      }
      // Check if deadline is today
      else if (deadlineStr === todayStr && !task.notified_today) {
        await sendEmail(
          userEmail,
          `URGENTE: Scadenza oggi per "${task.title}"`,
          `<h1 style="color: red;">SCADENZA OGGI!</h1><p>Il task "<strong>${task.title}</strong>" scade oggi. Completalo con priorità alta.</p>`,
          "high"
        );
        db.prepare("UPDATE tasks SET notified_today = 1 WHERE id = ?").run(task.id);
      }
      // Check if deadline is in 2 days
      else if (deadlineStr === twoDaysStr && !task.notified_2_days) {
        await sendEmail(
          userEmail,
          `Promemoria: Scadenza tra 2 giorni per "${task.title}"`,
          `<h1 style="color: #f97316;">In Scadenza</h1><p>Il task "<strong>${task.title}</strong>" scade tra 2 giorni (${format(parseISO(task.deadline), 'dd/MM/yyyy')}).</p>`,
          "normal"
        );
        db.prepare("UPDATE tasks SET notified_2_days = 1 WHERE id = ?").run(task.id);
      }
      // Check if deadline is in 3 days
      else if (deadlineStr === threeDaysStr && !task.notified_3_days) {
        await sendEmail(
          userEmail,
          `Promemoria: Scadenza tra 3 giorni per "${task.title}"`,
          `<h1 style="color: #eab308;">In Scadenza</h1><p>Il task "<strong>${task.title}</strong>" scade tra 3 giorni (${format(parseISO(task.deadline), 'dd/MM/yyyy')}).</p>`,
          "normal"
        );
        db.prepare("UPDATE tasks SET notified_3_days = 1 WHERE id = ?").run(task.id);
      }
    }
  };

  // Schedule cron job for 8:00 AM every day (Local Node.js only)
  cron.schedule("0 8 * * *", () => {
    checkDeadlines();
  });

  // Endpoint for Vercel Cron (or manual trigger)
  app.get("/api/cron", async (req, res) => {
    // Optional: Add a secret check to prevent unauthorized calls
    // if (req.query.secret !== process.env.CRON_SECRET) return res.status(401).end();
    
    await checkDeadlines();
    res.json({ message: "Deadline check completed" });
  });

  // Manual trigger endpoint for demo purposes
  app.post("/api/debug/check-deadlines", async (req, res) => {
    await checkDeadlines();
    res.json({ message: "Deadline check triggered" });
  });

  // Direct test email endpoint
  app.post("/api/debug/test-email", async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email mancante" });

    if (!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)) {
      return res.status(500).json({ 
        error: "SMTP non configurato", 
        details: "Configura SMTP_HOST, SMTP_USER e SMTP_PASS nelle variabili d'ambiente." 
      });
    }

    try {
      await sendEmail(
        email,
        "Test Notifica: Agente Pianificazione Lavoro",
        "<h1>Test Riuscito!</h1><p>Questa è una mail di test inviata dal tuo Agente di Pianificazione Lavoro.</p>"
      );
      res.json({ success: true, message: "Email di test inviata con successo" });
    } catch (error: any) {
      res.status(500).json({ error: "Invio fallito", details: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
