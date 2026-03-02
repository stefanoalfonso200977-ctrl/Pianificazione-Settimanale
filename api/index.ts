import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json({ limit: '50mb' })); // Increase limit for file uploads

// --- API Routes ---

// Gemini Integration
app.post("/api/gemini/breakdown", async (req, res) => {
  const { taskDescription, files } = req.body;
  
  try {
    // Prioritize MY_GEMINI_KEY as it's the one we set in .env
    // DO NOT TRIM THE KEY - sometimes keys have special characters that trim might remove incorrectly if not careful, 
    // though usually trim is safe. Let's try raw first to be sure.
    let apiKey = process.env.MY_GEMINI_KEY || process.env.GEMINI_API_KEY || "";
    
    // Remove any accidental quotes if they were included in the .env value
    apiKey = apiKey.replace(/^["']|["']$/g, '');

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
    res.status(500).json({ error: "Errore durante l'elaborazione con Gemini", details: error.message });
  }
});

app.get("/api/debug/env", (req, res) => {
  res.json({
    hasGemini: !!(process.env.MY_GEMINI_KEY || process.env.GEMINI_API_KEY)
  });
});

// Start Server (Only if not running in Vercel/Serverless environment)
// Vercel exports the app, so we don't want to listen on a port
if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
  startServer();
}

async function startServer() {
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

// Export for Vercel
export default app;
