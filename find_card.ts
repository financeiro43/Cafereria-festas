import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import firebaseConfig from './firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const hashOf = (str: string) => {
  if (!str) return 0;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
};

const formatCardNumber = (str: string) => {
  const h = hashOf(str);
  return h.toString().padEnd(16, '0').substring(0, 16).replace(/(.{4})/g, '$1 ').trim();
};

async function run() {
  try {
    const snap = await getDocs(collection(db, 'users'));
    console.log(`Fetched ${snap.size} users.`);
    snap.docs.forEach(doc => {
      const data = doc.data();
      const uid = doc.id;
      const qrCode = data.qrCode || '';
      const email = data.email || '';
      const name = data.name || '';
      
      const hashUid = formatCardNumber(uid);
      const hashQr = formatCardNumber(qrCode);
      const hashEmail = formatCardNumber(email);
      
      if (hashUid.startsWith('3082') || hashQr.startsWith('3082') || hashEmail.startsWith('3082') || name.includes('3082') || email.includes('r8nhy') || qrCode.includes('R8NHY')) {
        console.log('MATCH:', {
          uid,
          name,
          email,
          qrCode,
          hashUid,
          hashQr,
          hashEmail,
          data
        });
      }
    });
  } catch (error) {
    console.error('Error:', error);
  } finally {
    process.exit(0);
  }
}

run();
