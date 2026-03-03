import "dotenv/config";
import express from "express";
import { GoogleGenAI } from "@google/genai";

const app = express();

// Middleware
app.use(express.json({ limit: '50mb' })); // Increase limit for file uploads

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

// Gemini Integration
app.post("/api/gemini/breakdown", async (req, res) => {
  const { taskDescription, files } = req.body;
  
  try {
    // Prioritize GEMINI_API_KEY (provided by AI Studio) over MY_GEMINI_KEY
    let apiKey = process.env.GEMINI_API_KEY || process.env.MY_GEMINI_KEY || "";
    
    // Remove any accidental quotes and whitespace
    apiKey = apiKey.replace(/^["']|["']$/g, '').trim();

    if (!apiKey) {
      console.error("Gemini API Key is missing!");
      return res.status(401).json({ 
        error: "API Key mancante su Vercel", 
        details: "Vai su Vercel > Settings > Environment Variables e aggiungi MY_GEMINI_KEY" 
      });
    }

    // Log key details for debugging (do not log the full key)
    console.log(`Using Gemini API Key (length: ${apiKey.length}, starts with: ${apiKey.substring(0, 4)}..., ends with: ...${apiKey.substring(apiKey.length - 4)})`);
    console.log(`Key char codes: ${apiKey.substring(0, 4).split('').map(c => c.charCodeAt(0))}`);

    const ai = new GoogleGenAI({ apiKey });

    let prompt = `Sei un assistente esperto di pianificazione. 
    Analizza questa attività: "${taskDescription}".
    Scomponila in 3-5 sotto-task concreti e azionabili.
    Restituisci SOLO un array JSON di stringhe, senza markdown o altro testo.
    Esempio: ["Comprare vernice", "Coprire mobili", "Dipingere parete"]`;

    const parts: any[] = [{ text: prompt }];

    // Add images if present
    if (files && Array.isArray(files)) {
      for (const file of files) {
        if (file.mimeType.startsWith('image/')) {
          // Remove data:image/png;base64, prefix
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
      model: "gemini-flash-latest",
      contents: { parts }
    });
    
    let text = response.text || "";
    
    // Clean up markdown code blocks if present
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    
    const subtasks = JSON.parse(text);
    res.json({ subtasks });
  } catch (error: any) {
    console.error("Gemini Error:", error);
    if (error.message && error.message.includes("API key not valid")) {
      return res.status(401).json({ 
        error: "Chiave API non valida", 
        details: "La chiave API inserita su Vercel (MY_GEMINI_KEY) non è valida o è stata revocata. Generane una nuova su Google AI Studio e aggiornala su Vercel." 
      });
    }
    res.status(500).json({ error: "Errore durante l'elaborazione con Gemini", details: error.message });
  }
});

app.post("/api/gemini/parse-task", async (req, res) => {
  const { text, currentDate } = req.body;
  
  try {
    let apiKey = process.env.GEMINI_API_KEY || process.env.MY_GEMINI_KEY || "";
    apiKey = apiKey.replace(/^["']|["']$/g, '').trim();

    if (!apiKey) {
      return res.status(401).json({ error: "API Key mancante su Vercel" });
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
      model: "gemini-flash-latest",
      contents: prompt
    });
    
    let responseText = response.text || "";
    responseText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    
    const taskData = JSON.parse(responseText);
    res.json(taskData);
  } catch (error: any) {
    console.error("Gemini Parse Error:", error);
    if (error.message && error.message.includes("API key not valid")) {
      return res.status(401).json({ 
        error: "Chiave API non valida", 
        details: "La chiave API inserita su Vercel (MY_GEMINI_KEY) non è valida o è stata revocata. Generane una nuova su Google AI Studio e aggiornala su Vercel." 
      });
    }
    res.status(500).json({ error: "Errore durante l'elaborazione con Gemini", details: error.message });
  }
});

app.get("/api/debug/env", (req, res) => {
  res.json({
    hasGemini: !!(process.env.MY_GEMINI_KEY || process.env.GEMINI_API_KEY)
  });
});

// Export for Vercel
export default app;
