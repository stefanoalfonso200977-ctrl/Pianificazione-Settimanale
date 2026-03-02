import { useState, useEffect, type FormEvent, type FC, type ChangeEvent } from "react";
import { format, isSameDay, addDays, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import { Calendar as CalendarIcon, Trash2, Edit2, CheckCircle, AlertTriangle, Mail, Sparkles, History, Home, Settings, Paperclip, X, FileText, Image as ImageIcon, Clock, Cloud, Database } from "lucide-react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "./lib/utils";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, orderBy, Timestamp } from "firebase/firestore";

// Firebase Setup
const firebaseConfig = {
  apiKey: "AIzaSyAiYIjjUQWY5QrMwHeSHyGuWSbZzeUeB-U",
  authDomain: "pianificazione-settimana.firebaseapp.com",
  projectId: "pianificazione-settimana",
  storageBucket: "pianificazione-settimana.firebasestorage.app",
  messagingSenderId: "337752358600",
  appId: "1:337752358600:web:72e18f37536b07b7abaffd"
};

let db: any = null;

const initFirebase = (config: any) => {
  try {
    const app = initializeApp(config);
    db = getFirestore(app);
    console.log("Firebase initialized successfully");
    return true;
  } catch (e) {
    console.error("Firebase init error:", e);
    return false;
  }
};

// Initialize immediately
initFirebase(firebaseConfig);

// Types
interface TaskFile {
  name: string;
  data: string;
  mimeType: string;
}

interface Task {
  id: string | number; // Support both SQLite (number) and Firebase (string) IDs
  title: string;
  description: string;
  deadline: string;
  status: "pending" | "completed";
  subtasks: string[];
  files?: TaskFile[];
}

// API Service Wrapper (Hybrid: SQLite or Firebase)
const api = {
  useFirebase: () => !!db,
  
  getTasks: async () => {
    // If Firebase is active, this is handled by onSnapshot in useEffect
    // This fallback is for SQLite
    if (db) return []; 
    const res = await fetch("/api/tasks");
    return res.json();
  },
  createTask: async (task: Partial<Task>) => {
    if (db) {
      await addDoc(collection(db, "tasks"), {
        ...task,
        createdAt: Timestamp.now(),
        files: task.files || [],
        subtasks: task.subtasks || [],
        status: "pending"
      });
      return;
    }
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(task),
    });
    return res.json();
  },
  updateTask: async (id: string | number, task: Partial<Task>) => {
    if (db) {
      const docRef = doc(db, "tasks", String(id));
      // Remove id from update payload to avoid overwriting document ID
      const { id: _, ...updateData } = task;
      await updateDoc(docRef, updateData);
      return;
    }
    const res = await fetch(`/api/tasks/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(task),
    });
    return res.json();
  },
  deleteTask: async (id: string | number) => {
    if (db) {
      await deleteDoc(doc(db, "tasks", String(id)));
      return;
    }
    await fetch(`/api/tasks/${id}`, { method: "DELETE" });
  },
  breakdownTask: async (description: string, files?: TaskFile[]) => {
    const res = await fetch("/api/gemini/breakdown", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskDescription: description, files }),
    });
    return res.json();
  },
  getSettings: async () => {
    const res = await fetch("/api/settings");
    return res.json();
  },
  saveSettings: async (email: string) => {
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
  },
  triggerCheck: async () => {
    await fetch("/api/debug/check-deadlines", { method: "POST" });
  },
  testEmail: async (email: string) => {
    const res = await fetch("/api/debug/test-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    return res.json();
  },
  getEnvStatus: async () => {
    const res = await fetch("/api/debug/env");
    return res.json();
  }
};

// Components

const TaskCard: FC<{ task: Task; onUpdate: () => void; onDelete: () => void; handleFileUpload?: any; removeFile?: any }> = ({ task, onUpdate, onDelete, handleFileUpload, removeFile }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(task.title);
  const [editDesc, setEditDesc] = useState(task.description);
  const [editDeadline, setEditDeadline] = useState(task.deadline);
  const [editFiles, setEditFiles] = useState<TaskFile[]>(task.files || []);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const deadline = parseISO(task.deadline);
  
  const handleComplete = async () => {
    await api.updateTask(task.id, { ...task, status: task.status === "pending" ? "completed" : "pending" });
    onUpdate();
  };

  const handleSaveEdit = async () => {
    await api.updateTask(task.id, { 
      ...task, 
      title: editTitle, 
      description: editDesc, 
      deadline: editDeadline,
      files: editFiles
    });
    setIsEditing(false);
    onUpdate();
  };

  const handleGeminiBreakdown = async () => {
    if (!task.description && !task.title) {
      alert("Inserisci almeno un titolo per usare Gemini.");
      return;
    }
    
    try {
      const result = await api.breakdownTask(task.description || task.title, task.files);
      
      if (result.error) {
        throw new Error(result.details || result.error);
      }
      
      if (result.subtasks) {
        await api.updateTask(task.id, { ...task, subtasks: result.subtasks });
        onUpdate();
      }
    } catch (err: any) {
      console.error("Errore Gemini:", err);
      alert(`Errore durante la comunicazione con Gemini: ${err.message || "Riprova più tardi."}`);
    }
  };

  if (isEditing) {
    return (
      <div className="p-3.5 rounded-xl border border-gray-100 shadow-sm bg-white space-y-2">
        <input
          type="text"
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          className="w-full rounded-lg border-gray-200 p-2 border font-semibold focus:ring-2 focus:ring-black/5 outline-none transition-all text-xs"
          placeholder="Titolo"
        />
        <textarea
          value={editDesc}
          onChange={(e) => setEditDesc(e.target.value)}
          className="w-full rounded-lg border-gray-200 p-2 border text-[11px] focus:ring-2 focus:ring-black/5 outline-none transition-all"
          placeholder="Descrizione"
          rows={2}
        />
        <input
          type="date"
          value={editDeadline}
          onChange={(e) => setEditDeadline(e.target.value)}
          className="w-full rounded-lg border-gray-200 p-2 border text-[11px] focus:ring-2 focus:ring-black/5 outline-none transition-all"
        />
        
        <div className="space-y-1">
          <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider">Allegati</label>
          <div className="flex items-center gap-2">
            <label className="cursor-pointer flex items-center justify-center px-2 py-1 border border-gray-200 rounded-md shadow-sm text-[10px] font-medium text-gray-600 bg-white hover:bg-gray-50 transition-colors">
              <Paperclip className="w-3 h-3 mr-1" />
              Aggiungi File
              <input 
                type="file" 
                multiple 
                className="hidden" 
                accept=".pdf,.doc,.docx,image/*"
                onChange={(e) => handleFileUpload && handleFileUpload(e, false, editFiles, setEditFiles)}
              />
            </label>
          </div>
          
          {editFiles.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {editFiles.map((file, index) => (
                <div key={index} className="flex items-center gap-1 bg-gray-50 border border-gray-100 px-1.5 py-0.5 rounded-md text-[9px]">
                  <span className="truncate max-w-[100px] font-medium text-gray-600">{file.name}</span>
                  <button 
                    type="button" 
                    onClick={() => removeFile && removeFile(index, false, editFiles, setEditFiles)}
                    className="text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-1.5 justify-end pt-1">
          <button onClick={() => setIsEditing(false)} className="px-2 py-1 text-[10px] font-medium text-gray-500 hover:bg-gray-100 rounded-md transition-colors">Annulla</button>
          <button onClick={handleSaveEdit} className="px-3 py-1 text-[10px] bg-black text-white rounded-md hover:bg-gray-800 font-bold transition-colors">Salva</button>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="p-3.5 rounded-2xl border border-gray-100 shadow-[0_2px_15px_rgb(0,0,0,0.02)] bg-white transition-all w-full group"
    >
      <div className="flex gap-3 items-start">
        {/* Checkbox Circle */}
        <button 
          onClick={handleComplete}
          className={cn(
            "mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all shrink-0",
            task.status === "completed" 
              ? "bg-indigo-600 border-indigo-600 text-white" 
              : "border-gray-200 hover:border-indigo-300"
          )}
        >
          {task.status === "completed" && <CheckCircle className="w-3 h-3" />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-start mb-0.5">
            <div className="space-y-0.5">
              <h3 className={cn(
                "font-bold text-sm tracking-tight transition-all",
                task.status === "completed" ? "line-through text-gray-400" : "text-gray-900"
              )}>
                {task.title}
              </h3>
              <div className="flex items-center gap-1.5 text-[9px] font-medium text-gray-400">
                <CalendarIcon className="w-2.5 h-2.5" />
                {format(deadline, "d MMM yyyy", { locale: it })}
              </div>
            </div>

            <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button 
                onClick={handleGeminiBreakdown}
                className="p-1 rounded-full hover:bg-indigo-50 text-indigo-400 hover:text-indigo-600 transition-colors"
                title="Assistente AI"
              >
                <Sparkles className="w-3.5 h-3.5" />
              </button>
              <button 
                onClick={() => setIsEditing(true)} 
                className="p-1 rounded-full hover:bg-blue-50 text-gray-300 hover:text-blue-500 transition-colors"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              
              {showDeleteConfirm ? (
                <div className="flex items-center gap-1 bg-red-50 rounded-full px-1 py-0.5 border border-red-100 ml-1">
                  <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-0.5 rounded-full hover:bg-red-200 text-red-600">
                    <CheckCircle className="w-3 h-3" />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(false); }} className="p-0.5 rounded-full hover:bg-gray-200 text-gray-500">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowDeleteConfirm(true);
                  }} 
                  className="p-1 rounded-full hover:bg-red-50 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
          
          {task.description && (
            <p className="text-gray-500 text-[11px] mt-0.5 leading-relaxed line-clamp-2">{task.description}</p>
          )}

          {task.subtasks && task.subtasks.length > 0 && (
            <div className="mt-2 space-y-1">
              {task.subtasks.map((st, i) => (
                <div key={i} className="text-[10px] text-gray-600 flex items-center gap-2 bg-indigo-50/30 p-1 rounded-lg">
                  <div className="w-1 h-1 bg-indigo-400 rounded-full shrink-0" />
                  {st}
                </div>
              ))}
            </div>
          )}

          {/* Attachments Section */}
          <div className="mt-3 pt-3 border-t border-gray-50">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5 text-[8px] font-black text-gray-400 uppercase tracking-[0.2em]">
                <Paperclip className="w-2.5 h-2.5" />
                ALLEGATI
              </div>
              <button 
                onClick={() => setIsEditing(true)}
                className="text-indigo-500 hover:bg-indigo-50 p-0.5 rounded-md transition-colors"
              >
                <X className="w-3.5 h-3.5 rotate-45" />
              </button>
            </div>
            
            {task.files && task.files.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {task.files.map((file, i) => (
                  <div key={i} className="flex items-center gap-1 bg-gray-50 border border-gray-100 px-1.5 py-0.5 rounded-md text-[9px] text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer">
                    {file.mimeType.startsWith('image/') ? (
                      <ImageIcon className="w-2.5 h-2.5 text-blue-400" />
                    ) : (
                      <FileText className="w-2.5 h-2.5 text-gray-400" />
                    )}
                    <span className="truncate max-w-[100px] font-medium">{file.name}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[9px] italic text-gray-400">Nessun allegato.</p>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
};

function SettingsPanel() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [envStatus, setEnvStatus] = useState<{ hasSmtp: boolean } | null>(null);

  useEffect(() => {
    api.getSettings().then(data => setEmail(data.email));
    api.getEnvStatus().then(setEnvStatus);
  }, []);

  const handleSave = async () => {
    setLoading(true);
    await api.saveSettings(email);
    setLoading(false);
    alert("Email salvata!");
  };

  const handleTestEmail = async () => {
    if (!email) return alert("Inserisci prima un'email");
    setLoading(true);
    const result = await api.testEmail(email);
    setLoading(false);
    if (result.success) {
      alert("Email di test inviata! Controlla la tua casella di posta.");
    } else {
      alert(`Errore: ${result.error}\n${result.details || ""}`);
    }
  };

  return (
    <div className="bg-white p-6 rounded-xl border shadow-sm max-w-md mx-auto mt-8">
      <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
        <Settings className="w-5 h-5" /> Impostazioni Notifiche
      </h2>
      
      {!envStatus?.hasSmtp && (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl flex gap-3 items-start">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-800 space-y-1">
            <p className="font-bold">SMTP non configurato</p>
            <p>Le email non verranno inviate realmente finché non configuri un server SMTP (es. Gmail, SendGrid) nelle variabili d'ambiente.</p>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email per le notifiche</label>
          <div className="flex gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="flex-1 rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm p-2 border"
              placeholder="tua@email.com"
            />
            <button
              onClick={handleSave}
              disabled={loading}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium disabled:opacity-50"
            >
              Salva
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Riceverai notifiche 3 giorni prima della scadenza e il giorno stesso.
          </p>
        </div>
        
        <div className="pt-4 border-t">
          <button
            onClick={handleTestEmail}
            disabled={loading}
            className="text-sm text-gray-600 hover:text-indigo-600 flex items-center gap-2 disabled:opacity-50"
          >
            <Mail className="w-4 h-4" />
            Invia email di test ora
          </button>
        </div>

        <div className="pt-4 border-t space-y-3">
          <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <Cloud className="w-4 h-4 text-indigo-500" />
            Sincronizzazione Cloud (Firebase)
          </h3>
          <p className="text-xs text-gray-500">
            Per non perdere mai i dati e sincronizzarli in tempo reale come in "Villa Rosetta", 
            configura il tuo database Firebase.
          </p>
          
          <button
            onClick={() => {
              const configStr = prompt("Incolla qui la configurazione JSON di Firebase:");
              if (configStr) {
                try {
                  // Handle both raw JSON and object literal copy-paste
                  const cleanStr = configStr.replace(/const firebaseConfig = /, "").replace(/;$/, "");
                  // If user pastes JS object syntax (keys without quotes), we might need a safer parser or ask for JSON
                  // For now assume JSON or try to parse
                  const config = JSON.parse(cleanStr);
                  if (initFirebase(config)) {
                    alert("Firebase configurato con successo! Ricarica la pagina.");
                    window.location.reload();
                  } else {
                    alert("Configurazione non valida.");
                  }
                } catch (e) {
                  alert("Errore nel formato JSON. Assicurati di copiare solo l'oggetto JSON.");
                }
              }
            }}
            className="w-full text-center px-3 py-2 bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 text-sm font-bold transition-colors border border-indigo-200"
          >
            {api.useFirebase() ? "Modifica Configurazione Firebase" : "Configura Firebase Ora"}
          </button>
          
          {api.useFirebase() && (
             <div className="text-[10px] text-green-600 font-medium flex items-center gap-1 bg-green-50 p-2 rounded border border-green-100">
               <CheckCircle className="w-3 h-3" />
               Database Cloud Attivo
             </div>
          )}
        </div>

        <div className="pt-4 border-t space-y-3">
          <h3 className="text-sm font-medium text-gray-700">Backup Locale (SQLite)</h3>
          <p className="text-xs text-gray-500">Scarica una copia dei tuoi dati per non perderli se l'ambiente viene resettato.</p>
          
          <div className="flex gap-3">
            <a
              href="/api/backup"
              target="_blank"
              className="flex-1 text-center px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              <FileText className="w-4 h-4" />
              Scarica Backup
            </a>
            
            <label className="flex-1 cursor-pointer text-center px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium transition-colors flex items-center justify-center gap-2">
              <History className="w-4 h-4" />
              Ripristina
              <input
                type="file"
                accept=".json"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  
                  if (!confirm("ATTENZIONE: Il ripristino cancellerà tutti i dati attuali e li sostituirà con quelli del backup. Continuare?")) {
                    e.target.value = '';
                    return;
                  }

                  const reader = new FileReader();
                  reader.onload = async (ev) => {
                    try {
                      const json = JSON.parse(ev.target?.result as string);
                      setLoading(true);
                      const res = await fetch("/api/restore", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(json)
                      });
                      const data = await res.json();
                      setLoading(false);
                      
                      if (data.success) {
                        alert("Ripristino completato con successo! La pagina verrà ricaricata.");
                        window.location.reload();
                      } else {
                        throw new Error(data.details || "Errore sconosciuto");
                      }
                    } catch (err: any) {
                      console.error(err);
                      alert("Errore durante il ripristino: " + err.message);
                      setLoading(false);
                    }
                  };
                  reader.readAsText(file);
                  e.target.value = ''; // Reset input
                }}
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<"home" | "calendar" | "history" | "settings">("home");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTask, setNewTask] = useState<{title: string, description: string, deadline: string, files: TaskFile[]}>({ 
    title: "", 
    description: "", 
    deadline: format(new Date(), "yyyy-MM-dd"),
    files: []
  });
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>, isNewTask: boolean, editFiles?: TaskFile[], setEditFiles?: (f: TaskFile[]) => void) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles) return;

    Array.from(selectedFiles).forEach((file: File) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const data = event.target?.result as string;
        const newFile: TaskFile = {
          name: file.name,
          mimeType: file.type,
          data
        };
        
        if (isNewTask) {
          setNewTask(prev => ({ ...prev, files: [...prev.files, newFile] }));
        } else if (setEditFiles && editFiles) {
          setEditFiles([...editFiles, newFile]);
        }
      };
      reader.readAsDataURL(file);
    });
    
    // Reset input
    e.target.value = '';
  };

  const removeFile = (index: number, isNewTask: boolean, editFiles?: TaskFile[], setEditFiles?: (f: TaskFile[]) => void) => {
    if (isNewTask) {
      setNewTask(prev => ({ ...prev, files: prev.files.filter((_, i) => i !== index) }));
    } else if (setEditFiles && editFiles) {
      setEditFiles(editFiles.filter((_, i) => i !== index));
    }
  };

  const refreshTasks = async () => {
    const data = await api.getTasks();
    setTasks(data);
  };

  useEffect(() => {
    // If Firebase is active, use real-time listener
    if (api.useFirebase() && db) {
      const q = query(collection(db, "tasks"), orderBy("deadline", "asc"));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const firebaseTasks = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Task[];
        setTasks(firebaseTasks);
      });
      return () => unsubscribe();
    } else {
      // Fallback to SQLite polling
      refreshTasks();
      const interval = setInterval(() => refreshTasks().catch(console.error), 3000);
      return () => clearInterval(interval);
    }
  }, []);

  const handleCreateTask = async (e: FormEvent) => {
    e.preventDefault();
    if (!newTask.title) return;
    await api.createTask(newTask);
    setNewTask({ title: "", description: "", deadline: format(new Date(), "yyyy-MM-dd"), files: [] });
    refreshTasks();
  };

  // Filter logic
  const activeTasks = tasks
    .filter(t => t.status === "pending")
    .sort((a, b) => parseISO(a.deadline).getTime() - parseISO(b.deadline).getTime());
  const completedTasks = tasks.filter(t => t.status === "completed");
  
  const tasksForSelectedDate = selectedDate 
    ? tasks.filter(t => isSameDay(parseISO(t.deadline), selectedDate))
    : [];

  return (
    <div className="min-h-screen bg-[#fafafa] text-gray-900 font-sans pb-20">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3 font-black text-2xl text-indigo-600 tracking-tighter">
            <div className="w-10 h-10 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-indigo-200">
              <CheckCircle className="w-6 h-6" />
            </div>
            <div>
              Agente Pianificazione Lavoro
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                </span>
                <span className="text-[9px] font-bold text-green-600 uppercase tracking-wider">Sincronizzazione Live</span>
              </div>
            </div>
          </div>
          <nav className="flex gap-1 bg-gray-100/50 p-1.5 rounded-2xl">
            {[
              { id: "home", icon: Home, label: "Home" },
              { id: "calendar", icon: CalendarIcon, label: "Calendario" },
              { id: "history", icon: History, label: "Storico" },
              { id: "settings", icon: Settings, label: "Impostazioni" },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setView(item.id as any)}
                className={cn(
                  "px-4 py-2 rounded-xl transition-all flex items-center gap-2 text-sm font-bold",
                  view === item.id ? "bg-white text-indigo-600 shadow-sm" : "text-gray-400 hover:text-gray-600"
                )}
              >
                <item.icon className="w-4 h-4" />
                <span className="hidden sm:inline">{item.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12">
        <AnimatePresence mode="wait">
          {view === "home" && (
            <motion.div
              key="home"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-12"
            >
              {/* Welcome Section */}
              <div className="space-y-1">
                <h2 className="text-[10px] font-black text-indigo-500 uppercase tracking-[0.3em]">
                  Agente Pianificazione Lavoro
                </h2>
                <h1 className="text-xl font-medium text-gray-600">
                  Hai <span className="text-indigo-600 font-bold">{activeTasks.length} attività</span> in sospeso questa settimana.
                </h1>
                <div className="flex items-center gap-2 text-sm text-indigo-500/70 font-medium pt-1">
                  <Clock className="w-4 h-4" />
                  L'agente controlla autonomamente ogni giorno alle 08:00
                </div>
              </div>

              {/* Add Task Form */}
              <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-[0_2px_15px_rgb(0,0,0,0.02)]">
                <h2 className="text-base font-bold mb-3 flex items-center gap-3">
                  <span className="text-gray-300 font-light text-lg">+</span>
                  Aggiungi Nuova Attività
                </h2>
                <form onSubmit={handleCreateTask} className="space-y-3">
                  <div className="flex flex-col md:flex-row gap-2 items-center">
                    <div className="flex-1 w-full">
                      <input
                        type="text"
                        placeholder="Titolo Attività (es. Inviare Report)"
                        className="w-full rounded-lg border-gray-100 bg-gray-50/50 focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 p-2 border text-sm font-medium transition-all outline-none"
                        value={newTask.title}
                        onChange={e => setNewTask({ ...newTask, title: e.target.value })}
                      />
                    </div>
                    <div className="w-full md:w-36">
                      <input
                        type="date"
                        className="w-full rounded-lg border-gray-100 bg-gray-50/50 focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 p-2 border text-sm font-medium transition-all outline-none"
                        value={newTask.deadline}
                        onChange={e => setNewTask({ ...newTask, deadline: e.target.value })}
                      />
                    </div>
                    <button
                      type="submit"
                      className="w-full md:w-auto px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-800 font-bold text-sm shadow-md shadow-black/5 transition-all active:scale-95"
                    >
                      Aggiungi
                    </button>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <label className="cursor-pointer flex items-center gap-2 px-2 py-1 border border-gray-100 rounded-md text-[10px] font-bold text-gray-400 hover:bg-gray-50 transition-colors">
                      <Paperclip className="w-3 h-3" />
                      Allega File
                      <input 
                        type="file" 
                        multiple 
                        className="hidden" 
                        accept=".pdf,.doc,.docx,image/*"
                        onChange={(e) => handleFileUpload(e, true)}
                      />
                    </label>
                    
                    {newTask.files.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {newTask.files.map((file, index) => (
                          <div key={index} className="flex items-center gap-2 bg-indigo-50 px-3 py-1.5 rounded-lg text-xs font-bold text-indigo-600">
                            <span className="truncate max-w-[120px]">{file.name}</span>
                            <button type="button" onClick={() => removeFile(index, true)} className="hover:text-red-500">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </form>
              </div>

              {/* Active Tasks List Grouped by Month */}
              <div className="space-y-12">
                {activeTasks.length === 0 ? (
                  <div className="text-center py-20 bg-white rounded-[2.5rem] border border-dashed border-gray-200">
                    <p className="text-gray-400 font-medium">Nessuna attività in corso. Inizia ora!</p>
                  </div>
                ) : (
                  (Object.entries(
                    activeTasks.reduce<Record<string, Task[]>>((acc, task) => {
                      const month = format(parseISO(task.deadline), "MMMM yyyy", { locale: it });
                      if (!acc[month]) acc[month] = [];
                      acc[month].push(task);
                      return acc;
                    }, {})
                  ) as [string, Task[]][]).map(([month, monthTasks]) => (
                    <div key={month} className="space-y-8">
                      <h2 className="text-xl font-bold text-gray-900 capitalize tracking-tight border-b border-gray-100 pb-4">
                        {month}
                      </h2>
                      <div className="grid gap-6">
                        {monthTasks.map(task => (
                          <TaskCard
                            key={task.id}
                            task={task}
                            onUpdate={refreshTasks}
                            onDelete={async () => {
                              await api.deleteTask(task.id);
                              refreshTasks();
                            }}
                            handleFileUpload={handleFileUpload}
                            removeFile={removeFile}
                          />
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          )}

          {view === "calendar" && (
            <motion.div
              key="calendar"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="grid md:grid-cols-[300px_1fr] gap-8"
            >
              <div className="bg-white p-4 rounded-xl border shadow-sm h-fit">
                <DayPicker
                  mode="single"
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  locale={it}
                  modifiers={{
                    hasTask: (date) => tasks.some(t => isSameDay(parseISO(t.deadline), date) && t.status === "pending")
                  }}
                  modifiersStyles={{
                    hasTask: { fontWeight: "bold", color: "#4f46e5", textDecoration: "underline" }
                  }}
                />
              </div>
              
              <div className="space-y-4">
                <h2 className="text-lg font-semibold">
                  Attività del {selectedDate ? format(selectedDate, "d MMMM yyyy", { locale: it }) : "..."}
                </h2>
                {tasksForSelectedDate.length === 0 ? (
                  <p className="text-gray-500 italic">Nessuna attività per questa data.</p>
                ) : (
                  tasksForSelectedDate.map(task => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onUpdate={refreshTasks}
                      onDelete={async () => {
                        await api.deleteTask(task.id);
                        refreshTasks();
                      }}
                      handleFileUpload={handleFileUpload}
                      removeFile={removeFile}
                    />
                  ))
                )}
              </div>
            </motion.div>
          )}

          {view === "history" && (
            <motion.div
              key="history"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-lg font-semibold">Storico Attività Completate</h2>
                {completedTasks.length > 0 && (
                  <button
                    onClick={async () => {
                      if (confirm("Sei sicuro di voler eliminare definitivamente tutte le attività completate?")) {
                        for (const task of completedTasks) {
                          await api.deleteTask(task.id);
                        }
                        refreshTasks();
                      }
                    }}
                    className="text-xs text-red-500 hover:text-red-700 font-medium flex items-center gap-1 px-3 py-1.5 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Svuota Storico
                  </button>
                )}
              </div>
              <div className="space-y-8">
                {(Object.entries(
                  completedTasks.reduce<Record<string, Task[]>>((acc, task) => {
                    const month = format(parseISO(task.deadline), "MMMM yyyy", { locale: it });
                    if (!acc[month]) acc[month] = [];
                    acc[month].push(task);
                    return acc;
                  }, {})
                ) as [string, Task[]][]).map(([month, monthTasks]) => (
                  <div key={month}>
                    <h3 className="text-md font-medium text-gray-500 mb-3 uppercase tracking-wider text-xs border-b pb-1">
                      {month}
                    </h3>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                      {monthTasks.map(task => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          onUpdate={refreshTasks}
                          onDelete={async () => {
                            await api.deleteTask(task.id);
                            refreshTasks();
                          }}
                          handleFileUpload={handleFileUpload}
                          removeFile={removeFile}
                        />
                      ))}
                    </div>
                  </div>
                ))}
                {completedTasks.length === 0 && (
                  <p className="text-gray-500 text-center py-12">Nessuna attività completata nello storico.</p>
                )}
              </div>
            </motion.div>
          )}

          {view === "settings" && (
            <motion.div
              key="settings"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <SettingsPanel />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

// Helper icon
function Briefcase(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="20" height="14" x="2" y="7" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  )
}
