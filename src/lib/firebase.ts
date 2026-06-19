import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getAnalytics } from 'firebase/analytics';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

// Use standard Firestore to prevent multi-tab leasing locks in sandboxed browser environments
export const db = getFirestore(app);

export const auth = getAuth();
export const analytics = typeof window !== 'undefined' ? getAnalytics(app) : null;

