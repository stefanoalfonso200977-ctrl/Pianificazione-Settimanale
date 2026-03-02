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

## Distribuzione su Vercel

L'applicazione è pronta per essere distribuita su Vercel.

1. Fai il fork o push di questo repository sul tuo GitHub.
2. Vai su [Vercel](https://vercel.com) e clicca "Add New Project".
3. Importa il repository da GitHub.
4. Nelle impostazioni del progetto su Vercel, aggiungi le variabili d'ambiente:
   - `MY_GEMINI_KEY`: La tua chiave API di Google Gemini.
   - `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`: (Opzionale) Per le notifiche email.
5. Clicca "Deploy".

**Nota:** Su Vercel, il database SQLite locale (`tasks.db`) non persisterà i dati tra i riavvii. Assicurati di configurare **Firebase** nell'app (Impostazioni -> Sincronizzazione Cloud) per salvare i dati in modo permanente.

## Distribuzione PWA
