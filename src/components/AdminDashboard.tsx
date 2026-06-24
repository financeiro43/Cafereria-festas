import React, { useState, useEffect, useRef } from 'react';
import { db, auth } from '@/lib/firebase';
import { doc, onSnapshot, collection, query, where, orderBy, limit, addDoc, serverTimestamp, getDocs, getDoc, updateDoc, increment, startAfter, getDocsFromCache } from 'firebase/firestore';
import { QRCodeSVG } from 'qrcode.react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UserProfile, Transaction } from '../types';
import { handleFirestoreError, OperationType } from '@/lib/error-handler';
import { authService } from '@/services/authService';
import { PlusCircle, History, QrCode, LogOut, Wallet, CreditCard, ChevronRight, Info, Zap, ShieldCheck, X, ShoppingBag, Share2, Download, Users, Loader2, Wifi, WifiOff, Sparkles, Ticket, ShieldAlert, Trash2, Lock, Sliders, SlidersHorizontal } from 'lucide-react';
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
  const [showPrivacyDialog, setShowPrivacyDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingLoading, setDeletingLoading] = useState(false);

  const [rechargeAmount, setRechargeAmount] = useState<string>('50');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [lastVisible, setLastVisible] = useState<any>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const PAGE_SIZE = 10;
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

  const [editingChildProfile, setEditingChildProfile] = useState<UserProfile | null>(null);
  const [allocatedBalanceInput, setAllocatedBalanceInput] = useState<string>('');
  const [parentProfile, setParentProfile] = useState<UserProfile | null>(null);

  const [unlinkProfile, setUnlinkProfile] = useState<UserProfile | null>(null);
  const [unlinkDestination, setUnlinkDestination] = useState<'card' | 'parent'>('parent');
  const [unlinkSharedAmount, setUnlinkSharedAmount] = useState<string>('0');
  const [unlinkingLoading, setUnlinkingLoading] = useState(false);

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

  // Listen to parent user profile if current profile has a parentUid and is in 'shared' mode
  useEffect(() => {
    if (!profile.parentUid) {
      setParentProfile(null);
      return;
    }
    return onSnapshot(doc(db, 'users', profile.parentUid), (snap) => {
      if (snap.exists()) {
        setParentProfile({ ...snap.data(), uid: snap.id } as UserProfile);
      }
    });
  }, [profile.parentUid]);

  const [lastSelectedVal, setLastSelectedVal] = useState<string | null>(null);

  const displayedProfile = [profile, ...associatedProfiles].find(p => p.uid === displayedUid) || profile;

  const getProfileBalance = (p: UserProfile) => {
    if (p.uid === profile.uid) {
      if ((!profile.balanceType || profile.balanceType === 'shared') && profile.parentUid) {
        return parentProfile?.balance || 0;
      }
      return profile.balance || 0;
    }
    if (!p.balanceType || p.balanceType === 'shared') {
      return profile.balance || 0;
    }
    return p.balance || 0;
  };

  // Formata uma string para formato de cartão (XXXX XXXX XXXX XXXX)
  const formatCardNumber = (str: string) => {
    if (!str) return '0000 0000 0000 0000';
    
    const cleanDigits = str.replace(/\D/g, '');
    const isPurelyNumeric = /^\d+$/.test(cleanDigits);
    const isSystemCode = str.includes('PENDING') || str.includes('VIRTUAL');
    
    if (isPurelyNumeric && !isSystemCode && cleanDigits.length > 0) {
      const padded = cleanDigits.padEnd(16, '0').substring(0, 16);
      return padded.replace(/(.{4})/g, '$1 ').trim();
    }
    
    let hash1 = 0;
    let hash2 = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash1 = char + ((hash1 << 5) - hash1);
      hash2 = char + ((hash2 << 7) - hash2) + hash1;
    }
    
    let seed = Math.abs(hash1 ^ hash2);
    let numeric = '';
    for (let i = 0; i < 16; i++) {
      seed = (seed * 9301 + 49297) % 233280;
      numeric += (seed % 10).toString();
    }
    
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
      const cleanText = decodedText.trim();
      if (!cleanText) return;

      // Run queries in parallel to make dynamic identification twice as fast!
      const qMain = query(collection(db, 'users'), where('qrCode', '==', cleanText), limit(1));
      const qCards = query(collection(db, 'users'), where('linkedCards', 'array-contains', cleanText), limit(1));
      
      let snapMain: any = null;
      let snapCards: any = null;
      
      try {
        // Try local offline cache first (extremely fast, ~0ms latency!)
        [snapMain, snapCards] = await Promise.all([
          getDocsFromCache(qMain),
          getDocsFromCache(qCards)
        ]);
      } catch (cacheErr) {
        console.warn("[CACHE] Cache lookup failed, searching server...", cacheErr);
      }
      
      // Fallback to fetch from server if cache was empty or failed
      if (!snapMain || (snapMain.empty && (!snapCards || snapCards.empty))) {
        const [serverMain, serverCards] = await Promise.all([
          getDocs(qMain),
          getDocs(qCards)
        ]);
        snapMain = serverMain;
        snapCards = serverCards;
      }
      
      const querySnapshot = (snapMain && !snapMain.empty) ? snapMain : (snapCards || { empty: true });
      
      if (querySnapshot.empty) {
        toast.error('Cartão não identificado no sistema');
        return;
      }

      const userDoc = querySnapshot.docs[0];
      const userData = { ...userDoc.data(), uid: userDoc.id } as UserProfile;
      const userRef = doc(db, 'users', profile.uid);
      
      // Se for um cartão diferente e não for o próprio
      if (userData.uid !== profile.uid) {
        // Obter os dados de perfil mais atualizados do responsável diretamente do banco para evitar race conditions ou props estressadas/desatualizadas do React
        const parentSnap = await getDoc(userRef);
        const parentData = parentSnap.exists() ? (parentSnap.data() as UserProfile) : profile;
        const latestAssociatedUids = parentData.associatedUids || [];

        if (latestAssociatedUids.includes(userData.uid)) {
          toast.info(`${userData.name} já está vinculado à sua conta.`);
          setDisplayedUid(userData.uid);
          return;
        }

        if (userData.parentUid && userData.parentUid !== profile.uid) {
          toast.error('Este cartão já está vinculado a outro dispositivo!', {
            description: `O cartão de ${userData.name} já possui outro responsável associado.`
          });
          return;
        }

        if (confirm(`Deseja vincular a conta de ${userData.name} como um dependente? Você poderá gerenciar o saldo e visualizar o histórico.`)) {
          
          const childBalance = userData.balance || 0;
          
          // Quando vinculamos um dependente com saldo compartilhado/unificado (padrão),
          // para evitar perda de fundos, nós acrescentamos o saldo atual do dependente ao saldo do responsável/principal!
          await updateDoc(userRef, {
            associatedUids: Array.from(new Set([...latestAssociatedUids, userData.uid])),
            balance: increment(childBalance),
            _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
          });

          // Link parentUid and default balanceType in child's profile
          try {
            await updateDoc(doc(db, 'users', userData.uid), {
              parentUid: profile.uid,
              balanceType: 'shared',
              balance: 0, // Como agora está compartilhado, o saldo individual é considerado 0 (busca o do responsável)
              _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
            });
          } catch (childErr) {
            console.error("Erro ao gravar parentUid no perfil do dependente:", childErr);
          }

          setShowSuccessAnimation(true);
          toast.success(`Conta de ${userData.name} vinculada com sucesso!`, {
            description: childBalance > 0 
              ? `O saldo de R$ ${childBalance.toFixed(2)} do dependente foi unificado à sua carteira principal!` 
              : 'Você já pode gerenciar este saldo.',
            duration: 6000,
          });
          
          setDisplayedUid(userData.uid);
          
          // Esconde animação após alguns segundos
          setTimeout(() => setShowSuccessAnimation(false), 3000);
        }
      } else {
        toast.success('Este cartão já é o principal da sua conta.');
      }
    } catch (error: any) {
      console.error(error);
      toast.error('Erro ao processar leitura do cartão', {
        description: error?.message || 'Erro inesperado ao acessar o banco de dados.'
      });
    }
  };

  const fetchTransactions = async (isFirstPage = false, uid = displayedUid) => {
    if (!uid) return;
    
    setLoadingMore(true);
    try {
      const txRef = collection(db, 'transactions');
      let qTx;
      if (isFirstPage) {
        qTx = query(
          txRef,
          where('userId', '==', uid),
          limit(50) // Aumentado para pegar mais itens iniciais sem precisar de ordenação complexa no DB
        );
      } else if (lastVisible) {
        qTx = query(
          txRef,
          where('userId', '==', uid),
          startAfter(lastVisible),
          limit(50)
        );
      } else {
        return;
      }

      const snapshot = await getDocs(qTx);
      let newTx = snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) } as Transaction));
      
      // Ordenação manual para evitar necessidade de índice composto
      newTx.sort((a, b) => {
        const timeA = a.timestamp?.toMillis ? a.timestamp.toMillis() : 
                      (a.timestamp?.seconds ? a.timestamp.seconds * 1000 : 0);
        const timeB = b.timestamp?.toMillis ? b.timestamp.toMillis() : 
                      (b.timestamp?.seconds ? b.timestamp.seconds * 1000 : 0);
        return timeB - timeA;
      });

      if (isFirstPage) {
        setTransactions(newTx);
      } else {
        setTransactions(prev => {
          const existingIds = new Set(prev.map(t => t.id));
          const filtered = newTx.filter(t => !existingIds.has(t.id));
          return [...prev, ...filtered];
        });
      }
      
      if (snapshot.docs.length > 0) {
        setLastVisible(snapshot.docs[snapshot.docs.length - 1]);
      }
      setHasMore(snapshot.docs.length === PAGE_SIZE);
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'transactions');
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    if (!displayedUid) return;
    
    // Clear state when switching users
    setTransactions([]);
    setLastVisible(null);
    setHasMore(true);
    
    fetchTransactions(true, displayedUid);
    
    // Subscribe to first page for real-time updates without index requirement
    const qLatest = query(
      collection(db, 'transactions'),
      where('userId', '==', displayedUid),
      limit(50)
    );

    const unsubLatest = onSnapshot(qLatest, (snapshot) => {
      const latestTx = snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) } as Transaction));
      
      setTransactions(prev => {
        // Merge latest with existing, avoiding duplicates
        const latestIds = new Set(latestTx.map(t => t.id));
        const rest = prev.filter(t => !latestIds.has(t.id));
        const merged = [...latestTx, ...rest];
        
        return merged.sort((a, b) => {
          const timeA = a.timestamp?.toMillis ? a.timestamp.toMillis() : 
                        (a.timestamp?.seconds ? a.timestamp.seconds * 1000 : 0);
          const timeB = b.timestamp?.toMillis ? b.timestamp.toMillis() : 
                        (b.timestamp?.seconds ? b.timestamp.seconds * 1000 : 0);
          return timeB - timeA;
        });
      });
    }, (error) => {
      // Index error might happen if timestamp + userId index isn't ready
      console.warn('Real-time updates failed, falling back to manual fetch:', error);
    });

    return () => unsubLatest();
  }, [displayedUid]);

  useEffect(() => {
    if (!profile.associatedUids || profile.associatedUids.length === 0) {
      setAssociatedProfiles([]);
      return;
    }

    // Keep associatedProfiles strictly in sync with profile.associatedUids by removing any that are no longer linked
    setAssociatedProfiles(prev => prev.filter(p => profile.associatedUids?.includes(p.uid)));

    const unsubs = profile.associatedUids.map(uid => {
      return onSnapshot(doc(db, 'users', uid), (snap) => {
        if (snap.exists()) {
          const data = { ...snap.data(), uid: snap.id } as UserProfile;
          setAssociatedProfiles(prev => {
            // Filter current state to only include currently linked cards
            const filtered = prev.filter(p => profile.associatedUids?.includes(p.uid));
            const index = filtered.findIndex(p => p.uid === data.uid);
            if (index >= 0) {
              const next = [...filtered];
              next[index] = data;
              return next;
            }
            return [...filtered, data];
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

  const handleUpdateBalanceType = async (type: 'shared' | 'custom') => {
    if (type === displayedProfile.balanceType) return;
    
    try {
      if (type === 'shared') {
        const childCustomBalance = displayedProfile.balance || 0;
        
        // Devolve o saldo personalizado restante para a carteira principal do responsável
        await updateDoc(doc(db, 'users', profile.uid), {
          balance: increment(childCustomBalance),
          _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
        });
        
        await updateDoc(doc(db, 'users', displayedProfile.uid), {
          balanceType: 'shared',
          balance: 0,
          _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
        });
        
        toast.success(`Modo de saldo alterado para Compartilhado! O saldo de R$ ${childCustomBalance.toFixed(2)} foi unificado à sua Carteira Principal.`);
      } else {
        await updateDoc(doc(db, 'users', displayedProfile.uid), {
          balanceType: 'custom',
          balance: 0,
          _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
        });
        toast.success('Modo de saldo alterado para Personalizado! Agora você pode definir um saldo fixo dedicado para este cartão.');
      }
    } catch (err: any) {
      console.error(err);
      toast.error('Erro ao atualizar modo de saldo: ' + (err.message || ''));
    }
  };

  const handleAllocateCustomBalance = async (newAmount: number) => {
    if (isNaN(newAmount) || newAmount < 0) {
      toast.error('Valor de saldo inválido');
      return;
    }
    
    try {
      const currentChildBalance = displayedProfile.balance || 0;
      const diff = newAmount - currentChildBalance;
      
      if (diff === 0) return;
      
      if (diff > 0) {
        // Precisa retirar saldo da principal para dar pro dependente
        const parentBalance = profile.balance || 0;
        if (parentBalance < diff) {
          toast.error('Saldo insuficiente na Carteira Principal.', {
            description: `Você tem R$ ${parentBalance.toFixed(2)} livre, mas precisa de R$ ${diff.toFixed(2)} adicionais para esta transferência.`
          });
          return;
        }
        
        await updateDoc(doc(db, 'users', profile.uid), {
          balance: increment(-diff),
          _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
        });
        await updateDoc(doc(db, 'users', displayedProfile.uid), {
          balance: increment(diff),
          _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
        });
        toast.success(`R$ ${diff.toFixed(2)} transferidos para o cartão de ${displayedProfile.name}.`);
      } else {
        // Devolve o excesso para a principal
        const absDiff = Math.abs(diff);
        await updateDoc(doc(db, 'users', profile.uid), {
          balance: increment(absDiff),
          _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
        });
        await updateDoc(doc(db, 'users', displayedProfile.uid), {
          balance: increment(-absDiff),
          _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
        });
        toast.success(`R$ ${absDiff.toFixed(2)} devolvidos para sua Carteira Principal.`);
      }
    } catch (err: any) {
      console.error(err);
      toast.error('Erro ao calibrar saldo: ' + (err.message || ''));
    }
  };

  const handleAllocateBalanceForChild = async (targetUid: string, newAmount: number): Promise<boolean> => {
    if (isNaN(newAmount) || newAmount < 0) {
      toast.error('Valor de saldo inválido');
      return false;
    }
    
    try {
      const childProfile = associatedProfiles.find(p => p.uid === targetUid);
      if (!childProfile) return false;
      
      const isShared = !childProfile.balanceType || childProfile.balanceType === 'shared';
      const currentChildBalance = isShared ? 0 : (childProfile.balance || 0);
      
      if (newAmount === 0) {
        if (isShared) {
          // Já era compartilhado, nada a fazer
          return true;
        }
        
        // Devolve o saldo personalizado restante para a carteira principal do responsável
        await updateDoc(doc(db, 'users', profile.uid), {
          balance: increment(currentChildBalance),
          _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
        });
        
        await updateDoc(doc(db, 'users', targetUid), {
          balanceType: 'shared',
          balance: 0,
          _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
        });
        
        toast.success(`Modo de saldo alterado para Compartilhado! O saldo de R$ ${currentChildBalance.toFixed(2)} foi unificado à sua Carteira Principal.`);
        return true;
      }
      
      if (isShared) {
        // Se era compartilhado, vamos primeiro atualizar para 'custom'
        const parentBalance = profile.balance || 0;
        if (parentBalance < newAmount) {
          toast.error('Saldo insuficiente na Carteira Principal.', {
            description: `Você tem R$ ${parentBalance.toFixed(2)} livre, mas precisa de R$ ${newAmount.toFixed(2)} para esta alocação.`
          });
          return false;
        }
        
        await updateDoc(doc(db, 'users', profile.uid), {
          balance: increment(-newAmount),
          _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
        });
        await updateDoc(doc(db, 'users', targetUid), {
          balanceType: 'custom',
          balance: newAmount,
          _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
        });
        
        toast.success(`R$ ${newAmount.toFixed(2)} transferidos para o cartão de ${childProfile.name} (Saldo Personalizado Ativado).`);
        return true;
      }
      
      // Se já era customizado, calculamos a diferença
      const diff = newAmount - currentChildBalance;
      if (diff === 0) return true;
      
      if (diff > 0) {
        const parentBalance = profile.balance || 0;
        if (parentBalance < diff) {
          toast.error('Saldo insuficiente na Carteira Principal.', {
            description: `Você tem R$ ${parentBalance.toFixed(2)} livre, mas precisa de R$ ${diff.toFixed(2)} adicionais para esta transferência.`
          });
          return false;
        }
        
        await updateDoc(doc(db, 'users', profile.uid), {
          balance: increment(-diff),
          _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
        });
        await updateDoc(doc(db, 'users', targetUid), {
          balance: increment(diff),
          _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
        });
        toast.success(`R$ ${diff.toFixed(2)} adicionais transferidos para o cartão de ${childProfile.name}.`);
      } else {
        const absDiff = Math.abs(diff);
        await updateDoc(doc(db, 'users', profile.uid), {
          balance: increment(absDiff),
          _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
        });
        await updateDoc(doc(db, 'users', targetUid), {
          balance: increment(-absDiff),
          _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
        });
        toast.success(`R$ ${absDiff.toFixed(2)} devolvidos para sua Carteira Principal.`);
      }
      return true;
    } catch (err: any) {
      console.error(err);
      toast.error('Erro ao calibrar saldo: ' + (err.message || ''));
      return false;
    }
  };

  const handleUpdateBalanceTypeForChild = async (targetUid: string, type: 'shared' | 'custom') => {
    try {
      const childProfile = associatedProfiles.find(p => p.uid === targetUid);
      if (!childProfile) return;
      
      if (type === childProfile.balanceType) return;
      
      if (type === 'shared') {
        const childCustomBalance = childProfile.balance || 0;
        
        // Devolve o saldo personalizado restante para a carteira principal do responsável
        await updateDoc(doc(db, 'users', profile.uid), {
          balance: increment(childCustomBalance),
          _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
        });
        
        await updateDoc(doc(db, 'users', targetUid), {
          balanceType: 'shared',
          balance: 0,
          _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
        });
        
        toast.success(`Modo de saldo de ${childProfile.name} alterado para Compartilhado! O saldo de R$ ${childCustomBalance.toFixed(2)} foi unificado à sua carteira.`);
      } else {
        await updateDoc(doc(db, 'users', targetUid), {
          balanceType: 'custom',
          balance: 0,
          _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
        });
        toast.success(`Modo de saldo de ${childProfile.name} alterado para Personalizado! Agora você pode definir um saldo fixo dedicado para este cartão.`);
      }
    } catch (err: any) {
      console.error(err);
      toast.error('Erro ao atualizar modo de saldo: ' + (err.message || ''));
    }
  };

  const handleUnlinkAccountWithBalanceOption = async () => {
    if (!unlinkProfile) return;
    setUnlinkingLoading(true);
    try {
      const parentRef = doc(db, 'users', profile.uid);
      const childRef = doc(db, 'users', unlinkProfile.uid);
      
      const isCustom = unlinkProfile.balanceType === 'custom';
      const childBalance = unlinkProfile.balance || 0;
      
      const newAssociatedUids = (profile.associatedUids || []).filter(uid => uid !== unlinkProfile.uid);
      
      if (unlinkDestination === 'card') {
        // Opção 1: Saldo fica no Cartão
        if (isCustom) {
          // Keep current custom balance on child
          await updateDoc(childRef, {
            parentUid: null,
            balanceType: 'custom',
            _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
          });
          await updateDoc(parentRef, {
            associatedUids: newAssociatedUids,
            _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
          });
          toast.success(`Cartão de ${unlinkProfile.name} desvinculado. O saldo de R$ ${childBalance.toFixed(2)} foi mantido no cartão.`);
        } else {
          // If it was shared, we transfer unlinkSharedAmount from the parent to the child card
          const transferVal = parseFloat(unlinkSharedAmount || '0');
          const finalTransferVal = isNaN(transferVal) || transferVal <= 0 ? 0 : transferVal;
          const parentBalance = profile.balance || 0;
          
          if (finalTransferVal > parentBalance) {
            toast.error(`Você não possui saldo unificado suficiente para transferir R$ ${finalTransferVal.toFixed(2)} (Saldo atual: R$ ${parentBalance.toFixed(2)}).`);
            setUnlinkingLoading(false);
            return;
          }
          
          if (finalTransferVal > 0) {
            await updateDoc(childRef, {
              parentUid: null,
              balanceType: 'custom',
              balance: finalTransferVal,
              _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
            });
            await updateDoc(parentRef, {
              associatedUids: newAssociatedUids,
              balance: increment(-finalTransferVal),
              _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
            });
            toast.success(`Cartão de ${unlinkProfile.name} desvinculado. R$ ${finalTransferVal.toFixed(2)} foram transferidos para o cartão.`);
          } else {
            await updateDoc(childRef, {
              parentUid: null,
              balanceType: 'custom',
              balance: 0,
              _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
            });
            await updateDoc(parentRef, {
              associatedUids: newAssociatedUids,
              _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
            });
            toast.success(`Cartão de ${unlinkProfile.name} desvinculado. O cartão ficou com saldo R$ 0,00.`);
          }
        }
      } else {
        // Opção 2: Saldo fica na Conta Principal
        if (isCustom) {
          // Transfer custom child balance to parent, zero out child balance
          await updateDoc(childRef, {
            parentUid: null,
            balanceType: 'custom',
            balance: 0,
            _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
          });
          await updateDoc(parentRef, {
            associatedUids: newAssociatedUids,
            balance: increment(childBalance),
            _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
          });
          toast.success(`Cartão de ${unlinkProfile.name} desvinculado. O saldo de R$ ${childBalance.toFixed(2)} foi transferido para a sua conta principal.`);
        } else {
          // For shared balance, parent already has the balance, child has 0. Simply unlink.
          await updateDoc(childRef, {
            parentUid: null,
            balanceType: 'custom',
            balance: 0,
            _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
          });
          await updateDoc(parentRef, {
            associatedUids: newAssociatedUids,
            _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
          });
          toast.success(`Cartão de ${unlinkProfile.name} desvinculado com sucesso!`);
        }
      }
      
      setDisplayedUid(profile.uid);
      setUnlinkProfile(null);
      setEditingChildProfile(null);
    } catch (err: any) {
      console.error(err);
      toast.error('Erro ao desvincular o cartão: ' + (err.message || ''));
    } finally {
      setUnlinkingLoading(false);
    }
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
            
            <div className="flex items-center gap-2 bg-white/10 pl-4 pr-2 py-2 rounded-2xl border border-white/20 group">
              <div className="text-right hidden sm:block">
                <p className="text-[10px] font-black text-white uppercase leading-none mb-1 line-clamp-1 truncate max-w-[120px]">{profile.name}</p>
                <p className="text-[8px] font-bold text-blue-400 uppercase tracking-widest">{profile.role}</p>
              </div>
              {profile.role === 'admin' && (
                <Button 
                  variant="ghost" 
                  onClick={() => window.location.href = '/admin'} 
                  className="h-10 px-3 bg-purple-500/10 hover:bg-purple-500 text-purple-500 hover:text-white rounded-xl transition-all flex items-center gap-2 font-black uppercase tracking-widest text-[9px]"
                  title="Ir para o Painel Admin"
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  <span className="hidden xs:inline">Painel Admin</span>
                </Button>
              )}
              <Button 
                variant="ghost" 
                onClick={() => {
                  toast.promise(async () => {
                    if ('serviceWorker' in navigator) {
                      const registrations = await navigator.serviceWorker.getRegistrations();
                      for (let reg of registrations) await reg.unregister();
                    }
                    window.location.reload();
                  }, {
                    loading: 'Limpando cache...',
                    success: 'Atualizando...',
                    error: 'Erro ao atualizar'
                  });
                }} 
                className="h-10 px-3 bg-blue-500/10 hover:bg-blue-500 text-blue-500 hover:text-white rounded-xl transition-all flex items-center gap-2 font-black uppercase tracking-widest text-[9px]"
                title="Atualizar App"
              >
                <Zap className="h-3 w-3" />
                <span className="hidden xs:inline">Atualizar</span>
              </Button>
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
                          R$ {getProfileBalance(displayedProfile).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
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
                         <p className="text-sm font-black text-white/90 uppercase truncate max-w-[150px] mb-1.5">{displayedProfile.name}</p>
                         <p className="text-[10px] font-black tracking-[0.1em] font-mono text-white/80 leading-none">
                           {formatCardNumber(displayedProfile.uid || displayedProfile.qrCode)}
                         </p>
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

                  <div className="flex flex-col gap-3 px-8 pb-4">
                    <div className="flex items-center justify-center gap-2">
                      <div className="h-1.5 w-1.5 bg-blue-500 rounded-full animate-pulse" />
                      <span className="text-[10px] font-black uppercase tracking-widest text-blue-500">Pronto para uso</span>
                    </div>

                    <Button 
                      onClick={() => setIsScanning(true)}
                      variant="ghost"
                      className="h-10 text-[9px] font-black uppercase tracking-widest text-slate-500 hover:text-blue-400 gap-2"
                    >
                      <PlusCircle className="h-3 w-3" />
                      Vincular Novo Dependente
                    </Button>
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

                <div className="relative z-10 px-8 pb-8 flex gap-4">
                  <Button 
                    onClick={() => setActiveTab(ParentTab.RECHARGE)}
                    className="w-full h-14 bg-emerald-500/10 hover:bg-emerald-500 border border-emerald-500/20 text-emerald-500 hover:text-white rounded-2xl font-black text-[10px] uppercase tracking-widest gap-2 shadow-lg"
                  >
                    <Wallet className="h-4 w-4" />
                    Recarga
                  </Button>
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
                        <span className="text-xs font-black text-blue-400">R$ {getProfileBalance(profile).toFixed(2)}</span>
                      </button>

                      {/* Associated Profiles */}
                      {associatedProfiles.map(assoc => {
                        const isSelected = displayedUid === assoc.uid;
                        const isCustom = assoc.balanceType === 'custom';
                        const childBal = getProfileBalance(assoc);
                        
                        return (
                          <div 
                            key={assoc.uid}
                            onDoubleClick={() => {
                              setEditingChildProfile(assoc);
                              setAllocatedBalanceInput(isCustom ? (assoc.balance || 0).toString() : '');
                            }}
                            className={`w-full group/card flex items-center justify-between p-3.5 rounded-2xl border transition-all cursor-pointer relative hover:border-white/10 ${isSelected ? 'bg-blue-600/10 border-blue-600/30' : 'bg-slate-950/50 border-white/5'}`}
                          >
                            <div 
                              onClick={() => setDisplayedUid(assoc.uid)}
                              className="flex-1 flex items-center gap-3 select-none"
                            >
                              <div className={`h-8 w-8 rounded-lg flex items-center justify-center transition-all ${isSelected ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-500'}`}>
                                <Users className="h-4 w-4" />
                              </div>
                              <div className="text-left">
                                <span className="block text-xs font-black text-slate-200 truncate max-w-[120px]">{assoc.name}</span>
                                <span className="text-[9px] text-slate-500 font-bold uppercase tracking-tighter flex items-center gap-1">
                                  <span>Associado</span>
                                  {isCustom && (
                                    <>
                                      <span className="h-1 w-1 bg-amber-500 rounded-full animate-pulse" />
                                      <span className="text-amber-400 font-extrabold normal-case">Dedicado</span>
                                    </>
                                  )}
                                </span>
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-2">
                              <span 
                                onClick={() => setDisplayedUid(assoc.uid)}
                                className="text-xs font-black text-blue-400 select-none cursor-pointer pr-1"
                              >
                                R$ {childBal.toFixed(2)}
                              </span>
                              
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingChildProfile(assoc);
                                  setAllocatedBalanceInput(isCustom ? (assoc.balance || 0).toString() : '');
                                }}
                                className="p-2 hover:bg-white/5 rounded-lg text-slate-400 hover:text-blue-400 transition-all cursor-pointer"
                                title="Ajustar saldo e limites"
                              >
                                <SlidersHorizontal className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
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
                  {transactions.length === 0 && !loadingMore ? (
                    <div className="p-12 text-center text-slate-600 font-bold uppercase tracking-widest text-[10px]">
                      Sem movimentações recentes
                    </div>
                  ) : (
                    <>
                      {transactions.map((tx) => {
                        const date = tx.timestamp ? new Date(tx.timestamp.toDate ? tx.timestamp.toDate() : tx.timestamp) : new Date();
                        const dateStr = date.toLocaleDateString('pt-BR');
                        const timeStr = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                        
                        const isPurchase = tx.type === 'debit';
                        const stall = tx.stallName || (tx.description.includes('barraca') ? tx.description.split(': ')[0].replace('Compra na barraca ', '') : tx.description);
                        const items = tx.items || (tx.description.includes(': ') ? tx.description.split(': ')[1].split(', ') : []);

                        return (
                          <div key={tx.id} className="p-5 hover:bg-white/[0.02] transition-colors border-b border-white/5 last:border-0 group">
                            <div className="flex justify-between items-start">
                              <div className="flex items-center gap-4">
                                <div className={`h-10 w-10 rounded-2xl flex items-center justify-center transition-all group-hover:scale-110 ${tx.type === 'credit' ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'bg-blue-500/10 text-blue-500 border border-blue-500/20'}`}>
                                  {tx.type === 'credit' ? <PlusCircle className="h-5 w-5" /> : <ShoppingBag className="h-5 w-5" />}
                                </div>
                                <div className="space-y-1">
                                  <p className="text-[11px] font-black text-white uppercase tracking-tight leading-none group-hover:text-blue-400 transition-colors">
                                    {isPurchase ? `Compra: ${stall}` : tx.description}
                                  </p>
                                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                    <span className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">{dateStr}</span>
                                    <div className="h-0.5 w-0.5 bg-slate-800 rounded-full" />
                                    <span className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">{timeStr}</span>
                                    <div className="h-0.5 w-0.5 bg-slate-800 rounded-full" />
                                    <span className="text-[9px] text-blue-400 font-bold font-mono uppercase tracking-widest">
                                      Cartão: {formatCardNumber(tx.cardNumber || displayedProfile.uid || tx.qrCode || displayedProfile.qrCode)}
                                    </span>
                                  </div>
                                </div>
                              </div>
                              <div className="text-right">
                                <div className={`text-sm font-black tabular-nums ${tx.type === 'credit' ? 'text-emerald-500' : 'text-slate-200'}`}>
                                  {tx.type === 'credit' ? '+' : '-'} R$ {Math.abs(tx.amount).toFixed(2)}
                                </div>
                                <span className={`text-[7px] font-black uppercase px-1.5 py-0.5 rounded-md ${
                                  tx.status === 'completed' ? 'bg-emerald-500/10 text-emerald-500' : 
                                  tx.status === 'pending' ? 'bg-amber-500/10 text-amber-500' : 
                                  'bg-rose-500/10 text-rose-500'
                                }`}>
                                  {tx.status}
                                </span>
                              </div>
                            </div>
                            
                            {isPurchase && items.length > 0 && (
                              <div className="mt-3 pl-14 flex flex-wrap gap-1.5">
                                {items.map((item, id) => (
                                  <span key={id} className="px-2 py-0.5 bg-white/5 rounded-lg text-[8px] font-black text-slate-400 uppercase tracking-tighter border border-white/5 group-hover:border-white/10 transition-colors">
                                    {item}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      
                      {hasMore && (
                        <div className="p-4 border-t border-white/5 bg-slate-900/20">
                          <Button 
                            onClick={(e) => {
                              e.preventDefault();
                              fetchTransactions(false);
                            }}
                            disabled={loadingMore}
                            variant="ghost"
                            className="w-full h-10 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-white"
                          >
                            {loadingMore ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <History className="h-4 w-4 mr-2" />}
                            Carregar Mais
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* SECURE PRIVACY AND DATA RIGHTS PANEL (LGPD) */}
        <div className="pt-6 border-t border-white/5 animate-in fade-in duration-500">
          <Card className="bg-slate-900/40 border border-white/5 rounded-3xl overflow-hidden backdrop-blur-md">
            <CardContent className="p-6">
              <div className="flex items-start gap-3.5">
                <div className="p-3 bg-blue-500/10 text-blue-400 rounded-2xl shrink-0">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div className="space-y-1.5 flex-1 min-w-0">
                  <h4 className="text-white font-black text-xs uppercase tracking-widest flex items-center gap-1.5">
                    Privacidade e LGPD
                  </h4>
                  <p className="text-slate-400 text-[10px] leading-relaxed font-semibold">
                    Em conformidade com a LGPD, garantimos total controle sobre os seus dados. Nós coletamos apenas dados necessários para garantir a segurança, acesso e recuperação de sua conta.
                  </p>
                  <div className="pt-2 flex flex-wrap gap-x-4 gap-y-1 text-[9px] uppercase font-black tracking-widest">
                    <button 
                      onClick={() => setShowPrivacyDialog(true)}
                      className="text-blue-400 hover:text-blue-300 transition-colors cursor-pointer select-none text-left"
                    >
                      🛡️ Meus Dados & Termos
                    </button>
                    <span className="text-slate-800 hidden xs:inline">|</span>
                    <button 
                      onClick={() => setShowDeleteConfirm(true)}
                      className="text-red-400 hover:text-red-300 transition-colors cursor-pointer select-none text-left"
                    >
                      ⚠️ Excluir Conta & Anonimizar
                    </button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Dialog 1: Privacy and Data details - LGPD Transparency */}
        <Dialog open={showPrivacyDialog} onOpenChange={setShowPrivacyDialog}>
          <DialogContent className="sm:max-w-md bg-slate-900 border-white/10 rounded-[32px] p-6 text-white overflow-hidden">
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-blue-500/10 text-blue-400 rounded-2xl">
                  <ShieldCheck className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-lg font-black uppercase tracking-tight">Privacidade por Design</h3>
                  <p className="text-xs text-blue-400 font-bold uppercase tracking-widest">Festa Pass & LGPD</p>
                </div>
              </div>

              <div className="space-y-4 max-h-[350px] overflow-y-auto pr-2 text-xs text-slate-300 leading-relaxed font-medium">
                <div className="p-3 bg-white/5 border border-white/5 rounded-2xl space-y-1.5">
                  <h5 className="font-extrabold text-[10px] uppercase tracking-wider text-blue-400">📊 Transparência Ativa:</h5>
                  <p>Coletamos seu <strong>E-mail</strong> e seu <strong>Nome Completo</strong> estritamente com base na base legal de execução de contrato e legítimo interesse para fins de:</p>
                  <ul className="list-disc pl-4 space-y-1 mt-1 text-[11px]">
                    <li>Autenticação de identidade de forma segura</li>
                    <li>Recuperação de login e redefinição de senhas</li>
                    <li>Prevenção a fraudes financeiras e controle de saldos</li>
                  </ul>
                </div>

                <div className="p-3 bg-white/5 border border-white/5 rounded-2xl space-y-1">
                  <h5 className="font-extrabold text-[10px] uppercase tracking-wider text-blue-400">🛡️ Seus Direitos (Art. 18 LGPD):</h5>
                  <p>Você possui direito irrestrito de confirmar o tratamento, acessar seus dados, solicitar correção e pedir a exclusão permanente de sua conta a qualquer momento.</p>
                </div>

                <div className="p-3 bg-white/5 border border-white/5 rounded-2xl space-y-1 bg-blue-500/5 border-blue-500/20">
                  <h5 className="font-extrabold text-[10px] uppercase tracking-wider text-blue-400">⏳ Seu Registro de Consentimento:</h5>
                  <p className="text-[11px]">Seu consentimento foi devidamente assinado e registrado eletronicamente.</p>
                  <p className="text-[10px] font-mono mt-1 text-slate-400">Identificador: {profile.uid}</p>
                </div>
              </div>

              <div className="flex items-center justify-end pt-3">
                <Button 
                  onClick={() => setShowPrivacyDialog(false)}
                  className="bg-blue-600 hover:bg-blue-500 text-white font-black text-xs uppercase tracking-widest rounded-2xl px-6 h-12"
                >
                  Entendi e Aceito
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Dialog 2: LGPD Account Eraser Confirmation (Secure Self-Deletion and Anonymization) */}
        <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
          <DialogContent className="sm:max-w-md bg-slate-900 border border-red-500/30 rounded-[32px] p-6 text-white overflow-hidden">
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-red-500/10 text-red-400 rounded-2xl animate-pulse">
                  <ShieldAlert className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-lg font-black uppercase tracking-tight text-red-400">Solicitar Exclusão</h3>
                  <p className="text-xs text-red-400 font-bold uppercase tracking-widest">Ação Irreversível</p>
                </div>
              </div>

              <div className="space-y-4 text-xs text-slate-300 leading-relaxed font-semibold">
                <p>
                  Ao confirmar sua solicitação em conformidade com as diretrizes de privacidade, realizaremos as seguintes ações em nossos registros:
                </p>
                
                <div className="p-3.5 bg-red-500/5 border border-red-500/20 rounded-2xl space-y-2 text-[11px] text-red-200">
                  <p className="flex items-start gap-1.5 leading-snug">
                    <span className="text-red-400">🔴</span>
                    Seu login no Firebase Authentication e seu documento de usuário na coleção <code className="font-mono bg-black/30 px-1 py-0.5 rounded text-[10px] text-white">/users</code> serão apagados definitivamente.
                  </p>
                  <p className="flex items-start gap-1.5 leading-snug">
                    <span className="text-emerald-400">🟢</span>
                    Para manter a integridade fiscal, contabilidade de vendas das barracas e auditoria, registros em <code className="font-mono bg-black/30 px-1 py-0.5 rounded text-[10px] text-white">/transactions</code> e <code className="font-mono bg-black/30 px-1 py-0.5 rounded text-[10px] text-white">/consumption</code> serão <strong>preservados mas integralmente anonimizados</strong> (substituindo seu identificador pessoal por "Usuário Removido").
                  </p>
                </div>

                <p className="text-slate-400 text-[10px] leading-relaxed">
                  💡 Caso o Firebase solicite login recente, o sistema guiará você com instruções.
                </p>
              </div>

              <div className="flex items-center gap-3 justify-end pt-3">
                <Button 
                  variant="ghost"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="font-black text-xs uppercase tracking-widest rounded-2xl hover:bg-white/5 border border-white/10 text-white h-12"
                  disabled={deletingLoading}
                >
                  Cancelar
                </Button>
                <Button 
                  onClick={async () => {
                    setDeletingLoading(true);
                    try {
                      await authService.deleteAccountAndAnonymize(profile.uid);
                      toast.success('Sua conta foi excluída com sucesso e os registros foram devidamente anonimizados.', { duration: 8000 });
                      setShowDeleteConfirm(false);
                      setTimeout(() => {
                        window.location.reload();
                      }, 2000);
                    } catch (err: any) {
                      toast.error('Erro na exclusão', { description: err.message, duration: 8000 });
                    } finally {
                      setDeletingLoading(false);
                    }
                  }}
                  className="bg-red-600 hover:bg-red-500 text-white font-black text-xs uppercase tracking-widest rounded-2xl px-6 h-12"
                  disabled={deletingLoading}
                >
                  {deletingLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
                  {deletingLoading ? 'Excluindo...' : 'Confirmar e Excluir'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
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
          title="Vincular Novo Dependente"
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
                        {formatCardNumber(displayedProfile.uid || displayedProfile.qrCode)}
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

      <Dialog open={editingChildProfile !== null} onOpenChange={(open) => { if (!open) setEditingChildProfile(null); }}>
        <DialogContent className="sm:max-w-md bg-slate-950 border border-white/5 rounded-[32px] p-0 overflow-hidden outline-none text-white font-sans text-center">
          {editingChildProfile && (
            <div className="p-8 space-y-6">
              {/* Header */}
              <div className="space-y-1 text-center">
                <div className="flex justify-center mb-4">
                  <div className="bg-amber-500/10 p-3 rounded-2xl border border-amber-500/10">
                    <SlidersHorizontal className="h-6 w-6 text-amber-500 animate-pulse" />
                  </div>
                </div>
                <h3 className="text-xl font-black uppercase tracking-tighter text-slate-200">
                  Gerenciar {editingChildProfile.name}
                </h3>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                  Parâmetros de Saldo & Limites Parental
                </p>
              </div>

              {/* Selector de tipo de saldo: Compartilhado vs Personalizado */}
              <div className="space-y-3 text-left">
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Definição do Tipo de Saldo
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button 
                    type="button"
                    onClick={async () => {
                      const updatedProfile = { ...editingChildProfile, balanceType: 'shared' as const };
                      await handleUpdateBalanceTypeForChild(editingChildProfile.uid, 'shared');
                      setEditingChildProfile(updatedProfile);
                    }}
                    className={`p-3.5 rounded-xl border text-left flex flex-col gap-1 transition-all cursor-pointer ${
                      editingChildProfile.balanceType !== 'custom'
                        ? 'bg-blue-600/10 border-blue-500/40 ring-1 ring-blue-500/20' 
                        : 'bg-slate-900 border-white/5 hover:border-white/10'
                    }`}
                  >
                    <span className="text-xs font-black text-slate-200">Compartilhado</span>
                    <span className="text-[9px] text-slate-500 font-medium">Consome saldo da Carteira Principal</span>
                  </button>

                  <button 
                    type="button"
                    onClick={async () => {
                      const updatedProfile = { ...editingChildProfile, balanceType: 'custom' as const };
                      await handleUpdateBalanceTypeForChild(editingChildProfile.uid, 'custom');
                      setEditingChildProfile(updatedProfile);
                    }}
                    className={`p-3.5 rounded-xl border text-left flex flex-col gap-1 transition-all cursor-pointer ${
                      editingChildProfile.balanceType === 'custom'
                        ? 'bg-amber-600/10 border-amber-500/40 ring-1 ring-amber-500/20' 
                        : 'bg-slate-900 border-white/5 hover:border-white/10'
                    }`}
                  >
                    <span className="text-xs font-black text-amber-400">Personalizado</span>
                    <span className="text-[9px] text-slate-500 font-medium font-semibold">Saldo/Limite fixo dedicado</span>
                  </button>
                </div>
              </div>

              {/* Se for Personalizado: campo de alocação de saldo */}
              {editingChildProfile.balanceType === 'custom' && (
                <div className="p-4 bg-slate-900 rounded-2xl border border-white/5 space-y-3 text-left">
                  <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-wider text-slate-400">
                    <span>Definir Saldo Dedicado</span>
                    <span className="text-amber-400 font-mono font-black">
                      R$ {(editingChildProfile.balance || 0).toFixed(2)}
                    </span>
                  </div>

                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-black text-xs">R$</span>
                      <Input 
                        type="number" 
                        placeholder="Ex: 10.00"
                        value={allocatedBalanceInput}
                        onChange={(e) => setAllocatedBalanceInput(e.target.value)}
                        className="pl-10 pr-3 h-11 text-xs font-bold bg-slate-950 border-white/5 rounded-xl text-white focus:ring-amber-500"
                      />
                    </div>
                    <Button
                      type="button"
                      onClick={async () => {
                        const amt = parseFloat(allocatedBalanceInput);
                        if (isNaN(amt) || amt < 0) {
                          toast.error("Informe um valor válido");
                          return;
                        }
                        const success = await handleAllocateBalanceForChild(editingChildProfile.uid, amt);
                        if (success) {
                          setEditingChildProfile({
                            ...editingChildProfile,
                            balance: amt
                          });
                        }
                      }}
                      className="h-11 px-5 bg-amber-600 hover:bg-amber-500 text-white font-black text-xs uppercase tracking-wider rounded-xl cursor-pointer"
                    >
                      Definir
                    </Button>
                  </div>
                  
                  <div className="flex justify-start gap-1 p-0.5">
                    {[10, 20, 50].map((quickAmt) => (
                      <button
                        type="button"
                        key={quickAmt}
                        onClick={async () => {
                          setAllocatedBalanceInput(quickAmt.toString());
                          const success = await handleAllocateBalanceForChild(editingChildProfile.uid, quickAmt);
                          if (success) {
                            setEditingChildProfile({
                              ...editingChildProfile,
                              balance: quickAmt
                            });
                          }
                        }}
                        className="px-3 py-1.5 bg-slate-950 hover:bg-slate-900 border border-white/5 text-[9px] text-slate-300 font-black rounded-lg transition-all"
                      >
                        + R$ {quickAmt}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={async () => {
                        setAllocatedBalanceInput('0');
                        await handleAllocateBalanceForChild(editingChildProfile.uid, 0);
                        setEditingChildProfile({
                          ...editingChildProfile,
                          balanceType: 'shared',
                          balance: 0
                        });
                      }}
                      className="px-3 py-1.5 bg-red-950/65 hover:bg-red-900 border border-red-500/10 text-[9px] text-red-200 font-black rounded-lg transition-all ml-auto"
                    >
                      Zerar (Restaurar)
                    </button>
                  </div>
                  <p className="text-[9px] text-slate-500 text-left leading-normal font-medium">
                    Caso você defina como <span className="text-amber-500 font-bold">R$ 10</span>, esse valor é deduzido da Carteira Principal e dedicado à dependente. Quando o saldo é zerado, ele retorna automaticamente ao seu pool compartilhado.
                  </p>
                </div>
              )}

              {/* Spend Limits section inside parameters popup */}
              <div className="space-y-3 pt-2 border-t border-white/5 text-left">
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Limites do Dependente (24h e Caixas)
                </label>
                <div className="grid grid-cols-2 gap-3 text-left">
                  <div className="space-y-1">
                    <span className="text-[9px] font-black uppercase text-slate-500">Gasto Diário (R$)</span>
                    <Input 
                      type="number" 
                      placeholder="Sem limite"
                      defaultValue={editingChildProfile.dailyLimit || ''}
                      onBlur={async (e) => {
                        const val = parseFloat(e.target.value);
                        const limitVal = isNaN(val) || val <= 0 ? 0 : val;
                        try {
                          await updateDoc(doc(db, 'users', editingChildProfile.uid), {
                            dailyLimit: limitVal,
                            _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
                          });
                          toast.success('Limite diário updated!');
                        } catch (err) {
                          console.error(err);
                          toast.error('Erro ao atualizar limite');
                        }
                      }}
                      className="h-11 text-xs bg-slate-900 border border-white/5 rounded-xl text-white pl-3.5 focus:ring-blue-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <span className="text-[9px] font-black uppercase text-slate-500">Por Compra (R$)</span>
                    <Input 
                      type="number" 
                      placeholder="Sem limite"
                      defaultValue={editingChildProfile.transactionLimit || ''}
                      onBlur={async (e) => {
                        const val = parseFloat(e.target.value);
                        const limitVal = isNaN(val) || val <= 0 ? 0 : val;
                        try {
                          await updateDoc(doc(db, 'users', editingChildProfile.uid), {
                            transactionLimit: limitVal,
                            _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
                          });
                          toast.success('Limite por compra atualizado!');
                        } catch (err) {
                          console.error(err);
                          toast.error('Erro ao atualizar limite');
                        }
                      }}
                      className="h-11 text-xs bg-slate-900 border border-white/5 rounded-xl text-white pl-3.5 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Danger Zone: Desvincular Cartão */}
              <div className="p-4 bg-red-500/5 rounded-2xl border border-red-500/10 flex flex-col gap-2.5 text-left">
                <div>
                  <span className="text-[9px] font-black uppercase text-red-400 block mb-0.5">Desvincular Conta</span>
                  <p className="text-[9px] text-slate-500 leading-normal font-semibold">
                    Remove este cartão da sua tutela familiar revertendo-o para conta independente pré-paga única.
                  </p>
                </div>
                <Button
                  type="button"
                  onClick={() => {
                    setUnlinkProfile(editingChildProfile);
                    setUnlinkDestination('parent');
                    setUnlinkSharedAmount('0');
                  }}
                  className="w-full h-11 bg-red-950 hover:bg-red-900 text-red-200 hover:text-white font-black text-[10px] uppercase tracking-wider rounded-xl border border-red-500/10 flex items-center justify-center gap-2 cursor-pointer transition-all"
                >
                  <Trash2 className="h-3.5 w-3.5 animate-bounce" />
                  Desvincular da Conta
                </Button>
              </div>

              {/* Action buttons */}
              <div className="pt-2">
                <Button
                  type="button"
                  onClick={() => setEditingChildProfile(null)}
                  className="w-full h-12 bg-blue-600 hover:bg-blue-500 text-white font-black text-xs uppercase tracking-widest rounded-xl cursor-pointer"
                >
                  Salvar e Fechar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Custom Unlink Dialog with Balance Handling Option */}
      <Dialog open={unlinkProfile !== null} onOpenChange={(open) => { if (!open) setUnlinkProfile(null); }}>
        <DialogContent className="sm:max-w-md bg-slate-950 border border-white/5 rounded-[32px] p-0 overflow-hidden outline-none text-white font-sans text-center">
          {unlinkProfile && (
            <div className="p-8 space-y-6">
              {/* Header */}
              <div className="space-y-1 text-center">
                <div className="flex justify-center mb-4">
                  <div className="bg-red-500/10 p-3 rounded-2xl border border-red-500/10">
                    <ShieldAlert className="h-6 w-6 text-red-500 animate-pulse" />
                  </div>
                </div>
                <h3 className="text-xl font-black uppercase tracking-tighter text-slate-200">
                  Desvincular {unlinkProfile.name}
                </h3>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                  Configurar destino do saldo associado
                </p>
              </div>

              {/* Informações Atuais */}
              <div className="p-4 bg-white/5 rounded-2xl border border-white/5 text-left space-y-2">
                <p className="text-[11px] text-slate-400 font-semibold leading-relaxed">
                  Você está desvinculando o cartão de <strong className="text-white">{unlinkProfile.name}</strong>. Como deseja gerenciar o saldo deste cartão?
                </p>
                <div className="pt-2 border-t border-white/5 flex justify-between items-center text-xs">
                  <span className="text-slate-400 font-medium">Modo de Saldo Atual:</span>
                  <span className="font-black uppercase tracking-wider text-blue-400">
                    {unlinkProfile.balanceType === 'custom' ? 'Personalizado' : 'Compartilhado'}
                  </span>
                </div>
                {unlinkProfile.balanceType === 'custom' && (
                  <div className="flex justify-between items-center text-xs pt-1">
                    <span className="text-slate-400 font-medium">Saldo Dedicado no Cartão:</span>
                    <span className="font-black text-emerald-400">
                      R$ {(unlinkProfile.balance || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
                {unlinkProfile.balanceType !== 'custom' && (
                  <div className="flex justify-between items-center text-xs pt-1">
                    <span className="text-slate-400 font-medium">Saldo Unificado na Carteira:</span>
                    <span className="font-black text-blue-400">
                      R$ {(profile.balance || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
              </div>

              {/* Opções de Destino de Saldo */}
              <div className="space-y-3 text-left">
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Selecione o destino do saldo
                </label>
                <div className="flex flex-col gap-3">
                  {/* Option: Saldo Fica na Conta Principal */}
                  <button
                    type="button"
                    onClick={() => setUnlinkDestination('parent')}
                    className={`p-4 rounded-xl border text-left flex items-start gap-3 transition-all cursor-pointer ${
                      unlinkDestination === 'parent'
                        ? 'bg-blue-600/10 border-blue-500/40 ring-1 ring-blue-500/20'
                        : 'bg-slate-900 border-white/5 hover:border-white/10'
                    }`}
                  >
                    <div className="mt-1">
                      <div className={`h-4 w-4 rounded-full border flex items-center justify-center ${unlinkDestination === 'parent' ? 'border-blue-500 bg-blue-500 text-white' : 'border-slate-500'}`}>
                        {unlinkDestination === 'parent' && <div className="h-1.5 w-1.5 bg-white rounded-full" />}
                      </div>
                    </div>
                    <div className="space-y-0.5">
                      <span className="text-xs font-black text-slate-200 block">Conta Principal (Responsável)</span>
                      <span className="text-[9px] text-slate-500 font-semibold block leading-tight">
                        {unlinkProfile.balanceType === 'custom' 
                          ? `O saldo de R$ ${(unlinkProfile.balance || 0).toFixed(2)} será transferido de volta para você.` 
                          : 'O saldo já está unificado e continuará integralmente na sua conta.'}
                      </span>
                    </div>
                  </button>

                  {/* Option: Saldo Fica no Cartão */}
                  <button
                    type="button"
                    onClick={() => setUnlinkDestination('card')}
                    className={`p-4 rounded-xl border text-left flex items-start gap-3 transition-all cursor-pointer ${
                      unlinkDestination === 'card'
                        ? 'bg-blue-600/10 border-blue-500/40 ring-1 ring-blue-500/20'
                        : 'bg-slate-900 border-white/5 hover:border-white/10'
                    }`}
                  >
                    <div className="mt-1">
                      <div className={`h-4 w-4 rounded-full border flex items-center justify-center ${unlinkDestination === 'card' ? 'border-blue-500 bg-blue-500 text-white' : 'border-slate-500'}`}>
                        {unlinkDestination === 'card' && <div className="h-1.5 w-1.5 bg-white rounded-full" />}
                      </div>
                    </div>
                    <div className="space-y-0.5 w-full">
                      <span className="text-xs font-black text-slate-200 block">No próprio Cartão</span>
                      <span className="text-[9px] text-slate-500 font-semibold block leading-tight">
                        {unlinkProfile.balanceType === 'custom' 
                          ? `O saldo de R$ ${(unlinkProfile.balance || 0).toFixed(2)} permanecerá neste cartão.` 
                          : 'O cartão passará a ser pré-pago individual. Você pode definir um valor inicial abaixo.'}
                      </span>
                    </div>
                  </button>
                </div>
              </div>

              {/* Se o saldo for compartilhado e a opção for Cartão, permite definir o valor de transferência */}
              {unlinkDestination === 'card' && unlinkProfile.balanceType !== 'custom' && (
                <div className="space-y-2 text-left animate-fadeIn">
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400">
                    Valor a carregar no cartão (R$)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">R$</span>
                    <Input
                      type="number"
                      value={unlinkSharedAmount}
                      onChange={(e) => setUnlinkSharedAmount(e.target.value)}
                      className="h-11 text-xs bg-slate-900 border border-white/5 rounded-xl text-white pl-9 focus:ring-blue-500 w-full"
                      placeholder="0,00"
                    />
                  </div>
                  <p className="text-[9px] text-slate-500 leading-normal font-semibold">
                    Este valor será subtraído da sua conta principal de R$ {(profile.balance || 0).toFixed(2)}.
                  </p>
                </div>
              )}

              {/* Botões de Ação */}
              <div className="space-y-3 pt-2">
                <Button
                  type="button"
                  disabled={unlinkingLoading}
                  onClick={handleUnlinkAccountWithBalanceOption}
                  className="w-full h-12 bg-red-600 hover:bg-red-500 text-white font-black text-xs uppercase tracking-widest rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-all disabled:opacity-50"
                >
                  {unlinkingLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  Confirmar Desvinculação
                </Button>

                <Button
                  type="button"
                  disabled={unlinkingLoading}
                  onClick={() => setUnlinkProfile(null)}
                  className="w-full h-11 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 font-bold text-xs uppercase tracking-widest rounded-xl cursor-pointer"
                >
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
