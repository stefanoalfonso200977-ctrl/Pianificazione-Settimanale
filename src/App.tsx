import { useState, useEffect, type FormEvent, type FC, type ChangeEvent } from "react";
import { format, isSameDay, addDays, parseISO, differenceInCalendarDays, startOfWeek, endOfWeek, eachDayOfInterval, isToday, setMonth, setYear, getYear, getMonth } from "date-fns";
import { it } from "date-fns/locale";
import { Calendar as CalendarIcon, Trash2, Edit2, CheckCircle, AlertTriangle, Mail, Sparkles, History, Home, Settings, Paperclip, X, FileText, Image as ImageIcon, Clock, Cloud, Database, ChevronLeft, ChevronRight, Plus, ListTodo, BookOpen, Maximize2, Bell } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "./lib/utils";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, orderBy, Timestamp, setDoc } from "firebase/firestore";
import { getMessaging, getToken, onMessage } from "firebase/messaging";

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
let messaging: any = null;

const initFirebase = (config: any) => {
  try {
    const app = initializeApp(config);
    db = getFirestore(app);
    
    // Messaging only works in browser
    if (typeof window !== 'undefined') {
      try {
        messaging = getMessaging(app);
      } catch (e) {
        console.warn("Messaging not supported in this browser");
      }
    }
    
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

// API Service Wrapper (Hybrid: Firebase or Backend API)
const api = {
  useFirebase: () => !!db,
  
  getTasks: async () => {
    if (db) {
      try {
        const { getDocs, collection } = await import("firebase/firestore");
        const snapshot = await getDocs(collection(db, "tasks"));
        return snapshot.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          .filter(doc => doc.id !== "_settings_") as Task[];
      } catch (e) {
        console.error("Error fetching from Firebase:", e);
        return [];
      }
    }
    
    // Backend API
    const res = await fetch("/api/tasks");
    if (!res.ok) return [];
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
    
    // Backend API
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...task,
        status: "pending",
        subtasks: task.subtasks || [],
        files: task.files || []
      })
    });
    return res.json();
  },
  updateTask: async (id: string | number, task: Partial<Task>) => {
    if (db) {
      const docRef = doc(db, "tasks", String(id));
      const { id: _, ...updateData } = task;
      await updateDoc(docRef, updateData);
      return;
    }
    
    // Backend API
    const res = await fetch(`/api/tasks/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(task)
    });
    return res.json();
  },
  deleteTask: async (id: string | number) => {
    if (db) {
      await deleteDoc(doc(db, "tasks", String(id)));
      return;
    }
    
    // Backend API
    await fetch(`/api/tasks/${id}`, { method: "DELETE" });
  },
  breakdownTask: async (description: string, files?: TaskFile[]) => {
    try {
      const res = await fetch("/api/gemini/breakdown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskDescription: description, files })
      });
      return res.json();
    } catch (e: any) {
      console.error("Breakdown error:", e);
      return { error: e.message };
    }
  },
  parseTask: async (text: string, currentDate: string) => {
    try {
      const res = await fetch("/api/gemini/parse-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, currentDate })
      });
      return res.json();
    } catch (e: any) {
      console.error("Parse error:", e);
      return { error: e.message };
    }
  },
  researchTask: async (text: string) => {
    try {
      const res = await fetch("/api/gemini/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      });
      return res.json();
    } catch (e: any) {
      console.error("Research error:", e);
      return { error: e.message };
    }
  },
  getSettings: async () => {
    const res = await fetch("/api/settings");
    if (!res.ok) return {};
    return res.json();
  },
  saveSettings: async (settings: any) => {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings)
    });
    return res.ok;
  },
  triggerCheck: async () => {
    const res = await fetch("/api/cron", { method: "POST" });
    return res.json();
  },
  testEmail: async (email: string) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 seconds timeout

    try {
      const res = await fetch("/api/test-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      return res.json();
    } catch (e: any) {
      clearTimeout(timeoutId);
      if (e.name === 'AbortError') {
        return { success: false, error: "Il server SMTP non risponde (Timeout). Verifica l'Host e la Porta." };
      }
      throw e;
    }
  },
  getEnvStatus: async () => {
    const res = await fetch("/api/debug/env");
    return res.json();
  },
  registerPushToken: async (token: string) => {
    if (db) {
      const tokenRef = doc(db, "push_tokens", token);
      await setDoc(tokenRef, {
        token,
        updatedAt: Timestamp.now(),
        platform: navigator.userAgent
      });
    }
  }
};

// Components

const TaskCard: FC<{ task: Task; onUpdate: () => void; onDelete: () => void; handleFileUpload?: any; removeFile?: any }> = ({ task, onUpdate, onDelete, handleFileUpload, removeFile }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [showFullScreen, setShowFullScreen] = useState(false);
  const [editTitle, setEditTitle] = useState(task.title);
  const [editDesc, setEditDesc] = useState(task.description);
  const [editDeadline, setEditDeadline] = useState(task.deadline);
  const [editFiles, setEditFiles] = useState<TaskFile[]>(task.files || []);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const deadline = parseISO(task.deadline);
  const daysLeft = differenceInCalendarDays(deadline, new Date());
  
  let cardColorClass = "border-gray-100 bg-white";
  let deadlineTextColor = "text-gray-400";
  let alertElement = null;

  if (task.status === "pending") {
    if (daysLeft < 0) {
      cardColorClass = "border-red-500 bg-red-50 shadow-sm shadow-red-100";
      deadlineTextColor = "text-red-600 font-bold";
      alertElement = (
        <div className="flex items-center gap-1 text-xs font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full mt-1 w-fit">
          <AlertTriangle className="w-3 h-3" />
          Scaduto!
        </div>
      );
    } else if (daysLeft === 0 || daysLeft === 1) {
      cardColorClass = "border-red-300 bg-red-50/30";
      deadlineTextColor = "text-red-500 font-bold";
    } else if (daysLeft === 2) {
      cardColorClass = "border-orange-300 bg-orange-50/30";
      deadlineTextColor = "text-orange-500 font-bold";
    } else if (daysLeft === 3) {
      cardColorClass = "border-yellow-300 bg-yellow-50/30";
      deadlineTextColor = "text-yellow-600 font-bold";
    }
  }

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
      <div className={cn("p-3.5 rounded-xl border shadow-sm space-y-2", cardColorClass)}>
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
    <>
      <motion.div
        layout
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className={cn("p-3.5 rounded-2xl border shadow-[0_2px_15px_rgb(0,0,0,0.02)] transition-all w-full group relative", cardColorClass)}
      >
        <div className="flex gap-3 items-start">
          {/* Checkbox Circle */}
          <button 
            onClick={handleComplete}
            className={cn(
              "mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all shrink-0",
              task.status === "completed" 
                ? "bg-red-600 border-red-600 text-white" 
                : "border-gray-200 hover:border-red-300 bg-white"
            )}
          >
            {task.status === "completed" && <CheckCircle className="w-3 h-3" />}
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex justify-between items-start mb-0.5">
              <div className="space-y-0.5">
                <h3 className={cn(
                  "font-bold text-sm tracking-tight transition-all cursor-pointer hover:text-red-600",
                  task.status === "completed" ? "line-through text-gray-400" : "text-gray-900"
                )} onClick={() => setShowFullScreen(true)}>
                  {task.title}
                </h3>
                <div className={cn("flex items-center gap-1.5 text-[9px] font-medium", deadlineTextColor)}>
                  <CalendarIcon className="w-2.5 h-2.5" />
                  {format(deadline, "d MMM yyyy", { locale: it })}
                </div>
                {alertElement}
              </div>

              <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button 
                  onClick={() => setShowFullScreen(true)}
                  className="p-1 rounded-full hover:bg-emerald-50 text-gray-300 hover:text-emerald-500 transition-colors"
                  title="Espandi"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
                <button 
                  onClick={handleGeminiBreakdown}
                  className="p-1 rounded-full hover:bg-red-50 text-red-400 hover:text-red-600 transition-colors"
                  title="Assistente AI"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                </button>
                <button 
                  onClick={() => setIsEditing(true)} 
                  className="p-1 rounded-full hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors"
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
              <div 
                className="text-gray-500 text-[11px] mt-0.5 leading-relaxed line-clamp-2 cursor-pointer hover:text-gray-700"
                onClick={() => setShowFullScreen(true)}
              >
                <ReactMarkdown
                  components={{
                    p: ({node, ...props}) => <p className="inline" {...props} />,
                    h1: ({node, ...props}) => <span className="font-bold" {...props} />,
                    h2: ({node, ...props}) => <span className="font-bold" {...props} />,
                    li: ({node, ...props}) => <span className="mr-1" {...props} />,
                  }}
                >
                   {task.description.substring(0, 150) + (task.description.length > 150 ? "..." : "")}
                </ReactMarkdown>
              </div>
            )}

            {task.subtasks && task.subtasks.length > 0 && (
              <div className="mt-2 space-y-1">
                {task.subtasks.slice(0, 2).map((st, i) => (
                  <div key={i} className="text-[10px] text-gray-600 flex items-center gap-2 bg-red-50/30 p-1 rounded-lg">
                    <div className="w-1 h-1 bg-red-400 rounded-full shrink-0" />
                    {st}
                  </div>
                ))}
                {task.subtasks.length > 2 && (
                  <div className="text-[9px] text-gray-400 pl-3">+{task.subtasks.length - 2} altri</div>
                )}
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
                  className="text-red-500 hover:bg-red-50 p-0.5 rounded-md transition-colors"
                >
                  <X className="w-3.5 h-3.5 rotate-45" />
                </button>
              </div>
              
              {task.files && task.files.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {task.files.map((file, i) => (
                    <div key={i} className="flex items-center gap-1 bg-gray-50 border border-gray-100 px-1.5 py-0.5 rounded-md text-[9px] text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer">
                      {file.mimeType.startsWith('image/') ? (
                        <ImageIcon className="w-2.5 h-2.5 text-red-400" />
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

      <AnimatePresence>
        {showFullScreen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-white flex flex-col"
          >
            {/* Header */}
            <div className="p-4 border-b flex items-center justify-between bg-gray-50 sticky top-0 z-10 shadow-sm">
              <div className="flex items-center gap-3 overflow-hidden">
                <button 
                  onClick={() => setShowFullScreen(false)}
                  className="p-2 hover:bg-gray-200 rounded-full transition-colors shrink-0"
                >
                  <ChevronLeft className="w-6 h-6" />
                </button>
                <h2 className="text-xl font-bold truncate text-gray-800">{task.title}</h2>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                 <span className="text-sm text-gray-500 font-medium hidden sm:block">
                   {format(parseISO(task.deadline), "d MMMM yyyy", { locale: it })}
                 </span>
                 <button 
                   onClick={() => setShowFullScreen(false)}
                   className="p-2 hover:bg-red-50 hover:text-red-500 rounded-full text-gray-500 transition-colors"
                 >
                   <X className="w-6 h-6" />
                 </button>
              </div>
            </div>
            
            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 md:p-12 max-w-5xl mx-auto w-full bg-white">
              <div className="prose prose-lg prose-red max-w-none">
                <ReactMarkdown
                  components={{
                    h1: ({node, ...props}) => <h1 className="text-3xl font-black text-gray-900 mb-6 mt-8 border-b pb-2" {...props} />,
                    h2: ({node, ...props}) => <h2 className="text-2xl font-bold text-gray-800 mb-4 mt-8" {...props} />,
                    h3: ({node, ...props}) => <h3 className="text-xl font-bold text-gray-800 mb-3 mt-6" {...props} />,
                    p: ({node, ...props}) => <p className="mb-4 text-gray-700 leading-relaxed text-lg" {...props} />,
                    ul: ({node, ...props}) => <ul className="list-disc pl-6 mb-6 space-y-2 text-gray-700" {...props} />,
                    ol: ({node, ...props}) => <ol className="list-decimal pl-6 mb-6 space-y-2 text-gray-700" {...props} />,
                    li: ({node, ...props}) => <li className="pl-1" {...props} />,
                    a: ({node, ...props}) => <a className="text-red-600 hover:underline font-medium" {...props} />,
                    blockquote: ({node, ...props}) => <blockquote className="border-l-4 border-red-200 pl-4 italic text-gray-600 my-6 bg-gray-50 p-4 rounded-r-lg" {...props} />,
                    code: ({node, ...props}) => <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono text-pink-600" {...props} />,
                    strong: ({node, ...props}) => <strong className="font-bold text-gray-900" {...props} />,
                  }}
                >
                  {task.description || "*Nessuna descrizione disponibile.*"}
                </ReactMarkdown>
              </div>
              
              {/* Subtasks in Full Screen */}
              {task.subtasks && task.subtasks.length > 0 && (
                <div className="mt-12 pt-8 border-t border-gray-100">
                  <h3 className="text-xl font-bold mb-6 flex items-center gap-2 text-gray-800">
                    <ListTodo className="w-6 h-6 text-red-500" />
                    Lista di Controllo
                  </h3>
                  <ul className="space-y-3">
                    {task.subtasks.map((sub, i) => (
                      <li key={i} className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
                        <div className="mt-1 w-5 h-5 rounded-full border-2 border-red-200 flex items-center justify-center shrink-0">
                            <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                        </div>
                        <span className="text-gray-700 font-medium">{sub}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Attachments in Full Screen */}
              {task.files && task.files.length > 0 && (
                <div className="mt-12 pt-8 border-t border-gray-100">
                  <h3 className="text-xl font-bold mb-6 flex items-center gap-2 text-gray-800">
                    <Paperclip className="w-6 h-6 text-red-500" />
                    Allegati
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {task.files.map((file, i) => (
                      <div key={i} className="flex flex-col gap-2 p-4 rounded-xl border border-gray-200 hover:border-red-300 hover:shadow-md transition-all bg-white group cursor-pointer">
                        <div className="aspect-video bg-gray-100 rounded-lg flex items-center justify-center overflow-hidden relative">
                            {file.mimeType.startsWith('image/') ? (
                                <img src={file.data} alt={file.name} className="w-full h-full object-cover" />
                            ) : (
                                <FileText className="w-12 h-12 text-gray-300 group-hover:text-red-500 transition-colors" />
                            )}
                        </div>
                        <span className="font-medium text-sm truncate text-gray-700 group-hover:text-red-700">{file.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

function SettingsPanel() {
  const [email, setEmail] = useState(() => localStorage.getItem("settings_draft_email") || "");
  const [smtpHost, setSmtpHost] = useState(() => localStorage.getItem("settings_draft_smtpHost") || "");
  const [smtpPort, setSmtpPort] = useState(() => localStorage.getItem("settings_draft_smtpPort") || "587");
  const [smtpUser, setSmtpUser] = useState(() => localStorage.getItem("settings_draft_smtpUser") || "");
  const [smtpPass, setSmtpPass] = useState(() => localStorage.getItem("settings_draft_smtpPass") || "");
  const [loading, setLoading] = useState(false);
  const [envStatus, setEnvStatus] = useState<{ hasSmtp: boolean; hasServiceAccount: boolean } | null>(null);
  const [pushEnabled, setPushEnabled] = useState(false);

  useEffect(() => {
    api.getSettings().then(data => {
      // Only overwrite if draft is empty or we just loaded
      if (data.email && !email) setEmail(data.email);
      if (data.smtpHost && !smtpHost) setSmtpHost(data.smtpHost);
      if (data.smtpPort && smtpPort === "587") setSmtpPort(String(data.smtpPort));
      if (data.smtpUser && !smtpUser) setSmtpUser(data.smtpUser);
      if (data.smtpPass && !smtpPass) setSmtpPass(data.smtpPass);
    });
    api.getEnvStatus().then(setEnvStatus);
    
    if ("Notification" in window) {
      setPushEnabled(Notification.permission === "granted");
    }
  }, []);

  // Persist drafts to localStorage
  useEffect(() => { localStorage.setItem("settings_draft_email", email); }, [email]);
  useEffect(() => { localStorage.setItem("settings_draft_smtpHost", smtpHost); }, [smtpHost]);
  useEffect(() => { localStorage.setItem("settings_draft_smtpPort", smtpPort); }, [smtpPort]);
  useEffect(() => { localStorage.setItem("settings_draft_smtpUser", smtpUser); }, [smtpUser]);
  useEffect(() => { localStorage.setItem("settings_draft_smtpPass", smtpPass); }, [smtpPass]);

  const handleEnablePush = async () => {
    if (!messaging) {
      alert("Le notifiche push non sono supportate in questo browser o la configurazione Firebase non è corretta.");
      return;
    }

    try {
      console.log("Requesting notification permission...");
      const permission = await Notification.requestPermission();
      if (permission === "granted") {
        const vapidKey = "BIdM_sJF62J2pmknqLylOut4fGdmhWCGhZP1Lqk3e-4zDu-Oj_4J-uqhxLOJrevU2wCnCi8b2j9OsmRmKQ81KMI"; 
        
        console.log("Registering service worker...");
        // Ensure the service worker is registered and ready
        const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
          scope: '/'
        });
        
        // Wait for the service worker to be active
        await navigator.serviceWorker.ready;

        console.log("Getting FCM token...");
        const token = await getToken(messaging, { 
          vapidKey,
          serviceWorkerRegistration: registration
        });

        if (token) {
          console.log("Token received:", token);
          await api.registerPushToken(token);
          setPushEnabled(true);
          alert("Notifiche push attivate con successo!");
        } else {
          throw new Error("Nessun token ricevuto da Firebase.");
        }
      } else {
        alert("Permesso negato per le notifiche. Controlla le impostazioni del browser.");
      }
    } catch (e: any) {
      console.error("Push error details:", e);
      let errorMsg = e.message;
      if (e.code === 'messaging/token-subscribe-failed') {
        errorMsg = "Errore di sottoscrizione (VAPID Key non valida o problema di rete). Assicurati che la chiave VAPID sia corretta e che il progetto Firebase abbia le API Cloud Messaging attive.";
      }
      alert("Errore durante l'attivazione delle notifiche: " + errorMsg);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, smtpHost, smtpPort: parseInt(smtpPort), smtpUser, smtpPass })
      });
      
      if (response.ok) {
        setEnvStatus(prev => ({ ...prev, hasSmtp: !!smtpHost }));
        alert("Impostazioni salvate correttamente nel cloud!");
      } else {
        const errorData = await response.json();
        alert(`Errore durante il salvataggio: ${errorData.error || "Errore sconosciuto"}`);
      }
    } catch (e: any) {
      console.error("Save error:", e);
      alert("Errore critico durante il salvataggio: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleTestEmail = async () => {
    if (!email) return alert("Inserisci prima un'email");
    setLoading(true);
    const result = await api.testEmail(email);
    setLoading(false);
    if (result.success) {
      if (result.simulated) {
        alert("ATTENZIONE: L'email è stata solo SIMULATA perché mancano i dati SMTP (Host, Utente, Password). Compila i campi SMTP, salva le impostazioni e riprova.");
      } else {
        alert("Email di test inviata! Controlla la tua casella di posta (anche nello Spam).");
      }
    } else {
      alert(`Errore durante l'invio: ${result.error}\nAssicurati che i dati SMTP e la Password per le App siano corretti.`);
    }
  };

  return (
    <div className="bg-white p-6 rounded-xl border shadow-sm max-w-md mx-auto mt-8">
      <h2 className="text-xl font-semibold mb-4 flex items-center justify-between">
        <span className="flex items-center gap-2"><Settings className="w-5 h-5" /> Impostazioni Notifiche</span>
        <span className="text-[10px] font-normal text-gray-400 italic flex items-center gap-1">
          <Database className="w-3 h-3" /> Bozza salvata localmente
        </span>
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

      {envStatus && !envStatus.hasServiceAccount && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-xl flex gap-3 items-start">
          <Database className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
          <div className="text-xs text-blue-800 space-y-1">
            <p className="font-bold">Database in modalità limitata</p>
            <p>Non hai configurato <code>FIREBASE_SERVICE_ACCOUNT</code> su Vercel. Il salvataggio delle impostazioni potrebbe fallire se le regole di Firebase sono restrittive.</p>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email per le notifiche</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 text-sm p-2 border mb-2"
            placeholder="tua@email.com"
          />
          <p className="text-xs text-gray-500">
            Riceverai notifiche 3 giorni prima della scadenza e il giorno stesso.
          </p>
          <div className="mt-4 p-3 bg-blue-50 border border-blue-100 rounded-lg">
            <p className="text-[11px] text-blue-800 leading-relaxed">
              <strong>💡 Tip per Gmail:</strong> Se usi Gmail, usa <code>smtp.gmail.com</code> (Porta 465 o 587) e assicurati di usare una <strong>"Password per le App"</strong> invece della tua password normale.
            </p>
          </div>
        </div>

        <div className="pt-4 border-t space-y-3">
          <h3 className="text-sm font-medium text-gray-700">Configurazione Server Email (SMTP)</h3>
          <p className="text-xs text-gray-500 mb-2">Per inviare email reali, inserisci i dati del tuo provider email (es. Gmail). Se usi Gmail, devi generare una "Password per le app".</p>
          
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Host SMTP</label>
              <input type="text" value={smtpHost} onChange={e => setSmtpHost(e.target.value)} placeholder="smtp.gmail.com" className="w-full rounded-lg border-gray-300 shadow-sm text-sm p-2 border" />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Porta</label>
              <input type="text" value={smtpPort} onChange={e => setSmtpPort(e.target.value)} placeholder="587" className="w-full rounded-lg border-gray-300 shadow-sm text-sm p-2 border" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Utente (Tua Email)</label>
              <input type="email" value={smtpUser} onChange={e => setSmtpUser(e.target.value)} placeholder="tua@gmail.com" className="w-full rounded-lg border-gray-300 shadow-sm text-sm p-2 border" />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Password (App Password)</label>
              <input type="password" value={smtpPass} onChange={e => setSmtpPass(e.target.value)} placeholder="••••••••" className="w-full rounded-lg border-gray-300 shadow-sm text-sm p-2 border" />
            </div>
          </div>
        </div>

        <div className="pt-4 border-t flex items-center justify-between">
          <button
            onClick={handleTestEmail}
            disabled={loading}
            className="text-sm text-gray-600 hover:text-red-600 flex items-center gap-2 disabled:opacity-50"
          >
            <Mail className="w-4 h-4" />
            Invia email di test
          </button>
          
          <button
            onClick={handleSave}
            disabled={loading}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium disabled:opacity-50"
          >
            Salva Impostazioni
          </button>
        </div>

        <div className="pt-4 border-t space-y-3">
          <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <Bell className="w-4 h-4 text-red-500" />
            Notifiche Push Web
          </h3>
          <p className="text-xs text-gray-500">
            Ricevi avvisi istantanei sul tuo dispositivo (PC o Smartphone) anche quando l'app è chiusa.
          </p>
          
          <button
            onClick={handleEnablePush}
            disabled={pushEnabled}
            className={cn(
              "w-full text-center px-3 py-2 rounded-lg text-sm font-bold transition-colors border",
              pushEnabled 
                ? "bg-green-50 text-green-700 border-green-200 cursor-default" 
                : "bg-red-50 text-red-700 border-red-200 hover:bg-red-100"
            )}
          >
            {pushEnabled ? (
              <span className="flex items-center justify-center gap-2">
                <CheckCircle className="w-4 h-4" /> Notifiche Attive su questo dispositivo
              </span>
            ) : "Attiva Notifiche Push"}
          </button>
          
          {!pushEnabled && (
            <p className="text-[10px] text-gray-400 italic">
              Nota: Richiede il supporto del browser e una configurazione VAPID valida in Firebase.
            </p>
          )}
        </div>

        <div className="pt-4 border-t space-y-3">
          <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <Cloud className="w-4 h-4 text-red-500" />
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
            className="w-full text-center px-3 py-2 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 text-sm font-bold transition-colors border border-red-200"
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
  const [isParsing, setIsParsing] = useState(false);
  const [newTask, setNewTask] = useState<{title: string, description: string, deadline: string, files: TaskFile[]}>({ 
    title: "", 
    description: "", 
    deadline: format(new Date(), "yyyy-MM-dd"),
    files: []
  });
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [showAgentOptions, setShowAgentOptions] = useState(false);
  const [researchMode, setResearchMode] = useState(false);
  const [researchQuery, setResearchQuery] = useState("");
  const [pendingTaskTitle, setPendingTaskTitle] = useState("");
  const [isReporting, setIsReporting] = useState(false);

  const handleSendReport = async () => {
    setIsReporting(true);
    try {
      const result = await api.triggerCheck();
      if (result.success) {
        alert(`Report inviato! ${result.taskCount} attività trovate in scadenza.`);
      } else {
        alert("Errore durante l'invio del report: " + result.message);
      }
    } catch (e: any) {
      alert("Errore durante l'invio del report: " + e.message);
    } finally {
      setIsReporting(false);
    }
  };

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
    // If Firebase is active, we rely on the real-time listener (onSnapshot)
    // to update the state. Manually fetching might cause race conditions or empty state.
    if (api.useFirebase()) return;
    
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
      <header className="bg-red-600 border-b border-red-700 sticky top-0 z-10 shadow-md">
        <div className="max-w-5xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3 font-black text-2xl text-white tracking-tighter">
            <div className="w-10 h-10 bg-white rounded-2xl flex items-center justify-center text-red-600 shadow-lg shadow-red-800">
              <CheckCircle className="w-6 h-6" />
            </div>
            Agente Pianificazione Lavoro
          </div>
          <nav className="flex gap-1 bg-white p-1.5 rounded-2xl shadow-sm items-center">
            {[
              { id: "home", icon: Home, label: "Home" },
              { id: "history", icon: History, label: "Storico" },
              { id: "settings", icon: Settings, label: "Impostazioni" },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setView(item.id as any)}
                className={cn(
                  "px-4 py-2 rounded-xl transition-all flex items-center gap-2 text-sm font-bold",
                  view === item.id ? "bg-red-600 text-white shadow-md" : "text-gray-500 hover:bg-gray-100 hover:text-red-600"
                )}
              >
                <item.icon className="w-4 h-4" />
                <span className="hidden sm:inline">{item.label}</span>
              </button>
            ))}
            <div className="w-px h-6 bg-gray-200 mx-1 hidden sm:block" />
            <button
              onClick={handleSendReport}
              disabled={isReporting}
              className="px-4 py-2 rounded-xl transition-all flex items-center gap-2 text-sm font-bold text-red-600 hover:bg-red-50 disabled:opacity-50 active:scale-95"
              title="Invia Report Scadenze"
            >
              <Mail className="w-4 h-4" />
              <span className="hidden md:inline">{isReporting ? "Invio..." : "Report"}</span>
            </button>
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
              {/* Welcome Section & Calendar Container */}
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                {/* Welcome Text */}
                <div className="space-y-1 flex-1">
                  <h2 className="text-[10px] font-black text-red-500 uppercase tracking-[0.3em]">
                    Agente Pianificazione Lavoro
                  </h2>
                  <h1 className="text-xl font-medium text-gray-600">
                    Hai <span className="text-red-600 font-bold">{activeTasks.length} attività</span> in sospeso questa settimana.
                  </h1>
                  <div className="flex items-center gap-2 text-sm text-red-500/70 font-medium pt-1">
                    <Clock className="w-4 h-4" />
                    L'agente controlla autonomamente ogni giorno alle 08:00
                  </div>
                </div>

                {/* Horizontal Weekly Calendar */}
                <div className="bg-white p-4 rounded-3xl border border-gray-100 shadow-sm flex-1 max-w-xl">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <select
                        value={getMonth(currentWeekStart)}
                        onChange={(e) => {
                          const newDate = setMonth(currentWeekStart, parseInt(e.target.value));
                          setCurrentWeekStart(startOfWeek(newDate, { weekStartsOn: 1 }));
                        }}
                        className="bg-transparent text-xs font-bold text-gray-500 uppercase tracking-wider cursor-pointer outline-none hover:text-red-600 appearance-none pr-2"
                        style={{ backgroundImage: 'none' }}
                      >
                        {Array.from({ length: 12 }, (_, i) => (
                          <option key={i} value={i}>
                            {format(new Date(2000, i, 1), "MMMM", { locale: it })}
                          </option>
                        ))}
                      </select>
                      <select
                        value={getYear(currentWeekStart)}
                        onChange={(e) => {
                          const newDate = setYear(currentWeekStart, parseInt(e.target.value));
                          setCurrentWeekStart(startOfWeek(newDate, { weekStartsOn: 1 }));
                        }}
                        className="bg-transparent text-xs font-bold text-gray-500 uppercase tracking-wider cursor-pointer outline-none hover:text-red-600 appearance-none"
                        style={{ backgroundImage: 'none' }}
                      >
                        {Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - 2 + i).map((year) => (
                          <option key={year} value={year}>{year}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex gap-1">
                      <button 
                        onClick={() => setCurrentWeekStart(d => addDays(d, -7))}
                        className="p-1 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => setCurrentWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}
                        className="px-2 py-1 text-[10px] font-bold text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        Oggi
                      </button>
                      <button 
                        onClick={() => setCurrentWeekStart(d => addDays(d, 7))}
                        className="p-1 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-7 gap-1">
                    {eachDayOfInterval({
                      start: currentWeekStart,
                      end: endOfWeek(currentWeekStart, { weekStartsOn: 1 })
                    }).map((day, i) => {
                      const isCurrentDay = isToday(day);
                      const isSelected = selectedDate && isSameDay(day, selectedDate);
                      const dayTasks = tasks.filter(t => isSameDay(parseISO(t.deadline), day) && t.status === "pending");
                      const hasTasks = dayTasks.length > 0;
                      
                      return (
                        <div 
                          key={i} 
                          className={cn(
                            "flex flex-col items-center justify-center p-2 rounded-xl border transition-all cursor-pointer hover:scale-105",
                            isCurrentDay 
                              ? "bg-red-600 text-white border-red-600 shadow-md shadow-red-200" 
                              : isSelected
                                ? "bg-red-50 text-red-700 border-red-200"
                                : "bg-transparent text-gray-400 border-transparent hover:bg-gray-50 hover:text-gray-900"
                          )}
                          onClick={() => {
                            setSelectedDate(day);
                          }}
                        >
                          <span className="text-[9px] uppercase font-bold tracking-wider opacity-70">
                            {format(day, "EEE", { locale: it })}
                          </span>
                          <span className={cn("text-sm font-black", isCurrentDay ? "text-white" : "text-gray-900")}>
                            {format(day, "d")}
                          </span>
                          {hasTasks && (
                            <div className={cn(
                              "mt-0.5 px-1 py-[1px] rounded-full text-[8px] font-bold",
                              isCurrentDay ? "bg-white/20 text-white" : "bg-red-100 text-red-600"
                            )}>
                              {dayTasks.length}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>



              {/* Add Task Form (Agent Interface) */}
              <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)] relative overflow-hidden group">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-500 via-orange-500 to-yellow-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                
                {showAgentOptions && (
                    <div className="absolute inset-0 bg-white/95 backdrop-blur-sm z-10 flex flex-col items-center justify-center p-6 text-center animate-in fade-in zoom-in-95 duration-200">
                      {!researchMode ? (
                        <>
                          <h3 className="text-lg font-bold text-gray-800 mb-2">Come vuoi procedere?</h3>
                          <p className="text-sm text-gray-500 mb-6 max-w-xs">
                            Posso pianificare questa attività o fare una ricerca per te.
                          </p>
                          
                          <div className="grid grid-cols-2 gap-3 w-full max-w-sm">
                            <button
                              onClick={async () => {
                                setShowAgentOptions(false);
                                setIsParsing(true);
                                const parsed = await api.parseTask(pendingTaskTitle, format(new Date(), "yyyy-MM-dd"));
                                setIsParsing(false);
                                
                                if (parsed && !parsed.error) {
                                  await api.createTask({
                                    title: parsed.title || pendingTaskTitle,
                                    description: parsed.description || "",
                                    deadline: parsed.deadline || format(new Date(), "yyyy-MM-dd"),
                                    subtasks: parsed.subtasks || [],
                                    files: newTask.files
                                  });
                                  setNewTask({ title: "", description: "", deadline: format(new Date(), "yyyy-MM-dd"), files: [] });
                                  refreshTasks();
                                }
                              }}
                              className="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl bg-red-50 border-2 border-red-100 text-red-700 hover:bg-red-100 hover:border-red-200 transition-all group"
                            >
                              <div className="p-2 bg-white rounded-full shadow-sm group-hover:scale-110 transition-transform">
                                <ListTodo className="w-5 h-5" />
                              </div>
                              <span className="font-bold text-sm">Pianifica e Dividi</span>
                            </button>
                            
                            <button
                              onClick={() => {
                                setResearchMode(true);
                                setResearchQuery(pendingTaskTitle);
                              }}
                              className="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl bg-emerald-50 border-2 border-emerald-100 text-emerald-700 hover:bg-emerald-100 hover:border-emerald-200 transition-all group"
                            >
                              <div className="p-2 bg-white rounded-full shadow-sm group-hover:scale-110 transition-transform">
                                <BookOpen className="w-5 h-5" />
                              </div>
                              <span className="font-bold text-sm">Fai una Ricerca</span>
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <h3 className="text-lg font-bold text-gray-800 mb-2">In cosa posso aiutarti?</h3>
                          <p className="text-sm text-gray-500 mb-4 max-w-xs">
                            Descrivi cosa vuoi che cerchi o approfondisca per te.
                          </p>
                          
                          <textarea
                            value={researchQuery}
                            onChange={(e) => setResearchQuery(e.target.value)}
                            className="w-full max-w-sm p-3 rounded-xl border border-gray-200 bg-gray-50 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 min-h-[80px] resize-none"
                            placeholder="Es. Cerca i migliori hotel a Tokyo..."
                            autoFocus
                          />
                          
                          <button
                            onClick={async () => {
                              setShowAgentOptions(false);
                              setResearchMode(false);
                              setIsParsing(true);
                              const research = await api.researchTask(researchQuery);
                              setIsParsing(false);
                              
                              if (research && !research.content) {
                                alert("Errore durante la ricerca: " + (research.error || "Nessun risultato"));
                                return;
                              }
                              
                              await api.createTask({
                                  title: `Ricerca: ${researchQuery.length > 30 ? researchQuery.substring(0, 30) + "..." : researchQuery}`,
                                  description: research.content,
                                  deadline: format(selectedDate || new Date(), "yyyy-MM-dd"),
                                  files: newTask.files
                              });
                              setNewTask({ title: "", description: "", deadline: format(new Date(), "yyyy-MM-dd"), files: [] });
                              refreshTasks();
                            }}
                            disabled={!researchQuery.trim()}
                            className="w-full max-w-sm py-3 bg-emerald-600 text-white rounded-xl font-bold text-sm shadow-lg shadow-emerald-200 hover:bg-emerald-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                          >
                            Avvia Ricerca <Sparkles className="w-4 h-4" />
                          </button>
                        </>
                      )}
                      
                      <button 
                        onClick={() => {
                          setShowAgentOptions(false);
                          setResearchMode(false);
                        }}
                        className="mt-6 text-xs font-bold text-gray-400 hover:text-gray-600 underline"
                      >
                        Annulla
                      </button>
                    </div>
                  )}

                <h2 className="text-lg font-bold mb-4 flex items-center gap-2 text-gray-800">
                  <div className="p-2 bg-red-50 rounded-xl text-red-600">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  Nuova Attività
                </h2>
                
                <form onSubmit={async (e) => {
                  e.preventDefault();
                  if (!newTask.title) return;
                  
                  // If it's just a title and no deadline was explicitly set by AI, 
                  // we could just create it normally. But let's try to parse it if it looks like a sentence.
                  if (newTask.title.split(' ').length > 2) {
                    setPendingTaskTitle(newTask.title);
                    setShowAgentOptions(true);
                    return;
                  }
                  
                  // Fallback to normal creation
                  await handleCreateTask(e);
                }} className="space-y-4">
                  <div className="relative">
                    <textarea
                      placeholder="Cosa devi organizzare? (es. 'Prenota ristorante per venerdì sera', 'Prepara presentazione per domani')"
                      className="w-full rounded-2xl border-gray-200 bg-gray-50 focus:bg-white focus:border-red-500 focus:ring-4 focus:ring-red-500/10 p-4 pl-4 min-h-[100px] border text-sm font-medium transition-all outline-none resize-none"
                      value={newTask.title}
                      onChange={e => setNewTask({ ...newTask, title: e.target.value })}
                      disabled={isParsing}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          e.currentTarget.form?.requestSubmit();
                        }
                      }}
                    />
                    <div className="absolute bottom-3 right-3 flex items-center gap-1 bg-white p-1.5 rounded-2xl shadow-sm border border-gray-100">
                      <label className="cursor-pointer px-3 py-2 rounded-xl text-gray-500 hover:bg-gray-100 hover:text-red-600 transition-all flex items-center justify-center" title="Allega file">
                        <Paperclip className="w-4 h-4" />
                        <input 
                          type="file" 
                          multiple 
                          className="hidden" 
                          accept=".pdf,.doc,.docx,image/*"
                          onChange={(e) => handleFileUpload(e, true)}
                          disabled={isParsing}
                        />
                      </label>
                      
                        <button
                          type="button"
                          disabled={isParsing || !newTask.title}
                          onClick={async () => {
                            if (!newTask.title) return;
                            const targetDate = selectedDate || new Date();
                            await api.createTask({
                              title: newTask.title,
                              description: "",
                              deadline: format(targetDate, "yyyy-MM-dd"),
                              files: newTask.files
                            });
                            setNewTask({ title: "", description: "", deadline: format(new Date(), "yyyy-MM-dd"), files: [] });
                            refreshTasks();
                          }}
                          className="px-4 py-2 rounded-xl text-gray-500 hover:bg-gray-100 hover:text-red-600 font-bold text-xs transition-all active:scale-95 disabled:opacity-50 flex items-center gap-2"
                          title={`Aggiungi per il ${format(selectedDate || new Date(), "d MMMM", { locale: it })}`}
                        >
                          <Plus className="w-3 h-3" />
                          Inserisci
                        </button>

                        <button
                          type="submit"
                          disabled={isParsing || !newTask.title}
                          className="px-4 py-2 rounded-xl text-gray-500 hover:bg-gray-100 hover:text-red-600 font-bold text-xs transition-all active:scale-95 disabled:opacity-50 flex items-center gap-2"
                        >
                          {isParsing ? (
                            <>
                              <div className="w-3 h-3 border-2 border-red-600/30 border-t-red-600 rounded-full animate-spin" />
                              Analisi...
                            </>
                          ) : (
                            <>
                              AI <Sparkles className="w-3 h-3" />
                            </>
                          )}
                        </button>
                    </div>
                  </div>
                  
                  {newTask.files.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-2">
                      {newTask.files.map((file, index) => (
                        <div key={index} className="flex items-center gap-2 bg-red-50 px-3 py-1.5 rounded-lg text-xs font-bold text-red-600 border border-red-100">
                          <span className="truncate max-w-[150px]">{file.name}</span>
                          <button type="button" onClick={() => removeFile(index, true)} className="hover:text-red-500" disabled={isParsing}>
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </form>
              </div>

              {/* Today's Focus & Upcoming Split */}
              <div className="grid md:grid-cols-2 gap-8">
                {/* Left Column: Today's Focus / Selected Date Focus */}
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                      <div className={cn("w-2 h-2 rounded-full animate-pulse", selectedDate && !isToday(selectedDate) ? "bg-red-500" : "bg-red-500")} />
                      {selectedDate && !isToday(selectedDate) ? "Attività Selezionate" : "In Scadenza Oggi"}
                    </h2>
                    <span className="text-xs font-medium text-gray-400 bg-gray-100 px-2 py-1 rounded-full">
                      {format(selectedDate || new Date(), "d MMMM", { locale: it })}
                    </span>
                  </div>
                  
                  <div className="space-y-4">
                    {activeTasks.filter(t => {
                      const targetDate = selectedDate || new Date();
                      const taskDate = parseISO(t.deadline);
                      
                      if (isToday(targetDate)) {
                        // If today, show today's tasks AND overdue tasks
                        return isSameDay(taskDate, targetDate) || differenceInCalendarDays(taskDate, targetDate) < 0;
                      } else {
                        // If another date, show only tasks for that date
                        return isSameDay(taskDate, targetDate);
                      }
                    }).length === 0 ? (
                      <div className="p-8 text-center bg-white rounded-2xl border border-dashed border-gray-200">
                        <p className="text-sm text-gray-400 font-medium">
                          {isToday(selectedDate || new Date()) 
                            ? "Nessuna scadenza urgente oggi. Ottimo lavoro!" 
                            : "Nessuna attività per questa data."}
                        </p>
                      </div>
                    ) : (
                      activeTasks
                        .filter(t => {
                          const targetDate = selectedDate || new Date();
                          const taskDate = parseISO(t.deadline);
                          
                          if (isToday(targetDate)) {
                            return isSameDay(taskDate, targetDate) || differenceInCalendarDays(taskDate, targetDate) < 0;
                          } else {
                            return isSameDay(taskDate, targetDate);
                          }
                        })
                        .map(task => (
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
                </div>

                {/* Right Column: Upcoming */}
                <div className="space-y-6">
                  <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-red-500" />
                    Prossimi Giorni
                  </h2>
                  
                  <div className="space-y-4">
                    {activeTasks.filter(t => differenceInCalendarDays(parseISO(t.deadline), new Date()) > 0).length === 0 ? (
                      <div className="p-8 text-center bg-white rounded-2xl border border-dashed border-gray-200">
                        <p className="text-sm text-gray-400 font-medium">Nessuna attività programmata per i prossimi giorni.</p>
                      </div>
                    ) : (
                      activeTasks
                        .filter(t => differenceInCalendarDays(parseISO(t.deadline), new Date()) > 0)
                        .slice(0, 5) // Show only next 5 tasks
                        .map(task => (
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
                    {activeTasks.filter(t => differenceInCalendarDays(parseISO(t.deadline), new Date()) > 0).length > 5 && (
                      <p className="text-xs text-center text-gray-400 mt-2">
                        +{activeTasks.filter(t => differenceInCalendarDays(parseISO(t.deadline), new Date()) > 0).length - 5} altre attività
                      </p>
                    )}
                  </div>
                </div>
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
