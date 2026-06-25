import React, { useState, useEffect, lazy, Suspense } from 'react';
import { auth, db } from '@/lib/firebase';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, User, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithRedirect, getRedirectResult } from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot, collection, query, where, getDocs, updateDoc, deleteDoc, limit } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '@/lib/error-handler';
import { UserProfile, UserRole } from './types';
import { Toaster } from './components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { authService } from './services/authService';
import { Sparkles, ShieldCheck, CreditCard, ChevronRight, Mail, Lock, LayoutDashboard, User as UserIcon, LogOut, Store, Loader2, ArrowRight, Smartphone, ShoppingCart, Ticket, ShieldAlert } from 'lucide-react';
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
                        profile.role === 'vendor' ? '/pdv' : 
                        profile.role === 'recharge' ? '/recharge' : '/portal';
    return <Navigate to={defaultPath} replace />;
  }

  return <>{children}</>;
}

function MainApp() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [longLoading, setLongLoading] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (loading) setLongLoading(true);
    }, 10000);
    return () => clearTimeout(timer);
  }, [loading]);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [registerName, setRegisterName] = useState('');
  const [lgpdConsent, setLgpdConsent] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const [forgotPasswordEmail, setForgotPasswordEmail] = useState('');
  const [isForgotPassOpen, setIsForgotPassOpen] = useState(false);

  useEffect(() => {
    // Process redirect result if any when page loads
    getRedirectResult(auth)
      .then((result) => {
        if (result?.user) {
          console.log("[AUTH] Successfully logged in via Google redirect:", result.user.email);
        }
      })
      .catch((err) => {
        const isCancelled = err.code === 'auth/cancelled-popup-request' || 
                            err.code === 'auth/popup-closed-by-user' ||
                            err.code === 'auth/redirect-cancelled-by-user';
        if (!isCancelled) {
          console.warn("[AUTH] Error getting Google redirect result:", err);
        }
      });

    let unsubProfile: (() => void) | null = null;
    
    const unsubAuth = onAuthStateChanged(auth, async (authUser) => {
      // Cleanup previous profile listener if exists
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }

      if (!authUser) {
        console.log("[AUTH] No user found, stopping loading");
        setUser(null);
        setProfile(null);
        setLoading(false);
        return;
      }

      console.log("[AUTH] User authenticated:", authUser.email);
      setUser(authUser);
      const userRef = doc(db, 'users', authUser.uid);
      
      let retryCount = 0;
      const MAX_RETRIES = 3;

      const sanitizeEmailForComparison = (emailStr: string) => {
        const clean = emailStr.trim().toLowerCase();
        if (clean.endsWith('@gmail.com')) {
          const [local, domain] = clean.split('@');
          const localWithoutPlus = local.split('+')[0];
          const localWithoutDots = localWithoutPlus.replace(/\./g, '');
          return localWithoutDots + '@' + domain;
        }
        return clean;
      };

      const userEmail = authUser.email || '';
      const sanitizedUserEmail = sanitizeEmailForComparison(userEmail);
      const targetAdminEmail = sanitizeEmailForComparison('financeiro@modeloalpha.com.br');
      const targetStudentEmail = sanitizeEmailForComparison('denisandrews@gmail.com');

      const startProfileListener = () => {
        console.log("[AUTH] Starting profile listener for:", authUser.uid);
        return onSnapshot(userRef, async (snap) => {
          try {
            if (snap.exists()) {
              const data = snap.data() as UserProfile;
              console.log("[AUTH] Profile found, role:", data.role);

              if (sanitizedUserEmail === targetAdminEmail) {
                if (data.role !== 'admin') {
                  data.role = 'admin';
                  updateDoc(userRef, { role: 'admin' }).catch(err => {
                    console.warn("[AUTH] Non-blocking error updating admin role:", err);
                  });
                }
              } else if (sanitizedUserEmail === targetStudentEmail) {
                if (data.role !== 'student') {
                  data.role = 'student';
                  updateDoc(userRef, { role: 'student' }).catch(err => {
                    console.warn("[AUTH] Non-blocking error updating student role:", err);
                  });
                }
              }
              
              setProfile(data);
              setLoading(false);
              
              const currentPath = window.location.pathname;
              if (currentPath === '/' || currentPath === '/login') {
                const target = data.role === 'admin' ? '/admin' : 
                             data.role === 'vendor' ? '/pdv' : 
                             data.role === 'recharge' ? '/recharge' : '/portal';
                console.log("[AUTH] Auto-redirecting to:", target);
                navigate(target);
              }
            } else {
              if ((window as any).isRegisteringInProgress) {
                console.log("[AUTH] Registration in progress, skipping auto profile creation in listener.");
                return;
              }
              console.log("[AUTH] Profile missing, starting migration/creation...");
              // Check for migration with case-insensitive and trim-robust search
              const usersSnap = await getDocs(collection(db, 'users'));
              const targetEmail = authUser.email?.trim().toLowerCase();
              const existingDoc = usersSnap.docs.find(doc => {
                const docEmail = doc.data().email;
                return docEmail && docEmail.trim().toLowerCase() === targetEmail;
              });
              
              if (existingDoc) {
                const existingData = existingDoc.data();
                console.log("[AUTH] Migration: record found for email", authUser.email);
                const newProfile: UserProfile = {
                  ...(existingData as any),
                  uid: authUser.uid,
                  qrCode: existingData.qrCode || authUser.uid,
                  name: existingData.name || authUser.displayName || 'Usuário',
                  email: authUser.email?.trim().toLowerCase() || existingData.email,
                  role: sanitizedUserEmail === targetAdminEmail ? 'admin' : (sanitizedUserEmail === targetStudentEmail ? 'student' : (existingData.role || 'student'))
                };
                await setDoc(userRef, newProfile);
                if (existingDoc.id !== authUser.uid) await deleteDoc(existingDoc.ref);
              } else {
                console.log("[AUTH] Creating new profile for:", authUser.email);
                const newProfile: UserProfile = {
                  uid: authUser.uid,
                  name: authUser.displayName || 'Usuário',
                  email: authUser.email?.trim().toLowerCase() || '',
                  balance: 0,
                  role: sanitizedUserEmail === targetAdminEmail ? 'admin' : 'student',
                  qrCode: authUser.uid
                };
                await setDoc(userRef, newProfile);
              }
              // setDoc will trigger the snapshot listener again
            }
          } catch (e) {
            console.error("[AUTH] Error in snapshot processing:", e);
            setLoading(false);
          }
        }, (err) => {
          console.error("[AUTH] Snapshot listener error:", err);
          if (err.message.toLowerCase().includes('permission') && retryCount < MAX_RETRIES) {
            retryCount++;
            setTimeout(() => {
              if (unsubProfile) unsubProfile();
              unsubProfile = startProfileListener();
            }, 1500);
          } else {
            setLoading(false);
          }
        });
      };

      unsubProfile = startProfileListener();
    });

    return () => {
      unsubAuth();
      if (unsubProfile) unsubProfile();
    };
  }, [navigate]);

  const handleGoogleLogin = async () => {
    if (authLoading) return;
    setAuthLoading(true);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    
    // Check if running in installed PWA standalone mode
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone;
    // Check if on a mobile device (tablet/phone)
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    // Check if inside an in-app browser (social webviews, etc)
    const isInAppBrowser = /FBAN|FBAV|Instagram|WhatsApp|Line|Snapchat/i.test(navigator.userAgent);

    console.log("[AUTH] Google Login info:", { isStandalone, isMobile, isInAppBrowser });

    // Always attempt signInWithPopup first even on mobile, because:
    // 1. Standard mobile browsers (iOS Safari, Android Chrome) allow user-initiated popup triggers perfectly.
    // 2. It avoids Safari's Intelligent Tracking Prevention (ITP) or Chrome's third-party cookie blocking which often breaks signInWithRedirect state transmission.
    console.log("[AUTH] Attempting Google Auth via signInWithPopup first...");
    try {
      await signInWithPopup(auth, provider);
      setIsLoginOpen(false);
    } catch (error: any) {
      console.warn("[AUTH] signInWithPopup failed or was blocked:", error);
      
      const isCancelled = error.code === 'auth/cancelled-popup-request' || 
                          error.code === 'auth/popup-closed-by-user' ||
                          error.code === 'auth/redirect-cancelled-by-user';
                          
      if (isCancelled) {
        console.log("[AUTH] Google login cancelled by user.");
        setAuthLoading(false);
        return;
      }

      // Instead of falling back to signInWithRedirect (which crashes on iOS/Social app browsers with "sessionStorage is inaccessible" white screen),
      // we show a beautiful, friendly error instructing them how to use Email/Password login.
      toast.error('Login com Google Indisponível', { 
        description: 'Seu navegador ou aplicativo impediu o login rápido do Google (comum no WhatsApp, Instagram, Safari restrito ou aba anônima). Por favor, use a opção de entrar com E-mail e Senha abaixo. Se você não tem uma senha definida, clique em "Esqueci a senha" para criar uma instantaneamente!',
        duration: 10000
      });
      setAuthLoading(false);
    } finally {
      // Delay disabling authLoading state to handle smooth transition or reload
      setTimeout(() => {
        setAuthLoading(false);
      }, 1500);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    const cleanPassword = password.trim();
    if (!cleanEmail || !cleanPassword) return;
    
    if (isRegistering && !registerName.trim()) {
      toast.error('Erro no cadastro', { description: 'O nome completo é obrigatório.' });
      return;
    }

    if (isRegistering && !lgpdConsent) {
      toast.error('Aceite de LGPD obrigatório', { description: 'Você deve aceitar os Termos de Uso e Política de Privacidade para continuar.' });
      return;
    }

    setAuthLoading(true);
    if (isRegistering) {
      (window as any).isRegisteringInProgress = true;
    }
    try {
      if (isRegistering) {
        await authService.registerUser(registerName, cleanEmail, cleanPassword, lgpdConsent);
        toast.success('Cadastro concluído com sucesso!', {
          description: 'Enviamos um e-mail de verificação. Acesse sua caixa de entrada.',
          duration: 6000
        });
      } else {
        await authService.loginUser(cleanEmail, cleanPassword);
        toast.success('Login efetuado!');
      }
      setIsLoginOpen(false);
    } catch (error: any) {
      const msg = error.message || '';
      let friendlyMessage = msg;
      
      if (msg.includes('auth/email-already-in-use')) {
        friendlyMessage = 'Este e-mail já está cadastrado. Se você se cadastrou pelo Google ou está pré-cadastrado, use "Esqueci a senha" para criar sua senha.';
        setIsRegistering(false);
      } else if (msg.includes('auth/account-exists-with-different-credential')) {
        friendlyMessage = 'Esta conta já foi criada usando o Google. Use "Esqueci a senha" para criar uma senha pessoal ou continue com o Google.';
      } else if (msg.includes('auth/operation-not-allowed')) {
        friendlyMessage = 'O login com E-mail/Senha está desativado no Console do Firebase. Ative-o em Firebase Auth > Sign-in Method.';
      } else if (msg.includes('auth/invalid-credential') || msg.includes('auth/wrong-password') || msg.includes('auth/user-not-found')) {
        friendlyMessage = 'E-mail ou senha incorretos. Se você usou o Google originalmente ou está pré-cadastrado diretamente no sistema, defina a senha em "Esqueci a senha".';
      } else if (msg.includes('auth/weak-password')) {
        friendlyMessage = 'A senha digitada é muito fraca. Deve ter pelo menos 6 caracteres.';
      } else if (msg.includes('auth/invalid-email')) {
        friendlyMessage = 'O formato do e-mail digitado é inválido.';
      } else if (msg.includes('auth/user-disabled')) {
        friendlyMessage = 'Esta conta foi temporariamente desativada.';
      } else if (msg.includes('auth/too-many-requests')) {
        friendlyMessage = 'Muitas tentativas malsucedidas. Tente novamente mais tarde.';
      }

      toast.error(isRegistering ? 'Erro no cadastro' : 'Erro no login', { 
        description: friendlyMessage 
      });
    } finally {
      (window as any).isRegisteringInProgress = false;
      setAuthLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-slate-950 relative overflow-hidden">
        {/* Decorative Background */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-blue-600/20 blur-[100px] rounded-full animate-pulse" />
        
        <motion.div 
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          className="relative z-10 flex flex-col items-center gap-8"
        >
          <div className="relative">
            <div className="absolute inset-0 bg-blue-600 blur-2xl opacity-20 animate-pulse" />
            <div className="relative p-6 bg-slate-900 rounded-[32px] border border-white/10 shadow-2xl">
              <Sparkles className="h-12 w-12 text-yellow-400" />
            </div>
          </div>
          
          <div className="space-y-4 text-center">
            <div className="space-y-1">
              <h2 className="text-white font-black uppercase tracking-[0.4em] text-xs">Sistema Inteligente</h2>
              <div className="flex items-center gap-1 justify-center">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    animate={{ 
                      scale: [1, 1.5, 1],
                      opacity: [0.3, 1, 0.3] 
                    }}
                    transition={{ 
                      repeat: Infinity, 
                      duration: 1,
                      delay: i * 0.2
                    }}
                    className="h-1.5 w-1.5 bg-blue-500 rounded-full"
                  />
                ))}
              </div>
            </div>

            {longLoading && (
              <motion.div 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }}
                className="space-y-4 pt-4"
              >
                <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest max-w-[200px] mx-auto">
                  A inicialização está demorando mais que o esperado...
                </p>
                <Button 
                  onClick={() => window.location.reload()} 
                  variant="outline" 
                  className="bg-white/5 border-white/10 text-white font-black uppercase tracking-widest text-[9px] h-10 px-4"
                >
                  Recarregar App
                </Button>
              </motion.div>
            )}
          </div>
        </motion.div>
      </div>
    );
  }

  if (!user || !profile) {
    return (
      <div className="min-h-screen bg-slate-50">
        <nav className="p-6 flex justify-between items-center max-w-7xl mx-auto">
          <div className="flex items-center gap-2 font-black text-2xl text-slate-900 tracking-tighter">
            <div className="bg-slate-900 p-1.5 rounded-lg">
              <Sparkles className="h-5 w-5 text-yellow-400" />
            </div>
            FESTA <span className="text-blue-600">PASS</span>
          </div>
          <Button onClick={() => setIsLoginOpen(true)} variant="outline" className="rounded-xl font-bold uppercase tracking-widest text-[10px] px-6">Entrar</Button>
        </nav>

        <main className="max-w-7xl mx-auto px-6 py-12 md:py-24 grid md:grid-cols-2 gap-12 items-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <span className="text-blue-600 font-bold tracking-wider uppercase text-sm">Escolas do Futuro</span>
            <h1 className="text-5xl md:text-7xl font-black text-slate-900 mt-4 leading-tight tracking-tighter">
              Sua festa sem <br />
              <span className="text-blue-600">filas.</span>
            </h1>
            <p className="text-lg text-slate-600 mt-6 max-w-md font-medium">
              O sistema definitivo para eventos e festivais. Pagamentos via QR Code, gestão de barracas e recargas instantâneas.
            </p>
            <Button onClick={() => setIsLoginOpen(true)} size="lg" className="mt-10 bg-slate-900 text-white px-8 h-14 rounded-xl text-lg group">
              Começar Agora <ChevronRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
            </Button>
          </motion.div>
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="relative">
            <div className="aspect-square bg-slate-200 rounded-3xl overflow-hidden relative shadow-2xl">
              <img src="https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&q=80&w=1200" alt="Evento" className="object-cover w-full h-full mix-blend-overlay opacity-80" referrerPolicy="no-referrer" />
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
                {isRegistering && (
                  <div className="space-y-2">
                    <Label htmlFor="reg-name">Nome Completo</Label>
                    <Input 
                      id="reg-name"
                      type="text" 
                      value={registerName} 
                      onChange={(e) => setRegisterName(e.target.value)} 
                      placeholder="Ex: João da Silva" 
                      required 
                    />
                  </div>
                )}
                <div className="space-y-2"><Label>E-mail</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Senha</Label>
                    {!isRegistering && (
                      <button 
                        type="button" 
                        onClick={() => setIsForgotPassOpen(true)}
                        className="text-[10px] text-blue-600 font-bold uppercase tracking-widest hover:underline"
                      >
                        Esqueci a senha
                      </button>
                    )}
                  </div>
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                </div>

                {isRegistering && (
                  <div className="flex items-start gap-2.5 p-3.5 bg-slate-50 border border-slate-100 rounded-xl">
                    <input 
                      id="lgpd-consent-checkbox"
                      type="checkbox" 
                      checked={lgpdConsent} 
                      onChange={(e) => setLgpdConsent(e.target.checked)}
                      className="mt-1 h-4 w-4 bg-white text-blue-600 rounded border-slate-200 cursor-pointer focus:ring-blue-500"
                      required
                    />
                    <label htmlFor="lgpd-consent-checkbox" className="text-[10px] text-slate-500 font-semibold leading-relaxed cursor-pointer select-none">
                      Declaro consentimento explícito e de livre e esclarecida vontade, aceitando os{' '}
                      <span className="text-blue-600 hover:underline font-bold cursor-pointer">Termos de Uso</span> e{' '}
                      <span className="text-blue-600 hover:underline font-bold cursor-pointer">Política de Privacidade</span>.{' '}
                      Estou ciente de que meus dados de e-mail e nome são coletados apenas para segurança, login seguro e recuperação de conta.
                    </label>
                  </div>
                )}

                <Button type="submit" className="w-full bg-slate-900" disabled={authLoading}>{authLoading ? 'Processando...' : (isRegistering ? 'Cadastrar' : 'Entrar')}</Button>
              </form>

              <button onClick={() => {
                setIsRegistering(!isRegistering);
                setRegisterName('');
                setLgpdConsent(false);
              }} className="w-full text-center text-sm text-blue-600 font-semibold">{isRegistering ? 'Já tem conta? Entre' : 'Não tem conta? Cadastre-se'}</button>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-[10px] text-slate-500 font-medium leading-relaxed">
                <p className="font-bold text-slate-700 uppercase tracking-widest text-[9px] mb-1">💡 Dica de Acesso:</p>
                {isRegistering ? (
                  <p>Caso o sistema informe que seu e-mail já está cadastrado (como pelo Google ou pré-cadastro), mude para <strong>Acessar Conta</strong> e use <strong>Esqueci a senha</strong> para definir uma senha pessoal para este e-mail.</p>
                ) : (
                  <p>Se você se cadastrou originalmente via Google ou se seu e-mail foi pré-cadastrado na administração e quer usar uma senha pessoal, clique em <strong>Esqueci a senha</strong> para configurá-la.</p>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Forgot Password Dialog */}
        <Dialog open={isForgotPassOpen} onOpenChange={setIsForgotPassOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-xl font-bold">Recuperar Senha</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <p className="text-slate-500 text-sm">Insira seu e-mail para receber um link de redefinição de senha.</p>
              <div className="space-y-2">
                <Label>Seu E-mail</Label>
                <Input 
                  type="email" 
                  value={forgotPasswordEmail} 
                  onChange={(e) => setForgotPasswordEmail(e.target.value)} 
                  placeholder="exemplo@email.com"
                />
              </div>
              <Button 
                onClick={async () => {
                  if (!forgotPasswordEmail) return;
                  setAuthLoading(true);
                  try {
                    await sendPasswordResetEmail(auth, forgotPasswordEmail);
                    toast.success('E-mail de recuperação enviado!');
                    setIsForgotPassOpen(false);
                  } catch (err: any) {
                    toast.error('Erro ao enviar e-mail', { description: err.message });
                  } finally {
                    setAuthLoading(false);
                  }
                }} 
                className="w-full bg-slate-900"
                disabled={authLoading}
              >
                {authLoading ? 'Enviando...' : 'Enviar Link'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        <Toaster />
      </div>
    );
  }

  return (
    <Suspense fallback={<LoadingFallback />}>
      <Routes>
        <Route path="/" element={<Navigate to={profile.role === 'admin' ? '/admin' : profile.role === 'vendor' ? '/pdv' : profile.role === 'recharge' ? '/recharge' : '/portal'} replace />} />
        <Route path="/admin/*" element={<ProtectedRoute allowedRoles={['admin']} profile={profile}><AdminDashboard profile={profile} /></ProtectedRoute>} />
        <Route path="/vendor/*" element={<ProtectedRoute allowedRoles={['vendor']} profile={profile}><VendorDashboard profile={profile} /></ProtectedRoute>} />
        <Route path="/pdv/*" element={<ProtectedRoute allowedRoles={['vendor']} profile={profile}><AdminDashboard profile={profile} forcedTab="terminal" /></ProtectedRoute>} />
        <Route path="/recharge/*" element={<ProtectedRoute allowedRoles={['recharge']} profile={profile}><AdminDashboard profile={profile} forcedTab="recharge_pos" /></ProtectedRoute>} />
        <Route path="/portal/*" element={<ProtectedRoute allowedRoles={['student']} profile={profile}><ParentDashboard profile={profile} /></ProtectedRoute>} />
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
      <Toaster position="top-center" expand={true} richColors />
    </BrowserRouter>
  );
}
