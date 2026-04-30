import React, { useState, useEffect, lazy, Suspense } from 'react';
import { auth, db } from '@/lib/firebase';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, User, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot, collection, query, where, getDocs, updateDoc, deleteDoc } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '@/lib/error-handler';
import { UserProfile } from './types';
import { Toaster } from './components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Coffee, ShieldCheck, CreditCard, ChevronRight, Mail, Lock, LayoutDashboard, User as UserIcon, LogOut, Store, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';

// Lazy load components for performance
const ParentDashboard = lazy(() => import('./components/ParentDashboard'));
const VendorDashboard = lazy(() => import('./components/VendorDashboard'));
const AdminDashboard = lazy(() => import('./components/AdminDashboard'));
const MockPayment = lazy(() => import('./components/MockPayment'));

function LoadingFallback() {
  return (
    <div className="h-screen w-full flex items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-10 w-10 text-slate-400 animate-spin" />
        <p className="text-slate-400 font-black uppercase text-[10px] tracking-widest">Carregando Módulo...</p>
      </div>
    </div>
  );
}

function ProtectedRoute({ 
  children, 
  allowedRoles, 
  profile 
}: { 
  children: React.ReactNode, 
  allowedRoles: string[], 
  profile: UserProfile | null 
}) {
  const location = useLocation();

  if (!profile) {
    return <Navigate to="/" state={{ from: location }} replace />;
  }

  if (!allowedRoles.includes(profile.role)) {
    // Redirect to their default module if they try to access something else
    const defaultPath = profile.role === 'admin' ? '/admin' : 
                        profile.role === 'vendor' ? '/vendor' : 
                        profile.role === 'recharge' ? '/pdv' : '/portal';
    return <Navigate to={defaultPath} replace />;
  }

  return <>{children}</>;
}

function MainApp() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, async (authUser) => {
      if (!authUser) {
        setUser(null);
        setProfile(null);
        setLoading(false);
        return;
      }

      setUser(authUser);
      const userRef = doc(db, 'users', authUser.uid);
      
      const unsubProfile = onSnapshot(userRef, async (snap) => {
        if (snap.exists()) {
          const data = snap.data() as UserProfile;
          if (authUser.email === 'financeiro@modeloalpha.com.br' && data.role !== 'admin') {
            data.role = 'admin';
          }
          setProfile(data);
          setLoading(false);
          if (location.pathname === '/') {
            const target = data.role === 'admin' ? '/admin' : 
                         data.role === 'vendor' ? '/vendor' : 
                         data.role === 'recharge' ? '/pdv' : '/portal';
            navigate(target);
          }
        } else {
          // One-time attempt to find by email if document doesn't exist by UID
          try {
            const emailSnap = await getDocs(query(collection(db, 'users'), where('email', '==', authUser.email?.toLowerCase())));
            if (!emailSnap.empty) {
              const existingDoc = emailSnap.docs[0];
              const existingData = existingDoc.data();
              const newProfile: UserProfile = {
                ...(existingData as any),
                uid: authUser.uid,
                qrCode: authUser.uid,
                name: existingData.name || authUser.displayName || 'Estudante',
                email: authUser.email?.toLowerCase() || existingData.email
              };
              await setDoc(userRef, newProfile);
              if (existingDoc.id !== authUser.uid) await deleteDoc(existingDoc.ref);
            } else {
              const newProfile: UserProfile = {
                uid: authUser.uid,
                name: authUser.displayName || 'Estudante',
                email: authUser.email || '',
                balance: 0,
                role: authUser.email === 'financeiro@modeloalpha.com.br' ? 'admin' : 'student',
                qrCode: authUser.uid
              };
              await setDoc(userRef, newProfile);
            }
          } catch (e) {
            console.error("Migration error:", e);
          } finally {
            setLoading(false);
          }
        }
      });

      return () => unsubProfile();
    });

    return () => unsubAuth();
  }, [navigate]);

  const handleGoogleLogin = async () => {
    setAuthLoading(true);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
      setIsLoginOpen(false);
    } catch (error: any) {
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
      toast.error(isRegistering ? 'Erro no cadastro' : 'Erro no login', { 
        description: error.message === 'Firebase: Error (auth/invalid-credential).' ? 'E-mail ou senha incorretos' : error.message 
      });
    } finally {
      setAuthLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-slate-50">
        <motion.div animate={{ scale: [1, 1.1, 1] }} transition={{ repeat: Infinity, duration: 1.5 }} className="flex flex-col items-center gap-4">
          <Coffee className="h-12 w-12 text-slate-900" />
          <p className="text-slate-500 font-medium">Carregando...</p>
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
          <Button onClick={() => setIsLoginOpen(true)} variant="outline">Entrar</Button>
        </nav>

        <main className="max-w-7xl mx-auto px-6 py-12 md:py-24 grid md:grid-cols-2 gap-12 items-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <span className="text-blue-600 font-bold tracking-wider uppercase text-sm">Escolas do Futuro</span>
            <h1 className="text-5xl md:text-7xl font-bold text-slate-900 mt-4 leading-tight">
              A merenda sem <br />
              <span className="text-slate-400">complicações</span>
            </h1>
            <p className="text-lg text-slate-600 mt-6 max-w-md">
              O sistema definitivo para gestão de saldo escolar. Recargas instantâneas via Rede e pagamentos via QR Code.
            </p>
            <Button onClick={() => setIsLoginOpen(true)} size="lg" className="mt-10 bg-slate-900 text-white px-8 h-14 rounded-xl text-lg group">
              Começar Agora <ChevronRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
            </Button>
          </motion.div>
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="relative">
            <div className="aspect-square bg-slate-200 rounded-3xl overflow-hidden relative shadow-2xl">
              <img src="https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&q=80&w=1200" alt="Cafeteria" className="object-cover w-full h-full mix-blend-overlay opacity-80" referrerPolicy="no-referrer" />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-900/40 to-transparent" />
            </div>
          </motion.div>
        </main>

        <Dialog open={isLoginOpen} onOpenChange={setIsLoginOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle className="text-2xl font-bold text-center">{isRegistering ? 'Criar Conta' : 'Acessar Conta'}</DialogTitle></DialogHeader>
            <div className="space-y-6 py-4">
              <Button onClick={handleGoogleLogin} variant="outline" className="w-full flex items-center gap-3 h-12 border-slate-200">
                <svg className="w-5 h-5" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /></svg>
                Continuar com Google
              </Button>
              <div className="relative"><div className="absolute inset-0 flex items-center"><span className="w-full border-t border-slate-200" /></div><div className="relative flex justify-center text-xs uppercase"><span className="bg-white px-2 text-slate-500">Ou e-mail</span></div></div>
              <form onSubmit={handleEmailAuth} className="space-y-4">
                <div className="space-y-2"><Label>E-mail</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
                <div className="space-y-2"><Label>Senha</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
                <Button type="submit" className="w-full bg-slate-900" disabled={authLoading}>{authLoading ? 'Processando...' : (isRegistering ? 'Cadastrar' : 'Entrar')}</Button>
              </form>
              <button onClick={() => setIsRegistering(!isRegistering)} className="w-full text-center text-sm text-blue-600 font-semibold">{isRegistering ? 'Já tem conta? Entre' : 'Não tem conta? Cadastre-se'}</button>
            </div>
          </DialogContent>
        </Dialog>
        <Toaster />
      </div>
    );
  }

  if (profile.role === 'admin' && (window.location.pathname === '/' || window.location.pathname === '/admin')) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
        <div className="w-full max-w-4xl grid md:grid-cols-2 gap-8 animate-in fade-in zoom-in duration-500">
          <div className="col-span-full mb-8 text-center">
             <Coffee className="h-16 w-16 text-blue-500 mx-auto mb-4" />
             <h1 className="text-4xl font-black text-white uppercase tracking-tighter">Central Inteligente</h1>
             <p className="text-slate-400 mt-2 font-medium">Bem-vindo, {profile.name}. Escolha sua estação de trabalho:</p>
          </div>
          
          <Button 
            onClick={() => window.location.href = '/admin'}
            className="h-64 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-[40px] flex flex-col gap-4 text-white group shadow-2xl transition-all hover:-translate-y-2"
          >
            <div className="p-6 bg-blue-600 rounded-3xl group-hover:scale-110 transition-transform">
              <LayoutDashboard className="h-10 w-10" />
            </div>
            <div className="text-center">
              <span className="text-2xl font-black uppercase tracking-tight">Gestão Central</span>
              <p className="text-slate-400 text-xs mt-1">Configurações, Financeiro e Equipe</p>
            </div>
          </Button>

          <Button 
            onClick={() => window.location.href = '/pdv'}
            className="h-64 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-[40px] flex flex-col gap-4 text-white group shadow-2xl transition-all hover:-translate-y-2"
          >
            <div className="p-6 bg-green-600 rounded-3xl group-hover:scale-110 transition-transform">
              <Store className="h-10 w-10" />
            </div>
            <div className="text-center">
              <span className="text-2xl font-black uppercase tracking-tight">Terminal PDV</span>
              <p className="text-slate-400 text-xs mt-1">Vendas rápidas e Carga/Recarga</p>
            </div>
          </Button>

          <Button 
            onClick={() => window.location.href = '/portal'}
            className="h-24 md:col-span-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-[32px] flex items-center justify-center gap-4 text-white transition-all"
          >
            <UserIcon className="h-6 w-6 text-slate-400" />
            <span className="font-bold">Acessar Portal do Aluno (Visualização)</span>
            <ChevronRight className="h-4 w-4" />
          </Button>
          
          <Button variant="ghost" onClick={() => auth.signOut()} className="md:col-span-2 text-slate-500 hover:text-white">
            <LogOut className="h-4 w-4 mr-2" /> Encerrar Sessão
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Suspense fallback={<LoadingFallback />}>
      <Routes>
        <Route path="/" element={<Navigate to={profile.role === 'admin' ? '/admin' : profile.role === 'vendor' ? '/vendor' : profile.role === 'recharge' ? '/pdv' : '/portal'} replace />} />
        <Route path="/admin/*" element={<ProtectedRoute allowedRoles={['admin']} profile={profile}><AdminDashboard profile={profile} /></ProtectedRoute>} />
        <Route path="/vendor/*" element={<ProtectedRoute allowedRoles={['vendor', 'admin']} profile={profile}><VendorDashboard profile={profile} /></ProtectedRoute>} />
        <Route path="/pdv/*" element={<ProtectedRoute allowedRoles={['vendor', 'admin', 'recharge']} profile={profile}><AdminDashboard profile={profile} forcedTab="terminal" /></ProtectedRoute>} />
        <Route path="/recharge/*" element={<ProtectedRoute allowedRoles={['recharge', 'admin']} profile={profile}><AdminDashboard profile={profile} forcedTab="recharge_pos" /></ProtectedRoute>} />
        <Route path="/portal/*" element={<ProtectedRoute allowedRoles={['student', 'admin']} profile={profile}><ParentDashboard profile={profile} /></ProtectedRoute>} />
        <Route path="/mock-payment" element={<MockPayment />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <MainApp />
      <Toaster />
    </BrowserRouter>
  );
}
