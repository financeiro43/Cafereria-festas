import React, { useState, useEffect } from 'react';
import { auth, db } from '@/lib/firebase';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, User, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot, collection, query, where, getDocs, updateDoc, deleteDoc } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '@/lib/error-handler';
import { UserProfile } from './types';
import ParentDashboard from './components/ParentDashboard';
import VendorDashboard from './components/VendorDashboard';
import AdminDashboard from './components/AdminDashboard';
import MockPayment from './components/MockPayment';
import { Toaster } from './components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Coffee, ShieldCheck, CreditCard, ChevronRight, Settings, LayoutDashboard, Mail, Lock, User as UserIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'normal' | 'admin'>('normal');
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      if (user) {
        // Manage profile updates in real-time
        const userRef = doc(collection(db, 'users'), user.uid);
        
        let unsubProfile: (() => void) | undefined;
        
        try {
          // Setup a listener for real-time balance updates
          unsubProfile = onSnapshot(userRef, (snap) => {
          if (snap.exists()) {
            const data = snap.data() as UserProfile;
            // Force admin role for the specific finance email
            if (user.email === 'financeiro@modeloalpha.com.br' && data.role !== 'admin') {
              data.role = 'admin';
            }
            setProfile(data);
            setLoading(false);
          } else {
            // Find by email (pre-registered by admin)
            getDocs(query(collection(db, 'users'), where('email', '==', user.email?.toLowerCase())))
              .then(async (emailSnap) => {
                if (!emailSnap.empty) {
                  const existingDoc = emailSnap.docs[0];
                  const existingData = existingDoc.data();
                  
                  const newProfile: UserProfile = {
                    ...(existingData as any),
                    uid: user.uid,
                    qrCode: user.uid,
                    name: existingData.name || user.displayName || 'Estudante',
                    email: user.email?.toLowerCase() || existingData.email
                  };
                  
                  // Move data to the correct document ID (user.uid)
                  await setDoc(userRef, newProfile);
                  
                  // Delete the old random-ID document
                  if (existingDoc.id !== user.uid) {
                    await deleteDoc(existingDoc.ref);
                  }
                  
                  setProfile(newProfile);
                  setLoading(false);
                } else {
                  // Create default profile for first-time login
                  const newProfile: UserProfile = {
                    uid: user.uid,
                    name: user.displayName || 'Estudante',
                    email: user.email || '',
                    balance: 0,
                    role: user.email === 'financeiro@modeloalpha.com.br' ? 'admin' : 'student',
                    qrCode: user.uid
                  };
                  
                  setDoc(userRef, newProfile)
                    .then(() => {
                      setProfile(newProfile);
                      setLoading(false);
                    })
                    .catch(e => {
                      handleFirestoreError(e, OperationType.WRITE, `users/${user.uid}`);
                      setLoading(false);
                    });
                }
              })
              .catch(e => {
                console.error("Error finding user by email:", e);
                setLoading(false);
              });
          }
          }, (error) => {
            // If we get an error, it might be because the document is being created or permissions are still propagating
            console.warn('onSnapshot error:', error);
            if (error.message.includes('insufficient permissions')) {
               // Try a one-time get if onSnapshot fails initially
               getDoc(userRef).then((snap) => {
                 if (snap.exists()) {
                   setProfile(snap.data() as UserProfile);
                   setLoading(false);
                 }
               }).catch(() => {
                 handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
                 setLoading(false);
               });
            } else {
              handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
              setLoading(false);
            }
          });
        } catch (e) {
          console.error('Error setting up onSnapshot:', e);
          setLoading(false);
        }

        return () => {
          if (unsubProfile) unsubProfile();
        };
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const handleGoogleLogin = async () => {
    setAuthLoading(true);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
      setIsLoginOpen(false);
    } catch (error: any) {
      console.error('Login error:', error);
      toast.error('Erro no login Google', { description: error.message });
    } finally {
      setAuthLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setAuthLoading(true);
    try {
      if (isRegistering) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      setIsLoginOpen(false);
    } catch (error: any) {
      console.error('Auth error:', error);
      toast.error(isRegistering ? 'Erro no cadastro' : 'Erro no login', { 
        description: error.message === 'Firebase: Error (auth/invalid-credential).' ? 'E-mail ou senha incorretos' : error.message 
      });
    } finally {
      setAuthLoading(false);
    }
  };

  if (window.location.pathname === '/mock-payment') {
    return <MockPayment />;
  }

  if (loading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-slate-50">
        <motion.div 
          animate={{ scale: [1, 1.1, 1] }}
          transition={{ repeat: Infinity, duration: 1.5 }}
          className="flex flex-col items-center gap-4"
        >
          <Coffee className="h-12 w-12 text-slate-900" />
          <p className="text-slate-500 font-medium">Carregando sua cafeteria...</p>
        </motion.div>
      </div>
    );
  }

  if (!user || !profile) {
    return (
      <div className="min-h-screen bg-slate-50">
        <nav className="p-6 flex justify-between items-center max-w-7xl mx-auto">
          <div className="flex items-center gap-2 font-bold text-xl text-slate-900">
            <Coffee className="h-6 w-6" /> Cafeteria Inteligente
          </div>
          <Button onClick={() => setIsLoginOpen(true)} variant="outline" className="border-slate-200">Entrar</Button>
        </nav>

        <main className="max-w-7xl mx-auto px-6 py-12 md:py-24 grid md:grid-cols-2 gap-12 items-center">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <span className="text-blue-600 font-bold tracking-wider uppercase text-sm">Escolas do Futuro</span>
            <h1 className="text-5xl md:text-7xl font-bold text-slate-900 mt-4 leading-tight">
              A merenda sem <br />
              <span className="text-slate-400">complicações</span>
            </h1>
            <p className="text-lg text-slate-600 mt-6 max-w-md leading-relaxed">
              O sistema definitivo para gestão de saldo escolar. Recargas instantâneas via Rede e pagamentos via QR Code.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 mt-10">
              <Button onClick={() => setIsLoginOpen(true)} size="lg" className="bg-slate-900 hover:bg-slate-800 text-white px-8 h-14 rounded-xl text-lg group">
                Começar Agora <ChevronRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
              </Button>
            </div>
            
            <div className="grid grid-cols-2 gap-8 mt-16 pt-12 border-t border-slate-200">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-slate-900 font-bold">
                  <ShieldCheck className="h-5 w-5 text-green-500" /> Segurança
                </div>
                <p className="text-sm text-slate-500">Saldo protegido e histórico transparente auditável.</p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-slate-900 font-bold">
                  <CreditCard className="h-5 w-5 text-blue-500" /> Praticidade
                </div>
                <p className="text-sm text-slate-500">Recargas via PIX e Cartão de Crédito integradas.</p>
              </div>
            </div>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="relative"
          >
            <div className="aspect-square bg-slate-200 rounded-3xl overflow-hidden relative shadow-2xl">
              <img 
                src="https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&q=80&w=1200" 
                alt="Cafeteria"
                className="object-cover w-full h-full mix-blend-overlay opacity-80"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-900/40 to-transparent" />
              
              <div className="absolute bottom-8 left-8 right-8">
                <div className="bg-white/90 backdrop-blur p-6 rounded-2xl shadow-xl flex items-center justify-between">
                  <div>
                    <p className="text-xs text-slate-500 font-bold uppercase mb-1">Última Venda</p>
                    <p className="font-bold text-slate-900 text-lg">Pão de Queijo + Café</p>
                  </div>
                  <div className="text-right">
                    <p className="text-slate-400 line-through text-xs">R$ 12,00</p>
                    <p className="text-green-600 font-bold text-xl">R$ 9,50</p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </main>
        <footer className="mt-24 py-12 border-t border-slate-200 text-center text-slate-400 text-sm">
          © 2026 Cafeteria Inteligente. Todos os direitos reservados.
        </footer>

        <Dialog open={isLoginOpen} onOpenChange={setIsLoginOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold text-center">
                {isRegistering ? 'Criar Conta' : 'Acesse sua Conta'}
              </DialogTitle>
            </DialogHeader>
            
            <div className="space-y-6 py-4">
              <div className="flex flex-col gap-3">
                <Button 
                  onClick={handleGoogleLogin} 
                  variant="outline" 
                  className="flex items-center gap-3 h-12 border-slate-200 hover:bg-slate-50"
                  disabled={authLoading}
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                  </svg>
                  Continuar com Google
                </Button>
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-slate-200" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white px-2 text-slate-500 font-medium">Ou use seu e-mail</span>
                </div>
              </div>

              <form onSubmit={handleEmailAuth} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">E-mail</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <Input 
                      id="email" 
                      type="email" 
                      placeholder="seu@email.com" 
                      className="pl-10"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Senha</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <Input 
                      id="password" 
                      type="password" 
                      placeholder="••••••••" 
                      className="pl-10"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <Button type="submit" className="w-full bg-slate-900" disabled={authLoading}>
                  {authLoading ? 'Processando...' : (isRegistering ? 'Criar Minha Conta' : 'Entrar no Sistema')}
                </Button>
              </form>

              <div className="text-center text-sm text-slate-500">
                {isRegistering ? 'Já tem uma conta?' : 'Não tem conta?'} {' '}
                <button 
                  onClick={() => setIsRegistering(!isRegistering)}
                  className="text-blue-600 font-semibold hover:underline"
                >
                  {isRegistering ? 'Inicie sua sessão' : 'Cadastre-se agora'}
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Toaster />
      </div>
    );
  }

  return (
    <>
      <AnimatePresence mode="wait">
        {profile.role === 'admin' ? (
          <motion.div key="admin" className="w-full" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <AdminDashboard profile={profile} />
          </motion.div>
        ) : profile.role === 'vendor' ? (
          <motion.div key="vendor" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <VendorDashboard profile={profile} />
          </motion.div>
        ) : (
          <motion.div key="parent" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <ParentDashboard profile={profile} />
          </motion.div>
        )}
      </AnimatePresence>

      <Toaster />
    </>
  );
}
