import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, orderBy, Timestamp } from "firebase/firestore";

// Placeholder config - will be replaced by user input
const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

let app;
let db: any;

export const initFirebase = (config: any) => {
  try {
    app = initializeApp(config);
    db = getFirestore(app);
    localStorage.setItem("firebaseConfig", JSON.stringify(config));
    return true;
  } catch (e) {
    console.error("Firebase init error:", e);
    return false;
  }
};

// Try to load from local storage on boot
const savedConfig = localStorage.getItem("firebaseConfig");
if (savedConfig) {
  initFirebase(JSON.parse(savedConfig));
}

export const getDb = () => db;

// Helper to check if configured
export const isFirebaseConfigured = () => !!db;

// Firestore API
export const firestoreApi = {
  subscribeTasks: (callback: (tasks: any[]) => void) => {
    if (!db) return () => {};
    
    const q = query(collection(db, "tasks"), orderBy("deadline", "asc"));
    return onSnapshot(q, (snapshot) => {
      const tasks = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        // Convert Firestore Timestamp to ISO string if needed, or keep as is
        deadline: doc.data().deadline
      }));
      callback(tasks);
    });
  },

  addTask: async (task: any) => {
    if (!db) return;
    await addDoc(collection(db, "tasks"), {
      ...task,
      createdAt: Timestamp.now()
    });
  },

  updateTask: async (id: string, updates: any) => {
    if (!db) return;
    const docRef = doc(db, "tasks", id);
    await updateDoc(docRef, updates);
  },

  deleteTask: async (id: string) => {
    if (!db) return;
    await deleteDoc(doc(db, "tasks", id));
  }
};
