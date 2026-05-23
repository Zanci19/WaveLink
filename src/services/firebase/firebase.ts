import { FirebaseApp, initializeApp } from 'firebase/app';
import { Firestore, getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? 'YOUR_API_KEY',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? 'YOUR_AUTH_DOMAIN',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'YOUR_PROJECT_ID',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? 'YOUR_STORAGE_BUCKET',
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? 'YOUR_MESSAGING_SENDER_ID',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? 'YOUR_APP_ID',
};

const hasPlaceholder = (value: string) =>
  value.length === 0 || value.startsWith('YOUR_') || value.includes('YOUR_');

export const isFirebaseConfigured = () => {
  return !Object.values(firebaseConfig).some((value) => hasPlaceholder(String(value)));
};

let firebaseApp: FirebaseApp | null = null;
let firestoreDb: Firestore | null = null;

export const getFirebaseApp = () => {
  if (!isFirebaseConfigured()) {
    return null;
  }
  if (!firebaseApp) {
    firebaseApp = initializeApp(firebaseConfig);
  }
  return firebaseApp;
};

export const getFirestoreDb = () => {
  const app = getFirebaseApp();
  if (!app) {
    return null;
  }
  if (!firestoreDb) {
    firestoreDb = getFirestore(app);
  }
  return firestoreDb;
};
