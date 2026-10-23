import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, memoryLocalCache } from 'firebase/firestore';
import { getAnalytics } from 'firebase/analytics';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

// Use in-memory cache to completely prevent multi-tab persistent lease locks in sandbox/iframe environments
export const db = initializeFirestore(app, {
  localCache: memoryLocalCache()
});

export const auth = getAuth();
export const analytics = typeof window !== 'undefined' ? getAnalytics(app) : null;

