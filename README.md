# Agente Pianificazione Lavoro

Un'applicazione web per la gestione delle attività condominiali, potenziata dall'intelligenza artificiale e sincronizzata in tempo reale.

## Funzionalità Principali

- **Gestione Attività**: Crea, modifica e completa attività con scadenze.
- **Sincronizzazione Live**: Grazie a Firebase, le modifiche sono visibili istantaneamente a tutti i condomini connessi.
- **Assistente AI**: Integrazione con Gemini per scomporre attività complesse in sotto-task.
- **Allegati**: Caricamento di file e immagini per ogni attività.
- **Storico**: Visualizzazione delle attività completate divise per mese.
- **Backup e Ripristino**: Strumenti per salvare i dati localmente.

## Tecnologie Utilizzate

- **Frontend**: React, TypeScript, Tailwind CSS, Framer Motion
- **Backend**: Node.js, Express (per API locali e proxy)
- **Database**: Firebase Firestore (Cloud) + SQLite (Locale/Backup)
- **AI**: Google Gemini API

## Installazione e Avvio

1. Clona il repository:
   ```bash
   git clone <tuo-repo-url>
   cd agente-pianificazione-lavoro
   ```

2. Installa le dipendenze:
   ```bash
   npm install
   ```

3. Configura le variabili d'ambiente:
   Crea un file `.env` basato su `.env.example` e inserisci la tua chiave API di Gemini.

4. Avvia il server di sviluppo:
   ```bash
   npm run dev
   ```

5. Apri il browser su `http://localhost:3000`.

## Distribuzione

L'applicazione è configurata come PWA (Progressive Web App) e può essere installata su dispositivi mobili e desktop direttamente dal browser.
