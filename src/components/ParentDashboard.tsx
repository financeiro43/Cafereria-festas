import React, { useState, useEffect, useRef } from 'react';
import { db, auth } from '@/lib/firebase';
import { doc, onSnapshot, collection, query, where, orderBy, limit, addDoc, serverTimestamp, getDocs, updateDoc, increment } from 'firebase/firestore';
import { QRCodeSVG } from 'qrcode.react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UserProfile, Transaction } from '../types';
import { handleFirestoreError, OperationType } from '@/lib/error-handler';
import { PlusCircle, History, QrCode, LogOut, Wallet, CreditCard, ChevronRight, Info, Zap, ShieldCheck, X, ShoppingBag, Share2, Download, Users, Loader2, Wifi, WifiOff, Sparkles, Ticket } from 'lucide-react';
import axios from 'axios';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { toPng } from 'html-to-image';

import QRScanner from './QRScanner';
import RedePaymentForm from './RedePaymentForm';
import { Dialog, DialogContent } from '@/components/ui/dialog';

enum ParentTab {
  PAYMENT = 'payment',
  RECHARGE = 'recharge',
  HISTORY = 'history'
}

export default function ParentDashboard({ profile }: { profile: UserProfile }) {
  const [rechargeAmount, setRechargeAmount] = useState<string>('50');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [associatedProfiles, setAssociatedProfiles] = useState<UserProfile[]>([]);
  const [displayedUid, setDisplayedUid] = useState<string>(profile.uid);
  const [loading, setLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showSuccessAnimation, setShowSuccessAnimation] = useState(false);
  const [selectedAmount, setSelectedAmount] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<ParentTab>(ParentTab.PAYMENT);
  const [isOnline, setIsOnline] = useState(true);
  const shareCardRef = useRef<HTMLDivElement>(null);

  // Monitor connection status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    setIsOnline(navigator.onLine);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const [lastSelectedVal, setLastSelectedVal] = useState<string | null>(null);

  const displayedProfile = [profile, ...associatedProfiles].find(p => p.uid === displayedUid) || profile;

  // Formata uma string para formato de cartão (XXXX XXXX XXXX XXXX)
  const formatCardNumber = (str: string) => {
    // Usa o UID ou QRCode string para gerar um padrão numérico fixo baseado no hash
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const numeric = Math.abs(hash).toString().padEnd(16, '0').substring(0, 16);
    return numeric.replace(/(.{4})/g, '$1 ').trim();
  };

  const handleShare = async () => {
    setShowShareModal(true);
  };

  const generateAndShareImage = async () => {
    if (!shareCardRef.current) return;
    
    setLoading(true);
    try {
      const dataUrl = await toPng(shareCardRef.current, {
        cacheBust: true,
        backgroundColor: '#ffffff',
        style: {
          borderRadius: '0px' // Mantém o fundo limpo para o print
        }
      });
      
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const file = new File([blob], 'cartao-acesso.png', { type: 'image/png' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'Cartão de Acesso - Festa Pass',
          text: `Acesse o saldo de ${displayedProfile.name} usando este QR Code.`
        });
      } else {
        // Fallback: Download
        const link = document.createElement('a');
        link.download = `cartao-${displayedProfile.name.toLowerCase().replace(/\s/g, '-')}.png`;
        link.href = dataUrl;
        link.click();
        toast.success('Imagem baixada com sucesso!');
      }
    } catch (err) {
      console.error('Erro ao compartilhar imagem:', err);
      toast.error('Não foi possível gerar a imagem para compartilhamento');
    } finally {
      setLoading(false);
    }
  };

  const onScanSuccess = async (decodedText: string) => {
    try {
      setIsScanning(false);
      const q = query(collection(db, 'users'), where('qrCode', '==', decodedText));
      const querySnapshot = await getDocs(q);
      
      if (querySnapshot.empty) {
        toast.error('Cartão não identificado no sistema');
        return;
      }

      const userData = querySnapshot.docs[0].data() as UserProfile;
      const userRef = doc(db, 'users', profile.uid);
      
      // Se for um cartão diferente e não for o próprio
      if (userData.uid !== profile.uid) {
        if (confirm(`Deseja vincular o cartão de ${userData.name} como uma conta associada? Você poderá gerenciar e usar este saldo para pagamentos.`)) {
          
          await updateDoc(userRef, {
            associatedUids: Array.from(new Set([...(profile.associatedUids || []), userData.uid]))
          });

          setShowSuccessAnimation(true);
          toast.success(`Conta de ${userData.name} vinculada com sucesso!`, {
            description: 'Você já pode gerenciar este saldo.',
            duration: 5000,
          });
          
          // Esconde animação após alguns segundos
          setTimeout(() => setShowSuccessAnimation(false), 3000);
        }
      } else {
        toast.success('Este cartão já é o principal da sua conta.');
      }
    } catch (error) {
      console.error(error);
      toast.error('Erro ao processar leitura do cartão');
    }
  };

  useEffect(() => {
    if (!displayedUid) return;
    
    // Transactions listener
    const qTx = query(
      collection(db, 'transactions'),
      where('userId', '==', displayedUid),
      limit(50) // Increased limit since we sort on client
    );

    const unsubTx = onSnapshot(qTx, (snapshot) => {
      const txData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction));
      // Sort on client side to avoid composite index requirement
      const sortedTx = txData.sort((a, b) => {
        const timeA = a.timestamp?.toMillis ? a.timestamp.toMillis() : 0;
        const timeB = b.timestamp?.toMillis ? b.timestamp.toMillis() : 0;
        return timeB - timeA;
      });
      setTransactions(sortedTx);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'transactions');
    });

    return () => unsubTx();
  }, [profile.uid]);

  useEffect(() => {
    if (!profile.associatedUids || profile.associatedUids.length === 0) {
      setAssociatedProfiles([]);
      return;
    }

    const unsubs = profile.associatedUids.map(uid => {
      return onSnapshot(doc(db, 'users', uid), (snap) => {
        if (snap.exists()) {
          const data = { ...snap.data(), uid: snap.id } as UserProfile;
          setAssociatedProfiles(prev => {
            const index = prev.findIndex(p => p.uid === data.uid);
            if (index >= 0) {
              const next = [...prev];
              next[index] = data;
              return next;
            }
            return [...prev, data];
          });
        }
      });
    });

    return () => unsubs.forEach(unsub => unsub());
  }, [profile.associatedUids]);

  const handleRecharge = async () => {
    const amount = parseFloat(rechargeAmount);
    if (isNaN(amount) || amount <= 0) {
      toast.error('Valor inválido');
      return;
    }
    setSelectedAmount(amount);
    setShowPaymentModal(true);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white pb-32 overflow-x-hidden">
      {/* Background decorativo */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none -z-10">
        <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[40%] bg-blue-600/10 blur-[120px] rounded-full animate-pulse" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[40%] bg-purple-600/10 blur-[120px] rounded-full animate-pulse decoration-3000" />
      </div>

      <div className="max-w-md mx-auto px-6 pt-10 space-y-8">
        {/* Header */}
        <header className="flex justify-between items-center animate-in fade-in slide-in-from-top-4 duration-700">
          <div className="space-y-1">
            <h1 className="text-2xl font-black tracking-tight leading-none text-white uppercase">
              {activeTab === ParentTab.PAYMENT ? 'Pagamento' : 
               activeTab === ParentTab.RECHARGE ? 'Recarga' : 'Histórico'}
            </h1>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-[0.2em]">{displayedProfile.name} • {displayedUid === profile.uid ? 'Principal' : 'Associado'}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all duration-500 ${isOnline ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500' : 'bg-red-500/10 border-red-500/20 text-red-500 animate-pulse'}`}>
              {isOnline ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              <span className="text-[9px] font-black uppercase tracking-widest hidden xs:inline">{isOnline ? 'Online' : 'Offline'}</span>
            </div>
            
            <div className="flex items-center gap-2 bg-white/5 pl-4 pr-2 py-2 rounded-2xl border border-white/10 group">
              <div className="text-right hidden xs:block">
                <p className="text-[10px] font-black text-white uppercase leading-none mb-1 line-clamp-1">{profile.name}</p>
                <p className="text-[8px] font-bold text-slate-500 uppercase tracking-widest">{profile.email}</p>
              </div>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => auth.signOut()} 
                className="h-10 w-10 bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white rounded-xl transition-all"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </header>

        <AnimatePresence mode="wait">
          {activeTab === ParentTab.PAYMENT && (
            <motion.div 
              key="payment"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-8"
            >
              {/* Cartão Digital */}
              <div className="relative group">
                <div className="absolute inset-0 bg-blue-600/20 blur-3xl rounded-[40px] opacity-50 group-hover:opacity-100 transition-opacity" />
                <Card className="relative bg-gradient-to-br from-blue-600 via-blue-500 to-indigo-600 border border-white/20 rounded-[40px] overflow-hidden min-h-[220px] shadow-2xl">
                  <CardContent className="p-8 flex flex-col justify-between h-full min-h-[220px]">
                    <div className="flex justify-between items-start">
                      <div className="space-y-1">
                        <span className="text-[10px] font-black uppercase tracking-[0.3em] text-blue-100/60">Saldo Arena {displayedUid === profile.uid ? 'Unificado' : 'Associado'}</span>
                        <div className="text-5xl font-black tracking-tighter text-white">
                          R$ {displayedProfile.balance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </div>
                        {displayedUid === profile.uid && profile.associatedUids && profile.associatedUids.length > 0 && (
                          <p className="text-[9px] font-bold text-blue-200/40 uppercase mt-1">Gerenciando {profile.associatedUids.length} {profile.associatedUids.length === 1 ? 'conta associada' : 'contas associadas'}</p>
                        )}
                      </div>
                      <Sparkles className="h-8 w-8 text-yellow-300 fill-yellow-400/20 animate-pulse" />
                    </div>

                    <div className="flex justify-between items-end mt-12">
                      <div className="space-y-1">
                         <p className="text-[9px] font-bold uppercase tracking-widest text-blue-100/60 leading-none">Acesso VIP Eventos</p>
                         <p className="text-sm font-black text-white/90 uppercase truncate max-w-[150px]">{displayedProfile.name}</p>
                      </div>
                      <div className="bg-white/10 p-2 rounded-xl backdrop-blur-md border border-white/20">
                        <Ticket className="h-6 w-6 text-white" />
                      </div>
                    </div>
                  </CardContent>
                  <div className="absolute -top-1/2 -left-1/2 w-[200%] h-[200%] bg-gradient-to-br from-white/10 via-transparent to-transparent rotate-45 pointer-events-none" />
                </Card>
              </div>

              {/* QR Code para PDV */}
              <div className="bg-slate-900/50 border border-white/5 rounded-[40px] p-8 text-center space-y-6 relative overflow-hidden group">
                <div className="relative z-10 space-y-6">
                  <div className="space-y-1">
                    <h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-400">Pague no Balcão</h3>
                    <p className="text-[11px] text-slate-500 font-medium">Apresente este código para autorizar compras</p>
                  </div>
                  
                  <div className="bg-white p-6 rounded-[32px] inline-block shadow-[0_0_50px_rgba(255,255,255,0.05)] transform transition-transform group-hover:scale-105 duration-500">
                    <QRCodeSVG value={displayedProfile.qrCode} size={180} />
                  </div>

                  <div className="flex items-center justify-center gap-2">
                    <div className="h-1.5 w-1.5 bg-blue-500 rounded-full animate-pulse" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-blue-500">Pronto para uso</span>
                  </div>
                </div>

                <div className="relative z-10 px-8 pb-8">
                  <motion.div
                    whileHover={{ scale: 1.02, y: -2 }}
                    whileTap={{ scale: 0.98 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 10 }}
                  >
                    <Button 
                      onClick={handleShare}
                      className="w-full h-14 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-black text-[10px] uppercase tracking-[0.2em] rounded-2xl gap-3 shadow-lg hover:shadow-blue-500/10"
                    >
                      <Share2 className="h-4 w-4 text-blue-500" />
                      Compartilhar Acesso
                    </Button>
                  </motion.div>
                </div>

                <div className="absolute -bottom-10 -right-10 opacity-5">
                  <QrCode size={200} />
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === ParentTab.RECHARGE && (
            <motion.div 
              key="recharge"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-6"
            >
              {/* Recarga Rápida */}
              <div className="bg-slate-900/40 border border-white/5 rounded-[32px] p-6 space-y-6">
                <div className="grid grid-cols-3 gap-3">
                  {[20, 50, 100].map(val => (
                    <motion.button 
                      key={val} 
                      whileTap={{ scale: 0.96 }}
                      onClick={() => {
                        setRechargeAmount(val.toString());
                        setLastSelectedVal(val.toString());
                        setTimeout(() => setLastSelectedVal(null), 400);
                      }}
                      className={`relative h-16 rounded-2xl border-2 font-black text-sm transition-all duration-200 flex flex-col items-center justify-center gap-0.5 overflow-hidden group ${
                        rechargeAmount === val.toString() 
                        ? 'bg-blue-600/90 text-white border-blue-400 shadow-[0_0_30px_rgba(37,99,235,0.3)]' 
                        : 'bg-slate-950 text-slate-500 border-white/5 hover:border-white/10 hover:bg-slate-900 hover:text-slate-300'
                      }`}
                    >
                      <span className="text-[10px] opacity-60 font-bold">R$</span>
                      <span className="text-base tracking-tight">{val}</span>
                      
                      {/* Temporary flash outline */}
                      <AnimatePresence>
                        {lastSelectedVal === val.toString() && (
                          <motion.div 
                            initial={{ opacity: 1, scale: 1 }}
                            animate={{ opacity: 0, scale: 1.1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 border-2 border-white rounded-2xl z-20 pointer-events-none"
                            transition={{ duration: 0.4 }}
                          />
                        )}
                      </AnimatePresence>

                      {rechargeAmount === val.toString() && (
                        <>
                          <motion.div 
                            layoutId="active-recharge-glow"
                            className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-transparent pointer-events-none"
                            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                          />
                          <motion.div 
                            layoutId="active-recharge-indicator"
                            className="absolute bottom-1.5 h-1 w-6 bg-white rounded-full shadow-[0_0_10px_rgba(255,255,255,0.5)]"
                          />
                        </>
                      )}
                    </motion.button>
                  ))}
                </div>

                <div className="relative">
                  <span className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-500 font-black text-lg">R$</span>
                  <Input 
                    type="number" 
                    value={rechargeAmount}
                    onChange={(e) => setRechargeAmount(e.target.value)}
                    className="pl-14 pr-6 h-16 text-2xl font-black bg-slate-950 border-white/5 rounded-2xl focus:ring-blue-600 focus:border-blue-600 text-white text-right"
                  />
                </div>

                <Button 
                  onClick={handleRecharge} 
                  disabled={loading} 
                  className="w-full h-16 bg-blue-600 hover:bg-blue-500 text-white font-black text-sm uppercase tracking-widest rounded-2xl shadow-2xl transition-all active:scale-95 border-b-4 border-blue-800 active:border-b-0"
                >
                  {loading ? 'Processando...' : 'Recarregar Agora'}
                </Button>

                <div className="space-y-3">
                  <div className="flex items-center gap-3 p-4 bg-blue-500/5 rounded-2xl border border-blue-500/10 group cursor-pointer" onClick={() => setIsScanning(true)}>
                    <div className="h-10 w-10 bg-blue-600/10 rounded-xl flex items-center justify-center">
                        <QrCode className="h-5 w-5 text-blue-500" />
                    </div>
                    <div className="flex-1">
                        <p className="text-[11px] font-black uppercase text-blue-100">Vincular Conta Associada</p>
                        <p className="text-[9px] text-slate-500 font-bold">Gerencie cartões de dependentes ou familiares</p>
                    </div>
                    <ChevronRight className="h-5 w-5 text-slate-700 group-hover:translate-x-1 transition-transform" />
                  </div>

                  {/* Selector de Contas */}
                  <div className="pt-2">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-600 mb-3 ml-2">Escolha a Conta Ativa</p>
                    <div className="space-y-2">
                      {/* Principal Account */}
                      <button 
                        onClick={() => setDisplayedUid(profile.uid)}
                        className={`w-full flex items-center justify-between p-3.5 rounded-2xl border transition-all ${displayedUid === profile.uid ? 'bg-blue-600/10 border-blue-600/30 ring-1 ring-blue-600/20' : 'bg-slate-950/50 border-white/5'}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${displayedUid === profile.uid ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-500'}`}>
                            <CreditCard className="h-4 w-4" />
                          </div>
                          <div className="text-left">
                            <span className="block text-xs font-black text-slate-200">Carteira Principal</span>
                            <span className="text-[9px] text-slate-500 font-bold uppercase tracking-tighter">Própria</span>
                          </div>
                        </div>
                        <span className="text-xs font-black text-blue-400">R$ {profile.balance.toFixed(2)}</span>
                      </button>

                      {/* Associated Profiles */}
                      {associatedProfiles.map(assoc => (
                        <button 
                          key={assoc.uid}
                          onClick={() => setDisplayedUid(assoc.uid)}
                          className={`w-full flex items-center justify-between p-3.5 rounded-2xl border transition-all ${displayedUid === assoc.uid ? 'bg-blue-600/10 border-blue-600/30 ring-1 ring-blue-600/20' : 'bg-slate-950/50 border-white/5'}`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${displayedUid === assoc.uid ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-500'}`}>
                              <Users className="h-4 w-4" />
                            </div>
                            <div className="text-left">
                              <span className="block text-xs font-black text-slate-200 truncate max-w-[120px]">{assoc.name}</span>
                              <span className="text-[9px] text-slate-500 font-bold uppercase tracking-tighter">Associado</span>
                            </div>
                          </div>
                          <span className="text-xs font-black text-blue-400">R$ {assoc.balance.toFixed(2)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === ParentTab.HISTORY && (
            <motion.div 
              key="history"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-4"
            >
              <div className="bg-slate-900/40 border border-white/5 rounded-[32px] overflow-hidden">
                <div className="divide-y divide-white/5">
                  {transactions.length === 0 ? (
                    <div className="p-12 text-center text-slate-600 font-bold uppercase tracking-widest text-[10px]">
                      Sem movimentações recentes
                    </div>
                  ) : (
                    transactions.map((tx) => (
                      <div key={tx.id} className="flex justify-between items-center p-6 hover:bg-white/[0.02] transition-colors">
                        <div className="flex items-center gap-4">
                          <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${tx.type === 'credit' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                            {tx.type === 'credit' ? <PlusCircle className="h-5 w-5" /> : <ShoppingBag className="h-5 w-5" />}
                          </div>
                          <div>
                            <p className="text-xs font-black text-white/90 uppercase leading-none mb-1">{tx.description}</p>
                            <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">
                              {tx.timestamp ? new Date(tx.timestamp.toDate()).toLocaleDateString('pt-BR') : 'Agora'}
                            </p>
                          </div>
                        </div>
                        <div className={`text-sm font-black ${tx.type === 'credit' ? 'text-green-500' : 'text-slate-400'}`}>
                          {tx.type === 'credit' ? '+' : '-'} R$ {Math.abs(tx.amount).toFixed(2)}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Fluent Bottom Navigation Capsule */}
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 w-full max-w-[340px] z-[100] px-4">
        <motion.nav 
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="bg-slate-900/60 backdrop-blur-2xl border border-white/10 rounded-[32px] p-2 flex items-center justify-between shadow-[0_20px_50px_rgba(0,0,0,0.5)] ring-1 ring-inset ring-white/5"
        >
          <button 
            onClick={() => setActiveTab(ParentTab.PAYMENT)}
            className={`relative flex-1 flex flex-col items-center justify-center py-3 gap-1 transition-all ${activeTab === ParentTab.PAYMENT ? 'text-white' : 'text-slate-500 hover:text-slate-400'}`}
          >
            {activeTab === ParentTab.PAYMENT && (
              <motion.div 
                layoutId="active-portal-tab-bg"
                className="absolute inset-x-1 inset-y-1 bg-blue-600 rounded-[24px] shadow-lg shadow-blue-500/20"
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
            )}
            <div className="relative z-10 flex flex-col items-center gap-1">
              <QrCode className={`h-5 w-5 ${activeTab === ParentTab.PAYMENT ? 'text-white' : 'text-slate-500'}`} />
              <span className={`text-[8px] font-black uppercase tracking-widest ${activeTab === ParentTab.PAYMENT ? 'text-white' : 'text-slate-500'}`}>Pagamento</span>
            </div>
          </button>
          
          <button 
            onClick={() => setActiveTab(ParentTab.RECHARGE)}
            className={`relative flex-1 flex flex-col items-center justify-center py-3 gap-1 transition-all ${activeTab === ParentTab.RECHARGE ? 'text-white' : 'text-slate-500 hover:text-slate-400'}`}
          >
            {activeTab === ParentTab.RECHARGE && (
              <motion.div 
                layoutId="active-portal-tab-bg"
                className="absolute inset-x-1 inset-y-1 bg-blue-600 rounded-[24px] shadow-lg shadow-blue-500/20"
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
            )}
            <div className="relative z-10 flex flex-col items-center gap-1">
              <Wallet className={`h-5 w-5 ${activeTab === ParentTab.RECHARGE ? 'text-white' : 'text-slate-500'}`} />
              <span className={`text-[8px] font-black uppercase tracking-widest ${activeTab === ParentTab.RECHARGE ? 'text-white' : 'text-slate-500'}`}>Recarga</span>
            </div>
          </button>
          
          <button 
            onClick={() => setActiveTab(ParentTab.HISTORY)}
            className={`relative flex-1 flex flex-col items-center justify-center py-3 gap-1 transition-all ${activeTab === ParentTab.HISTORY ? 'text-white' : 'text-slate-500 hover:text-slate-400'}`}
          >
            {activeTab === ParentTab.HISTORY && (
              <motion.div 
                layoutId="active-portal-tab-bg"
                className="absolute inset-x-1 inset-y-1 bg-blue-600 rounded-[24px] shadow-lg shadow-blue-500/20"
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
            )}
            <div className="relative z-10 flex flex-col items-center gap-1">
              <History className={`h-5 w-5 ${activeTab === ParentTab.HISTORY ? 'text-white' : 'text-slate-500'}`} />
              <span className={`text-[8px] font-black uppercase tracking-widest ${activeTab === ParentTab.HISTORY ? 'text-white' : 'text-slate-500'}`}>Histórico</span>
            </div>
          </button>
        </motion.nav>
      </div>

      {isScanning && (
        <QRScanner 
          onScan={onScanSuccess} 
          onClose={() => setIsScanning(false)} 
          title="Vincular Cartão Escolar"
        />
      )}

      {/* Animação Sucesso Vínculo */}
      <AnimatePresence>
        {showSuccessAnimation && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-blue-600/20 backdrop-blur-md"
          >
            <motion.div
              initial={{ scale: 0.5, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 1.1, opacity: 0 }}
              className="bg-white rounded-[40px] p-10 text-center space-y-6 shadow-2xl max-w-sm w-full"
            >
              <div className="flex justify-center">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: [0, 1.2, 1] }}
                  transition={{ delay: 0.2, type: 'spring' }}
                  className="h-24 w-24 bg-green-500 rounded-full flex items-center justify-center shadow-lg shadow-green-200"
                >
                  <ShieldCheck className="h-12 w-12 text-white" />
                </motion.div>
              </div>
              <div className="space-y-2">
                <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tighter">Tudo Pronto!</h3>
                <p className="text-sm text-slate-500 font-bold leading-relaxed">
                  A conta foi vinculada com sucesso ao seu perfil principal.
                </p>
              </div>
              <div className="pt-4 flex justify-center">
                <div className="flex gap-1">
                  {[1, 2, 3].map(i => (
                    <motion.div
                      key={i}
                      animate={{ scale: [1, 1.5, 1], opacity: [0.3, 1, 0.3] }}
                      transition={{ repeat: Infinity, duration: 1, delay: i * 0.2 }}
                      className="h-2 w-2 bg-blue-600 rounded-full"
                    />
                  ))}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal de Compartilhamento */}
      <AnimatePresence>
        {showShareModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowShareModal(false)}
              className="absolute inset-0 bg-slate-950/90 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-sm"
            >
              <div 
                ref={shareCardRef}
                className="bg-white rounded-[40px] p-10 text-slate-950 overflow-hidden shadow-2xl relative"
              >
                <div className="absolute top-0 left-0 w-full h-3 bg-blue-600" />
                
                <div className="text-center space-y-8 pt-4">
                  <div className="space-y-1">
                    <div className="flex justify-center mb-6">
                      <div className="bg-blue-600 p-2.5 rounded-2xl shadow-lg shadow-blue-200">
                        <Sparkles className="h-7 w-7 text-white" />
                      </div>
                    </div>
                    <h3 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Festa Pass Digital</h3>
                    <p className="text-[11px] text-slate-400 font-bold uppercase tracking-[0.2em]">O Melhor do Entretenimento</p>
                  </div>

                  <div className="bg-white p-6 rounded-[40px] shadow-[0_20px_50px_rgba(0,0,0,0.06)] border border-slate-100 flex justify-center relative group">
                    <QRCodeSVG value={displayedProfile.qrCode} size={220} />
                    <div className="absolute inset-0 bg-white/50 backdrop-blur-[1px] opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center p-8 text-center pointer-events-none">
                       <p className="text-[10px] font-black uppercase text-blue-600">QRCode Válido para Pagamento</p>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="space-y-1">
                      <p className="text-[9px] text-slate-400 font-bold uppercase tracking-[0.3em] font-mono">Número do Cartão</p>
                      <p className="text-lg font-black text-slate-800 tracking-[0.1em] font-mono">
                        {formatCardNumber(displayedProfile.uid)}
                      </p>
                    </div>

                    <div className="pt-6 border-t border-slate-100 flex justify-between items-end">
                      <div className="text-left space-y-1">
                        <p className="text-[8px] text-slate-400 font-bold uppercase tracking-widest leading-none">Titular</p>
                        <p className="text-sm font-black text-slate-900 uppercase truncate max-w-[140px]">{displayedProfile.name}</p>
                      </div>
                      <div className="text-right space-y-1">
                        <p className="text-[8px] text-slate-400 font-bold uppercase tracking-widest leading-none">Válido em</p>
                        <p className="text-[10px] font-black text-slate-900 uppercase">Toda a Rede</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Elementos decorativos */}
                <div className="absolute top-10 right-[-40px] w-48 h-48 bg-blue-600/5 rounded-full blur-3xl pointer-events-none" />
                <div className="absolute bottom-[-40px] left-[-40px] w-48 h-48 bg-purple-600/5 rounded-full blur-3xl pointer-events-none" />
              </div>

              <div className="mt-8 space-y-3">
                <Button 
                  onClick={generateAndShareImage}
                  disabled={loading}
                  className="w-full h-16 bg-blue-600 hover:bg-blue-500 text-white font-black text-xs uppercase tracking-[0.2em] rounded-2xl gap-3 shadow-xl shadow-blue-900/40"
                >
                  {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Share2 className="h-5 w-5" />}
                  {loading ? 'Gerando Imagem...' : 'Enviar Cartão (Imagem)'}
                </Button>
                
                <Button 
                  onClick={() => setShowShareModal(false)}
                  variant="ghost"
                  className="w-full h-12 text-slate-400 hover:text-white font-black text-[10px] uppercase tracking-widest"
                >
                  Fechar
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <Dialog open={showPaymentModal} onOpenChange={setShowPaymentModal}>
        <DialogContent className="sm:max-w-md bg-slate-900 border-white/5 rounded-[32px] p-0 overflow-hidden outline-none">
          <div className="p-8">
            <RedePaymentForm 
              amount={selectedAmount} 
              uid={displayedUid} 
              onSuccess={() => {
                setTimeout(() => setShowPaymentModal(false), 2000);
              }}
              onCancel={() => setShowPaymentModal(false)}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
