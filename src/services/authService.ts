import { auth, db } from '@/lib/firebase';
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  sendPasswordResetEmail, 
  sendEmailVerification,
  deleteUser
} from 'firebase/auth';
import { 
  doc, 
  setDoc, 
  deleteDoc, 
  collection, 
  query, 
  where, 
  getDocs, 
  writeBatch 
} from 'firebase/firestore';
import { UserProfile } from '../types';

/**
 * Service to handle Firebase Authentication & LGPD-compliant operations.
 */
export const authService = {
  /**
   * Registers a new user with explicit LGPD consent and email verification.
   */
  registerUser: async (name: string, email: string, password: string, consentedToTerms: boolean) => {
    if (!consentedToTerms) {
      throw new Error('Você precisa aceitar os Termos de Uso e a Política de Privacidade para se cadastrar.');
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanPassword = password.trim();

    if (!name.trim()) {
      throw new Error('O nome completo é obrigatório.');
    }

    if (cleanPassword.length < 6) {
      throw new Error('A senha deve ter pelo menos 6 caracteres.');
    }

    // 1. Create the Auth User
    const userCredential = await createUserWithEmailAndPassword(auth, cleanEmail, cleanPassword);
    const user = userCredential.user;

    // 2. Send validation / verification email
    try {
      await sendEmailVerification(user);
    } catch (err) {
      console.warn('Erro ao enviar e-mail de verificação automático:', err);
    }

    // 3. Create initial Firestore profile document (starting with zero balance and student role)
    const userProfile: UserProfile & { 
      consentedToTerms: boolean; 
      consentedToTermsAt: string;
      emailVerified: boolean;
      purposeOfDataCollection: string;
    } = {
      uid: user.uid,
      name: name.trim(),
      email: cleanEmail,
      balance: 0,
      role: 'student',
      qrCode: user.uid,
      consentedToTerms: true,
      consentedToTermsAt: new Date().toISOString(),
      emailVerified: false,
      purposeOfDataCollection: 'Os dados coletados (como e-mail) servem estritamente para a sua autenticação, login seguro e recuperação de conta, em conformidade com as regras de transparência da LGPD.'
    };

    const userRef = doc(db, 'users', user.uid);
    await setDoc(userRef, userProfile);

    return user;
  },

  /**
   * Log in user
   */
  loginUser: async (email: string, password: string) => {
    const cleanEmail = email.trim().toLowerCase();
    const cleanPassword = password.trim();
    return await signInWithEmailAndPassword(auth, cleanEmail, cleanPassword);
  },

  /**
   * Password recovery / Reset Email
   */
  recoverPassword: async (email: string) => {
    const cleanEmail = email.trim().toLowerCase();
    return await sendPasswordResetEmail(auth, cleanEmail);
  },

  /**
   * Deletes user's account safely and anonymizes related clinical, transaction, and consumption records for LGPD
   */
  deleteAccountAndAnonymize: async (uid: string) => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error('Você precisa estar autenticado para realizar esta operação.');
    }

    if (currentUser.uid !== uid) {
      throw new Error('Operação de exclusão não autorizada para este usuário.');
    }

    // 1. Query transactions related to this user
    const transactionsQuery = query(collection(db, 'transactions'), where('userId', '==', uid));
    const transactionsSnap = await getDocs(transactionsQuery);

    // 2. Query consumption records related to this user
    const consumptionQuery = query(collection(db, 'consumption'), where('studentId', '==', uid));
    const consumptionSnap = await getDocs(consumptionQuery);

    // 3. Anonymize records using writeBatch to ensure atomic operation
    const batch = writeBatch(db);

    transactionsSnap.docs.forEach((docSnap) => {
      batch.update(docSnap.ref, {
        userId: 'Usuário Removido',
        userNameAnonymized: 'Usuário Removido',
        description: 'Transação de Usuário Removido (Exclusão por LGPD)'
      });
    });

    consumptionSnap.docs.forEach((docSnap) => {
      batch.update(docSnap.ref, {
        studentId: 'Usuário Removido',
        studentNameAnonymized: 'Usuário Removido'
      });
    });

    // Commit updates for transactions and consumption
    await batch.commit();

    // 4. Delete the user document in `/users` collection
    const userDocRef = doc(db, 'users', uid);
    await deleteDoc(userDocRef);

    // 5. Delete the Auth User
    try {
      await deleteUser(currentUser);
    } catch (authError: any) {
      console.error('Erro de reautenticação no Auth:', authError);
      if (authError.code === 'auth/requires-recent-login') {
        throw new Error(
          'Para sua segurança em conformidade com a LGPD, a exclusão da conta exige um login recente. ' +
          'Por favor, saia de sua conta, faça login novamente com sua senha e clique em Excluir novamente.'
        );
      }
      throw authError;
    }
  }
};
