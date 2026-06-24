import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db, auth } from '@/lib/firebase';
import { collection, addDoc, onSnapshot, query, deleteDoc, doc, updateDoc, orderBy, limit, Timestamp, increment, serverTimestamp, where, getDocs, getDoc, setDoc, getDocsFromCache } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Stall, Product, UserProfile, Withdrawal, Order, Transaction, UserRole, CartItem } from '../types';
import { Plus, Trash2, Store, Package, Users, TrendingUp, DollarSign, History, LayoutDashboard, Settings as SettingsIcon, FileText, ShoppingCart, Smartphone, LogOut, ArrowLeftRight, QrCode, Printer, Loader2, Menu, X, Search, CreditCard, ShieldCheck as ShieldCheckIcon, User as UserIcon, Edit2, Filter, Sparkles, Ticket, Zap, CheckSquare, Square, Copy, RefreshCw, Palette, Download, Calculator, Calendar, AlertTriangle } from 'lucide-react';
import { QRCodeSVG, QRCodeCanvas } from 'qrcode.react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import VendorDashboard from './VendorDashboard';
import { handleFirestoreError, OperationType } from '@/lib/error-handler';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

import QRScanner from './QRScanner';
import ReportsPortal from './ReportsPortal';

type AdminTab = 'overview' | 'stalls' | 'products' | 'users' | 'terminal' | 'recharge_pos' | 'transactions' | 'card_printer' | 'reports' | 'clients';

export default function AdminDashboard({ profile, forcedTab }: { profile: UserProfile, forcedTab?: AdminTab }) {
  const [activeTab, setActiveTab] = useState<AdminTab>(forcedTab || 'overview');
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // SHARED STATE FOR TERMINAL & RECHARGE
  const [sharedCart, setSharedCart] = useState<CartItem[]>([]);
  const [sharedScannedUser, setSharedScannedUser] = useState<UserProfile | null>(null);

  useEffect(() => {
    if (profile.role !== 'admin') {
      if (profile.role === 'vendor') {
        if (activeTab !== 'terminal') {
          setActiveTab('terminal');
        }
      } else if (profile.role === 'recharge') {
        if (activeTab !== 'recharge_pos' && activeTab !== 'terminal') {
          setActiveTab('recharge_pos');
        }
      } else {
        if (activeTab !== 'terminal' && activeTab !== 'recharge_pos') {
          setActiveTab('terminal');
        }
      }
    } else if (forcedTab) {
      setActiveTab(forcedTab);
    }
  }, [profile.role, forcedTab, activeTab]);
  
  const [stalls, setStalls] = useState<Stall[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [recentSales, setRecentSales] = useState<any[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  
  const [newStallName, setNewStallName] = useState('');
  const [editingStall, setEditingStall] = useState<Stall | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [newProductName, setNewProductName] = useState('');
  const [newProductPrice, setNewProductPrice] = useState('');
  const [selectedStallId, setSelectedStallId] = useState('');
  
  const [withdrawalAmount, setWithdrawalAmount] = useState('');
  const [withdrawalStallId, setWithdrawalStallId] = useState('');
  const [withdrawalNote, setWithdrawalNote] = useState('');

  // Dashboard Period/Date Filters
  const [dashboardFilterPreset, setDashboardFilterPreset] = useState<'all' | 'today' | 'this_month' | 'custom'>('all');
  const [dashboardStartDate, setDashboardStartDate] = useState('');
  const [dashboardEndDate, setDashboardEndDate] = useState('');

  // Helper to parse multiple timestamp formats (Firestore/ISO/Milliseconds) to Date
  const getParsedDate = (timestampField: any): Date | null => {
    if (!timestampField) return null;
    if (typeof timestampField.toDate === 'function') {
      return timestampField.toDate();
    }
    if (typeof timestampField.toMillis === 'function') {
      return new Date(timestampField.toMillis());
    }
    if (timestampField.seconds) {
      return new Date(timestampField.seconds * 1000);
    }
    const parsed = new Date(timestampField);
    return isNaN(parsed.getTime()) ? null : parsed;
  };

  // Helper to evaluate if a Date fits inside the active dashboard filters
  const filterByDateRange = (itemDate: Date | null): boolean => {
    if (!itemDate) return true;
    const itemTime = itemDate.getTime();

    if (dashboardFilterPreset === 'all') return true;

    // Local start & end of today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    if (dashboardFilterPreset === 'today') {
      return itemTime >= todayStart.getTime() && itemTime <= todayEnd.getTime();
    }

    if (dashboardFilterPreset === 'this_month') {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0, 23, 59, 59, 999);
      return itemTime >= monthStart.getTime() && itemTime <= monthEnd.getTime();
    }

    if (dashboardFilterPreset === 'custom') {
      let matches = true;
      if (dashboardStartDate) {
        const start = new Date(dashboardStartDate + 'T00:00:00');
        if (!isNaN(start.getTime())) {
          matches = matches && itemTime >= start.getTime();
        }
      }
      if (dashboardEndDate) {
        const end = new Date(dashboardEndDate + 'T23:59:59');
        if (!isNaN(end.getTime())) {
          matches = matches && itemTime <= end.getTime();
        }
      }
      return matches;
    }

    return true;
  };

  // Memos of filtered lists that will feed the financial metrics
  const filteredTransactions = useMemo(() => {
    return transactions.filter(t => {
      const d = getParsedDate(t.timestamp);
      return filterByDateRange(d);
    });
  }, [transactions, dashboardFilterPreset, dashboardStartDate, dashboardEndDate]);

  const filteredWithdrawals = useMemo(() => {
    return withdrawals.filter(w => {
      const d = getParsedDate(w.timestamp);
      return filterByDateRange(d);
    });
  }, [withdrawals, dashboardFilterPreset, dashboardStartDate, dashboardEndDate]);

  const filteredRecentSales = useMemo(() => {
    return recentSales.filter(s => {
      const d = getParsedDate(s.timestamp);
      return filterByDateRange(d);
    });
  }, [recentSales, dashboardFilterPreset, dashboardStartDate, dashboardEndDate]);

  useEffect(() => {
    const unsubStalls = onSnapshot(collection(db, 'stalls'), (snap) => {
      setStalls(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Stall)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'stalls');
    });

    const unsubProducts = onSnapshot(collection(db, 'products'), (snap) => {
      setProducts(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'products');
    });

    // Withdrawals - Admin Only
    let unsubWithdrawals = () => {};
    if (profile.role === 'admin') {
      unsubWithdrawals = onSnapshot(collection(db, 'withdrawals'), (snap) => {
        setWithdrawals(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Withdrawal)));
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, 'withdrawals');
      });
    }

    // Consumption - Admin or Vendor
    let unsubSales = () => {};
    if (profile.role === 'admin' || profile.role === 'vendor') {
      const qSales = query(collection(db, 'consumption'), orderBy('timestamp', 'desc'));
      unsubSales = onSnapshot(qSales, (snap) => {
        setRecentSales(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, 'consumption');
      });
    }

    // Transactions - Admin or Vendor or Recharge
    let unsubTransactions = () => {};
    if (profile.role === 'admin' || profile.role === 'vendor' || profile.role === 'recharge') {
      const qTransactions = query(collection(db, 'transactions'), orderBy('timestamp', 'desc'));
      unsubTransactions = onSnapshot(qTransactions, (snap) => {
        setTransactions(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction)));
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, 'transactions');
      });
    }

    // Users - Admin can see all, Vendors might need it for scanning but rules allow list
    let unsubUsers = () => {};
    if (profile.role === 'admin' || profile.role === 'vendor' || profile.role === 'recharge') {
      unsubUsers = onSnapshot(collection(db, 'users'), (snap) => {
        setUsers(snap.docs.map(doc => ({ ...doc.data(), uid: doc.id } as UserProfile)));
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, 'users');
      });
    }

    return () => {
      unsubStalls();
      unsubProducts();
      unsubUsers();
      unsubSales();
      unsubWithdrawals();
      unsubTransactions();
    };
  }, [profile.role]);

  const stats = useMemo(() => {
    const totalTransactions = filteredTransactions.filter(t => t.type === 'debit');
    const totalRevenue = totalTransactions.reduce((acc, t) => acc + (t.amount || 0), 0);
    
    // Identificar usuários que já colocaram valores (pelo menos um crédito)
    const rechargedUserIds = new Set(filteredTransactions.filter(t => t.type === 'credit' && t.status === 'completed').map(t => t.userId));
    
    const activePhysicalCards = users.filter(u => u.isPhysicalCard && rechargedUserIds.has(u.uid)).length;
    const activeVirtualCards = users.filter(u => !u.isPhysicalCard && rechargedUserIds.has(u.uid)).length;
    
    const totalUsers = users.length;
    
    const credited = filteredTransactions.filter(t => t.type === 'credit' && t.status === 'completed').reduce((acc, t) => acc + (t.amount || 0), 0);
    const debited = totalRevenue;
    const totalWithdrawn = filteredWithdrawals.reduce((acc, curr) => acc + (curr.amount || 0), 0);
    const totalPending = filteredTransactions.filter(t => t.type === 'credit' && t.status === 'pending').reduce((acc, t) => acc + (t.amount || 0), 0);
    
    return {
      totalRevenue,
      totalSalesCount: totalTransactions.length,
      activePhysicalCards,
      activeVirtualCards,
      totalUsers,
      credited,
      debited,
      totalWithdrawn,
      balance: debited - totalWithdrawn,
      totalPending
    };
  }, [filteredTransactions, users, filteredWithdrawals]);

  const statsByStall = useMemo(() => {
    return stalls.map(stall => {
      const stallTransactions = filteredTransactions.filter(t => t.type === 'debit' && t.description?.includes(stall.name));
      const totalSales = stallTransactions.reduce((acc, curr) => acc + (curr.amount || 0), 0);
      
      // Contagem de produtos vendidos usando a collection consumption
      const stallConsumption = filteredRecentSales.filter(s => s.stallId === stall.id);
      let productsSold = 0;
      stallConsumption.forEach(sale => {
        if (sale.detailedItems && Array.isArray(sale.detailedItems)) {
          productsSold += sale.detailedItems.reduce((acc: number, item: any) => acc + (item.quantity || 0), 0);
        } else if (sale.items && Array.isArray(sale.items)) {
          // Fallback para formato string "Nx Nome"
          sale.items.forEach((item: string) => {
            const match = item.match(/^(\d+)x/);
            if (match) productsSold += parseInt(match[1]);
          });
        }
      });

      return {
        ...stall,
        totalSales,
        productsSold
      };
    });
  }, [stalls, filteredTransactions, filteredRecentSales]);

  const statsByCaixa = useMemo(() => {
    const operatorsMap = new Map<string, { uid: string; name: string; role: string; email: string }>();
    
    // Add known recharge/admin users
    users.forEach(u => {
      if (u.role === 'recharge' || u.role === 'admin') {
        operatorsMap.set(u.uid, {
          uid: u.uid,
          name: u.name || u.email?.split('@')[0] || 'Operador',
          role: u.role,
          email: u.email || ''
        });
      }
    });

    // Fallback: If there are transactions with an operatorId that isn't in users:
    filteredTransactions.forEach(t => {
      if (t.type === 'credit' && t.status === 'completed' && t.operatorId && !operatorsMap.has(t.operatorId)) {
        operatorsMap.set(t.operatorId, {
          uid: t.operatorId,
          name: t.operatorName || 'Operador Externo',
          role: 'recharge',
          email: ''
        });
      }
    });

    // If there is no operator on some old credit transactions, assign them to a virtual "Caixa Geral (Legado)"
    const hasLegacyCredit = filteredTransactions.some(t => t.type === 'credit' && t.status === 'completed' && !t.operatorId);
    if (hasLegacyCredit && !operatorsMap.has('legacy_general')) {
      operatorsMap.set('legacy_general', {
        uid: 'legacy_general',
        name: 'Caixa Administrativo (Legado)',
        role: 'admin',
        email: ''
      });
    }

    const oList = Array.from(operatorsMap.values());

    return oList.map(op => {
      const opTransactions = filteredTransactions.filter(t => {
        if (t.type !== 'credit' || t.status !== 'completed') return false;
        if (t.operatorId) {
          return t.operatorId === op.uid;
        } else {
          return op.uid === 'legacy_general' || (op.role === 'admin' && !operatorsMap.has('legacy_general'));
        }
      });

      const totalRecharged = opTransactions.reduce((acc, curr) => acc + (curr.amount || 0), 0);

      const totalCash = opTransactions.filter(t => {
        const m = (t.paymentMethod || '').toLowerCase();
        const desc = (t.description || '').toLowerCase();
        return m.includes('dinheiro') || desc.includes('dinheiro');
      }).reduce((acc, curr) => acc + (curr.amount || 0), 0);

      const totalPix = opTransactions.filter(t => {
        const m = (t.paymentMethod || '').toLowerCase();
        const desc = (t.description || '').toLowerCase();
        return m.includes('pix') || desc.includes('pix');
      }).reduce((acc, curr) => acc + (curr.amount || 0), 0);

      const totalCard = opTransactions.filter(t => {
        const m = (t.paymentMethod || '').toLowerCase();
        const desc = (t.description || '').toLowerCase();
        return m.includes('cart') || m.includes('deb') || m.includes('cred') ||
               desc.includes('cart') || desc.includes('deb') || desc.includes('cred') ||
               desc.includes('déb') || desc.includes('créd');
      }).reduce((acc, curr) => acc + (curr.amount || 0), 0);

      const opWithdrawals = filteredWithdrawals.filter(w => w.stallId === op.uid);
      const totalWithdrawn = opWithdrawals.reduce((acc, curr) => acc + (curr.amount || 0), 0);

      return {
        ...op,
        totalRecharged,
        totalWithdrawn,
        totalCash,
        totalPix,
        totalCard,
        balance: totalRecharged - totalWithdrawn
      };
    }).filter(c => c.totalRecharged > 0 || c.totalWithdrawn > 0 || c.role === 'recharge' || c.role === 'admin');
  }, [users, filteredTransactions, filteredWithdrawals]);

  const paymentMethodStats = useMemo(() => {
    const credits = filteredTransactions.filter(t => t.type === 'credit' && t.status === 'completed');
    
    let cash = 0;
    let pix = 0;
    let card = 0;

    credits.forEach(t => {
      const amt = t.amount || 0;
      const m = (t.paymentMethod || '').toLowerCase();
      const desc = (t.description || '').toLowerCase();

      if (m.includes('dinheiro') || desc.includes('dinheiro')) {
        cash += amt;
      } else if (m.includes('pix') || desc.includes('pix')) {
        pix += amt;
      } else if (
        m.includes('cart') || m.includes('deb') || m.includes('cred') ||
        desc.includes('cart') || desc.includes('deb') || desc.includes('cred') ||
        desc.includes('déb') || desc.includes('créd')
      ) {
        card += amt;
      }
    });

    const totalCalculated = cash + pix + card;
    const totalCredits = credits.reduce((acc, t) => acc + (t.amount || 0), 0);
    const other = Math.max(0, totalCredits - totalCalculated);

    return { cash, pix, card, other };
  }, [filteredTransactions]);

  const handleWithdraw = async () => {
    if (!withdrawalStallId || !withdrawalAmount) return;
    try {
      await addDoc(collection(db, 'withdrawals'), {
        stallId: withdrawalStallId,
        amount: parseFloat(withdrawalAmount),
        adminId: auth.currentUser?.uid,
        note: withdrawalNote || '',
        timestamp: new Date().toISOString()
      });
      setWithdrawalAmount('');
      setWithdrawalNote('');
      toast.success('Retirada registrada com sucesso!');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'withdrawals');
    }
  };

  const handleDeleteWithdrawal = async (id: string) => {
    if (!window.confirm('Tem certeza que deseja cancelar esta retirada? O saldo correspondente retornará ao caixa de recarga.')) return;
    try {
      await deleteDoc(doc(db, 'withdrawals', id));
      toast.success('Retirada cancelada com sucesso!');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'withdrawals');
    }
  };

  const handleAddStall = async () => {
    if (!newStallName.trim()) return;
    try {
      await addDoc(collection(db, 'stalls'), {
        name: newStallName,
        createdAt: new Date().toISOString()
      });
      setNewStallName('');
      toast.success('Barraca cadastrada com sucesso!');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'stalls');
    }
  };

  const handleAddProduct = async () => {
    if (!newProductName.trim() || !newProductPrice || !selectedStallId) {
      toast.error('Preencha todos os campos do produto');
      return;
    }
    try {
      await addDoc(collection(db, 'products'), {
        name: newProductName,
        price: parseFloat(newProductPrice),
        vendorId: selectedStallId,
        active: true
      });
      setNewProductName('');
      setNewProductPrice('');
      toast.success('Produto cadastrado com sucesso!');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'products');
    }
  };

  const [rechargeAmounts, setRechargeAmounts] = useState<{[key: string]: string}>({});
  const [rechargePaymentMethods, setRechargePaymentMethods] = useState<{[key: string]: string}>({});

  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserRole, setNewUserRole] = useState<UserRole>('student');
  const [newUserVendorIds, setNewUserVendorIds] = useState<string[]>([]);
  
  // Clients (Funcionários / Clientes) State variables
  const [newClientName, setNewClientName] = useState('');
  const [newClientEmail, setNewClientEmail] = useState('');
  const [newClientQrCode, setNewClientQrCode] = useState('');
  const [newClientBalance, setNewClientBalance] = useState('');
  const [clientSearchQuery, setClientSearchQuery] = useState('');
  const [linkingUser, setLinkingUser] = useState<UserProfile | null>(null);
  const [physicalCardInput, setPhysicalCardInput] = useState('');
  const [settings, setSettings] = useState({
    siteName: 'Festa Pass',
    contactEmail: 'financeiro@modeloalpha.com.br'
  });

  useEffect(() => {
    const fetchSettings = async () => {
      if (profile.role !== 'admin') return;
      try {
        const docRef = doc(db, 'settings', 'config');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setSettings(docSnap.data() as any);
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, 'settings/config');
      }
    };
    fetchSettings();
  }, [profile.role]);

  const handleSaveSettings = async () => {
    try {
      await setDoc(doc(db, 'settings', 'config'), settings);
      toast.success('Configurações salvas com sucesso!');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'settings/config');
    }
  };
  const [isGenerating, setIsGenerating] = useState(false);
  const [batchSize, setBatchSize] = useState(24);
  const [showPrintView, setShowPrintView] = useState(false);
  const [cardBgUrl, setCardBgUrl] = useState('https://images.unsplash.com/photo-1614850523296-d8c1af93d400?auto=format&fit=crop&q=80&w=1000');

  // Physical Cards Enhanced States
  const [physicalSearchQuery, setPhysicalSearchQuery] = useState('');
  const [physicalBalanceFilter, setPhysicalBalanceFilter] = useState<'all' | 'zero' | 'positive'>('all');
  const [selectedPhysicalCards, setSelectedPhysicalCards] = useState<string[]>([]);
  const [cardGradient, setCardGradient] = useState<'mystic-slate' | 'royal-gold' | 'aurora-emerald' | 'cosmic-purple' | 'neon-sunset' | 'custom-image'>('mystic-slate');
  const [cardTextColor, setCardTextColor] = useState<'light' | 'dark'>('light');
  const [cardTitleText, setCardTitleText] = useState('');
  const [bulkRechargeAmount, setBulkRechargeAmount] = useState<number>(0);
  const [showBulkRechargeModal, setShowBulkRechargeModal] = useState(false);
  const [bulkRechargeProcessing, setBulkRechargeProcessing] = useState(false);

  // Formatter matching online card (16 numbers with spaces every 4 digits)
  const formatCardNumber = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const numeric = Math.abs(hash).toString().padEnd(16, '0').substring(0, 16);
    return numeric.replace(/(.{4})/g, '$1 ').trim();
  };

  const getCardBgStyle = (gradientType: string) => {
    switch (gradientType) {
      case 'mystic-slate':
        return 'bg-gradient-to-br from-slate-900 via-slate-800 to-slate-950 border-slate-700';
      case 'royal-gold':
        return 'bg-gradient-to-br from-stone-900 via-neutral-900 to-yellow-950 border-amber-900/40';
      case 'aurora-emerald':
        return 'bg-gradient-to-br from-slate-950 via-teal-950 to-emerald-950 border-emerald-500/20';
      case 'cosmic-purple':
        return 'bg-gradient-to-br from-slate-950 via-indigo-950 to-purple-950 border-purple-500/30';
      case 'neon-sunset':
        return 'bg-gradient-to-br from-stone-950 via-rose-950 to-stone-900 border-rose-500/20';
      default:
        return 'bg-slate-900';
    }
  };

  const handleBulkDelete = async () => {
    if (selectedPhysicalCards.length === 0) return;
    if (!window.confirm(`Deseja realmente excluir os ${selectedPhysicalCards.length} cartões selecionados?`)) return;
    try {
      const promises = selectedPhysicalCards.map(uid => deleteDoc(doc(db, 'users', uid)));
      await Promise.all(promises);
      toast.success(`${selectedPhysicalCards.length} cartões excluídos com sucesso!`);
      setSelectedPhysicalCards([]);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'users/bulk');
    }
  };

  const handleBulkRecharge = async () => {
    const rechargeValue = bulkRechargeAmount;
    if (isNaN(rechargeValue) || rechargeValue <= 0) {
      toast.error('Informe um valor de recarga válido.');
      return;
    }
    if (selectedPhysicalCards.length === 0) return;
    setBulkRechargeProcessing(true);
    try {
      const promises = selectedPhysicalCards.map(async (uid) => {
        const userRef = doc(db, 'users', uid);
        await updateDoc(userRef, {
          balance: increment(rechargeValue)
        });
        const uProfile = users.find(u => u.uid === uid);
        const cardNum = uProfile?.qrCode || uid;
        const uName = uProfile?.name || '';
        // Log transaction for audit
        await addDoc(collection(db, 'transactions'), {
          userId: uid,
          userName: uName,
          clientName: uName,
          cardNumber: cardNum,
          amount: rechargeValue,
          type: 'credit',
          paymentMethod: 'Saldo Admin',
          status: 'completed',
          description: 'Recarga administrativa em lote',
          timestamp: serverTimestamp(),
          operatorId: auth.currentUser?.uid || '',
          operatorName: profile.name || profile.email || 'Operador'
        });
      });
      await Promise.all(promises);
      toast.success(`Recarga de R$ ${rechargeValue.toFixed(2)} efetuada para ${selectedPhysicalCards.length} cartões!`);
      setSelectedPhysicalCards([]);
      setBulkRechargeAmount(0);
      setShowBulkRechargeModal(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'users/bulk-recharge');
    } finally {
      setBulkRechargeProcessing(false);
    }
  };

  const toggleSelectCard = (uid: string) => {
    setSelectedPhysicalCards(prev => {
      if (prev.includes(uid)) {
        return prev.filter(id => id !== uid);
      } else {
        return [...prev, uid];
      }
    });
  };

  const toggleSelectAllPhysical = (allCards: any[]) => {
    if (selectedPhysicalCards.length === allCards.length) {
      setSelectedPhysicalCards([]);
    } else {
      setSelectedPhysicalCards(allCards.map(c => c.uid));
    }
  };

  const handlePrint = () => {
    window.print();
  };
 
  const downloadExcelWithQR = () => {
    try {
      const physicalCards = users.filter(u => u.isPhysicalCard);
      
      if (physicalCards.length === 0) {
        toast.error("Nenhum cartão físico encontrado para exportar.");
        return;
      }
 
      toast.info("Processando exportação do Excel...");
 
      let tableRows = "";
      
      physicalCards.forEach(card => {
        const formattedNum = formatCardNumber(card.uid || card.qrCode || '');
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(card.qrCode || '')}`;
        const balanceFormatted = card.balance.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
        // Safe timestamp retrieval
        let creationDate = 'N/A';
        if (card.timestamp) {
          if (typeof card.timestamp.toMillis === 'function') {
            creationDate = new Date(card.timestamp.toMillis()).toLocaleString('pt-BR');
          } else if (card.timestamp.seconds) {
            creationDate = new Date(card.timestamp.seconds * 1000).toLocaleString('pt-BR');
          } else {
            creationDate = new Date(card.timestamp).toLocaleString('pt-BR');
          }
        }
 
        tableRows += `
          <tr style="height: 110px;">
            <td style="mso-number-format:'@'; text-align: left; font-weight: bold; font-family: sans-serif; vertical-align: middle;">${formattedNum}</td>
            <td style="text-align: left; font-family: sans-serif; vertical-align: middle;">${card.name || 'Sem Nome'}</td>
            <td style="text-align: left; font-family: sans-serif; mso-number-format:'@'; color: #64748b; vertical-align: middle;">${card.qrCode || ''}</td>
            <td style="text-align: center; vertical-align: middle; padding: 5px;">
              <img src="${qrUrl}" width="100" height="100" alt="QR Code" style="display: block; margin: auto;" />
            </td>
            <td style="text-align: right; font-weight: bold; font-family: sans-serif; color: #16a34a; vertical-align: middle;">R$ ${balanceFormatted}</td>
            <td style="text-align: center; font-family: sans-serif; color: #475569; vertical-align: middle;">${creationDate}</td>
          </tr>
        `;
      });

      const excelTemplate = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
        <head>
        <meta http-equiv="content-type" content="text/plain; charset=UTF-8"/>
        <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Cartões Festa Pass</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
        <style>
          table {
            border-collapse: collapse;
          }
          th {
            background-color: #0f172a;
            color: #ffffff;
            font-weight: bold;
            font-family: sans-serif;
            text-align: center;
            border: 1px solid #cbd5e1;
            padding: 12px 8px;
            font-size: 14px;
          }
          td {
            vertical-align: middle;
            border: 1px solid #cbd5e1;
            padding: 8px;
            font-size: 12px;
          }
        </style>
        </head>
        <body>
        <h2 style="font-family: sans-serif; color: #0f172a; margin-bottom: 5px;">Relatório de Cartões de Consumo - ${settings.siteName || 'Festa Pass'}</h2>
        <p style="font-family: sans-serif; color: #64748b; font-size: 12px; margin-top: 0; margin-bottom: 20px;">Gerado em: ${new Date().toLocaleString('pt-BR')}</p>
        <table>
          <thead>
            <tr>
              <th style="width: 180px;">Número do Cartão</th>
              <th style="width: 220px;">Nome do Titular</th>
              <th style="width: 250px;">Link / Conteúdo QR Code</th>
              <th style="width: 120px;">Código QR (Imagem)</th>
              <th style="width: 120px;">Saldo Atual</th>
              <th style="width: 150px;">Data de Geração</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
        </body>
        </html>
      `;

      const blob = new Blob([excelTemplate], { type: 'application/vnd.ms-excel;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `cartoes_${settings.siteName?.toLowerCase().replace(/\s+/g, '_') || 'festapass'}_${new Date().toISOString().split('T')[0]}.xls`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      toast.success("Excel gerado e baixado com sucesso!");
    } catch (e) {
      console.error(e);
      toast.error("Erro ao gerar o arquivo Excel.");
    }
  };

  const filteredPhysicalCards = useMemo(() => {
    return users.filter(u => {
      if (!u.isPhysicalCard) return false;
      
      const formattedNum = formatCardNumber(u.uid || u.qrCode || '');
      const matchesSearch = 
        u.name.toLowerCase().includes(physicalSearchQuery.toLowerCase()) ||
        u.qrCode?.toLowerCase().includes(physicalSearchQuery.toLowerCase()) ||
        formattedNum.includes(physicalSearchQuery);
      
      let matchesBalance = true;
      if (physicalBalanceFilter === 'zero') {
        matchesBalance = u.balance === 0;
      } else if (physicalBalanceFilter === 'positive') {
        matchesBalance = u.balance > 0;
      }
      
      return matchesSearch && matchesBalance;
    });
  }, [users, physicalSearchQuery, physicalBalanceFilter]);

  const downloadSingleQRCode = (card: UserProfile) => {
    try {
      const canvas = document.getElementById(`canvas-qr-${card.uid}`) as HTMLCanvasElement;
      if (!canvas) {
        toast.error("Não foi possível encontrar o elemento visual deste QR Code.");
        return;
      }
      const dataUrl = canvas.toDataURL("image/png");
      const link = document.createElement("a");
      const safeName = (card.name || "sem_nome").replace(/[^a-z0-9_]/gi, "_").toLowerCase();
      const formattedNum = (card.uid || card.qrCode || '').replace(/\s+/g, '');
      link.href = dataUrl;
      link.download = `qrcode_${safeName}_${formattedNum}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success(`QR Code de ${card.name} baixado!`);
    } catch (error) {
      console.error("Erro ao baixar QR code:", error);
      toast.error("Erro ao gerar imagem do QR Code.");
    }
  };

  const downloadSelectedQRCodes = async () => {
    const cardsToDownload = selectedPhysicalCards.length > 0 
      ? users.filter(u => u.isPhysicalCard && selectedPhysicalCards.includes(u.uid))
      : filteredPhysicalCards;

    if (cardsToDownload.length === 0) {
      toast.error("Nenhum cartão para download de QR Code.");
      return;
    }

    const noun = cardsToDownload.length === 1 ? "QR Code" : "QR Codes";
    const toastId = toast.loading(`Preparando e compactando ${cardsToDownload.length} ${noun}...`);

    try {
      const zip = new JSZip();
      let addedCount = 0;

      for (let i = 0; i < cardsToDownload.length; i++) {
        const card = cardsToDownload[i];
        const canvas = document.getElementById(`canvas-qr-${card.uid}`) as HTMLCanvasElement;
        
        if (canvas) {
          try {
            const dataUrl = canvas.toDataURL("image/png");
            // Extrair os dados binários do Base64
            const base64Data = dataUrl.split(',')[1];
            if (base64Data) {
              const safeName = (card.name || "sem_nome").replace(/[^a-z0-9_]/gi, "_").toLowerCase();
              const formattedNum = (card.uid || card.qrCode || '').replace(/\s+/g, '');
              const filename = `qrcode_${safeName}_${formattedNum}.png`;
              
              zip.file(filename, base64Data, { base64: true });
              addedCount++;
            }
          } catch (e) {
            console.error("Erro ao converter QR code em imagem para o ZIP:", e);
          }
        }
      }

      if (addedCount === 0) {
        toast.dismiss(toastId);
        toast.error("Não foi possível gerar imagens para os QR Codes.");
        return;
      }

      toast.loading(`Gerando arquivo compactado (.ZIP)...`, { id: toastId });
      
      const content = await zip.generateAsync({ type: 'blob' });
      
      const link = document.createElement("a");
      link.href = URL.createObjectURL(content);
      const today = new Date().toISOString().slice(0, 10);
      link.download = `qrcodes_lote_${today}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      toast.success(`Download de ${addedCount} ${noun} em arquivo ZIP concluído!`, { id: toastId });
    } catch (error) {
      console.error("Erro ao gerar o arquivo ZIP:", error);
      toast.error("Ocorreu um erro ao gerar o arquivo compactado.", { id: toastId });
    }
  };

  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all');
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string, type: 'stall' | 'product' | 'user', action: () => void } | null>(null);
  const [resetConfirm, setResetConfirm] = useState<{ id: string, name: string, amount: number, action: () => void } | null>(null);

  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [sortField, setSortField] = useState<'name' | 'qrCode' | 'role' | 'balance' | 'stalls' | null>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  
  // Bulk Edit States
  const [showBulkEditModal, setShowBulkEditModal] = useState(false);
  const [bulkEditRole, setBulkEditRole] = useState<UserRole | ''>('');
  const [bulkEditRecharge, setBulkEditRecharge] = useState<string>('');
  const [bulkEditPaymentMethod, setBulkEditPaymentMethod] = useState<string>('Dinheiro');
  const [bulkEditStalls, setBulkEditStalls] = useState<string[]>([]);
  const [bulkEditActionType, setBulkEditActionType] = useState<'role' | 'recharge' | 'zero' | 'stalls' | 'delete' | null>(null);

  const handleToggleSort = (field: 'name' | 'qrCode' | 'role' | 'balance' | 'stalls') => {
    if (sortField === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const toggleSelectUser = (uid: string) => {
    setSelectedUsers(prev => 
      prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid]
    );
  };

  const toggleSelectAllUsers = () => {
    const visibleIds = filteredUsers.map(u => u.uid);
    const allSelected = visibleIds.length > 0 && visibleIds.every(id => selectedUsers.includes(id));
    if (allSelected) {
      setSelectedUsers(prev => prev.filter(id => !visibleIds.includes(id)));
    } else {
      setSelectedUsers(prev => {
        const unique = new Set([...prev, ...visibleIds]);
        return Array.from(unique);
      });
    }
  };

  const filteredUsers = useMemo(() => {
    let list = users.filter(user => {
      if (user.role === 'admin' && profile.email !== 'financeiro@modeloalpha.com.br') return false; // Hide other admins unless super admin
      
      const matchesSearch = 
        user.name.toLowerCase().includes(userSearchQuery.toLowerCase()) ||
        user.email.toLowerCase().includes(userSearchQuery.toLowerCase()) ||
        user.qrCode?.toLowerCase().includes(userSearchQuery.toLowerCase());
      
      const matchesRole = roleFilter === 'all' || user.role === roleFilter;

      return matchesSearch && matchesRole;
    });

    if (sortField) {
      list = [...list].sort((a, b) => {
        let valA: any = '';
        let valB: any = '';

        if (sortField === 'name') {
          valA = (a.name || '').toLowerCase();
          valB = (b.name || '').toLowerCase();
        } else if (sortField === 'qrCode') {
          valA = (a.qrCode || '').toLowerCase();
          valB = (b.qrCode || '').toLowerCase();
        } else if (sortField === 'role') {
          valA = (a.role || '').toLowerCase();
          valB = (b.role || '').toLowerCase();
        } else if (sortField === 'balance') {
          valA = a.balance ?? 0;
          valB = b.balance ?? 0;
        } else if (sortField === 'stalls') {
          valA = a.vendorIds?.length ?? 0;
          valB = b.vendorIds?.length ?? 0;
        }

        if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
        if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return list;
  }, [users, userSearchQuery, roleFilter, profile.email, sortField, sortOrder]);

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'vendor': return <ShoppingCart className="h-4 w-4" />;
      case 'recharge': return <CreditCard className="h-4 w-4" />;
      case 'admin': return <ShieldCheckIcon className="h-4 w-4" />;
      default: return <UserIcon className="h-4 w-4" />;
    }
  };

  const handleDeleteUser = async (userId: string) => {
    setDeleteConfirm({
      id: userId,
      type: 'user',
      action: async () => {
        try {
          await deleteDoc(doc(db, 'users', userId));
          toast.success('Usuário removido com sucesso');
          if (editingUser?.uid === userId) setEditingUser(null);
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `users/${userId}`);
        }
      }
    });
  };

  const handleZeroBalance = (userId: string) => {
    const userToReset = users.find(u => u.uid === userId);
    if (!userToReset) return;

    if (userToReset.balance <= 0) {
      toast.info('Este cartão já está com saldo zerado.');
      return;
    }

    setResetConfirm({
      id: userId,
      name: userToReset.name,
      amount: userToReset.balance,
      action: async () => {
        try {
          const currentBalance = userToReset.balance;
          await updateDoc(doc(db, 'users', userId), {
            balance: 0
          });

          const cardNum = userToReset.qrCode || userId;
          const uName = userToReset.name;
          await addDoc(collection(db, 'transactions'), {
            userId,
            userName: uName,
            clientName: uName,
            cardNumber: cardNum,
            amount: currentBalance,
            type: 'debit',
            description: 'Saldo zerado pelo Administrador',
            paymentMethod: 'Sistema',
            status: 'completed',
            timestamp: serverTimestamp()
          });

          toast.success(`Saldo de ${userToReset.name} zerado com sucesso!`);
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, `users/${userId}`);
        }
      }
    });
  };

  const exportToExcel = () => {
    try {
      const excelData = filteredUsers.map(u => {
        const assignedStalls = u.vendorIds && u.vendorIds.length > 0
          ? u.vendorIds.map(id => stalls.find(s => s.id === id)?.name || id).join(', ')
          : 'Nenhuma';
          
        let roleLabel = 'Cliente';
        if (u.role === 'vendor') roleLabel = 'Vendedor';
        else if (u.role === 'recharge') roleLabel = 'Recarga';
        else if (u.role === 'admin') roleLabel = 'Administrador';

        return {
          'Nome Completo': u.name,
          'E-mail': u.email || 'N/A',
          'Função': roleLabel,
          'Código do Cartão': u.qrCode || 'N/A',
          'Saldo (R$)': u.balance || 0,
          'Barracas Vinculadas': assignedStalls,
        };
      });

      const worksheet = XLSX.utils.json_to_sheet(excelData);

      // Apply Excel currency format to monetary columns dynamically
      if (worksheet['!ref']) {
        const range = XLSX.utils.decode_range(worksheet['!ref']);
        for (let col = range.s.c; col <= range.e.c; col++) {
          const headerAddress = XLSX.utils.encode_cell({ r: range.s.r, c: col });
          const headerCell = worksheet[headerAddress];
          if (headerCell && typeof headerCell.v === 'string') {
            const headerText = headerCell.v;
            const isMonetary = 
              headerText.includes('(R$)') || 
              headerText.includes('Valor') || 
              headerText.includes('Preço') || 
              headerText.includes('Saldo');

            if (isMonetary) {
              for (let row = range.s.r + 1; row <= range.e.r; row++) {
                const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
                const cell = worksheet[cellAddress];
                if (cell && typeof cell.v === 'number') {
                  cell.t = 'n';
                  cell.z = '"R$ " #,##0.00';
                }
              }
            }
          }
        }
      }

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Usuários');

      worksheet['!cols'] = [
        { wch: 25 }, // Nome Completo
        { wch: 30 }, // E-mail
        { wch: 15 }, // Função
        { wch: 20 }, // Código do Cartão
        { wch: 15 }, // Saldo (R$)
        { wch: 35 }, // Barracas Vinculadas
      ];

      XLSX.writeFile(workbook, `usuarios_sistema_${new Date().toISOString().split('T')[0]}.xlsx`);
      toast.success('Lista de usuários exportada para Excel com sucesso!');
    } catch (error) {
      console.error("Erro ao exportar excel:", error);
      toast.error('Erro ao gerar arquivo do Excel.');
    }
  };

  const handleAddClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClientName) {
      toast.error('Insira o nome completo do funcionário');
      return;
    }

    try {
      const emailLower = newClientEmail.trim() ? newClientEmail.trim().toLowerCase() : `funcionario-${Date.now()}@modeloalpha.com.br`;
      const qrCodeVal = newClientQrCode.trim() ? newClientQrCode.trim() : `PENDING-${Date.now()}-${Math.floor(Math.random()*1000)}`;
      const balanceVal = parseFloat(newClientBalance) || 0;

      // Check if email already exists
      const q = query(collection(db, 'users'), where('email', '==', emailLower));
      const snap = await getDocs(q);

      if (!snap.empty) {
        toast.error('Este e-mail já está cadastrado');
        return;
      }

      await addDoc(collection(db, 'users'), {
        name: newClientName,
        email: emailLower,
        role: 'student',
        balance: balanceVal,
        qrCode: qrCodeVal,
        isEmployee: true,
        timestamp: serverTimestamp()
      });

      setNewClientName('');
      setNewClientEmail('');
      setNewClientQrCode('');
      setNewClientBalance('');
      toast.success('Funcionário cadastrado com sucesso!');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'users');
    }
  };

  const handleExportClientsSpreadsheet = () => {
    try {
      const clientsOnly = users.filter(u => u.role === 'student');
      const excelData = clientsOnly.map(u => ({
        'Nome Completo': u.name,
        'E-mail': u.email || '',
        'Código do Cartão': u.qrCode || '',
        'Saldo (R$)': u.balance || 0
      }));

      // if empty, add a placeholder row with instructions
      if (excelData.length === 0) {
        excelData.push({
          'Nome Completo': 'Exemplo Silva (Apague esta linha)',
          'E-mail': 'exemplo@gmail.com',
          'Código do Cartão': '12345678',
          'Saldo (R$)': 0
        });
      }

      const worksheet = XLSX.utils.json_to_sheet(excelData);

      // Apply Excel currency style
      if (worksheet['!ref']) {
        const range = XLSX.utils.decode_range(worksheet['!ref']);
        for (let row = range.s.r + 1; row <= range.e.r; row++) {
          const cellAddress = XLSX.utils.encode_cell({ r: row, c: 3 }); // col index 3 (Saldo (R$))
          const cell = worksheet[cellAddress];
          if (cell && typeof cell.v === 'number') {
            cell.t = 'n';
            cell.z = '"R$ " #,##0.00';
          }
        }
      }

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Clientes');

      worksheet['!cols'] = [
        { wch: 30 }, // Nome Completo
        { wch: 30 }, // E-mail
        { wch: 25 }, // Código do Cartão
        { wch: 15 }, // Saldo
      ];

      XLSX.writeFile(workbook, `clientes_funcionarios_${new Date().toISOString().split('T')[0]}.xlsx`);
      toast.success('Lista de clientes baixada com sucesso!');
    } catch (error) {
      console.error(error);
      toast.error('Erro ao gerar planilha excel.');
    }
  };

  const handleImportClientsSpreadsheet = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const workbook = XLSX.read(bstr, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet) as any[];

        if (jsonData.length === 0) {
          toast.error('A planilha está vazia ou no formato incorreto.');
          return;
        }

        toast.loading('Processando importação de clientes...', { id: 'import-clients-loading' });

        let importedCount = 0;
        let updatedCount = 0;

        for (const row of jsonData) {
          // Normalize column names dynamically to ignore spacing and casing
          const name = row['Nome Completo'] || row['Nome'] || row['nome'] || row['Name'] || row['Cliente'] || row['cliente'];
          if (!name) continue; // Must have name

          let email = row['E-mail'] || row['Email'] || row['email'] || row['Google E-mail'] || row['E-mail do Google'];
          if (!email) {
            email = `cliente-${Date.now()}-${Math.floor(Math.random() * 10000)}@modeloalpha.com.br`;
          } else {
            email = email.toString().trim().toLowerCase();
          }

          const qrCode = row['Código do Cartão'] || row['Código'] || row['Codigo'] || row['Cartão'] || row['Cartao'] || row['QR Code'] || row['qrCode'] || row['qr'] || row['QR'] || '';
          
          let balanceVal = 0;
          const balanceRaw = row['Saldo (R$)'] || row['Saldo'] || row['saldo'] || row['Balance'] || row['Valor'] || row['valor'];
          if (balanceRaw !== undefined) {
            balanceVal = parseFloat(balanceRaw.toString().replace('R$', '').replace(',', '.').trim()) || 0;
          }

          // Check if employee/client with this email already exists
          const q = query(collection(db, 'users'), where('email', '==', email));
          const snap = await getDocs(q);

          if (!snap.empty) {
            // Update existing user balance/name/qrCode
            const existingId = snap.docs[0].id;
            const existingUser = snap.docs[0].data();
            await updateDoc(doc(db, 'users', existingId), {
              name: name.toString().trim(),
              qrCode: qrCode ? qrCode.toString().trim() : existingUser.qrCode || `PENDING-${Date.now()}`,
              balance: balanceVal, // override with sheet balance
              isEmployee: true
            });
            updatedCount++;
          } else {
            // Create new record
            await addDoc(collection(db, 'users'), {
              name: name.toString().trim(),
              email,
              role: 'student',
              balance: balanceVal,
              qrCode: qrCode ? qrCode.toString().trim() : `PENDING-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
              isEmployee: true,
              timestamp: serverTimestamp()
            });
            importedCount++;
          }
        }

        toast.dismiss('import-clients-loading');
        toast.success(`Importação realizada com sucesso! ${importedCount} novos, ${updatedCount} atualizados.`);
      } catch (error) {
        console.error('Erro na importação:', error);
        toast.dismiss('import-clients-loading');
        toast.error('Falha ao processar arquivo. Verifique o formato das colunas.');
      }
    };

    reader.readAsBinaryString(file);
    // Reset file input value so same file can be selected again
    e.target.value = '';
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserEmail || !newUserName) return;

    try {
      // Check if user already exists
      const q = query(collection(db, 'users'), where('email', '==', newUserEmail.toLowerCase()));
      const snap = await getDocs(q);

      if (!snap.empty) {
        toast.error('Este e-mail já está cadastrado');
        return;
      }

      await addDoc(collection(db, 'users'), {
        name: newUserName,
        email: newUserEmail.toLowerCase(),
        role: newUserRole,
        balance: 0,
        vendorIds: newUserRole === 'vendor' ? newUserVendorIds : [],
        qrCode: `PENDING-${Date.now()}`,
        timestamp: serverTimestamp()
      });

      setNewUserEmail('');
      setNewUserName('');
      setNewUserRole('student');
      setNewUserVendorIds([]);
      toast.success('Membro pré-cadastrado com sucesso!');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'users');
    }
  };

  const handleSavePhysicalCard = async () => {
    if (!linkingUser) return;
    const cardCode = physicalCardInput.trim();
    if (!cardCode) {
      toast.error('O código do cartão não pode ser vazio');
      return;
    }

    try {
      // Check if this card code is already linked to anyone else
      const q = query(collection(db, 'users'), where('qrCode', '==', cardCode));
      const snap = await getDocs(q);
      
      if (!snap.empty) {
        toast.error('Este número de cartão já está vinculado a outro usuário!');
        return;
      }

      await updateDoc(doc(db, 'users', linkingUser.uid), {
        qrCode: cardCode,
        _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
      });

      toast.success('Cartão físico vinculado com sucesso!');
      setLinkingUser(null);
      setPhysicalCardInput('');
    } catch (e) {
      console.error(e);
      toast.error('Erro ao vincular cartão');
    }
  };

  const handleLinkVirtualCard = async (user: UserProfile) => {
    try {
      toast.loading('Gerando cartão virtual...', { id: 'gen-virtual' });
      
      let isUnique = false;
      let virtualCode = '';
      
      while (!isUnique) {
        const rand = Math.floor(100000 + Math.random() * 900000);
        virtualCode = `FV-${rand}`;
        
        const q = query(collection(db, 'users'), where('qrCode', '==', virtualCode));
        const snap = await getDocs(q);
        if (snap.empty) {
          isUnique = true;
        }
      }

      await updateDoc(doc(db, 'users', user.uid), {
        qrCode: virtualCode,
        _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
      });

      toast.dismiss('gen-virtual');
      toast.success(`Cartão virtual ${virtualCode} gerado e vinculado!`);
    } catch (e) {
      console.error(e);
      toast.dismiss('gen-virtual');
      toast.error('Erro ao gerar cartão virtual');
    }
  };

  const handleUnlinkCard = async (user: UserProfile) => {
    if (!confirm(`Deseja realmente desvincular o cartão ${user.qrCode} de ${user.name}?`)) {
      return;
    }
    try {
      const pendingCode = `PENDING-${Date.now()}-${Math.floor(Math.random()*1000)}`;
      await updateDoc(doc(db, 'users', user.uid), {
        qrCode: pendingCode,
        _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
      });
      toast.success('Cartão desvinculado com sucesso!');
    } catch (e) {
      console.error(e);
      toast.error('Erro ao desvincular cartão');
    }
  };

  const handleCompletePendingTransaction = async (txId: string) => {
    if (!confirm('Deseja realmente confirmar o pagamento/recebimento desta recarga pendente?')) {
      return;
    }
    try {
      await updateDoc(doc(db, 'transactions', txId), {
        status: 'completed'
      });
      toast.success('Pagamento recebido e baixado com sucesso!');
    } catch (e) {
      console.error(e);
      toast.error('Erro ao confirmar pagamento.');
    }
  };

  const handleManualRecharge = async (userId: string) => {
    const amount = parseFloat(rechargeAmounts[userId] || '0');
    const paymentMethod = rechargePaymentMethods[userId] || '';
    
    if (!paymentMethod) {
      toast.error('Selecione a forma de pagamento');
      return;
    }
    
    if (isNaN(amount) || amount <= 0) {
      toast.error('Insira um valor válido para recarga');
      return;
    }

    try {
      const uProfile = users.find(u => u.uid === userId);
      const isShared = uProfile && (!uProfile.balanceType || uProfile.balanceType === 'shared') && uProfile.parentUid;
      const targetUserId = isShared ? uProfile.parentUid! : userId;

      // Update balance
      await updateDoc(doc(collection(db, 'users'), targetUserId), {
        balance: increment(amount)
      });

      const cardNum = uProfile?.qrCode || userId;
      const uName = uProfile?.name || '';

      // Record transaction
      await addDoc(collection(db, 'transactions'), {
        userId,
        userName: uName,
        clientName: uName,
        cardNumber: cardNum,
        amount,
        type: 'credit',
        description: `Recarga manual (${paymentMethod})`,
        paymentMethod,
        status: paymentMethod === 'Conta' ? 'pending' : 'completed',
        timestamp: serverTimestamp(),
        operatorId: auth.currentUser?.uid || '',
        operatorName: profile.name || profile.email || 'Operador'
      });

      setRechargeAmounts(prev => ({ ...prev, [userId]: '' }));
      toast.success('Crédito adicionado com sucesso!');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${userId}`);
    }
  };

  const setUserVendorIds = async (userId: string, stallId: string, checked: boolean) => {
    try {
      const user = users.find(u => u.uid === userId);
      if (!user) return;

      let newVendorIds = [...(user.vendorIds || [])];
      if (checked) {
        if (!newVendorIds.includes(stallId)) newVendorIds.push(stallId);
      } else {
        newVendorIds = newVendorIds.filter(id => id !== stallId);
      }

      await updateDoc(doc(collection(db, 'users'), userId), {
        vendorIds: newVendorIds,
        role: newVendorIds.length > 0 ? 'vendor' : 'student'
      });
      toast.success('Associações atualizadas');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${userId}`);
    }
  };

  const handleBulkEditAction = async (forcedType?: 'zero' | 'delete') => {
    const actType = forcedType || bulkEditActionType;
    if (selectedUsers.length === 0) {
      toast.error('Nenhum usuário selecionado.');
      return;
    }

    try {
      if (actType === 'delete') {
        if (!window.confirm(`Deseja realmente remover os ${selectedUsers.length} usuários selecionados?`)) return;
        const promises = selectedUsers.map(uid => deleteDoc(doc(db, 'users', uid)));
        await Promise.all(promises);
        toast.success(`${selectedUsers.length} usuários excluídos com sucesso!`);
        setSelectedUsers([]);
      } 
      
      else if (actType === 'role') {
        if (!bulkEditRole) {
          toast.error('Selecione uma função.');
          return;
        }
        const promises = selectedUsers.map(uid => updateDoc(doc(db, 'users', uid), { role: bulkEditRole }));
        await Promise.all(promises);
        toast.success(`Função atualizada para os ${selectedUsers.length} usuários selecionados!`);
        setSelectedUsers([]);
      }

      else if (actType === 'recharge') {
        const amount = parseFloat(bulkEditRecharge || '0');
        if (isNaN(amount) || amount <= 0) {
          toast.error('Insira um valor de recarga válido.');
          return;
        }
        const promises = selectedUsers.map(async (uid) => {
          const uProfile = users.find(u => u.uid === uid);
          const isShared = uProfile && (!uProfile.balanceType || uProfile.balanceType === 'shared') && uProfile.parentUid;
          const targetUserId = isShared ? uProfile.parentUid! : uid;

          const cardNum = uProfile?.qrCode || uid;
          const uName = uProfile?.name || '';
          await updateDoc(doc(db, 'users', targetUserId), { balance: increment(amount) });
          await addDoc(collection(db, 'transactions'), {
            userId: uid,
            userName: uName,
            clientName: uName,
            cardNumber: cardNum,
            amount: amount,
            type: 'credit',
            description: `Recarga manual em lote (${bulkEditPaymentMethod})`,
            paymentMethod: bulkEditPaymentMethod,
            status: 'completed',
            timestamp: serverTimestamp(),
            operatorId: auth.currentUser?.uid || '',
            operatorName: profile.name || profile.email || 'Operador'
          });
        });
        await Promise.all(promises);
        toast.success(`Recarga de R$ ${amount.toFixed(2)} efetuada para ${selectedUsers.length} usuários!`);
        setSelectedUsers([]);
        setBulkEditRecharge('');
      }

      else if (actType === 'zero') {
        if (!window.confirm(`Tem certeza que deseja zerar o saldo dos ${selectedUsers.length} usuários selecionados?`)) return;
        const promises = selectedUsers.map(uid => updateDoc(doc(db, 'users', uid), { balance: 0 }));
        await Promise.all(promises);
        toast.success(`Saldo zerado para os ${selectedUsers.length} usuários selecionados!`);
        setSelectedUsers([]);
      }

      else if (actType === 'stalls') {
        const promises = selectedUsers.map(uid => updateDoc(doc(db, 'users', uid), { vendorIds: bulkEditStalls }));
        await Promise.all(promises);
        toast.success(`Acesso às barracas atualizado para os ${selectedUsers.length} usuários!`);
        setSelectedUsers([]);
      }

      setShowBulkEditModal(false);
      setBulkEditActionType(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'users/bulk-edit');
    }
  };

  const handleGenerateCards = async () => {
    if (batchSize > 200) {
      toast.error('Gere no máximo 200 cartões por vez para evitar sobrecarga');
      return;
    }
    setIsGenerating(true);
    try {
      const timestamp = Date.now();
      const batchPromises = [];
      for (let i = 1; i <= batchSize; i++) {
        const uniqueId = `CARD-${timestamp}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
        batchPromises.push(addDoc(collection(db, 'users'), {
          name: `Cartão #${timestamp.toString().slice(-4)}${i.toString().padStart(3, '0')}`,
          email: `card-${uniqueId.toLowerCase()}@maestro.internal`,
          role: 'student',
          balance: 0,
          vendorIds: [],
          qrCode: uniqueId,
          isPhysicalCard: true,
          timestamp: serverTimestamp()
        }));
      }
      await Promise.all(batchPromises);
      toast.success(`${batchSize} cartões gerados!`);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'users/batch');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDeleteStall = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setDeleteConfirm({
      id,
      type: 'stall',
      action: async () => {
        try {
          await deleteDoc(doc(db, 'stalls', id));
          const stallProducts = products.filter(p => p.vendorId === id);
          for (const p of stallProducts) {
            await deleteDoc(doc(db, 'products', p.id));
          }
          toast.success('Barraca excluída');
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `stalls/${id}`);
        }
      }
    });
  };

  const handleUpdateStall = async () => {
    if (!editingStall || !editingStall.name.trim()) return;
    try {
      await updateDoc(doc(db, 'stalls', editingStall.id), {
        name: editingStall.name
      });
      setEditingStall(null);
      toast.success('Barraca atualizada!');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `stalls/${editingStall.id}`);
    }
  };

  const handleDeleteProduct = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setDeleteConfirm({
      id,
      type: 'product',
      action: async () => {
        try {
          await deleteDoc(doc(db, 'products', id));
          toast.success('Produto excluído');
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `products/${id}`);
        }
      }
    });
  };

  const handleUpdateProduct = async () => {
    if (!editingProduct || !editingProduct.name.trim() || !editingProduct.price || !editingProduct.vendorId) return;
    try {
      await updateDoc(doc(db, 'products', editingProduct.id), {
        name: editingProduct.name,
        price: Number(editingProduct.price),
        vendorId: editingProduct.vendorId
      });
      setEditingProduct(null);
      toast.success('Produto atualizado!');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `products/${editingProduct.id}`);
    }
  };

  const navItems = [
    { id: 'overview', icon: TrendingUp, label: 'Gestão Financeira', category: 'Administração' },
    { id: 'stalls', icon: Store, label: 'Barracas', category: 'Administração' },
    { id: 'products', icon: Package, label: 'Catálogo Geral', category: 'Administração' },
    { id: 'users', icon: Users, label: 'Gestão de Usuários', category: 'Administração' },
    { id: 'clients', icon: Users, label: 'Planilha de Funcionários', category: 'Administração' },
    { id: 'transactions', icon: History, label: 'Histórico de Vendas', category: 'Administração' },
    { id: 'reports', icon: FileText, label: 'Relatórios do Evento', category: 'Administração' },
    { id: 'card_printer', icon: Printer, label: 'Impressor de Cartões', category: 'Administração' },
    { id: 'terminal', icon: ShoppingCart, label: 'Terminal PDV (Caixa)', category: 'Canais de Venda' },
    { id: 'recharge_pos', icon: QrCode, label: 'Carga e Recarga', category: 'Canais de Venda' },
    { id: 'settings', icon: SettingsIcon, label: 'Configurações', category: 'Sistema' },
  ].filter(item => {
    if (profile.role === 'admin') return true;
    if (profile.role === 'vendor') return item.id === 'terminal';
    if (profile.role === 'recharge') return item.id === 'recharge_pos' || item.id === 'terminal';
    return false;
  });

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-x-hidden">
      {/* Floating Menu Button */}
      {!forcedTab && activeTab !== 'terminal' && activeTab !== 'recharge_pos' && (
        <div className="fixed top-6 right-6 z-[200]">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className={`h-16 w-16 rounded-[24px] flex items-center justify-center shadow-2xl transition-all duration-500 ${
              isMenuOpen 
                ? 'bg-red-500 text-white rotate-90' 
                : 'bg-slate-950 text-white'
            }`}
          >
            {isMenuOpen ? <X className="h-8 w-8" /> : <Menu className="h-8 w-8" />}
          </motion.button>
        </div>
      )}

      {/* Full Screen Navigation Overlay */}
      <AnimatePresence>
        {isMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[190] bg-slate-950/95 backdrop-blur-2xl flex flex-col items-center justify-center p-8 overflow-y-auto"
          >
            <div className="max-w-4xl w-full space-y-12 py-20">
              <div className="text-center space-y-2">
                <div className="h-16 w-16 bg-blue-600 rounded-2xl mx-auto flex items-center justify-center mb-4">
                  <Sparkles className="h-8 w-8 text-white" />
                </div>
                <h1 className="text-4xl font-black text-white tracking-tighter uppercase">Painel de Evento</h1>
                <p className="text-slate-500 font-bold uppercase tracking-widest text-xs">Acesso Maestro • Controle Total</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {navItems.map((item) => {
                  const isActive = activeTab === item.id;
                  return (
                    <motion.button
                      key={item.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      whileHover={{ scale: 1.02, y: -4 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => {
                        setActiveTab(item.id as AdminTab);
                        setIsMenuOpen(false);
                      }}
                      className={`group p-6 rounded-[32px] border-2 transition-all text-left flex items-center gap-5 ${
                        isActive 
                          ? 'bg-blue-600 border-blue-400 shadow-[0_20px_50px_rgba(37,99,235,0.3)]' 
                          : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/10'
                      }`}
                    >
                      <div className={`h-12 w-12 rounded-2xl flex items-center justify-center transition-all ${
                        isActive ? 'bg-white text-blue-600' : 'bg-white/5 text-slate-400 group-hover:text-white'
                      }`}>
                        <item.icon className="h-6 w-6" />
                      </div>
                      <div>
                        <p className={`text-[10px] font-black uppercase tracking-widest mb-0.5 ${
                          isActive ? 'text-blue-100' : 'text-slate-500'
                        }`}>
                          {item.category}
                        </p>
                        <p className={`text-sm font-black uppercase tracking-tight ${
                          isActive ? 'text-white' : 'text-slate-200'
                        }`}>
                          {item.label}
                        </p>
                      </div>
                    </motion.button>
                  );
                })}
              </div>

              <div className="pt-12 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-8">
                <div className="flex items-center gap-4">
                  <div className="h-14 w-14 rounded-2xl bg-slate-800 flex items-center justify-center text-slate-400 border border-white/5 font-black text-xl">
                    {profile.name.charAt(0)}
                  </div>
                  <div>
                    <h3 className="text-white font-black uppercase tracking-tight">{profile.name}</h3>
                    <p className="text-slate-500 text-xs font-bold uppercase tracking-widest">Acesso de Administrador</p>
                  </div>
                </div>
                <Button 
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
                  className="h-16 px-6 rounded-2xl bg-blue-500/10 hover:bg-blue-500 text-blue-500 hover:text-white border border-blue-500/20 font-black uppercase tracking-widest text-[10px] transition-all flex items-center gap-3"
                  title="Atualizar App"
                >
                  <Zap className="h-5 w-5" />
                  <span className="hidden sm:inline">Atualizar</span>
                </Button>
                <Button 
                  onClick={() => window.location.href = '/portal'}
                  className="h-16 px-6 rounded-2xl bg-purple-500/10 hover:bg-purple-500 text-purple-500 hover:text-white border border-purple-500/20 font-black uppercase tracking-widest text-[10px] transition-all flex items-center gap-3"
                  title="Ir para o Portal do Cliente"
                >
                  <Sparkles className="h-5 w-5" />
                  <span>Portal do Cliente</span>
                </Button>
                <Button 
                  onClick={() => auth.signOut()}
                  className="h-16 px-8 rounded-2xl bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white border border-red-500/20 font-black uppercase tracking-widest text-[10px] transition-all"
                >
                  <LogOut className="h-5 w-5 mr-3" /> Sair do Painel
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 min-h-screen">
        <div className={`max-w-6xl mx-auto ${forcedTab ? 'p-2' : 'p-8 pt-24 md:pt-8'}`}>
          {activeTab === 'overview' && (
            <div className="space-y-8 animate-in fade-in duration-500">
              <header className="px-2 md:px-0 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                  <h2 className="text-2xl md:text-3xl font-black text-slate-900 uppercase tracking-tight leading-none">Gestão Financeira</h2>
                  <p className="text-slate-500 text-sm mt-2">Painel unificado e auditoria de fluxo de caixa físico e faturamento virtual</p>
                </div>
                <div className="bg-blue-50 border border-blue-100 rounded-2xl px-4 py-3 flex items-center gap-2.5">
                  <div className="h-2 w-2 rounded-full bg-blue-600 animate-pulse" />
                  <p className="text-xs font-black uppercase text-blue-800 tracking-wider">Modo Auditoria Ativo</p>
                </div>
              </header>

              {/* Period Filter Section */}
              <div className="bg-slate-50 border border-slate-100/80 rounded-[32px] p-5 md:p-6 flex flex-col lg:flex-row gap-5 items-stretch lg:items-center justify-between px-6 md:px-8 shadow-sm">
                {/* Filter Controls */}
                <div className="flex flex-col md:flex-row items-stretch md:items-center gap-4 flex-1">
                  <div className="flex items-center gap-2">
                    <Filter className="h-4 w-4 text-slate-500 shrink-0" />
                    <span className="text-xs font-black uppercase tracking-wider text-slate-500 whitespace-nowrap">Filtrar Período:</span>
                  </div>
                  
                  <div className="bg-slate-200/60 p-1 rounded-2xl flex flex-wrap gap-1">
                    {(['all', 'today', 'this_month', 'custom'] as const).map((preset) => {
                      const labels: Record<string, string> = {
                        all: 'Todo o Tempo',
                        today: 'Hoje',
                        this_month: 'Este Mês',
                        custom: 'Personalizado'
                      };
                      const isActive = dashboardFilterPreset === preset;
                      return (
                        <Button
                          key={preset}
                          onClick={() => setDashboardFilterPreset(preset)}
                          variant="ghost"
                          className={`h-10 px-4 rounded-xl text-xs font-bold uppercase transition-all ${
                            isActive 
                              ? 'bg-white text-slate-900 shadow-md shadow-slate-900/5' 
                              : 'text-slate-500 hover:text-slate-900 hover:bg-white/40'
                          }`}
                        >
                          {labels[preset]}
                        </Button>
                      );
                    })}
                  </div>

                  {dashboardFilterPreset === 'custom' && (
                    <div className="flex flex-wrap items-center gap-2 animate-in slide-in-from-left duration-300">
                      <Input
                        type="date"
                        value={dashboardStartDate}
                        onChange={(e) => setDashboardStartDate(e.target.value)}
                        className="h-11 rounded-xl bg-white border-slate-200 text-xs font-semibold text-slate-700 w-36 px-3"
                        title="Data Inicial"
                      />
                      <span className="text-slate-400 text-xs font-medium">até</span>
                      <Input
                        type="date"
                        value={dashboardEndDate}
                        onChange={(e) => setDashboardEndDate(e.target.value)}
                        className="h-11 rounded-xl bg-white border-slate-200 text-xs font-semibold text-slate-700 w-36 px-3"
                        title="Data Final"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Accounts Receivable Banner */}
              {stats.totalPending > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-[28px] p-5 px-6 flex flex-col sm:flex-row items-center justify-between gap-4 mx-2 md:mx-0 animate-pulse mb-6">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-2xl bg-amber-100 flex items-center justify-center text-amber-600 shrink-0">
                      <AlertTriangle className="h-5 w-5" />
                    </div>
                    <div className="text-center sm:text-left">
                      <p className="text-[10px] font-black uppercase text-amber-800 tracking-wider">Atenção: Cobranças "Em Conta" Pendentes</p>
                      <p className="text-sm font-semibold text-amber-700">Há recargas na modalidade pós-paga ("Em Conta") pendentes para recebimento / liquidação.</p>
                    </div>
                  </div>
                  <div className="text-center sm:text-right shrink-0">
                    <p className="text-[10px] font-black uppercase text-amber-600 tracking-widest">A Receber</p>
                    <p className="text-2xl font-black text-amber-800 tracking-tighter">R$ {stats.totalPending.toFixed(2)}</p>
                  </div>
                </div>
              )}

              {/* Main Financial Indicators */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 px-2 md:px-0">
                <Card className="shadow-2xl shadow-blue-500/5 border-none bg-blue-600 text-white rounded-[32px] overflow-hidden relative group">
                  <div className="absolute -right-4 -top-4 w-24 h-24 bg-white/10 blur-3xl rounded-full group-hover:scale-150 transition-transform duration-700" />
                  <CardContent className="p-6 md:p-8 space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-100 flex items-center gap-2">
                      <Store className="h-3 w-3" /> Faturamento das Barracas
                    </p>
                    <h4 className="text-3xl font-black tabular-nums tracking-tighter">R$ {stats.totalRevenue.toFixed(2)}</h4>
                    <p className="text-[9px] text-blue-200 font-bold uppercase tracking-widest">{stats.totalSalesCount} transações de consumo</p>
                  </CardContent>
                </Card>

                <Card className="shadow-2xl shadow-emerald-500/5 border-none bg-emerald-600 text-white rounded-[32px] overflow-hidden relative group">
                  <div className="absolute -right-4 -top-4 w-24 h-24 bg-white/10 blur-3xl rounded-full group-hover:scale-150 transition-transform duration-700" />
                  <CardContent className="p-6 md:p-8 space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-100 flex items-center gap-2">
                      <CreditCard className="h-3 w-3" /> Total Recarregado (Carga)
                    </p>
                    <h4 className="text-3xl font-black tabular-nums tracking-tighter">R$ {stats.credited.toFixed(2)}</h4>
                    <p className="text-[9px] text-emerald-100/80 font-bold uppercase tracking-widest">Aporte financeiro nos caixas</p>
                  </CardContent>
                </Card>

                <Card className="shadow-sm border-none bg-white rounded-[32px] overflow-hidden relative group">
                  <CardContent className="p-6 md:p-8 space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2">
                      <FileText className="h-3 w-3 text-red-500" /> Total Recolhido (Saídas)
                    </p>
                    <h4 className="text-3xl font-black text-slate-900 tabular-nums tracking-tighter">R$ {stats.totalWithdrawn.toFixed(2)}</h4>
                    <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">{withdrawals.length} malotes fisicamente coletados</p>
                  </CardContent>
                </Card>

                <Card className="shadow-sm border-none bg-indigo-950 text-white rounded-[32px] overflow-hidden relative group h-full">
                  <div className="absolute -right-4 -top-4 w-24 h-24 bg-indigo-500/10 blur-3xl rounded-full group-hover:scale-150 transition-transform duration-700" />
                  <CardContent className="p-6 md:p-8 space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-300 flex items-center gap-2">
                      <DollarSign className="h-3 w-3 text-amber-400" /> Saldo Físico nos Caixas
                    </p>
                    <h4 className="text-3xl font-black text-amber-400 tabular-nums tracking-tighter">R$ {(stats.credited - stats.totalWithdrawn).toFixed(2)}</h4>
                    <p className="text-[9px] text-indigo-200/80 font-bold uppercase tracking-widest">Dinheiro físico em gavetas de recarga</p>
                  </CardContent>
                </Card>
              </div>

              {/* Payment Method Breakdown */}
              <div className="px-2 md:px-0">
                <div className="bg-white border border-slate-100 rounded-[32px] p-6 md:p-8 shadow-sm space-y-6">
                  <div>
                    <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
                      <Calculator className="h-4 w-4 text-emerald-500" /> Divisão Física de Entradas por Meio de Pagamento
                    </h3>
                    <p className="text-xs text-slate-400 mt-1 uppercase font-bold tracking-widest">Consolidado de todas as cargas e recargas efetuadas</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-slate-50 border border-slate-100 rounded-2xl p-5 flex items-center justify-between">
                      <div className="space-y-1">
                        <p className="text-[10px] font-black uppercase text-emerald-600 tracking-wider">Espécie / Dinheiro</p>
                        <p className="text-2xl font-black text-slate-900 tabular-nums tracking-tight">R$ {paymentMethodStats.cash.toFixed(2)}</p>
                      </div>
                      <div className="h-10 w-10 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-600">
                        <DollarSign className="h-5 w-5" />
                      </div>
                    </div>

                    <div className="bg-slate-50 border border-slate-100 rounded-2xl p-5 flex items-center justify-between">
                      <div className="space-y-1">
                        <p className="text-[10px] font-black uppercase text-blue-600 tracking-wider">PIX Instantâneo</p>
                        <p className="text-2xl font-black text-slate-900 tabular-nums tracking-tight">R$ {paymentMethodStats.pix.toFixed(2)}</p>
                      </div>
                      <div className="h-10 w-10 rounded-xl bg-blue-100 flex items-center justify-center text-blue-600">
                        <QrCode className="h-5 w-5" />
                      </div>
                    </div>

                    <div className="bg-slate-50 border border-slate-100 rounded-2xl p-5 flex items-center justify-between">
                      <div className="space-y-1">
                        <p className="text-[10px] font-black uppercase text-indigo-600 tracking-wider">Cartão Débito / Crédito</p>
                        <p className="text-2xl font-black text-slate-900 tabular-nums tracking-tight">R$ {paymentMethodStats.card.toFixed(2)}</p>
                      </div>
                      <div className="h-10 w-10 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-600">
                        <CreditCard className="h-5 w-5" />
                      </div>
                    </div>
                  </div>
                  
                  {/* Subtle graphical bar chart indicator */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
                      <span>Proporção de Arrecadação</span>
                      <span className="text-slate-500">100% Auditável</span>
                    </div>
                    <div className="h-3 w-full rounded-full bg-slate-100 overflow-hidden flex">
                      {stats.credited > 0 ? (
                        <>
                          <div 
                            style={{ width: `${(paymentMethodStats.cash / stats.credited) * 100}%` }}
                            className="bg-emerald-500 h-full transition-all duration-500" 
                            title={`Dinheiro: ${((paymentMethodStats.cash / stats.credited) * 100).toFixed(1)}%`}
                          />
                          <div 
                            style={{ width: `${(paymentMethodStats.pix / stats.credited) * 100}%` }}
                            className="bg-blue-500 h-full transition-all duration-500"
                            title={`PIX: ${((paymentMethodStats.pix / stats.credited) * 100).toFixed(1)}%`}
                          />
                          <div 
                            style={{ width: `${(paymentMethodStats.card / stats.credited) * 100}%` }}
                            className="bg-indigo-500 h-full transition-all duration-500"
                            title={`Cartão: ${((paymentMethodStats.card / stats.credited) * 100).toFixed(1)}%`}
                          />
                          <div 
                            style={{ width: `${(paymentMethodStats.other / stats.credited) * 100}%` }}
                            className="bg-slate-400 h-full transition-all duration-500"
                            title={`Outros: ${((paymentMethodStats.other / stats.credited) * 100).toFixed(1)}%`}
                          />
                        </>
                      ) : (
                        <div className="w-full bg-slate-200 h-full" />
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Operations row: Withdrawals Register Form */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 md:gap-8 px-2 md:px-0">
                <div className="lg:col-span-5">
                  <Card className="shadow-sm border-none rounded-[32px] overflow-hidden h-full">
                    <CardHeader className="bg-slate-50 border-b border-slate-100 p-6 md:p-8">
                      <CardTitle className="text-xs font-black uppercase tracking-[0.2em] text-slate-900 flex items-center gap-2">
                        <ArrowLeftRight className="h-4 w-4 text-blue-600" /> Recolhimento de Valores (Retirada)
                      </CardTitle>
                      <CardDescription className="text-[10px] uppercase font-bold text-slate-400 tracking-widest mt-1">
                        Registre a retirada do dinheiro físico do caixa de recargas para o cofre geral
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="p-6 md:p-8 space-y-6">
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest ml-1">Caixa de Recarga / Operador Origem</label>
                          <select 
                            className="flex h-14 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                            value={withdrawalStallId}
                            onChange={(e) => setWithdrawalStallId(e.target.value)}
                          >
                            <option value="">Selecionar Caixa de Recarga</option>
                            {users.filter(u => u.role === 'recharge' || u.role === 'admin').map(u => (
                              <option key={u.uid} value={u.uid}>
                                {u.name || u.email?.split('@')[0] || 'Operador'} ({u.role === 'admin' ? 'Admin' : 'Operador'})
                              </option>
                            ))}
                            {statsByCaixa.some(c => c.uid === 'legacy_general') && (
                              <option value="legacy_general">Caixa Administrativo (Legado)</option>
                            )}
                          </select>
                        </div>

                        <div className="space-y-2">
                          <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest ml-1">Valor do Malote (R$)</label>
                          <Input 
                            type="number"
                            placeholder="0.00" 
                            value={withdrawalAmount}
                            onChange={(e) => setWithdrawalAmount(e.target.value)}
                            className="h-14 rounded-2xl bg-slate-50 border-slate-200 focus-visible:ring-blue-500 font-black text-lg"
                          />
                        </div>

                        <div className="space-y-2">
                          <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest ml-1">Observação / Identificação (Opcional)</label>
                          <Input 
                            type="text"
                            placeholder="Ex: Turno Tarde, Malote #002, Fechamento..." 
                            value={withdrawalNote}
                            onChange={(e) => setWithdrawalNote(e.target.value)}
                            className="h-14 rounded-2xl bg-slate-50 border-slate-200 focus-visible:ring-blue-500"
                          />
                        </div>
                      </div>

                      <Button 
                        onClick={handleWithdraw} 
                        disabled={!withdrawalStallId || !withdrawalAmount}
                        className="w-full h-14 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-2xl font-black uppercase tracking-[0.2em] text-[10px] shadow-xl active:scale-95 transition-all"
                      >
                        Confirmar Coleta de Malote
                      </Button>
                    </CardContent>
                  </Card>
                </div>

                {/* Cashier Status List (Withdrawal limits per Cashier) */}
                <div className="lg:col-span-7">
                  <Card className="shadow-sm border-none rounded-[32px] overflow-hidden h-full">
                    <CardHeader className="bg-slate-50 border-b border-slate-100 p-6 md:p-8 flex flex-row items-center justify-between">
                      <div>
                        <CardTitle className="text-xs font-black uppercase tracking-[0.2em] text-slate-900">Gavetas e Status dos Caixas de Recarga</CardTitle>
                        <CardDescription className="text-[10px] uppercase font-bold text-slate-400 tracking-widest mt-1">Balanço físico individualizado por operador</CardDescription>
                      </div>
                      <Users className="h-5 w-5 text-slate-300" />
                    </CardHeader>
                    <CardContent className="p-6 md:p-8">
                      <div className="space-y-4 max-h-[360px] overflow-y-auto pr-2 custom-scrollbar">
                        {statsByCaixa.length === 0 ? (
                          <div className="py-20 text-center space-y-4">
                             <div className="h-12 w-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-300">
                               <Package className="h-6 w-6" />
                             </div>
                             <p className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em]">Nenhum operador de recarga identificado</p>
                          </div>
                        ) : (
                          statsByCaixa.map(caixa => (
                            <div key={caixa.uid} className="flex flex-col p-5 bg-slate-50 hover:bg-white hover:shadow-md hover:border-blue-100 rounded-3xl border border-slate-100 transition-all gap-3">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <div className="h-10 w-10 rounded-xl bg-white border border-slate-100 flex items-center justify-center text-slate-400">
                                    <Users className="h-4 w-4" />
                                  </div>
                                  <div>
                                    <p className="font-black text-slate-900 uppercase tracking-tight text-xs">{caixa.name}</p>
                                    <p className="text-[9px] text-slate-400 font-medium tracking-normal lowercase">{caixa.email || 'Autenticação de terminal'}</p>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <p className="text-lg font-black text-emerald-600 tabular-nums tracking-tighter">R$ {caixa.balance.toFixed(2)}</p>
                                  <p className="text-[8px] text-slate-400 font-black uppercase tracking-widest">Disponível em Caixa</p>
                                </div>
                              </div>
                              
                              <div className="border-t border-slate-100 pt-3 grid grid-cols-3 gap-2 text-[9px] text-slate-500 font-medium">
                                <div>
                                  <span className="block text-slate-400 font-black text-[8px] uppercase tracking-wider">Cargas Efetuadas</span>
                                  <strong className="text-slate-800 tracking-tight text-[11px]">R$ {caixa.totalRecharged.toFixed(2)}</strong>
                                </div>
                                <div>
                                  <span className="block text-slate-400 font-black text-[8px] uppercase tracking-wider">Já Recolhido</span>
                                  <strong className="text-red-500 tracking-tight text-[11px]">R$ {caixa.totalWithdrawn.toFixed(2)}</strong>
                                </div>
                                <div className="text-right">
                                  <span className="block text-slate-400 font-black text-[8px] uppercase tracking-wider">Espécie / PIX / Card</span>
                                  <strong className="text-[9px] text-slate-400">R${caixa.totalCash.toFixed(0)}/R${caixa.totalPix.toFixed(0)}/R${caixa.totalCard.toFixed(0)}</strong>
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>

              {/* Stall Revenue Performance Panel */}
              <div className="px-2 md:px-0">
                <Card className="shadow-sm border-none rounded-[32px] overflow-hidden">
                  <CardHeader className="bg-slate-50 border-b border-slate-100 p-6 md:p-8 flex flex-row items-center justify-between">
                    <div>
                      <CardTitle className="text-xs font-black uppercase tracking-[0.2em] text-slate-900">Performance Digital de Vendas (Barracas)</CardTitle>
                      <CardDescription className="text-[10px] uppercase font-bold text-slate-400 tracking-widest mt-1">faturamento acumulado eletronicamente em cartões sem entrada de dinheiro físico no balcão</CardDescription>
                    </div>
                    <Store className="h-5 w-5 text-slate-300" />
                  </CardHeader>
                  <CardContent className="p-6 md:p-8">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {statsByStall.length === 0 ? (
                        <div className="col-span-full py-12 text-center text-slate-400 text-xs font-bold uppercase tracking-wider">Nenhuma barraca cadastrada</div>
                      ) : (
                        statsByStall.map(stall => (
                          <div key={stall.id} className="p-5 border border-slate-100 bg-slate-50/50 hover:bg-white hover:border-blue-100 rounded-2xl hover:shadow-md transition-all flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="h-11 w-11 bg-white border border-slate-100 rounded-xl flex items-center justify-center text-slate-400">
                                <Store className="h-5 w-5" />
                              </div>
                              <div className="space-y-0.5">
                                <p className="font-black text-slate-900 uppercase tracking-tight text-xs">{stall.name}</p>
                                <p className="text-[9px] text-blue-600 font-bold uppercase tracking-widest flex items-center gap-1">
                                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                                  {stall.productsSold || 0} Itens Vendidos
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-base font-black text-slate-900 tracking-tight tabular-nums">R$ {stall.totalSales.toFixed(2)}</p>
                              <p className="text-[8px] text-slate-400 font-black uppercase tracking-widest">Faturamento</p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Timeline of registered withdrawals with Cancellation support */}
              <div className="px-2 md:px-0">
                <Card className="shadow-sm border-none rounded-[32px] overflow-hidden">
                  <CardHeader className="bg-slate-50 border-b border-slate-100 p-6 md:p-8">
                    <CardTitle className="text-xs font-black uppercase tracking-[0.2em] text-slate-900 flex items-center gap-2">
                      <FileText className="h-4 w-4 text-emerald-600" /> Registro Auditável de Coletas (Timeline)
                    </CardTitle>
                    <CardDescription className="text-[10px] uppercase font-bold text-slate-400 tracking-widest mt-1">Visualização cronológica de malotes recolhidos e repassados</CardDescription>
                  </CardHeader>
                  <CardContent className="p-6 md:p-8">
                    {filteredWithdrawals.length === 0 ? (
                      <div className="py-16 text-center space-y-3">
                        <div className="h-10 w-10 rounded-full bg-slate-100 text-slate-300 flex items-center justify-center mx-auto">
                          <History className="h-5 w-5" />
                        </div>
                        <p className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em]">Nenhum malote recolhido até o momento</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow className="border-slate-100 hover:bg-transparent">
                              <TableHead className="text-[9px] uppercase font-black text-slate-400 h-10 tracking-wider">Data / Horário</TableHead>
                              <TableHead className="text-[9px] uppercase font-black text-slate-400 h-10 tracking-wider">Origem (Caixa de Recarga)</TableHead>
                              <TableHead className="text-[9px] uppercase font-black text-slate-400 h-10 tracking-wider">Identificação / Observação</TableHead>
                              <TableHead className="text-[9px] uppercase font-black text-slate-400 h-10 tracking-wider">Registrado por (Admin)</TableHead>
                              <TableHead className="text-[9px] uppercase font-black text-slate-400 h-10 tracking-wider text-right">Valor Recolhido</TableHead>
                              <TableHead className="text-[9px] uppercase font-black text-slate-400 h-10 tracking-wider text-right w-16">Ações</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {[...filteredWithdrawals].sort((a,b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).map(w => {
                              const targetCaixa = users.find(u => u.uid === w.stallId);
                              const targetCaixaName = targetCaixa ? (targetCaixa.name || targetCaixa.email) : (w.stallId === 'legacy_general' ? 'Caixa Administrativo (Legado)' : 'Operador Desconhecido');
                              const authorAdmin = users.find(u => u.uid === w.adminId);
                              const authorAdminName = authorAdmin ? (authorAdmin.name || authorAdmin.email?.split('@')[0]) : 'Admin';
                              
                              return (
                                <TableRow key={w.id} className="border-slate-100 hover:bg-slate-50/50">
                                  <TableCell className="text-xs text-slate-500 font-medium">
                                    {new Date(w.timestamp).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                  </TableCell>
                                  <TableCell className="text-xs text-slate-900 font-black uppercase tracking-tight">
                                    {targetCaixaName}
                                  </TableCell>
                                  <TableCell className="text-xs text-slate-500 font-medium italic">
                                    {w.note || 'Sem observações'}
                                  </TableCell>
                                  <TableCell className="text-xs text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                                    {authorAdminName}
                                  </TableCell>
                                  <TableCell className="text-sm text-red-600 font-black text-right tabular-nums">
                                    R$ {w.amount.toFixed(2)}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <Button 
                                      variant="ghost" 
                                      size="icon" 
                                      onClick={() => handleDeleteWithdrawal(w.id)}
                                      className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl"
                                      title="Cancelar recolhimento"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

        {activeTab === 'stalls' && (
          <div className="space-y-8">
            <header>
              <h2 className="text-3xl font-black text-slate-900 uppercase">Configurar Barracas</h2>
              <p className="text-slate-500">Adicione ou remova pontos de venda</p>
            </header>
            <div className="flex gap-2 max-w-md">
              <Input 
                placeholder="Nome da barraca" 
                value={newStallName}
                onChange={(e) => setNewStallName(e.target.value)}
              />
              <Button onClick={handleAddStall} className="bg-blue-600">
                Cadastrar
              </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {stalls.map(stall => (
                <div 
                  key={stall.id} 
                  onClick={() => setEditingStall(stall)}
                  className="group p-6 bg-white rounded-2xl shadow-sm border border-slate-100 flex items-center justify-between cursor-pointer hover:shadow-md hover:border-blue-200 transition-all active:scale-[0.98]"
                >
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-slate-50 rounded-xl group-hover:bg-blue-50 transition-colors">
                      <Store className="h-6 w-6 text-slate-400 group-hover:text-blue-500" />
                    </div>
                    <div>
                      <span className="font-black text-slate-900 uppercase text-sm tracking-widest">{stall.name}</span>
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">Clique para editar</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingStall(stall);
                      }} 
                      className="text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={(e) => handleDeleteStall(stall.id, e)} 
                      className="text-red-400 hover:text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {/* Edit Stall Dialog */}
            <Dialog open={!!editingStall} onOpenChange={(open) => !open && setEditingStall(null)}>
              <DialogContent className="rounded-[32px] border-none shadow-2xl p-8 max-w-sm">
                <DialogHeader className="space-y-4">
                  <div className="h-14 w-14 rounded-2xl bg-blue-600 flex items-center justify-center text-white mx-auto shadow-xl">
                    <Edit2 className="h-7 w-7" />
                  </div>
                  <DialogTitle className="text-2xl font-black text-center tracking-tight uppercase">Editar Barraca</DialogTitle>
                  <DialogDescription className="text-center text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                    Altere o nome do ponto de venda
                  </DialogDescription>
                </DialogHeader>
                <div className="py-6 space-y-4">
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Nome da Barraca</Label>
                    <Input 
                      value={editingStall?.name || ''} 
                      onChange={(e) => setEditingStall(prev => prev ? { ...prev, name: e.target.value } : null)}
                      placeholder="Ex: Cantina Principal"
                      className="h-14 rounded-2xl bg-slate-50 border-slate-200 font-black"
                    />
                  </div>
                </div>
                <DialogFooter className="flex-col sm:flex-col gap-3">
                  <Button onClick={handleUpdateStall} className="w-full h-14 bg-slate-900 hover:bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl active:scale-95 transition-all">
                    Salvar Alterações
                  </Button>
                  <Button variant="ghost" onClick={() => setEditingStall(null)} className="w-full h-12 rounded-xl font-bold uppercase tracking-widest text-[10px] text-slate-400 hover:text-slate-600">
                    Cancelar
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}

        {activeTab === 'products' && (
          <div className="space-y-8">
            <header>
              <h2 className="text-3xl font-black text-slate-900 uppercase tracking-tight">Catálogo de Produtos</h2>
              <p className="text-slate-500">Vincule produtos a barracas específicas</p>
            </header>
            <Card className="shadow-sm border-none max-w-2xl">
              <CardContent className="pt-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2 col-span-1 md:col-span-2">
                    <label className="text-[10px] font-black uppercase text-slate-400">Nome do Item</label>
                    <Input placeholder="Ex: Misto Quente" value={newProductName} onChange={(e) => setNewProductName(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-slate-400">Preço (R$)</label>
                    <Input type="number" placeholder="8.50" value={newProductPrice} onChange={(e) => setNewProductPrice(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-slate-400">Ponto de Venda</label>
                    <select 
                      className="flex h-10 w-full rounded-md border border-slate-200 bg-background px-3 py-2 text-sm"
                      value={selectedStallId}
                      onChange={(e) => setSelectedStallId(e.target.value)}
                    >
                      <option value="">Selecionar Barraca</option>
                      {stalls.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                </div>
                <Button onClick={handleAddProduct} className="w-full bg-slate-900 hover:bg-slate-800">
                  <Plus className="h-4 w-4 mr-2" /> Adicionar ao Catálogo
                </Button>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {stalls.map(stall => (
                <Card key={stall.id} className="shadow-sm border-none bg-white">
                  <CardHeader className="bg-slate-50 rounded-t-2xl border-b border-slate-100">
                    <CardTitle className="text-xs uppercase tracking-widest font-black text-slate-400">{stall.name}</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-4 space-y-2">
                    {products.filter(p => p.vendorId === stall.id).length === 0 ? (
                      <p className="py-4 text-center text-xs text-slate-400 italic">Nenhum produto</p>
                    ) : (
                      products.filter(p => p.vendorId === stall.id).map(product => (
                        <div 
                          key={product.id} 
                          onClick={() => setEditingProduct(product)}
                          className="flex items-center justify-between p-2 hover:bg-blue-50 rounded-lg group cursor-pointer transition-colors active:scale-[0.98]"
                        >
                          <div>
                            <p className="text-sm font-bold text-slate-900 line-clamp-1 truncate max-w-[150px]">{product.name}</p>
                            <p className="text-[10px] text-blue-600 font-bold">R$ {product.price.toFixed(2)}</p>
                          </div>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingProduct(product);
                              }} 
                              className="h-7 w-7 text-slate-400 hover:text-blue-600 hover:bg-blue-100"
                            >
                              <Edit2 className="h-3 w-3" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              onClick={(e) => handleDeleteProduct(product.id, e)} 
                              className="h-7 w-7 text-slate-400 hover:text-red-500 hover:bg-red-100"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Edit Product Dialog */}
            <Dialog open={!!editingProduct} onOpenChange={(open) => !open && setEditingProduct(null)}>
              <DialogContent className="rounded-[32px] border-none shadow-2xl p-8 max-w-sm">
                <DialogHeader className="space-y-4">
                  <div className="h-14 w-14 rounded-2xl bg-blue-600 flex items-center justify-center text-white mx-auto shadow-xl">
                    <Edit2 className="h-7 w-7" />
                  </div>
                  <DialogTitle className="text-2xl font-black text-center tracking-tight uppercase">Editar Produto</DialogTitle>
                  <DialogDescription className="text-center text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                    Altere os detalhes do produto
                  </DialogDescription>
                </DialogHeader>
                <div className="py-6 space-y-4">
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Ponto de Venda</Label>
                    <select
                      value={editingProduct?.vendorId || ''}
                      onChange={(e) => setEditingProduct(prev => prev ? { ...prev, vendorId: e.target.value } : null)}
                      className="w-full h-14 rounded-2xl bg-slate-50 border-slate-200 font-bold px-4 text-sm"
                    >
                      <option value="">Selecione a Barraca</option>
                      {stalls.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Nome do Produto</Label>
                    <Input 
                      value={editingProduct?.name || ''} 
                      onChange={(e) => setEditingProduct(prev => prev ? { ...prev, name: e.target.value } : null)}
                      placeholder="Ex: Coca-Cola 350ml"
                      className="h-14 rounded-2xl bg-slate-50 border-slate-200 font-black"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Preço unitário</Label>
                    <Input 
                      type="number"
                      step="0.01"
                      value={editingProduct?.price || ''} 
                      onChange={(e) => setEditingProduct(prev => prev ? { ...prev, price: Number(e.target.value) } : null)}
                      placeholder="0.00"
                      className="h-14 rounded-2xl bg-slate-50 border-slate-200 font-black"
                    />
                  </div>
                </div>
                <DialogFooter className="flex-col sm:flex-col gap-3">
                  <Button onClick={handleUpdateProduct} className="w-full h-14 bg-slate-900 hover:bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl active:scale-95 transition-all">
                    Salvar Alterações
                  </Button>
                  <Button variant="ghost" onClick={() => setEditingProduct(null)} className="w-full h-12 rounded-xl font-bold uppercase tracking-widest text-[10px] text-slate-400 hover:text-slate-600">
                    Cancelar
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}

        {activeTab === 'users' && (
          <div className="space-y-8 animate-in fade-in duration-500">
            <header className="flex flex-col md:flex-row md:items-end justify-between gap-8 pb-10 border-b border-slate-100">
              <div className="space-y-4">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-blue-600">
                  <ShieldCheckIcon className="h-3 w-3" />
                  <span className="text-[10px] font-black uppercase tracking-widest">Controle de Acesso</span>
                </div>
                <h2 className="text-4xl font-black text-slate-900 tracking-tighter flex items-center gap-4">
                  <div className="h-14 w-14 rounded-2xl bg-slate-950 flex items-center justify-center text-white shadow-2xl rotate-3 shrink-0">
                    <Users className="h-7 w-7" />
                  </div>
                  GESTÃO DE USUÁRIOS
                </h2>
                <p className="text-slate-500 text-lg font-medium max-w-xl leading-relaxed">
                  Gerencie permissões, atribua barracas e controle acessos de colaboradores e clientes de forma centralizada.
                </p>
              </div>
            </header>

            {/* Form Section */}
            <section className="bg-white p-8 rounded-[32px] border border-slate-200 shadow-sm relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-8 opacity-5">
                <Users className="h-24 w-24 text-slate-900" />
              </div>
              <div className="relative z-10 flex flex-col gap-8">
                <div>
                  <h3 className="font-black text-slate-900 text-xl uppercase tracking-tighter">Pré-Cadastro de Usuários</h3>
                  <p className="text-slate-500 text-sm mt-1 max-w-md">Adicione usuários ao sistema. Eles entrarão com as permissões definidas ao fazer login.</p>
                </div>

                <form onSubmit={handleAddUser} className="space-y-8">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Nome Completo</label>
                      <Input 
                        value={newUserName}
                        onChange={(e) => setNewUserName(e.target.value)}
                        placeholder="Ex: João Silva"
                        className="bg-slate-50 border-slate-200 h-14 focus-visible:ring-blue-500 rounded-2xl text-base font-medium px-4"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">E-mail do Google</label>
                      <Input 
                        type="email"
                        value={newUserEmail}
                        onChange={(e) => setNewUserEmail(e.target.value)}
                        placeholder="exemplo@gmail.com"
                        className="bg-slate-50 border-slate-200 h-14 focus-visible:ring-blue-500 rounded-2xl text-base font-medium px-4"
                      />
                    </div>
                  </div>

                  <div className="space-y-6">
                    <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Selecione a Função</label>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { id: 'student', label: 'Cliente', icon: UserIcon },
                        { id: 'vendor', label: 'Vendedor', icon: ShoppingCart },
                        { id: 'recharge', label: 'Recarga', icon: CreditCard },
                        { id: 'admin', label: 'Admin', icon: ShieldCheckIcon },
                      ].map((role) => (
                        <button
                          key={role.id}
                          type="button"
                          onClick={() => {
                            setNewUserRole(role.id as any);
                            if (role.id !== 'vendor') setNewUserVendorIds([]);
                          }}
                          className={`flex items-center gap-3 px-4 py-3 rounded-2xl border-2 transition-all group/role ${
                            newUserRole === role.id 
                              ? 'border-blue-600 bg-blue-50 text-blue-600' 
                              : 'border-slate-100 bg-slate-50/50 hover:bg-white hover:border-slate-200 text-slate-500'
                          }`}
                        >
                          <div className={`p-2 rounded-lg transition-colors ${
                            newUserRole === role.id ? 'bg-blue-600 text-white' : 'bg-white text-slate-400 group-hover/role:text-slate-600'
                          }`}>
                            <role.icon className="h-4 w-4" />
                          </div>
                          <span className="text-[10px] font-black uppercase tracking-widest">{role.label}</span>
                        </button>
                      ))}
                    </div>

                    {newUserRole === 'vendor' && (
                      <div className="space-y-4 pt-4 border-t border-slate-100 animate-in fade-in slide-in-from-top-2 duration-300">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Atribuir Barracas (Vendedor)</label>
                        <div className="flex flex-wrap gap-2">
                          {stalls.map(stall => {
                            const isAssigned = newUserVendorIds.includes(stall.id);
                            return (
                              <button
                                key={stall.id}
                                type="button"
                                onClick={() => {
                                  setNewUserVendorIds(prev => 
                                    isAssigned ? prev.filter(id => id !== stall.id) : [...prev, stall.id]
                                  );
                                }}
                                className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${
                                  isAssigned 
                                    ? 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-500/20' 
                                    : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                                }`}
                              >
                                {stall.name}
                              </button>
                            );
                          })}
                          {stalls.length === 0 && (
                            <p className="text-xs text-slate-400 italic">Nenhuma barraca cadastrada ainda.</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <Button type="submit" className="w-full bg-slate-950 hover:bg-blue-600 text-white h-16 rounded-[24px] font-black uppercase tracking-[0.2em] text-xs transition-all shadow-xl group/submit">
                    <Plus className="h-5 w-5 mr-2 group-hover/submit:rotate-90 transition-transform" /> 
                    Finalizar Pré-Cadastro
                  </Button>
                </form>
              </div>
            </section>

            {/* Search and List Header */}
            <div className="flex flex-col gap-6">
              <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
                <div className="space-y-4 flex-1">
                  <div className="flex flex-wrap gap-2">
                    {[
                      { id: 'all', label: 'Todos', icon: Users },
                      { id: 'student', label: 'Clientes', icon: UserIcon },
                      { id: 'vendor', label: 'Vendedores', icon: ShoppingCart },
                      { id: 'recharge', label: 'Recarga', icon: CreditCard },
                      { id: 'admin', label: 'Admins', icon: ShieldCheckIcon },
                    ].map((role) => (
                      <button
                        key={role.id}
                        onClick={() => setRoleFilter(role.id as any)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border shadow-sm cursor-pointer ${
                          roleFilter === role.id 
                            ? 'bg-blue-600 border-blue-600 text-white shadow-blue-200' 
                            : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                        }`}
                      >
                        <role.icon className="h-3 w-3" />
                        {role.label}
                      </button>
                    ))}
                  </div>
                  
                  <div className="relative max-w-2xl">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input 
                      placeholder="Buscar por nome, e-mail ou cartão..." 
                      value={userSearchQuery}
                      onChange={(e) => setUserSearchQuery(e.target.value)}
                      className="pl-12 h-14 bg-white border-slate-200 rounded-2xl shadow-sm focus:ring-blue-500 text-base font-medium"
                    />
                  </div>
                </div>
                
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 shrink-0">
                  <div className="text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em] px-4 self-center">
                    <span className="text-blue-600 font-black">{filteredUsers.length}</span> Membros encontrados
                  </div>
                  <Button 
                    onClick={exportToExcel}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl h-14 px-6 font-black uppercase tracking-widest text-[10px] flex items-center justify-center gap-2 border-none shadow-xl shadow-emerald-650/10 active:scale-95 transition-all cursor-pointer whitespace-nowrap"
                  >
                    <Download className="h-4 w-4" />
                    Exportar Excel
                  </Button>
                </div>
              </div>

              {/* Bulk Edit Panel */}
              {selectedUsers.length > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-[24px] p-6 flex flex-col md:flex-row items-center justify-between gap-4 transition-all duration-300 shadow-md">
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-black text-sm shrink-0 select-none shadow-md shadow-blue-500/20">
                      {selectedUsers.length}
                    </div>
                    <div>
                      <h5 className="text-xs font-black uppercase text-blue-900 tracking-widest">Ações em Lote</h5>
                      <p className="text-[10px] text-blue-600 font-bold uppercase tracking-wider mt-0.5">Selecione uma operação aplicável aos membros marcados</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => {
                        setBulkEditActionType('recharge');
                        setBulkEditRecharge('');
                        setBulkEditPaymentMethod('Dinheiro');
                        setShowBulkEditModal(true);
                      }}
                      className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-800 text-[10px] font-black uppercase tracking-wider rounded-xl border border-slate-200 transition-all cursor-pointer flex items-center gap-1.5 shadow-sm"
                    >
                      <Plus className="h-3.5 w-3.5 text-emerald-600" />
                      Recarregar
                    </button>
                    <button
                      onClick={() => {
                        setBulkEditActionType('role');
                        setBulkEditRole('');
                        setShowBulkEditModal(true);
                      }}
                      className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-800 text-[10px] font-black uppercase tracking-wider rounded-xl border border-slate-200 transition-all cursor-pointer flex items-center gap-1.5 shadow-sm"
                    >
                      <UserIcon className="h-3.5 w-3.5 text-blue-600" />
                      Alterar Função
                    </button>
                    <button
                      onClick={() => {
                        setBulkEditActionType('stalls');
                        setBulkEditStalls([]);
                        setShowBulkEditModal(true);
                      }}
                      className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-800 text-[10px] font-black uppercase tracking-wider rounded-xl border border-slate-200 transition-all cursor-pointer flex items-center gap-1.5 shadow-sm"
                    >
                      <Store className="h-3.5 w-3.5 text-indigo-600" />
                      Atribuir Barracas
                    </button>
                    <button
                      onClick={() => handleBulkEditAction('zero')}
                      className="px-4 py-2 bg-white hover:bg-rose-50 text-rose-600 text-[10px] font-black uppercase tracking-wider rounded-xl border border-rose-100 transition-all cursor-pointer flex items-center gap-1.5 shadow-sm"
                    >
                      <RefreshCw className="h-3.5 w-3.5 text-rose-500" />
                      Zerar Saldos
                    </button>
                    <button
                      onClick={() => handleBulkEditAction('delete')}
                      className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-black uppercase tracking-wider rounded-xl border border-rose-700 transition-all cursor-pointer flex items-center gap-1.5 shadow-md"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Excluir
                    </button>
                    <button
                      onClick={() => setSelectedUsers([])}
                      className="px-4 py-2 bg-slate-200/50 hover:bg-slate-200 text-slate-600 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all cursor-pointer"
                    >
                      Desmarcar Todos
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="bg-white rounded-[32px] border border-slate-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <Table className="w-full min-w-[1240px]">
                  <TableHeader className="bg-slate-50/70 border-b border-slate-100 select-none">
                    <TableRow className="hover:bg-transparent border-b border-slate-100">
                      <TableHead className="w-14 h-14 px-4 py-4 text-center">
                        <input 
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                          checked={filteredUsers.length > 0 && filteredUsers.every(u => selectedUsers.includes(u.uid))}
                          onChange={toggleSelectAllUsers}
                        />
                      </TableHead>
                      <TableHead 
                        onClick={() => handleToggleSort('name')}
                        className="text-[10px] uppercase font-black tracking-widest text-slate-400 h-14 px-6 py-4 cursor-pointer hover:bg-slate-100/50 transition-colors"
                      >
                        <div className="flex items-center gap-1.5">
                          Nome / E-mail
                          <span className="text-slate-400 font-bold">
                            {sortField === 'name' ? (sortOrder === 'asc' ? '▲' : '▼') : '↕'}
                          </span>
                        </div>
                      </TableHead>
                      <TableHead 
                        onClick={() => handleToggleSort('qrCode')}
                        className="text-[10px] uppercase font-black tracking-widest text-slate-400 h-14 px-4 py-4 cursor-pointer hover:bg-slate-100/50 transition-colors"
                      >
                        <div className="flex items-center gap-1.5">
                          Nº Cartão (QR)
                          <span className="text-slate-400 font-bold">
                            {sortField === 'qrCode' ? (sortOrder === 'asc' ? '▲' : '▼') : '↕'}
                          </span>
                        </div>
                      </TableHead>
                      <TableHead 
                        onClick={() => handleToggleSort('role')}
                        className="text-[10px] uppercase font-black tracking-widest text-slate-400 h-14 px-4 py-4 cursor-pointer hover:bg-slate-100/50 transition-colors"
                      >
                        <div className="flex items-center gap-1.5">
                          Função
                          <span className="text-slate-400 font-bold">
                            {sortField === 'role' ? (sortOrder === 'asc' ? '▲' : '▼') : '↕'}
                          </span>
                        </div>
                      </TableHead>
                      <TableHead 
                        onClick={() => handleToggleSort('balance')}
                        className="text-[10px] uppercase font-black tracking-widest text-slate-400 h-14 px-4 py-4 cursor-pointer hover:bg-slate-100/50 transition-colors"
                      >
                        <div className="flex items-center gap-1.5">
                          Saldo Atual
                          <span className="text-slate-400 font-bold">
                            {sortField === 'balance' ? (sortOrder === 'asc' ? '▲' : '▼') : '↕'}
                          </span>
                        </div>
                      </TableHead>
                      <TableHead className="text-[10px] uppercase font-black tracking-widest text-slate-400 h-14 px-4 py-4">Recarga Rápida</TableHead>
                      <TableHead 
                        onClick={() => handleToggleSort('stalls')}
                        className="text-[10px] uppercase font-black tracking-widest text-slate-400 h-14 px-4 py-4 cursor-pointer hover:bg-slate-100/50 transition-colors"
                      >
                        <div className="flex items-center gap-1.5">
                          Barracas Vinculadas
                          <span className="text-slate-400 font-bold">
                            {sortField === 'stalls' ? (sortOrder === 'asc' ? '▲' : '▼') : '↕'}
                          </span>
                        </div>
                      </TableHead>
                      <TableHead className="text-[10px] uppercase font-black tracking-widest text-slate-400 h-14 px-6 py-4 text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-12 text-slate-400 font-medium h-24">
                          Nenhum usuário encontrado correspondendo aos filtros.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredUsers.map(user => {
                        const isChosen = selectedUsers.includes(user.uid);
                        return (
                          <TableRow 
                            key={user.uid} 
                            onDoubleClick={() => setEditingUser(user)}
                            className={`hover:bg-slate-50/50 border-b border-slate-100/80 transition-colors cursor-pointer select-none ${
                              isChosen ? 'bg-blue-50/20 hover:bg-blue-50/40' : ''
                            }`}
                            title="Duplo clique sobre a linha para editar perfil"
                          >
                            <TableCell className="px-4 py-4 w-14 text-center" onDoubleClick={(e) => e.stopPropagation()}>
                              <input 
                                type="checkbox"
                                className="h-4 w-4 rounded border-slate-350 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                checked={isChosen}
                                onClick={(e) => e.stopPropagation()}
                                onChange={() => toggleSelectUser(user.uid)}
                              />
                            </TableCell>

                            <TableCell className="px-6 py-4 whitespace-nowrap">
                              <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-800 font-extrabold text-sm uppercase shadow-inner shrink-0 select-none">
                                  {user.name.charAt(0)}
                                </div>
                                <div className="flex flex-col min-w-0">
                                  <span className="font-extrabold text-slate-900 text-sm uppercase tracking-tight truncate max-w-[200px]">{user.name}</span>
                                  <span className="text-[15px] text-slate-400 font-semibold truncate max-w-[200px]">{user.email}</span>
                                </div>
                              </div>
                            </TableCell>
                            
                            <TableCell className="px-4 py-4 whitespace-nowrap" onDoubleClick={(e) => e.stopPropagation()}>
                              <div className="flex flex-col gap-1 select-all" onClick={(e) => e.stopPropagation()}>
                                <div className="flex items-center gap-1.5 font-mono text-[11px] font-black text-slate-900 bg-slate-50 border border-slate-100 px-2.5 py-1 rounded-lg w-max [&_button]:hover:opacity-100">
                                  <span>{user.qrCode ? formatCardNumber(user.qrCode || user.uid || '') : 'Sem cartão'}</span>
                                  {user.qrCode && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        navigator.clipboard.writeText(formatCardNumber(user.qrCode || user.uid || ''));
                                        toast.success('Número de 16 dígitos copiado!');
                                      }}
                                      className="text-slate-400 hover:text-slate-800 p-0.5 transition-colors"
                                      title="Copiar Número"
                                    >
                                      <Copy className="h-3 w-3" />
                                    </button>
                                  )}
                                </div>
                                {user.qrCode && (
                                  <span className="text-[9px] text-slate-400 font-bold font-mono pl-1">ID: {user.qrCode}</span>
                                )}
                              </div>
                            </TableCell>
                            
                            <TableCell className="px-4 py-4 whitespace-nowrap">
                              <span className={`inline-flex items-center gap-1.5 text-[9px] font-black uppercase px-2.5 py-1.5 rounded-xl border shadow-sm ${
                                user.role === 'vendor' ? 'bg-blue-50 text-blue-600 border-blue-100' : 
                                user.role === 'recharge' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                                user.role === 'admin' ? 'bg-slate-900 text-white border-slate-800' :
                                'bg-slate-50 text-slate-500 border-slate-100'
                              }`}>
                                {getRoleIcon(user.role)}
                                {user.role === 'student' ? 'Cliente' : 
                                 user.role === 'vendor' ? 'Vendedor' : 
                                 user.role === 'recharge' ? 'Recarga' : 'Admin'}
                              </span>
                            </TableCell>
                            
                            <TableCell className="px-4 py-4 whitespace-nowrap">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-slate-900 text-sm">R$ {user.balance.toFixed(2)}</span>
                                {user.balance > 0 && (
                                  <button
                                    type="button"
                                    onDoubleClick={(e) => e.stopPropagation()}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleZeroBalance(user.uid);
                                    }}
                                    className="text-[9px] font-black tracking-wider text-rose-600 hover:text-white bg-rose-55 hover:bg-rose-600 px-2.5 py-1 rounded-lg transition-all uppercase cursor-pointer"
                                    title="Zerar saldo deste cartão"
                                  >
                                    Zerar
                                  </button>
                                )}
                              </div>
                            </TableCell>
                            
                            <TableCell className="px-4 py-4 whitespace-nowrap" onDoubleClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center gap-1.5 max-w-[210px]" onClick={(e) => e.stopPropagation()}>
                                <div className="relative flex-1">
                                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400">R$</span>
                                  <input 
                                    type="number"
                                    placeholder="0,00"
                                    className="w-full text-xs font-bold rounded-lg border border-slate-200 bg-white pl-7 pr-1 py-1.5 transition-all focus:border-blue-500 outline-none"
                                    value={rechargeAmounts[user.uid] || ''}
                                    onChange={(e) => setRechargeAmounts(prev => ({ ...prev, [user.uid]: e.target.value }))}
                                  />
                                </div>
                                <select
                                  className="text-[9px] font-black uppercase tracking-tight rounded-lg border border-slate-200 bg-white py-1.5 pl-1.5 pr-6 focus:border-blue-500 outline-none hover:bg-slate-50 transition-all shrink-0 cursor-pointer"
                                  value={rechargePaymentMethods[user.uid] || ''}
                                  onChange={(e) => setRechargePaymentMethods(prev => ({ ...prev, [user.uid]: e.target.value }))}
                                >
                                  <option value="">Selecionar...</option>
                                  <option value="Dinheiro">Dinheiro</option>
                                  <option value="Pix">PIX</option>
                                  <option value="Débito">Débito</option>
                                  <option value="Crédito">Crédito</option>
                                  <option value="Conta">Conta</option>
                                </select>
                                <Button 
                                  size="sm" 
                                  onClick={() => handleManualRecharge(user.uid)}
                                  className="bg-slate-900 hover:bg-blue-600 text-white rounded-lg px-2.5 h-8 font-black uppercase tracking-wider text-[9px] border-none shrink-0"
                                >
                                  OK
                                </Button>
                              </div>
                            </TableCell>
                            
                            <TableCell className="px-4 py-4" onDoubleClick={(e) => e.stopPropagation()}>
                              <div className="flex flex-wrap gap-1.5 max-w-[280px]" onClick={(e) => e.stopPropagation()}>
                                {stalls.map(s => {
                                  const isLinked = user.vendorIds?.includes(s.id);
                                  return (
                                    <label key={s.id} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase cursor-pointer transition-all border ${
                                      isLinked 
                                        ? 'bg-blue-50 text-blue-700 border-blue-200 shadow-sm font-extrabold' 
                                        : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'
                                    }`}>
                                      <input 
                                        type="checkbox"
                                        className="hidden"
                                        checked={!!isLinked}
                                        onChange={(e) => setUserVendorIds(user.uid, s.id, e.target.checked)}
                                      />
                                      {isLinked && <ShieldCheckIcon className="h-2.5 w-2.5 shrink-0" />}
                                      <span className="truncate max-w-[85px]">{s.name}</span>
                                    </label>
                                  );
                                })}
                                {stalls.length === 0 && <span className="text-[10px] text-slate-400 italic">Cadastre barracas primeiro.</span>}
                              </div>
                            </TableCell>
                            
                            <TableCell className="px-6 py-4 text-right whitespace-nowrap" onDoubleClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                                <button 
                                  onClick={() => setEditingUser(user)}
                                  className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                  title="Editar usuário"
                                >
                                  <Edit2 className="h-4 w-4" />
                                </button>
                                <button 
                                  onClick={() => handleDeleteUser(user.uid)}
                                  className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                                  title="Excluir usuário"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'clients' && (
          <div className="space-y-8 animate-in fade-in duration-500">
            <header className="flex flex-col md:flex-row md:items-end justify-between gap-8 pb-10 border-b border-slate-100">
              <div className="space-y-4">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-blue-600">
                  <Users className="h-3 w-3" />
                  <span className="text-[10px] font-black uppercase tracking-widest">Base de Funcionários</span>
                </div>
                <h2 className="text-4xl font-black text-slate-900 tracking-tighter flex items-center gap-4">
                  <div className="h-14 w-14 rounded-2xl bg-blue-600 flex items-center justify-center text-white shadow-2xl rotate-3 shrink-0">
                    <Users className="h-7 w-7" />
                  </div>
                  CADASTRO DE FUNCIONÁRIOS
                </h2>
                <p className="text-slate-500 text-lg font-medium max-w-xl leading-relaxed">
                  Gerencie o cadastro de seus colaboradores e vincule cartões físicos ou virtuais para liberação de consumo nas barracas.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button 
                  onClick={handleExportClientsSpreadsheet}
                  className="bg-white hover:bg-slate-50 text-slate-800 border border-slate-200 h-14 px-6 rounded-2xl font-black uppercase tracking-wider text-xs transition-all flex items-center gap-2 cursor-pointer"
                >
                  <Download className="h-5 w-5 text-blue-600" />
                  Baixar Planilha de Funcionários
                </Button>
                
                <div className="relative">
                  <input
                    type="file"
                    accept=".xlsx, .xls, .csv"
                    onChange={handleImportClientsSpreadsheet}
                    className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10"
                    id="clients-xlsx-uploader"
                  />
                  <Button 
                    className="bg-blue-600 hover:bg-blue-700 text-white h-14 px-6 rounded-2xl font-black uppercase tracking-wider text-xs transition-all flex items-center gap-2"
                  >
                    <Plus className="h-5 w-5" />
                    Importar Funcionários em Colunas
                  </Button>
                </div>
              </div>
            </header>

            {/* Cadastro Manual Card */}
            <section className="bg-white p-8 rounded-[32px] border border-slate-200 shadow-sm relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-8 opacity-5">
                <Users className="h-24 w-24 text-slate-900" />
              </div>
              <div className="relative z-10 flex flex-col gap-8">
                <div>
                  <h3 className="font-black text-slate-900 text-xl uppercase tracking-tighter">Cadastro Manual de Funcionários</h3>
                  <p className="text-slate-500 text-sm mt-1 max-w-md">Insira um novo funcionário para vinculação posterior de saldo ou cartão.</p>
                </div>

                <form onSubmit={handleAddClient} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Nome Completo</label>
                      <Input 
                        value={newClientName}
                        onChange={(e) => setNewClientName(e.target.value)}
                        placeholder="Ex: João Souza"
                        required
                        className="bg-slate-50 border-slate-200 h-14 focus-visible:ring-blue-500 rounded-2xl text-base font-medium px-4"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">E-mail do Google (Opcional)</label>
                      <Input 
                        type="email"
                        value={newClientEmail}
                        onChange={(e) => setNewClientEmail(e.target.value)}
                        placeholder="joao@gmail.com"
                        className="bg-slate-50 border-slate-200 h-14 focus-visible:ring-blue-500 rounded-2xl text-base font-medium px-4"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Código do Cartão / QR (Deixe Vazio p/ Vincular Depois)</label>
                      <Input 
                        value={newClientQrCode}
                        onChange={(e) => setNewClientQrCode(e.target.value)}
                        placeholder="Ex: 87654321"
                        className="bg-slate-50 border-slate-200 h-14 focus-visible:ring-blue-500 rounded-2xl text-base font-medium px-4"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Saldo Inicial (R$)</label>
                      <Input 
                        type="number"
                        step="0.01"
                        value={newClientBalance}
                        onChange={(e) => setNewClientBalance(e.target.value)}
                        placeholder="0.00"
                        className="bg-slate-50 border-slate-200 h-14 focus-visible:ring-blue-500 rounded-2xl text-base font-medium px-4"
                      />
                    </div>
                  </div>

                  <Button type="submit" className="w-full md:w-auto bg-slate-950 hover:bg-blue-600 text-white h-14 px-8 rounded-2xl font-black uppercase tracking-[0.2em] text-xs transition-all shadow-xl group/submit">
                    <Plus className="h-5 w-5 mr-2 group-hover/submit:rotate-90 transition-transform" /> 
                    Finalizar Cadastro
                  </Button>
                </form>
              </div>
            </section>

            {/* Lista de Clientes Card */}
            <div className="bg-white p-8 rounded-[32px] border border-slate-200 shadow-sm space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h3 className="font-black text-slate-900 text-xl uppercase tracking-tighter">Funcionários Cadastrados</h3>
                  <p className="text-slate-500 text-sm">Lista de colaboradores ativos aptos para vinculação de cartões.</p>
                </div>
                <div className="relative max-w-md w-full">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 h-5 w-5" />
                  <Input 
                    placeholder="Pesquisar funcionário..."
                    value={clientSearchQuery}
                    onChange={(e) => setClientSearchQuery(e.target.value)}
                    className="bg-slate-50 border-slate-200 h-12 pl-12 rounded-xl text-sm"
                  />
                </div>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-slate-100">
                <Table>
                  <TableHeader className="bg-slate-50">
                    <TableRow>
                      <TableHead className="font-black text-[10px] uppercase text-slate-600 tracking-wider">Nome do Funcionário</TableHead>
                      <TableHead className="font-black text-[10px] uppercase text-slate-600 tracking-wider">E-mail</TableHead>
                      <TableHead className="font-black text-[10px] uppercase text-slate-600 tracking-wider">Cartão Vinculado</TableHead>
                      <TableHead className="font-black text-[10px] uppercase text-slate-600 tracking-wider">Saldo em Conta</TableHead>
                      <TableHead className="font-black text-[10px] uppercase text-slate-600 tracking-wider text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.filter(u => u.role === 'student' && 
                      (u.isEmployee === true || u.email?.includes('modeloalpha.com.br')) &&
                      (!clientSearchQuery || 
                       u.name.toLowerCase().includes(clientSearchQuery.toLowerCase()) || 
                       (u.email && u.email.toLowerCase().includes(clientSearchQuery.toLowerCase())) || 
                       (u.qrCode && u.qrCode.toLowerCase().includes(clientSearchQuery.toLowerCase())))
                    ).length > 0 ? (
                      users.filter(u => u.role === 'student' && 
                        (u.isEmployee === true || u.email?.includes('modeloalpha.com.br')) &&
                        (!clientSearchQuery || 
                         u.name.toLowerCase().includes(clientSearchQuery.toLowerCase()) || 
                         (u.email && u.email.toLowerCase().includes(clientSearchQuery.toLowerCase())) || 
                         (u.qrCode && u.qrCode.toLowerCase().includes(clientSearchQuery.toLowerCase())))
                      ).map((user) => (
                        <TableRow key={user.uid} className="hover:bg-slate-50/55 transition-colors">
                          <TableCell className="font-black text-sm text-slate-900 uppercase">{user.name}</TableCell>
                          <TableCell className="text-xs text-slate-500 font-medium">{user.email || 'N/A'}</TableCell>
                          <TableCell>
                            {(!user.qrCode || user.qrCode.startsWith('PENDING-')) ? (
                              <div className="flex flex-col gap-1.5 py-1">
                                <span className="text-[10px] font-black text-amber-500 uppercase flex items-center gap-1">
                                  <AlertTriangle className="h-3.5 w-3.5" /> Sem Cartão
                                </span>
                                <div className="flex items-center gap-1.5">
                                  <Button
                                    size="sm"
                                    onClick={() => {
                                      setLinkingUser(user);
                                      setPhysicalCardInput('');
                                    }}
                                    className="h-8 bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200/40 rounded-xl px-2.5 text-[10px] font-black uppercase tracking-wider flex items-center gap-1 cursor-pointer transition-all shrink-0"
                                  >
                                    <CreditCard className="h-3.5 w-3.5" /> Físico
                                  </Button>
                                  <Button
                                    size="sm"
                                    onClick={() => handleLinkVirtualCard(user)}
                                    className="h-8 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 border border-indigo-200/40 rounded-xl px-2.5 text-[10px] font-black uppercase tracking-wider flex items-center gap-1 cursor-pointer transition-all shrink-0"
                                  >
                                    <Sparkles className="h-3.5 w-3.5" /> Virtual
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 py-1">
                                <div className="font-mono text-xs text-blue-600 font-bold bg-blue-55/85 px-3 py-1.5 rounded-xl border border-blue-100 flex items-center gap-2">
                                  <CreditCard className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                                  <span>{user.qrCode}</span>
                                  <button 
                                    onClick={() => handleUnlinkCard(user)} 
                                    title="Desvincular Cartão" 
                                    className="text-red-500 hover:text-red-700 font-black ml-1.5 text-sm cursor-pointer focus:outline-none transition-all hover:scale-120"
                                  >
                                    ✕
                                  </button>
                                </div>
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="font-black text-sm text-green-600">R$ {(user.balance || 0).toFixed(2)}</TableCell>
                          <TableCell className="text-right">
                            <Button 
                              variant="ghost" 
                              onClick={() => {
                                setDeleteConfirm({
                                  id: user.uid,
                                  type: 'user',
                                  action: async () => {
                                    try {
                                      await deleteDoc(doc(db, 'users', user.uid));
                                      toast.success('Funcionário removido!');
                                    } catch (error) {
                                      handleFirestoreError(error, OperationType.DELETE, `users/${user.uid}`);
                                    }
                                  }
                                });
                              }}
                              className="h-10 w-10 p-0 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-xl"
                            >
                              <Trash2 className="h-5 w-5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-sm text-slate-400 italic">
                          Nenhum funcionário cadastrado.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'transactions' && (
          <div className="space-y-8 animate-in fade-in duration-500">
            <header>
              <h2 className="text-3xl font-black text-slate-900 uppercase tracking-tight flex items-center gap-3">
                <FileText className="h-8 w-8 text-blue-600" />
                Histórico de Vendas
              </h2>
              <p className="text-slate-500 mt-1">Lista completa de transações financeiras registradas no sistema.</p>
            </header>

            <Card className="shadow-sm border-none bg-white rounded-3xl overflow-hidden">
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-slate-50">
                    <TableRow>
                      <TableHead className="font-bold text-slate-900 py-4 uppercase text-[10px] tracking-widest pl-8">Início / Data</TableHead>
                      <TableHead className="font-bold text-slate-900 py-4 uppercase text-[10px] tracking-widest">Cliente / ID</TableHead>
                      <TableHead className="font-bold text-slate-900 py-4 uppercase text-[10px] tracking-widest">Cartão / Código</TableHead>
                      <TableHead className="font-bold text-slate-900 py-4 uppercase text-[10px] tracking-widest text-right">Valor</TableHead>
                      <TableHead className="font-bold text-slate-900 py-4 uppercase text-[10px] tracking-widest text-center">Tipo</TableHead>
                      <TableHead className="font-bold text-slate-900 py-4 uppercase text-[10px] tracking-widest">Descrição</TableHead>
                      <TableHead className="font-bold text-slate-900 py-4 uppercase text-[10px] tracking-widest text-right pr-8">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactions.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-12 text-slate-400 italic">
                          Nenhuma transação encontrada.
                        </TableCell>
                      </TableRow>
                    ) : (
                      transactions.map((tx) => (
                        <TableRow key={tx.id} className="hover:bg-slate-50/50 border-slate-100">
                          <TableCell className="py-4 pl-8">
                            <div className="flex flex-col">
                              <span className="font-medium text-slate-900">
                                {tx.timestamp?.toDate ? tx.timestamp.toDate().toLocaleDateString('pt-BR') : 'Recent'}
                              </span>
                              <span className="text-[10px] text-slate-400 font-bold uppercase">
                                {tx.timestamp?.toDate ? tx.timestamp.toDate().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="py-4">
                            <div className="flex flex-col">
                              <span className="font-bold text-slate-700 text-xs truncate max-w-[150px]">
                                {users.find(u => u.uid === tx.userId)?.name || tx.userName || tx.userId}
                              </span>
                              <span className="text-[9px] text-slate-400 font-medium">#{tx.id.slice(0, 8)}</span>
                            </div>
                          </TableCell>
                          <TableCell className="py-4">
                            <span className="font-mono text-[11px] font-bold text-slate-700">
                              {formatCardNumber((tx as any).cardNumber || users.find(u => u.uid === tx.userId)?.qrCode || tx.userId || '')}
                            </span>
                          </TableCell>
                          <TableCell className="py-4 text-right">
                            <span className={`font-black tracking-tight ${tx.type === 'credit' ? 'text-emerald-500' : 'text-rose-500'}`}>
                              {tx.type === 'credit' ? '+' : '-'} R$ {tx.amount.toFixed(2)}
                            </span>
                          </TableCell>
                          <TableCell className="py-4 text-center">
                            <span className={`text-[10px] font-black uppercase px-3 py-1 rounded-full border ${
                              tx.type === 'credit' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-slate-100 text-slate-500 border-slate-200'
                            }`}>
                              {tx.type === 'credit' ? 'Recarga' : 'Gasto'}
                            </span>
                          </TableCell>
                          <TableCell className="py-4">
                            <span className="text-sm text-slate-600">{tx.description}</span>
                          </TableCell>
                          <TableCell className="py-4 text-right pr-8">
                            <div className="flex items-center justify-end gap-2">
                              <span className={`text-[10px] font-black uppercase px-3 py-1 rounded-full ${
                                tx.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 
                                tx.status === 'pending' ? 'bg-amber-100 text-amber-700' : 
                                'bg-rose-100 text-rose-700'
                              }`}>
                                {tx.status === 'completed' ? 'Pago' : tx.status === 'pending' ? 'Pendente' : 'Erro'}
                              </span>
                              {tx.type === 'credit' && tx.status === 'pending' && (
                                <Button
                                  size="sm"
                                  onClick={() => handleCompletePendingTransaction(tx.id)}
                                  className="h-7 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-2 text-[9px] font-black uppercase tracking-wider border-none scale-90"
                                >
                                  Baixar
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        )}
        {activeTab === 'card_printer' && (
          <div className="space-y-8 animate-in fade-in duration-500">
            {/* Hidden canvas elements to render all physical cards offline so we can convert them to images for the Excel export */}
            <div className="hidden" aria-hidden="true" style={{ display: 'none' }}>
              {users.filter(u => u.isPhysicalCard).map(card => (
                <QRCodeCanvas 
                  key={card.uid}
                  id={`canvas-qr-${card.uid}`}
                  value={card.qrCode || card.uid || ''}
                  size={120}
                  level="M"
                />
              ))}
            </div>

            <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-slate-200 pb-8">
              <div>
                <h2 className="text-3xl font-black text-slate-900 uppercase tracking-tight flex items-center gap-3">
                  <Printer className="h-8 w-8 text-blue-600" />
                  CARTÃO FÍSICO
                </h2>
                <p className="text-slate-500 mt-1">Gere cartões profissionais premium com QR Code e número de 16 dígitos.</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button 
                  onClick={downloadExcelWithQR} 
                  variant="outline"
                  className="bg-white border-emerald-200 hover:bg-emerald-50 text-emerald-700 font-bold rounded-xl h-11"
                  title="Exportar todos os cartões com imagens dos QR Codes para o Excel"
                >
                  <FileText className="h-4 w-4 mr-2 text-emerald-600" /> Baixar Excel
                </Button>
                <Button 
                  onClick={downloadSelectedQRCodes} 
                  variant="outline"
                  className="bg-white border-blue-200 hover:bg-blue-50 text-blue-700 font-bold rounded-xl h-11"
                  title="Baixar cada imagem do QR Code em lote individualmente"
                >
                  <Download className="h-4 w-4 mr-2 text-blue-600" /> Baixar QR Codes ({selectedPhysicalCards.length > 0 ? selectedPhysicalCards.length : filteredPhysicalCards.length})
                </Button>
                <Button 
                  onClick={handlePrint} 
                  variant="outline"
                  className="bg-white border-slate-200 text-slate-900 font-bold rounded-xl h-11"
                >
                  <Printer className="h-4 w-4 mr-2 text-slate-600" /> Imprimir Agora
                </Button>
                <Button 
                  onClick={() => setShowPrintView(!showPrintView)} 
                  className="bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl h-11"
                >
                  {showPrintView ? 'Editar Lote / Painel' : 'Visualização de Impressão'}
                </Button>
              </div>
            </header>

            <div className={showPrintView ? 'hidden' : 'block space-y-10'}>
              <section className="space-y-10">
                {/* 1. Designer and Builder grid */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <Card className="bg-slate-900 border-none rounded-3xl shadow-xl overflow-hidden p-8 flex flex-col justify-between">
                    <div className="space-y-6">
                      <div className="space-y-1">
                        <span className="text-xs font-black text-blue-400 uppercase tracking-widest block">PASSO 1</span>
                        <h3 className="text-white font-black text-xl uppercase tracking-tight">Criar Cartões em Lote</h3>
                        <p className="text-slate-400 text-sm">Gere cartões em massa instantaneamente. Cada um terá um número único de 16 dígitos.</p>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                          <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Qtd. de Cartões</label>
                          <Input 
                            type="number"
                            value={batchSize}
                            onChange={(e) => setBatchSize(parseInt(e.target.value) || 24)}
                            className="bg-slate-800 border-slate-700 text-white h-11 focus:ring-blue-500 rounded-xl"
                            min="1"
                            max="200"
                          />
                        </div>
                        <div className="space-y-4">
                          <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest block">Fundo de Imagem Customizada</label>
                          <div className="space-y-3">
                            <div className="flex items-center gap-3">
                              <input 
                                type="file" 
                                id="card-bg-upload"
                                className="hidden" 
                                accept="image/*"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) {
                                    const reader = new FileReader();
                                    reader.onloadend = () => {
                                      setCardBgUrl(reader.result as string);
                                      setCardGradient('custom-image');
                                    };
                                    reader.readAsDataURL(file);
                                  }
                                }}
                              />
                              <label 
                                htmlFor="card-bg-upload"
                                className="flex-1 flex items-center justify-center gap-2 bg-slate-800 border-2 border-dashed border-slate-700 text-slate-300 hover:text-white hover:border-blue-500 transition-all h-11 px-6 rounded-xl cursor-pointer text-xs font-bold"
                              >
                                <Store className="h-4 w-4 text-blue-400" /> Escolher Imagem
                              </label>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="p-4 bg-blue-500/10 rounded-2xl border border-blue-500/10 space-y-1.5 text-[10px] text-slate-300">
                        <p className="font-extrabold text-blue-400 uppercase tracking-wider">Por que 16 dígitos?</p>
                        <p className="leading-relaxed opacity-90">
                          Seus cartões físicos seguem exatamente o layout e segurança do cartão digital gerado pelo aluno/responsável na Área do Cliente. Ao ser impresso, você pode consultar o extrato, recarregar online, e ter uma conferência ágil no caixa.
                        </p>
                      </div>
                    </div>

                    <Button 
                      onClick={handleGenerateCards} 
                      disabled={isGenerating}
                      className="w-full bg-blue-600 hover:bg-blue-500 text-white h-12 mt-6 font-black uppercase tracking-widest disabled:opacity-50 rounded-xl transition-all shadow-lg shadow-blue-500/20"
                    >
                      {isGenerating ? <Loader2 className="h-5 w-5 animate-spin" /> : <><Plus className="h-4 w-4 mr-2" /> Gerar {batchSize} Novos Cartões</>}
                    </Button>
                  </Card>

                  {/* 2. Dynamic Studio Card Preview */}
                  <div className="flex flex-col justify-center items-center bg-slate-50/50 rounded-3xl border-2 border-dashed border-slate-200 p-8">
                    <div className="flex items-center gap-2 mb-4">
                       <Palette className="h-4 w-4 text-blue-600" />
                       <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Estúdio de Customização (Vertical)</p>
                    </div>
                    
                    <div 
                      className={`relative w-[225px] h-[360px] rounded-2xl shadow-2xl overflow-hidden border border-slate-200 transition-all duration-300 ${cardGradient === 'custom-image' ? '' : getCardBgStyle(cardGradient)}`}
                    >
                      {cardGradient === 'custom-image' && (
                        <>
                          <img src={cardBgUrl} alt="Background" className="absolute inset-0 w-full h-full object-cover" referrerPolicy="no-referrer" />
                          <div className="absolute inset-0 bg-black/40" />
                        </>
                      )}
                      
                      <div className="relative h-full p-5 flex flex-col justify-between text-white select-none text-center">
                        {/* Top: Card Header */}
                        <div className="space-y-1">
                          <div className="h-6 w-6 bg-white/10 backdrop-blur-sm rounded-lg border border-white/10 flex items-center justify-center mx-auto shadow-inner mb-1.5">
                            <Sparkles className="h-3.5 w-3.5 text-blue-400 animate-pulse" />
                          </div>
                          <span className="text-xs font-black tracking-widest uppercase text-white drop-shadow-sm block truncate max-w-full">
                            {cardTitleText.trim() || settings.siteName || "Festa Pass"}
                          </span>
                          <p className="text-[6px] text-white/70 font-black tracking-[0.25em] uppercase">
                            CARTÃO DE CONSUMO
                          </p>
                        </div>

                        {/* Middle: MUCH LARGER QR Code */}
                        <div className="flex flex-col items-center justify-center my-3">
                          <div className="bg-white p-3 rounded-2xl border border-white/10 shadow-xl transition-all duration-300 hover:scale-[1.03]">
                            <QRCodeSVG value="PREVIEW" size={105} level="H" />
                          </div>
                        </div>

                        {/* Bottom: Number & Bearer info (Validity removed) */}
                        <div className="space-y-3">
                          <div className="space-y-0.5">
                            <span className="text-[6px] font-black text-white/50 uppercase tracking-[0.25em] font-mono block">NÚMERO DO CARTÃO</span>
                            <span className="text-xs font-black tracking-[0.1em] font-mono text-slate-100 drop-shadow-md">
                              {formatCardNumber("PREVIEW-CARD-HASH-STB")}
                            </span>
                          </div>

                          <div className="border-t border-white/10 pt-2">
                            <span className="text-[6px] font-black text-white/50 uppercase tracking-[0.2em] block leading-none mb-0.5">Titular</span>
                            <span className="text-[11px] font-black uppercase tracking-tight text-white drop-shadow-sm block truncate">
                              PORTADOR #001
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-6 w-full max-w-[225px] space-y-4 bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
                      <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Tema Visual do Cartão</p>
                      
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { id: 'mystic-slate', label: 'Slate' },
                          { id: 'royal-gold', label: 'Gold' },
                          { id: 'aurora-emerald', label: 'Emerald' },
                          { id: 'cosmic-purple', label: 'Purple' },
                          { id: 'neon-sunset', label: 'Sunset' },
                          { id: 'custom-image', label: 'Foto' }
                        ].map(theme => (
                          <button 
                            key={theme.id}
                            onClick={() => setCardGradient(theme.id as any)}
                            className={`h-7 rounded-lg text-[9px] font-black uppercase transition-all flex items-center justify-center border ${cardGradient === theme.id ? 'bg-slate-900 text-white border-blue-500 shadow-sm' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'}`}
                          >
                            {theme.label}
                          </button>
                        ))}
                      </div>

                      <div className="space-y-1 pt-1">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">Título / Evento (Frente)</span>
                        <Input 
                          placeholder={settings.siteName || "Festa Pass"}
                          value={cardTitleText}
                          onChange={(e) => setCardTitleText(e.target.value)}
                          className="h-8 text-xs font-bold rounded-lg border-slate-200"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* 3. Cards Summary HUD Panels */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Cartões Ativos (Filters "all") */}
                  <div 
                    onClick={() => setPhysicalBalanceFilter('all')}
                    className={`p-6 rounded-2xl flex items-center gap-4 transition-all duration-300 border cursor-pointer select-none ${
                      physicalBalanceFilter === 'all' 
                        ? 'bg-blue-50/70 border-blue-500 ring-2 ring-blue-500/15 shadow-md shadow-blue-500/5 text-blue-900' 
                        : 'bg-slate-50 hover:bg-slate-100/80 border-slate-100 hover:border-slate-300'
                    }`}
                  >
                    <div className={`h-12 w-12 rounded-xl flex items-center justify-center transition-all ${
                      physicalBalanceFilter === 'all' ? 'bg-blue-600 text-white shadow-md' : 'bg-blue-100 text-blue-600'
                    }`}>
                      <CreditCard className="h-6 w-6" />
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest block leading-none mb-1">
                        Cartões Ativos {physicalBalanceFilter === 'all' && '●'}
                      </p>
                      <h4 className="text-2xl font-black text-slate-900 tracking-tight">{users.filter(u => u.isPhysicalCard).length}</h4>
                    </div>
                  </div>
                  
                  {/* Saldo Total Impresso (Filters "positive" - cards with balance > 0) */}
                  <div 
                    onClick={() => setPhysicalBalanceFilter('positive')}
                    className={`p-6 rounded-2xl flex items-center gap-4 transition-all duration-300 border cursor-pointer select-none ${
                      physicalBalanceFilter === 'positive' 
                        ? 'bg-emerald-50/70 border-emerald-500 ring-2 ring-emerald-500/15 shadow-md shadow-emerald-500/5 text-emerald-900' 
                        : 'bg-slate-50 hover:bg-slate-100/80 border-slate-100 hover:border-slate-300'
                    }`}
                  >
                    <div className={`h-12 w-12 rounded-xl flex items-center justify-center transition-all ${
                      physicalBalanceFilter === 'positive' ? 'bg-emerald-600 text-white shadow-md' : 'bg-emerald-100 text-emerald-600'
                    }`}>
                      <DollarSign className="h-6 w-6" />
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest block leading-none mb-1">
                        Saldo Total Impresso {physicalBalanceFilter === 'positive' && '●'}
                      </p>
                      <h4 className="text-2xl font-black text-slate-900 tracking-tight">
                        R$ {users.filter(u => u.isPhysicalCard).reduce((acc, u) => acc + (u.balance || 0), 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </h4>
                    </div>
                  </div>

                  {/* Com Saldo Ativo (Filters "positive") */}
                  <div 
                    onClick={() => setPhysicalBalanceFilter('positive')}
                    className={`p-6 rounded-2xl flex items-center gap-4 transition-all duration-300 border cursor-pointer select-none ${
                      physicalBalanceFilter === 'positive' 
                        ? 'bg-purple-50/70 border-purple-500 ring-2 ring-purple-500/15 shadow-md shadow-purple-500/5 text-purple-900' 
                        : 'bg-slate-50 hover:bg-slate-100/80 border-slate-100 hover:border-slate-300'
                    }`}
                  >
                    <div className={`h-12 w-12 rounded-xl flex items-center justify-center transition-all ${
                      physicalBalanceFilter === 'positive' ? 'bg-purple-600 text-white shadow-md' : 'bg-purple-100 text-purple-600'
                    }`}>
                      <Sparkles className="h-6 w-6" />
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest block leading-none mb-1">
                        Com Saldo Ativo {physicalBalanceFilter === 'positive' && '●'}
                      </p>
                      <h4 className="text-2xl font-black text-slate-900 tracking-tight">{users.filter(u => u.isPhysicalCard && u.balance > 0).length} cartões</h4>
                    </div>
                  </div>
                </div>

                {/* 4. Filter, Search, Management center */}
                <div className="space-y-6 animate-in fade-in duration-300">
                  <div className="bg-slate-55 border bg-white shadow-sm p-6 rounded-3xl border-slate-100 space-y-4">
                     <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                       <div>
                          <h3 className="text-base font-black text-slate-900 uppercase">Consultar Direitório de Cartões</h3>
                          <p className="text-xs text-slate-500">Busque por número, nome do portador ou código de barras</p>
                       </div>
                       
                       {/* Balance filter tabs */}
                       <div className="flex bg-slate-100 p-1 rounded-xl shrink-0 border border-slate-100">
                         <button 
                           onClick={() => setPhysicalBalanceFilter('all')}
                           className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${physicalBalanceFilter === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                         >
                           Todos
                         </button>
                         <button 
                           onClick={() => setPhysicalBalanceFilter('positive')}
                           className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${physicalBalanceFilter === 'positive' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                         >
                           Com Saldo
                         </button>
                         <button 
                           onClick={() => setPhysicalBalanceFilter('zero')}
                           className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${physicalBalanceFilter === 'zero' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                         >
                           Sem Saldo
                         </button>
                       </div>
                     </div>

                     {/* Search bar & Bulk actions */}
                     <div className="flex flex-col md:flex-row gap-4">
                       <div className="relative flex-1">
                          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                          <Input 
                            value={physicalSearchQuery}
                            onChange={(e) => setPhysicalSearchQuery(e.target.value)}
                            placeholder="Buscar por lote, ID, nome #000 ou dígitos do cartão..."
                            className="bg-white border-slate-200 pl-11 h-12 rounded-xl text-sm focus-visible:ring-blue-500 font-bold"
                          />
                          {physicalSearchQuery && (
                            <button 
                              onClick={() => setPhysicalSearchQuery('')}
                              className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-black text-slate-400 hover:text-slate-900"
                            >
                              LIMPAR
                            </button>
                          )}
                       </div>
                       
                       <div className="flex gap-2">
                         <Button
                           variant="outline"
                           onClick={() => toggleSelectAllPhysical(filteredPhysicalCards)}
                           className="bg-white border-slate-200 h-12 text-xs font-bold rounded-xl whitespace-nowrap"
                         >
                           {selectedPhysicalCards.length === filteredPhysicalCards.length ? 'Desmarcar Tudo' : 'Selecionar Tudo'}
                         </Button>
                         
                         {selectedPhysicalCards.length > 0 && (
                           <div className="flex gap-2 animate-in slide-in-from-right-3">
                             <Button
                               onClick={() => setShowBulkRechargeModal(true)}
                               className="bg-emerald-600 hover:bg-emerald-700 text-white h-12 text-sm font-black rounded-xl"
                             >
                               Recarregar ({selectedPhysicalCards.length})
                             </Button>
                             <Button
                               variant="destructive"
                               onClick={handleBulkDelete}
                               className="h-12 text-sm font-black rounded-xl"
                             >
                               Excluir ({selectedPhysicalCards.length})
                             </Button>
                           </div>
                         )}
                       </div>
                     </div>
                  </div>

                  {/* Dashboard Cards Grid */}
                  {filteredPhysicalCards.length === 0 ? (
                    <div className="text-center py-16 bg-slate-50 border-2 border-dashed border-slate-200 rounded-3xl space-y-3">
                      <CreditCard className="h-12 w-12 text-slate-300 mx-auto" />
                      <div>
                         <p className="text-sm font-black text-slate-700 uppercase">Nenhum Cartão Encontrado</p>
                         <p className="text-xs text-slate-500">Tente mudar sua busca ou o filtro de saldo</p>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                      {filteredPhysicalCards.sort((a, b) => (b.timestamp?.toMillis?.() || 0) - (a.timestamp?.toMillis?.() || 0)).slice(0, 100).map(card => {
                        const formattedNum = formatCardNumber(card.uid || card.qrCode || '');
                        const isSelected = selectedPhysicalCards.includes(card.uid);
                        const bgStyle = cardGradient === 'custom-image' ? '' : getCardBgStyle(cardGradient);
                        
                        return (
                          <div 
                            key={card.uid} 
                            onClick={() => toggleSelectCard(card.uid)}
                            className={`bg-white border-2 rounded-2xl shadow-sm overflow-hidden group/card relative transition-all duration-200 cursor-pointer flex flex-col justify-between ${isSelected ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-slate-100 hover:border-slate-300'}`}
                          >
                            {/* Visual Card Card area: VERTICAL proportion for dashboard list */}
                            <div className={`relative h-[280px] w-full overflow-hidden flex flex-col justify-between p-4 text-white ${bgStyle}`}>
                              {cardGradient === 'custom-image' && (
                                <>
                                  <img src={cardBgUrl} alt="Background" className="absolute inset-0 w-full h-full object-cover group-hover/card:scale-105 transition-transform duration-500 opacity-80" referrerPolicy="no-referrer" />
                                  <div className="absolute inset-0 bg-black/40" />
                                </>
                              )}
                              
                              <div className="flex justify-between items-start z-10" onClick={(e) => e.stopPropagation()}>
                                 <button 
                                   onClick={() => toggleSelectCard(card.uid)}
                                   className={`h-6 w-6 rounded-lg flex items-center justify-center transition-all ${isSelected ? 'bg-blue-600 text-white' : 'bg-black/35 text-white/50 hover:text-white border border-white/10'}`}
                                 >
                                    {isSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                                 </button>
                                 <span className="text-[7.5px] font-black tracking-widest uppercase bg-white/10 px-2 py-0.5 rounded-full border border-white/10 leading-none">
                                    {cardTitleText.trim() || settings.siteName || "Festa Pass"}
                                 </span>
                              </div>

                              {/* Center: LARGER QR Code */}
                              <div className="flex justify-center my-1.5 z-10">
                                <div className="bg-white p-2 rounded-xl shadow-md border border-white/10">
                                  <QRCodeSVG value={card.qrCode} size={85} level="M" />
                                </div>
                              </div>

                              {/* Card Number & Header details */}
                              <div className="space-y-2 z-10">
                                <div className="space-y-0.5 text-center">
                                  <span className="text-[5px] text-white/60 font-mono tracking-widest block font-extrabold leading-none">NÚMERO DO CARTÃO</span>
                                  <p className="text-[11px] font-black font-mono tracking-wider text-slate-100 drop-shadow">{formattedNum}</p>
                                </div>

                                <div className="border-t border-white/10 pt-1.5 flex justify-between items-end text-left leading-none">
                                  <div>
                                    <span className="text-[5px] font-extrabold text-white/50 uppercase tracking-widest leading-none block mb-0.5">Titular</span>
                                    <span className="text-[9.5px] font-black uppercase tracking-tight text-white drop-shadow block truncate max-w-[120px]">{card.name}</span>
                                  </div>
                                  <span className="text-[8px] font-bold text-slate-300 font-mono">{card.qrCode?.slice(-8)}</span>
                                </div>
                              </div>
                            </div>

                            {/* Info and interaction panel at the bottom */}
                            <div className="p-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                               <div className="text-left">
                                 <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider block leading-none mb-0.5">SALDO</span>
                                 <p className="text-xs font-black text-slate-900">
                                   R$ {card.balance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                 </p>
                               </div>
                               
                               <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                                  <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    onClick={() => {
                                      navigator.clipboard.writeText(formattedNum);
                                      toast.success('Número de 16 dígitos copiado!');
                                    }}
                                    className="h-7 w-7 text-slate-400 hover:text-slate-900"
                                    title="Copiar Número do Cartão"
                                  >
                                    <Copy className="h-3.5 w-3.5" />
                                  </Button>
                                  
                                  <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    onClick={() => {
                                      navigator.clipboard.writeText(card.qrCode);
                                      toast.success('Código QR copiado!');
                                    }}
                                    className="h-7 w-7 text-slate-400 hover:text-slate-900"
                                    title="Copiar Link QR"
                                  >
                                    <QrCode className="h-3.5 w-3.5" />
                                  </Button>

                                  <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    onClick={() => downloadSingleQRCode(card)}
                                    className="h-7 w-7 text-slate-400 hover:text-blue-600"
                                    title="Baixar Imagem do QR Code"
                                  >
                                    <Download className="h-3.5 w-3.5" />
                                  </Button>

                                  <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    onClick={() => handleZeroBalance(card.uid)}
                                    className="h-7 w-7 text-slate-400 hover:text-amber-650"
                                    title="Zerar Saldo"
                                  >
                                    <RefreshCw className="h-3.5 w-3.5" />
                                  </Button>
 
                                  <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    onClick={() => handleDeleteUser(card.uid)}
                                    className="h-7 w-7 text-slate-300 hover:text-red-500"
                                    title="Excluir Cartão"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                               </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>
            </div>

            <div className={showPrintView ? 'block' : 'print-only'}>
              <section className="bg-slate-100 p-8 md:p-12 rounded-3xl border border-slate-200 print-view-section">
                <div id="printable-cards" className="print:block">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-y-8 gap-x-8 justify-center items-center print:grid-cols-3 print:gap-x-4 print:gap-y-4">
                    {users.filter(u => u.isPhysicalCard).sort((a, b) => (b.timestamp?.toMillis?.() || 0) - (a.timestamp?.toMillis?.() || 0)).slice(0, batchSize).map(card => {
                      const formattedNum = formatCardNumber(card.uid || card.qrCode || '');
                      const bgStyle = cardGradient === 'custom-image' ? '' : getCardBgStyle(cardGradient);
                      
                      return (
                        <div 
                          key={card.uid} 
                          className={`relative print-card w-[53.98mm] h-[85.6mm] rounded-[12px] overflow-hidden bg-slate-900 border border-slate-700 mx-auto ${bgStyle}`}
                        >
                          {cardGradient === 'custom-image' && (
                            <>
                              <img src={cardBgUrl} alt="Background" className="absolute inset-0 w-full h-full object-cover" />
                              <div className="absolute inset-0 bg-black/45" />
                            </>
                          )}
                          <div className="relative h-full p-4 flex flex-col justify-between text-white select-none text-center">
                            {/* Top row site Name */}
                            <div className="space-y-0.5">
                              <span className="text-[9px] font-black tracking-widest uppercase text-white drop-shadow-sm leading-none block">
                                {cardTitleText.trim() || settings.siteName || "FESTA PASS"}
                              </span>
                              <span className="text-[55px] text-white/70 font-black tracking-[0.2em] uppercase mt-0.5 block leading-none" style={{fontSize: "5px"}}>
                                CARTÃO DE CONSUMO
                              </span>
                            </div>

                            {/* Center: MUCH LARGER QR Code */}
                            <div className="flex justify-center my-2">
                              <div className="bg-white p-2 rounded-xl shadow-lg border border-white/5">
                                <QRCodeSVG value={card.qrCode} size={110} level="H" />
                              </div>
                            </div>

                            {/* Spaced credit card code */}
                            <div className="space-y-2">
                              <div className="space-y-0.5">
                                <span className="text-[5px] text-white/50 font-black tracking-[0.2em] uppercase font-mono block">NÚMERO DO CARTÃO</span>
                                <p className="text-xs font-black tracking-[0.08em] font-mono leading-none text-slate-50">{formattedNum}</p>
                              </div>

                              {/* Bottom row Titular (Validity removed) */}
                              <div className="border-t border-white/10 pt-1.5 text-center">
                                 <p className="text-[5px] font-extrabold text-white/50 uppercase tracking-widest leading-none mb-0.5">Titular</p>
                                 <p className="text-[10px] font-black uppercase tracking-tight truncate text-white drop-shadow">{card.name}</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <style>{`
                    @media screen {
                      .print-only {
                        display: none !important;
                      }
                    }
                    
                    @media print {
                      @page {
                        size: A4 portrait;
                        margin: 8mm 10mm;
                      }
                      
                      .print-only {
                        display: block !important;
                      }
                      
                      /* Hide background elements to avoid blank spots at the top of page */
                      .fixed, 
                      [role="dialog"], 
                      .sonner, 
                      .toast,
                      header,
                      footer,
                      button,
                      [role="tablist"],
                      .no-print,
                      .print-hide {
                        display: none !important;
                      }

                      * {
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                        color-adjust: exact !important;
                      }

                      /* Reset all heights/scrolls/overflows so browser pagination triggers correctly */
                      html, body, #root, .min-h-screen, main, .max-w-6xl {
                        height: auto !important;
                        min-height: 0 !important;
                        max-height: none !important;
                        overflow: visible !important;
                        background: white !important;
                        visibility: visible !important;
                        padding: 0 !important;
                        margin: 0 !important;
                      }

                      .print-view-section {
                        background: transparent !important;
                        border: none !important;
                        padding: 0 !important;
                        margin: 0 !important;
                        box-shadow: none !important;
                      }

                      #printable-cards {
                        display: block !important;
                        width: 100% !important;
                        background: transparent !important;
                        padding: 0 !important;
                        margin: 0 !important;
                      }

                      #printable-cards .grid {
                        display: block !important;
                        text-align: center !important;
                        background: transparent !important;
                        padding: 0 !important;
                        margin: 0 !important;
                      }

                      .print-card {
                        break-inside: avoid !important;
                        page-break-inside: avoid !important;
                        width: 53.98mm !important;
                        height: 85.6mm !important;
                        margin: 2mm !important;
                        display: inline-block !important;
                        position: relative !important;
                        border: 0.1mm solid #ddd !important;
                        box-sizing: border-box !important;
                        background-color: #0f172a !important; /* Ensure dark cards render beautifully */
                      }

                      .print-card img {
                        display: block !important;
                        width: 100% !important;
                        height: 100% !important;
                        object-fit: cover !important;
                      }
                    }
                  `}</style>
                </div>
              </section>
            </div>
          </div>
        )}
        {activeTab === 'terminal' && (
            <div className="bg-slate-900 -m-8 min-h-screen p-8">
              <div className="mb-6 flex items-center justify-between border-b border-white/5 pb-6">
                <div className="flex items-center gap-4">
                  {!forcedTab && (
                    <Button 
                      variant="ghost" 
                      onClick={() => setActiveTab('overview')}
                      className="h-12 w-12 rounded-xl bg-white/5 text-white hover:bg-white/10"
                    >
                      <ArrowLeftRight className="h-5 w-5" />
                    </Button>
                  )}
                  <div>
                    <h2 className="text-2xl font-black text-white uppercase tracking-tighter">Terminal Integrado</h2>
                    <p className="text-slate-400 text-sm">Visão do vendedor/caixeiro em ambiente seguro</p>
                  </div>
                </div>
                <div className="px-3 py-1 bg-blue-600 text-white text-[10px] font-black rounded-full uppercase tracking-widest">Simulação Ativa</div>
              </div>
              <VendorDashboard 
                profile={profile} 
                externalCart={sharedCart}
                setExternalCart={setSharedCart}
                externalScannedUser={sharedScannedUser}
                setExternalScannedUser={setSharedScannedUser}
              />
            </div>
          )}

          {activeTab === 'recharge_pos' && (
            <div className="bg-slate-900 -m-8 min-h-screen p-8">
              <div className="mb-6 flex items-center justify-between border-b border-white/5 pb-6">
                <div className="flex items-center gap-4">
                  {!forcedTab && (
                    <Button 
                      variant="ghost" 
                      onClick={() => setActiveTab('overview')}
                      className="h-12 w-12 rounded-xl bg-white/5 text-white hover:bg-white/10"
                    >
                      <ArrowLeftRight className="h-5 w-5" />
                    </Button>
                  )}
                  <div>
                    <h2 className="text-2xl font-black text-white uppercase tracking-tighter">Carga e Recarga</h2>
                    <p className="text-slate-400 text-sm">Adicione créditos aos cartões dos clientes via QR Code</p>
                  </div>
                </div>
                <div className="px-3 py-1 bg-green-600 text-white text-[10px] font-black rounded-full uppercase tracking-widest">Caixa Aberto</div>
              </div>
              <RechargePortal 
                externalScannedUser={sharedScannedUser}
                setExternalScannedUser={setSharedScannedUser}
                onSuccess={() => setSharedCart([])}
                users={users}
                products={products}
                stalls={stalls}
              />
            </div>
          )}

          {activeTab === 'reports' && (
            <ReportsPortal 
              stalls={stalls}
              products={products}
              users={users}
              transactions={transactions}
              withdrawals={withdrawals}
              consumption={recentSales}
            />
          )}

          {activeTab === 'settings' && (
            <div className="space-y-8 animate-in fade-in duration-500">
              <header className="flex flex-col md:flex-row md:items-end justify-between gap-8 pb-10 border-b border-slate-100">
                <div className="space-y-4">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-600">
                    <SettingsIcon className="h-3 w-3" />
                    <span className="text-[10px] font-black uppercase tracking-widest">Configurações Globais</span>
                  </div>
                  <h2 className="text-4xl font-black text-slate-900 tracking-tighter flex items-center gap-4">
                    <div className="h-14 w-14 rounded-2xl bg-slate-950 flex items-center justify-center text-white shadow-2xl -rotate-3 shrink-0">
                      <SettingsIcon className="h-7 w-7" />
                    </div>
                    SISTEMA & GATEWAY
                  </h2>
                  <p className="text-slate-500 text-lg font-medium max-w-xl leading-relaxed">
                    Configure as chaves do gateway de pagamento, dados de contato e preferências do sistema.
                  </p>
                </div>
              </header>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-white p-8 rounded-[32px] border border-slate-200 shadow-sm space-y-8">
                   <div>
                     <h3 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2 mb-6">
                       <FileText className="h-5 w-5 text-blue-600" />
                       DADOS DO EVENTO
                     </h3>
                     <div className="grid grid-cols-1 gap-6">
                        <div className="space-y-2">
                          <Label className="text-[10px] uppercase font-black tracking-widest text-slate-400 ml-1">Nome da Plataforma</Label>
                          <Input 
                            value={settings.siteName}
                            onChange={(e) => setSettings({ ...settings, siteName: e.target.value })}
                            className="bg-slate-50 border-slate-200 h-14 rounded-2xl font-medium"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-[10px] uppercase font-black tracking-widest text-slate-400 ml-1">Email de Suporte</Label>
                          <Input 
                            value={settings.contactEmail}
                            onChange={(e) => setSettings({ ...settings, contactEmail: e.target.value })}
                            className="bg-slate-50 border-slate-200 h-14 rounded-2xl font-medium"
                          />
                        </div>
                     </div>
                   </div>

                   <Button 
                    onClick={handleSaveSettings}
                    className="w-full bg-slate-950 hover:bg-blue-600 text-white h-16 rounded-[24px] font-black uppercase tracking-[0.2em] text-xs transition-all shadow-xl group/save"
                   >
                     Salvar Configurações
                   </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Edit User Dialog */}
      <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
        <DialogContent className="sm:max-w-[600px] rounded-[40px] p-0 overflow-hidden border-none shadow-2xl">
          {editingUser && (
            <div className="max-h-[90vh] overflow-y-auto custom-scrollbar">
              <div className="bg-slate-950 p-8 text-white relative">
                <div className="absolute top-0 right-0 p-8 opacity-10">
                  <Edit2 className="h-32 w-32" />
                </div>
                <div className="relative z-10 flex items-center gap-6">
                  <div className="h-16 w-16 rounded-2xl bg-blue-600 flex items-center justify-center text-white font-black text-2xl border border-blue-400 uppercase">
                    {editingUser.name.charAt(0)}
                  </div>
                  <div>
                    <h2 className="text-2xl font-black uppercase tracking-tight">{editingUser.name}</h2>
                    <p className="text-slate-400 text-xs font-bold uppercase tracking-[0.2em]">{editingUser.email}</p>
                  </div>
                </div>
              </div>

              <div className="p-8 space-y-8 bg-white">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2 col-span-1 md:col-span-2">
                    <Label className="text-[10px] uppercase font-black tracking-widest text-slate-400 ml-1">Nome Completo</Label>
                    <Input 
                      value={editingUser.name}
                      onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })}
                      className="bg-slate-50 border-slate-200 h-14 rounded-2xl font-medium"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[10px] uppercase font-black tracking-widest text-slate-400 ml-1">E-mail de Acesso</Label>
                    <Input 
                      value={editingUser.email}
                      onChange={(e) => setEditingUser({ ...editingUser, email: e.target.value.toLowerCase() })}
                      className="bg-slate-50 border-slate-200 h-14 rounded-2xl font-medium"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[10px] uppercase font-black tracking-widest text-slate-400 ml-1">QR Code / Cartão</Label>
                    <Input 
                      value={editingUser.qrCode}
                      onChange={(e) => setEditingUser({ ...editingUser, qrCode: e.target.value })}
                      className="bg-slate-50 border-slate-200 h-14 rounded-2xl font-mono"
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <Label className="text-[10px] uppercase font-black tracking-widest text-slate-400 ml-1">Função no Sistema</Label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { id: 'student', label: 'Cliente', icon: UserIcon },
                      { id: 'vendor', label: 'Vendedor', icon: ShoppingCart },
                      { id: 'recharge', label: 'Recarga', icon: CreditCard },
                      { id: 'admin', label: 'Admin', icon: ShieldCheckIcon },
                    ].map((role) => (
                      <button
                        key={role.id}
                        type="button"
                        onClick={() => {
                          const newRole = role.id as UserRole;
                          setEditingUser({ 
                            ...editingUser, 
                            role: newRole,
                            // Clear vendorIds if not vendor, but user might want to keep them just in case
                            // Let's decide based on UX: if they switch to student, they usually don't need vendorIds
                          });
                        }}
                        className={`flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all gap-2 ${
                          editingUser.role === role.id 
                            ? 'border-blue-600 bg-blue-50 text-blue-600' 
                            : 'border-slate-100 hover:border-slate-200 text-slate-500'
                        }`}
                      >
                        <role.icon className="h-5 w-5" />
                        <span className="text-[9px] font-black uppercase tracking-tight">{role.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {editingUser.role === 'vendor' && (
                  <div className="space-y-4 pt-4 border-t border-slate-100">
                    <Label className="text-[10px] uppercase font-black tracking-widest text-slate-400 ml-1">Atribuir Barracas</Label>
                    <div className="flex flex-wrap gap-2">
                      {stalls.map(stall => {
                        const isAssigned = editingUser.vendorIds?.includes(stall.id);
                        return (
                          <button
                            key={stall.id}
                            type="button"
                            onClick={() => {
                              const currentIds = editingUser.vendorIds || [];
                              const newIds = isAssigned 
                                ? currentIds.filter(id => id !== stall.id)
                                : [...currentIds, stall.id];
                              setEditingUser({ ...editingUser, vendorIds: newIds });
                            }}
                            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${
                              isAssigned 
                                ? 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-500/20' 
                                : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300'
                            }`}
                          >
                            {stall.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="pt-6 flex flex-col sm:flex-row gap-3">
                  <Button 
                    variant="ghost" 
                    onClick={() => handleDeleteUser(editingUser.uid)}
                    className="h-14 rounded-2xl text-red-600 hover:bg-red-50 font-bold text-xs uppercase tracking-widest px-6"
                  >
                    Excluir Usuário
                  </Button>
                  <div className="flex-1 flex gap-3">
                    <Button 
                      variant="outline" 
                      onClick={() => setEditingUser(null)}
                      className="flex-1 h-14 rounded-2xl border-slate-200 font-bold text-xs uppercase tracking-widest"
                    >
                      Cancelar
                    </Button>
                    <Button 
                      onClick={async () => {
                        if (!editingUser) return;
                        try {
                          const { uid, ...updateData } = editingUser;
                          await updateDoc(doc(db, 'users', uid), {
                            ...updateData,
                            _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
                          });
                          toast.success('Perfil atualizado com sucesso!');
                          setEditingUser(null);
                        } catch (err) {
                          toast.error('Erro ao atualizar perfil');
                          console.error(err);
                        }
                      }}
                      className="flex-1 h-14 rounded-2xl bg-slate-900 text-white font-black text-xs uppercase tracking-widest hover:bg-blue-600 shadow-xl"
                    >
                      Salvar
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingUser && false} onOpenChange={() => {}}> {/* Placeholder for safety */}
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <DialogContent className="rounded-[40px] border-none shadow-2xl p-0 max-w-sm overflow-hidden bg-white">
          <AnimatePresence mode="wait">
            {deleteConfirm && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 1.05, y: -10 }}
                className="w-full"
              >
                <div className="bg-red-50 p-10 flex flex-col items-center justify-center">
                  <motion.div
                    initial={{ scale: 0, rotate: -180 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: 'spring', stiffness: 200, damping: 15 }}
                    className="h-20 w-20 rounded-3xl bg-red-500 text-white flex items-center justify-center shadow-xl shadow-red-500/30 mb-6"
                  >
                    <Trash2 className="h-10 w-10" strokeWidth={2.5} />
                  </motion.div>
                  <DialogHeader className="space-y-2">
                    <DialogTitle className="text-2xl font-black text-center text-red-950 uppercase tracking-tighter">
                      Confirmar Exclusão
                    </DialogTitle>
                    <p className="text-center text-[10px] font-black uppercase tracking-[0.2em] text-red-500/60">
                      Ação Irreversível • Cuidado
                    </p>
                  </DialogHeader>
                </div>

                <div className="p-10 space-y-8">
                  <div className="text-center space-y-4">
                    <p className="text-slate-600 font-medium text-lg leading-relaxed">
                      Tem certeza que deseja remover este <span className="font-black text-slate-900 border-b-2 border-red-200">
                        {deleteConfirm?.type === 'stall' ? 'ponto de venda' : deleteConfirm?.type === 'product' ? 'produto' : 'usuário'}
                      </span>?
                    </p>
                    <p className="text-xs text-slate-400 font-bold uppercase tracking-widest bg-slate-50 py-2 rounded-xl">
                      {deleteConfirm?.id}
                    </p>
                  </div>

                  <div className="flex flex-col gap-3">
                    <Button 
                      onClick={() => {
                        deleteConfirm?.action();
                        setDeleteConfirm(null);
                      }}
                      className="w-full h-16 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-black uppercase tracking-[0.2em] text-xs shadow-xl shadow-red-600/20 active:scale-95 transition-all"
                    >
                      Sim, Confirmar Exclusão
                    </Button>
                    <Button 
                      variant="ghost" 
                      onClick={() => setDeleteConfirm(null)}
                      className="w-full h-14 rounded-2xl font-black uppercase tracking-[0.2em] text-[10px] text-slate-400 hover:text-slate-900 hover:bg-slate-50 transition-all"
                    >
                      Não, Manter Registro
                    </Button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </DialogContent>
      </Dialog>

      {/* Linking Physical Card Dialog */}
      <Dialog open={!!linkingUser} onOpenChange={(open) => {
        if (!open) {
          setLinkingUser(null);
          setPhysicalCardInput('');
        }
      }}>
        <DialogContent className="max-w-md bg-white p-8 rounded-3xl border border-slate-100 shadow-2xl">
          <DialogHeader className="text-left space-y-2">
            <div className="h-12 w-12 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center mb-2">
              <CreditCard className="h-6 w-6" />
            </div>
            <DialogTitle className="text-xl font-black text-slate-900 uppercase tracking-tight">Vincular Cartão Físico</DialogTitle>
            <DialogDescription className="text-sm text-slate-500">
              Aproxime o cartão do leitor ou digite o código/número para o funcionário <span className="font-extrabold text-slate-900 uppercase">{linkingUser?.name}</span>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Código do Cartão / QR Code</label>
              <Input 
                autoFocus
                value={physicalCardInput}
                onChange={(e) => setPhysicalCardInput(e.target.value)}
                placeholder="Ex: 1048293 ou passe no leitor"
                className="bg-slate-50 border-slate-200 h-14 focus-visible:ring-blue-500 rounded-2xl text-base font-semibold px-4"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSavePhysicalCard();
                  }
                }}
              />
            </div>
          </div>

          <DialogFooter className="flex gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setLinkingUser(null);
                setPhysicalCardInput('');
              }}
              className="rounded-xl h-12"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSavePhysicalCard}
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl h-12 px-6 font-bold"
            >
              Confirmar Vínculo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Balance Reset Confirmation Dialog */}
      <Dialog open={!!resetConfirm} onOpenChange={(open) => !open && setResetConfirm(null)}>
        <DialogContent className="rounded-[40px] border-none shadow-2xl p-0 max-w-sm overflow-hidden bg-white">
          <AnimatePresence mode="wait">
            {resetConfirm && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 1.05, y: -10 }}
                className="w-full"
              >
                <div className="bg-amber-50 p-10 flex flex-col items-center justify-center">
                  <motion.div
                    initial={{ scale: 0, rotate: -180 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: 'spring', stiffness: 200, damping: 15 }}
                    className="h-20 w-20 rounded-3xl bg-amber-500 text-white flex items-center justify-center shadow-xl shadow-amber-500/30 mb-6"
                  >
                    <RefreshCw className="h-10 w-10 animate-spin-slow" strokeWidth={2.5} />
                  </motion.div>
                  <DialogHeader className="space-y-2">
                    <DialogTitle className="text-2xl font-black text-center text-amber-950 uppercase tracking-tighter">
                      Zerar Saldo
                    </DialogTitle>
                    <p className="text-center text-[10px] font-black uppercase tracking-[0.2em] text-amber-600/80">
                      Esta Ação Irá Zerar o Saldo
                    </p>
                  </DialogHeader>
                </div>

                <div className="p-10 space-y-8">
                  <div className="text-center space-y-4">
                    <p className="text-slate-600 font-medium text-lg leading-relaxed">
                      Tem certeza que deseja zerar o saldo de <span className="font-black text-slate-900 border-b-2 border-amber-200">{resetConfirm?.name}</span>?
                    </p>
                    <div className="bg-amber-50/50 p-4 rounded-2xl border border-amber-100 flex flex-col items-center justify-center">
                      <span className="text-[10px] font-black uppercase text-amber-700 tracking-wider">Saldo Atual a ser Perdido</span>
                      <span className="text-2xl font-black text-slate-900 mt-1">R$ {resetConfirm?.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3">
                    <Button 
                      onClick={() => {
                        resetConfirm?.action();
                        setResetConfirm(null);
                      }}
                      className="w-full h-16 bg-amber-600 hover:bg-amber-700 text-white rounded-2xl font-black uppercase tracking-[0.2em] text-xs shadow-xl shadow-amber-600/20 active:scale-95 transition-all"
                    >
                      Sim, Zerar Saldo
                    </Button>
                    <Button 
                      variant="ghost" 
                      onClick={() => setResetConfirm(null)}
                      className="w-full h-14 rounded-2xl font-black uppercase tracking-[0.2em] text-[10px] text-slate-400 hover:text-slate-900 hover:bg-slate-50 transition-all"
                    >
                      Não, Manter Saldo
                    </Button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </DialogContent>
      </Dialog>

      <Dialog open={showBulkEditModal} onOpenChange={setShowBulkEditModal}>
        <DialogContent className="max-w-md bg-white p-8 rounded-3xl border border-slate-100 shadow-2xl">
          <DialogHeader className="text-left space-y-2">
            <div className="h-12 w-12 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center mb-2">
              <Edit2 className="h-6 w-6" />
            </div>
            <DialogTitle className="text-xl font-black text-slate-900 uppercase tracking-tight">Editar em Lote</DialogTitle>
            <DialogDescription className="text-sm text-slate-500">
              Aplicando alterações simultâneas para <span className="font-extrabold text-slate-900">{selectedUsers.length} usuários</span> selecionados.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {bulkEditActionType === 'role' && (
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest leading-none">Alterar Função para</label>
                <select
                  value={bulkEditRole}
                  onChange={(e) => setBulkEditRole(e.target.value as UserRole)}
                  className="w-full text-sm font-semibold rounded-xl border border-slate-200 bg-white p-3 focus:border-blue-500 outline-none hover:bg-slate-50 transition-all cursor-pointer"
                >
                  <option value="">Selecione a Função...</option>
                  <option value="student">Cliente</option>
                  <option value="vendor">Vendedor</option>
                  <option value="recharge">Recarga</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            )}

            {bulkEditActionType === 'recharge' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Valor da Recarga (R$)</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-black text-slate-400">R$</span>
                    <Input 
                      type="number"
                      value={bulkEditRecharge}
                      onChange={(e) => setBulkEditRecharge(e.target.value)}
                      placeholder="0.00"
                      className="pl-10 h-14 text-lg font-black rounded-xl border-slate-200 focus-visible:ring-blue-500"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Forma de Pagamento</label>
                  <select
                    value={bulkEditPaymentMethod}
                    onChange={(e) => setBulkEditPaymentMethod(e.target.value)}
                    className="w-full text-sm font-semibold rounded-xl border border-slate-200 bg-white p-3 focus:border-blue-500 outline-none hover:bg-slate-50 transition-all cursor-pointer"
                  >
                    <option value="Dinheiro">Dinheiro</option>
                    <option value="Pix">PIX</option>
                    <option value="Débito">Débito</option>
                    <option value="Crédito">Crédito</option>
                    <option value="Conta">Conta</option>
                  </select>
                </div>
              </div>
            )}

            {bulkEditActionType === 'stalls' && (
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Vincular às Barracas Selecionadas</label>
                <div className="flex flex-wrap gap-2 pt-2">
                  {stalls.map(stall => {
                    const isLinked = bulkEditStalls.includes(stall.id);
                    return (
                      <button
                        key={stall.id}
                        type="button"
                        onClick={() => {
                          setBulkEditStalls(prev => 
                            isLinked ? prev.filter(id => id !== stall.id) : [...prev, stall.id]
                          );
                        }}
                        className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${
                          isLinked 
                            ? 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-500/20' 
                            : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                        }`}
                      >
                        {stall.name}
                      </button>
                    );
                  })}
                  {stalls.length === 0 && (
                    <p className="text-xs text-slate-400 italic">Nenhuma barraca cadastrada ainda.</p>
                  )}
                </div>
              </div>
            )}

            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-1.5 text-xs text-slate-500 leading-relaxed font-semibold">
              <p className="font-extrabold text-slate-800 uppercase tracking-wider text-[10px]">Aviso de Operação:</p>
              <p>Esta operação modificará as propriedades de múltiplos registros em massa no banco de dados e não pode ser revertida de forma simples.</p>
            </div>
          </div>

          <DialogFooter className="flex flex-col gap-2 pt-2 sm:flex-col">
            <Button
              onClick={() => handleBulkEditAction()}
              className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white font-extrabold uppercase tracking-widest text-xs rounded-xl"
            >
              Aplicar Alterações em Lote
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setShowBulkEditModal(false);
                setBulkEditActionType(null);
              }}
              className="w-full h-11 text-xs font-bold text-slate-500 hover:text-slate-900 rounded-xl"
            >
              Cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showBulkRechargeModal} onOpenChange={setShowBulkRechargeModal}>
        <DialogContent className="max-w-md bg-white p-8 rounded-3xl border border-slate-100 shadow-2xl">
          <DialogHeader className="text-left space-y-2">
            <div className="h-12 w-12 bg-emerald-100 rounded-2xl flex items-center justify-center text-emerald-600 mb-2">
              <DollarSign className="h-6 w-6" />
            </div>
            <DialogTitle className="text-xl font-black text-slate-900 uppercase tracking-tight">Recarga em Lote</DialogTitle>
            <DialogDescription className="text-sm text-slate-500">
              Isso adicionará o saldo especificado abaixo a todos os <span className="font-extrabold text-slate-900">{selectedPhysicalCards.length} cartões físicos selecionados</span>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Valor da Recarga (R$)</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-black text-slate-400">R$</span>
                <Input 
                  type="number"
                  value={bulkRechargeAmount || ''}
                  onChange={(e) => setBulkRechargeAmount(parseFloat(e.target.value) || 0)}
                  placeholder="0.00"
                  className="pl-10 h-14 text-lg font-black rounded-xl border-slate-200 focus-visible:ring-emerald-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-4 gap-2">
              {[10, 20, 50, 100].map(amt => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setBulkRechargeAmount(amt)}
                  className="h-10 text-xs font-black rounded-lg border border-slate-200 hover:bg-slate-50 active:bg-slate-100 transition-all text-slate-700"
                >
                  + R$ {amt}
                </button>
              ))}
            </div>

            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-1.5 text-xs text-slate-500 leading-relaxed font-semibold">
              <p className="font-extrabold text-slate-800 uppercase tracking-wider text-[10px]">Aviso de Operação:</p>
              <p>As recargas geram transações individuais de crédito para cada um dos portadores dos cartões. Esta ação não poderá ser desfeita automaticamente.</p>
            </div>
          </div>

          <DialogFooter className="flex flex-col gap-2 pt-2 sm:flex-col">
            <Button
              onClick={handleBulkRecharge}
              disabled={bulkRechargeProcessing || bulkRechargeAmount <= 0}
              className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold uppercase tracking-widest text-xs rounded-xl disabled:opacity-50"
            >
              {bulkRechargeProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : `Confirmar R$ ${(bulkRechargeAmount).toFixed(2)} em Lote`}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setShowBulkRechargeModal(false);
                setBulkRechargeAmount(0);
              }}
              className="w-full h-11 text-xs font-bold text-slate-500 hover:text-slate-900 rounded-xl"
            >
              Cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ShieldCheck({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function RechargePortal({ 
  externalScannedUser, 
  setExternalScannedUser,
  onSuccess,
  users = [],
  products = [],
  stalls = []
}: { 
  externalScannedUser?: UserProfile | null, 
  setExternalScannedUser?: React.Dispatch<React.SetStateAction<UserProfile | null>>,
  onSuccess?: () => void,
  users?: UserProfile[],
  products?: Product[],
  stalls?: Stall[]
}) {
  const [internalScannedUser, setInternalScannedUser] = useState<UserProfile | null>(null);
  const baseScannedUser = externalScannedUser !== undefined ? externalScannedUser : internalScannedUser;
  // Get the absolute latest, live synchronized user data from local active user base
  const scannedUser = useMemo(() => {
    if (!baseScannedUser) return null;
    const live = users.find(u => u.uid === baseScannedUser.uid);
    return live ? live : baseScannedUser;
  }, [baseScannedUser, users]);
  const setScannedUser = setExternalScannedUser !== undefined ? setExternalScannedUser : setInternalScannedUser;

  const [isScanning, setIsScanning] = useState(false);
  const [amount, setAmount] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<string>('');
  const [processing, setProcessing] = useState(false);

  // States for extra products checkout integrated into recharge
  const [extraQuantities, setExtraQuantities] = useState<{[productId: string]: number}>({});

  const extrasStallObj = useMemo(() => {
    return stalls.find(s => s.name?.toLowerCase().includes('extra'));
  }, [stalls]);

  const extrasProducts = useMemo(() => {
    if (!products) return [];
    if (extrasStallObj) {
      return products.filter(p => p.active !== false && p.vendorId === extrasStallObj.id);
    }
    // Fallback: list products with "extra", "cartão", "pulseira" keywords
    return products.filter(p => 
      p.active !== false && 
      (p.category?.toLowerCase().includes('extra') || 
       p.name?.toLowerCase().includes('cartão') || 
       p.name?.toLowerCase().includes('pulseira') ||
       p.name?.toLowerCase().includes('crachá'))
    );
  }, [products, extrasStallObj]);

  const extraItemsTotal = useMemo(() => {
    let sum = 0;
    Object.keys(extraQuantities).forEach(prodId => {
      const qty = extraQuantities[prodId];
      if (qty && qty > 0) {
        const p = products.find(prod => prod.id === prodId);
        if (p) {
          sum += p.price * qty;
        }
      }
    });
    return sum;
  }, [extraQuantities, products]);
  
  // Custom calculator states
  const [rechargeSearchQuery, setRechargeSearchQuery] = useState('');
  
  const filteredRechargeUsers = useMemo(() => {
    if (!rechargeSearchQuery.trim()) return [];
    const qLower = rechargeSearchQuery.toLowerCase();
    return users.filter(u => 
      u.role === 'student' && 
      (u.name.toLowerCase().includes(qLower) || 
       (u.email && u.email.toLowerCase().includes(qLower)) || 
       (u.qrCode && u.qrCode.toLowerCase().includes(qLower)))
    );
  }, [users, rechargeSearchQuery]);

  const [showCalcModal, setShowCalcModal] = useState(false);
  const [calcSearch, setCalcSearch] = useState('');
  const [calcQuantities, setCalcQuantities] = useState<{[productId: string]: number}>({});

  const calcTotal = useMemo(() => {
    let sum = 0;
    Object.entries(calcQuantities).forEach(([prodId, qty]) => {
      const p = products.find(prod => prod.id === prodId);
      const qtyNum = qty as number;
      if (p && qtyNum > 0) {
        sum += p.price * qtyNum;
      }
    });
    return sum;
  }, [calcQuantities, products]);

  const groupedProducts = useMemo(() => {
    const activeProducts = products.filter(p => p.active !== false);
    const searchLower = calcSearch.toLowerCase().trim();
    const filtered = searchLower
      ? activeProducts.filter(p => p.name.toLowerCase().includes(searchLower) || (p.category && p.category.toLowerCase().includes(searchLower)))
      : activeProducts;

    const groups: { [stallId: string]: { stallName: string; items: Product[] } } = {};

    filtered.forEach(p => {
      const stallId = p.vendorId || 'other';
      if (!groups[stallId]) {
        const stallObj = stalls.find(s => s.id === stallId);
        groups[stallId] = {
          stallName: stallObj ? stallObj.name : 'Outros',
          items: []
        };
      }
      groups[stallId].items.push(p);
    });

    return groups;
  }, [products, stalls, calcSearch]);

  const handleApplyCalc = () => {
    setAmount(calcTotal.toFixed(2));
    setShowCalcModal(false);
  };

  const handleClearCalc = () => {
    setCalcQuantities({});
  };
  const [statusModal, setStatusModal] = useState<{
    show: boolean;
    type: 'success' | 'error' | 'info';
    title: string;
    message: string;
  }>({
    show: false,
    type: 'info',
    title: '',
    message: ''
  });

  const onScanSuccess = async (decodedText: string) => {
    try {
      const cleanText = decodedText.trim();
      if (!cleanText) return;

      // 1. Instant Local Memory Search (0ms response)
      const foundLocal = users.find(u => 
        u.qrCode === cleanText || 
        (u.linkedCards && u.linkedCards.includes(cleanText))
      );

      if (foundLocal) {
        const resolvedLocal = { ...foundLocal, scannedCardCode: cleanText };
        setScannedUser(resolvedLocal);
        setIsScanning(false);
        setStatusModal({
          show: true,
          type: 'success',
          title: 'Cliente Identificado',
          message: `Cliente: ${foundLocal.name}\nCartão: ${cleanText}\n\nO cartão foi validado com sucesso.\nSaldo Atual: R$ ${foundLocal.balance.toFixed(2)}`
        });
        return;
      }

      // 2. Fast parallel query fallback if not in current local state
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
      
      const snap = (snapMain && !snapMain.empty) ? snapMain : (snapCards || { empty: true });
 
      if (!snap.empty) {
        const userData = snap.docs[0].data() as UserProfile;
        const resolvedUser = { ...userData, uid: snap.docs[0].id, scannedCardCode: cleanText };
        setScannedUser(resolvedUser);
        setIsScanning(false);
        setStatusModal({
          show: true,
          type: 'success',
          title: 'Cliente Identificado',
          message: `Cliente: ${userData.name}\nCartão: ${cleanText}\n\nO cartão foi validado com sucesso.\nSaldo Atual: R$ ${userData.balance.toFixed(2)}`
        });
      } else {
        setStatusModal({
          show: true,
          type: 'error',
          title: 'Não Encontrado',
          message: 'Este QR Code não corresponde a nenhum cliente cadastrado no sistema.'
        });
      }
    } catch (error) {
      console.error(error);
      setStatusModal({
        show: true,
        type: 'error',
        title: 'Erro de Leitura',
        message: 'Ocorreu um problema ao tentar processar o QR Code.'
      });
    }
  };

  const handleRecharge = async () => {
    const val = parseFloat(amount);
    if (!scannedUser || isNaN(val) || val <= 0) return;

    if (!paymentMethod) {
      toast.error('Selecione a forma de pagamento');
      return;
    }

    if (val < extraItemsTotal) {
      toast.error('O valor da recarga deve ser maior ou igual ao total dos itens extras adicionais!');
      return;
    }

    try {
      setProcessing(true);
      
      const rCardNum = (scannedUser as any).scannedCardCode || scannedUser.qrCode || scannedUser.uid || '';
      
      const netAddition = val - extraItemsTotal;
      const dbPromises: Promise<any>[] = [];

      const isShared = scannedUser && (!scannedUser.balanceType || scannedUser.balanceType === 'shared') && scannedUser.parentUid;
      const targetUserId = isShared ? scannedUser.parentUid! : scannedUser.uid;

      // 1. Update user balance with the net addition
      dbPromises.push(updateDoc(doc(db, 'users', targetUserId), {
        balance: increment(netAddition)
      }));

      // 2. Record full recharge credit transaction
      dbPromises.push(addDoc(collection(db, 'transactions'), {
        userId: scannedUser.uid,
        userName: scannedUser.name,
        clientName: scannedUser.name,
        cardNumber: rCardNum,
        amount: val,
        type: 'credit',
        description: `Recarga Ponto de Venda (${paymentMethod})`,
        paymentMethod,
        status: paymentMethod === 'Conta' ? 'pending' : 'completed',
        timestamp: serverTimestamp(),
        operatorId: auth.currentUser?.uid || '',
        operatorName: (users?.find(u => u.uid === auth.currentUser?.uid)?.name) || auth.currentUser?.displayName || auth.currentUser?.email || 'Operador'
      }));

      // 3. Group selected extra items by vendor
      const itemsByVendor: { [vendorId: string]: { product: Product, qty: number }[] } = {};
      Object.keys(extraQuantities).forEach(prodId => {
        const qty = extraQuantities[prodId];
        if (qty && qty > 0) {
          const p = products.find(prod => prod.id === prodId);
          if (p) {
            const vId = p.vendorId || 'extras';
            if (!itemsByVendor[vId]) {
              itemsByVendor[vId] = [];
            }
            itemsByVendor[vId].push({ product: p, qty });
          }
        }
      });

      // 4. Record transactions and consumption logs for extra products grouped by stall
      Object.entries(itemsByVendor).forEach(([vId, itemsList]) => {
        const stallObj = stalls.find(s => s.id === vId);
        const stallName = stallObj ? stallObj.name : 'Extras';
        const subTotal = itemsList.reduce((acc, item) => acc + item.product.price * item.qty, 0);
        const itemNamesString = itemsList.map(item => `${item.qty}x ${item.product.name}`).join(', ');

        // Write debit transaction
        dbPromises.push(addDoc(collection(db, 'transactions'), {
          userId: scannedUser.uid,
          userName: scannedUser.name,
          clientName: scannedUser.name,
          cardNumber: rCardNum,
          amount: -subTotal,
          type: 'debit',
          description: `Compra de Extras na recarga (${stallName}): ${itemNamesString}`,
          stallName,
          items: itemsList.map(item => `${item.qty}x ${item.product.name}`),
          vendorId: vId,
          status: 'completed',
          timestamp: serverTimestamp()
        }));

        // Write consumption log
        dbPromises.push(addDoc(collection(db, 'consumption'), {
          studentId: scannedUser.uid,
          studentName: scannedUser.name,
          clientName: scannedUser.name,
          cardNumber: rCardNum,
          vendorId: vId,
          stallId: vId,
          amount: subTotal,
          items: itemsList.map(item => `${item.qty}x ${item.product.name}`),
          detailedItems: itemsList.map(item => ({
            productId: item.product.id,
            name: item.product.name,
            quantity: item.qty,
            price: item.product.price,
            subtotal: item.product.price * item.qty
          })),
          timestamp: serverTimestamp()
        }));
      });

      await Promise.all(dbPromises);

      setScannedUser(null);
      setAmount('');
      setExtraQuantities({});
      if (onSuccess) onSuccess();
      
      const itemsSummary = Object.keys(extraQuantities)
        .filter(pId => (extraQuantities[pId] || 0) > 0)
        .map(pId => {
          const qty = extraQuantities[pId] || 0;
          const p = products.find(prod => prod.id === pId);
          return `${qty}x ${p?.name || 'Item'}`;
        }).join(', ');

      let successMsg = `Cliente: ${scannedUser.name}\nCartão: ${rCardNum}\n\n`;
      successMsg += `A recarga de R$ ${val.toFixed(2)} (${paymentMethod}) foi adicionada ao saldo.\n`;
      if (extraItemsTotal > 0) {
        successMsg += `Descontado compra de extras: R$ ${extraItemsTotal.toFixed(2)} (${itemsSummary})\n`;
      }
      successMsg += `Novo Saldo Líquido do Cartão: R$ ${(scannedUser.balance + netAddition).toFixed(2)}`;

      setStatusModal({
        show: true,
        type: 'success',
        title: 'Operação Concluída',
        message: successMsg
      });
    } catch (error) {
      console.error('Erro no processamento da carga:', error);
      setStatusModal({
        show: true,
        type: 'error',
        title: 'Falha na Recarga',
        message: 'Não foi possível processar o crédito e descontar extras. Verifique sua conexão e tente novamente.'
      });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-6xl mx-auto pb-20">
      <div className="space-y-6">
        <Card className="bg-slate-800/50 backdrop-blur-md border-white/5 text-white rounded-[32px] overflow-hidden shadow-2xl">
          <CardHeader className="p-8 pb-4">
            <div className="flex items-center gap-3 mb-2">
               <div className="p-2 bg-green-500/20 rounded-xl">
                  <QrCode className="h-5 w-5 text-green-400" />
               </div>
               <CardTitle className="text-xl font-black uppercase tracking-tight">Identificação</CardTitle>
            </div>
            <CardDescription className="text-slate-400 text-sm">Escaneie o cartão do cliente para iniciar a recarga</CardDescription>
          </CardHeader>
          <CardContent className="p-8 pt-4 space-y-6">
            {!isScanning && !scannedUser ? (
              <div className="space-y-4">
                <button 
                  onClick={() => setIsScanning(true)} 
                  className="w-full h-40 bg-white/[0.03] hover:bg-white/[0.05] border-2 border-dashed border-white/10 flex flex-col items-center justify-center gap-3 rounded-[32px] transition-all group active:scale-95"
                >
                  <div className="p-3 bg-blue-600 rounded-full shadow-2xl shadow-blue-900/40 group-hover:scale-110 transition-transform">
                     <QrCode className="h-7 w-7 text-white" />
                  </div>
                  <span className="font-black text-xs uppercase tracking-[0.2em] text-slate-400">Toque para Escanear com Câmera</span>
                </button>
                
                <div className="relative">
                  <Input
                    placeholder="OU PASSE O CARTÃO FÍSICO (LEITOR USB/RFID)"
                    onKeyDown={async (e) => {
                      if (e.key === 'Enter') {
                        const text = e.currentTarget.value.trim();
                        if (text) {
                          await onScanSuccess(text);
                          e.currentTarget.value = '';
                        }
                      }
                    }}
                    className="bg-white/5 border-white/10 text-center text-xs font-black uppercase tracking-wider text-white placeholder:text-slate-500 rounded-2xl h-14 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 border border-white/10 w-full"
                    autoFocus
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none">
                    <span className="text-[9px] font-black uppercase text-blue-400 animate-pulse bg-blue-500/10 px-2 py-0.5 rounded-md border border-blue-500/20">Leitor Ativo</span>
                  </div>
                </div>

                <div className="pt-4 border-t border-white/5 space-y-2">
                  <div className="flex items-center gap-2">
                    <Search className="h-4 w-4 text-blue-400" />
                    <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Buscar por Cliente / Funcionário</span>
                  </div>
                  
                  <div className="relative">
                    <Input
                      placeholder="Pesquisar por nome, e-mail ou cartão..."
                      value={rechargeSearchQuery}
                      onChange={(e) => setRechargeSearchQuery(e.target.value)}
                      className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 rounded-xl h-12 text-sm"
                    />
                    {rechargeSearchQuery && (
                      <button 
                        onClick={() => setRechargeSearchQuery('')} 
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-450 hover:text-white"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  {rechargeSearchQuery.trim() && (
                    <div className="bg-slate-900 border border-white/10 rounded-2xl max-h-48 overflow-y-auto divide-y divide-white/5">
                      {filteredRechargeUsers.length > 0 ? (
                        filteredRechargeUsers.map(u => (
                          <button
                            key={u.uid}
                            type="button"
                            onClick={() => {
                              setScannedUser(u);
                              setRechargeSearchQuery('');
                            }}
                            className="w-full text-left p-3 hover:bg-white/5 flex flex-col justify-between transition-colors cursor-pointer"
                          >
                            <span className="font-bold text-xs text-white uppercase">{u.name}</span>
                            <span className="text-[10px] text-slate-400">{u.email}</span>
                            <div className="flex justify-between items-center mt-1">
                              <span className="text-[9px] font-mono font-bold text-blue-400">Cartão: {u.qrCode || 'N/A'}</span>
                              <span className="text-[10px] font-bold text-green-400">R$ {u.balance.toFixed(2)}</span>
                            </div>
                          </button>
                        ))
                      ) : (
                        <p className="p-3 text-xs text-slate-500 italic text-center">Nenhum cliente encontrado.</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : isScanning ? (
              <div className="h-56 flex items-center justify-center bg-slate-900 rounded-[40px] border-2 border-dashed border-white/5">
                 <Loader2 className="h-10 w-10 text-blue-500 animate-spin" />
              </div>
            ) : scannedUser ? (
              <div className="p-8 bg-blue-600/10 border border-blue-500/20 rounded-[40px] space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
                <div className="flex justify-between items-start">
                  <div className="space-y-1">
                     <p className="text-[10px] font-black uppercase text-blue-400 tracking-[0.2em]">Cliente Confirmado</p>
                     <h3 className="text-2xl font-black tracking-tight">{scannedUser.name}</h3>
                     <p className="text-[11px] font-black uppercase text-blue-400 font-mono tracking-wider">
                       Cartão: {(scannedUser as any).scannedCardCode || scannedUser.qrCode || scannedUser.uid}
                     </p>
                     <p className="text-slate-500 text-sm font-medium italic">{scannedUser.email}</p>
                  </div>
                  <button onClick={() => setScannedUser(null)} className="h-12 w-12 flex items-center justify-center rounded-2xl bg-white/5 hover:bg-white/10 text-slate-500 hover:text-white transition-colors">
                    <XCircle className="h-7 w-7" />
                  </button>
                </div>
                
                <div className="p-6 bg-slate-900/50 rounded-3xl border border-white/5 flex items-center justify-between">
                  <div>
                     <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Saldo Atual</p>
                     <p className="text-4xl font-black text-green-400 tracking-tighter">R$ {scannedUser.balance.toFixed(2)}</p>
                  </div>
                  <div className="h-14 w-14 rounded-2xl bg-green-500/10 flex items-center justify-center text-green-400">
                     <DollarSign className="h-8 w-8" />
                  </div>
                </div>

                <Button 
                  variant="outline" 
                  onClick={() => {
                    setScannedUser(null);
                    setAmount('');
                  }}
                  className="w-full h-14 bg-white/5 border-white/10 text-slate-300 hover:text-white hover:bg-white/10 rounded-2xl font-black uppercase tracking-widest text-[10px]"
                >
                  Trocar de Cliente
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {scannedUser && (
          <Card className="bg-slate-800/20 backdrop-blur-md border border-white/5 text-white rounded-[32px] overflow-hidden shadow-2xl">
            <CardHeader className="p-8 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-500/20 rounded-xl">
                  <Sparkles className="h-5 w-5 text-indigo-400" />
                </div>
                <div>
                  <CardTitle className="text-lg font-black uppercase tracking-tight">Venda de Extras</CardTitle>
                  <CardDescription className="text-slate-400 text-xs">Selecione cartões ou pulseiras para deduzir diretamente da recarga física e registrá-los como venda</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-8 pt-2 space-y-4">
              {extrasProducts.length === 0 ? (
                <div className="p-6 text-center bg-white/[0.02] border border-dashed border-white/5 rounded-2xl">
                  <p className="text-xs text-slate-500 italic">Nenhum produto extra ou da barraca "Extras" encontrado.</p>
                  <p className="text-[10px] text-slate-600 mt-1">Crie produtos vinculados à barraca de extras para listá-los aqui.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-1.5 opacity-75">
                    <Store className="h-3.5 w-3.5 text-indigo-400" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-indigo-400">Itens Disponíveis</span>
                  </div>
                  <div className="grid grid-cols-1 gap-2.5 max-h-72 overflow-y-auto pr-1 custom-scrollbar">
                    {extrasProducts.map(p => {
                      const qty = extraQuantities[p.id] || 0;
                      return (
                        <div 
                          key={p.id} 
                          className={`p-4 rounded-2xl border transition-all flex items-center justify-between ${
                            qty > 0 
                              ? 'bg-indigo-600/15 border-indigo-500/40 text-white' 
                              : 'bg-white/[0.02] border-white/5 hover:border-white/10 text-slate-300'
                          }`}
                        >
                          <div className="space-y-0.5">
                            <span className="font-extrabold text-sm tracking-tight text-white">{p.name}</span>
                            <div className="font-mono text-xs font-black text-emerald-400">
                              R$ {p.price.toFixed(2)}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 bg-slate-950/60 p-1 rounded-xl border border-white/5 select-none">
                            <button
                              type="button"
                              onClick={() => {
                                setExtraQuantities(prev => {
                                  const current = prev[p.id] || 0;
                                  if (current <= 1) {
                                    const copy = { ...prev };
                                    delete copy[p.id];
                                    return copy;
                                  }
                                  return { ...prev, [p.id]: current - 1 };
                                });
                              }}
                              className={`h-7 w-7 rounded-lg flex items-center justify-center font-black transition-all ${
                                qty > 0 
                                  ? 'bg-slate-800 text-white hover:bg-slate-700 cursor-pointer' 
                                  : 'opacity-20 cursor-not-allowed'
                              }`}
                              disabled={qty === 0}
                            >
                              -
                            </button>
                            <span className="font-mono font-black text-xs w-6 text-center text-white">
                              {qty}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setExtraQuantities(prev => ({
                                  ...prev,
                                  [p.id]: (prev[p.id] || 0) + 1
                                }));
                              }}
                              className="h-7 w-7 bg-indigo-600 hover:bg-indigo-500 rounded-lg flex items-center justify-center font-black text-white transition-all cursor-pointer"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <div className="space-y-6">
        <Card className="bg-slate-800/50 backdrop-blur-md border-white/5 text-white rounded-[32px] overflow-hidden shadow-2xl">
          <CardHeader className="p-8 pb-4">
             <div className="flex items-center gap-3 mb-2">
               <div className="p-2 bg-blue-500/20 rounded-xl">
                  <DollarSign className="h-5 w-5 text-blue-400" />
               </div>
               <CardTitle className="text-xl font-black uppercase tracking-tight">Valor da Carga</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-8 pt-4 space-y-8">
            <div className="grid grid-cols-2 gap-4">
              {['10', '20', '50', '100'].map(val => (
                <button 
                  key={val}
                  disabled={!scannedUser}
                  onClick={() => setAmount(val)}
                  className={`h-24 rounded-[24px] font-black text-2xl transition-all active:scale-95 border-2 ${
                    amount === val 
                      ? 'bg-blue-600 border-blue-500 text-white shadow-xl shadow-blue-900/40' 
                      : 'bg-white/[0.03] border-white/5 hover:border-white/10 text-slate-400 disabled:opacity-20'
                  }`}
                >
                  R$ {val}
                </button>
              ))}
            </div>
            
            <div className="space-y-3">
              <div className="flex items-center justify-between px-2">
                <label className="text-[10px] font-black uppercase text-slate-500 tracking-[0.2em] block">Valor da Recarga</label>
                <button
                  type="button"
                  disabled={!scannedUser}
                  onClick={() => setShowCalcModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 text-[10px] font-black uppercase tracking-wider transition-all disabled:opacity-30 active:scale-95 cursor-pointer"
                >
                  <Calculator className="h-4 w-4" />
                  Calcular por Itens
                </button>
              </div>
              <div className="relative group">
                <span className="absolute left-6 top-1/2 -translate-y-1/2 font-black text-2xl text-slate-600 group-focus-within:text-blue-500 transition-colors">R$</span>
                <input 
                  type="number"
                  placeholder="0.00"
                  disabled={!scannedUser}
                  className="w-full bg-slate-900/80 border-2 border-white/5 rounded-[24px] h-20 pl-16 pr-6 font-black text-4xl text-white outline-none focus:border-blue-600 transition-all disabled:opacity-20 tabular-nums"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-[10px] font-black uppercase text-slate-500 tracking-[0.2em] px-2 block">Forma de Pagamento</label>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {['Dinheiro', 'Pix', 'Débito', 'Crédito', 'Conta'].map(method => (
                  <button
                    key={method}
                    disabled={!scannedUser}
                    onClick={() => setPaymentMethod(method)}
                    className={`h-14 rounded-2xl text-[9px] font-black uppercase tracking-tight border-2 transition-all active:scale-95 ${
                      paymentMethod === method
                        ? 'bg-emerald-600 border-emerald-500 text-white shadow-lg shadow-emerald-900/40'
                        : 'bg-white/[0.03] border-white/5 hover:border-white/10 text-slate-400 disabled:opacity-20'
                    }`}
                  >
                    {method}
                  </button>
                ))}
              </div>
            </div>

            {scannedUser && amount && parseFloat(amount) > 0 && (
              <div className="p-5 bg-slate-900 border border-white/10 rounded-2xl space-y-3 animate-in fade-in duration-300">
                <p className="text-[10px] font-black uppercase text-indigo-400 tracking-wider">Resumo da Operação</p>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between text-slate-400">
                    <span>Recarga Recebida:</span>
                    <span className="font-mono font-bold text-white">R$ {parseFloat(amount).toFixed(2)}</span>
                  </div>
                  {extraItemsTotal > 0 && (
                    <>
                      <div className="flex justify-between text-indigo-400 font-semibold items-center">
                        <span className="flex items-center gap-1">Compra de Extras:</span>
                        <span className="font-mono font-black">- R$ {extraItemsTotal.toFixed(2)}</span>
                      </div>
                      <div className="pl-3 py-1 space-y-1 text-[10px] text-slate-450 border-l border-indigo-500/20 bg-indigo-500/[0.02] rounded-r-md">
                        {Object.keys(extraQuantities).map(pId => {
                          const qty = extraQuantities[pId] || 0;
                          if (qty <= 0) return null;
                          const p = products.find(prod => prod.id === pId);
                          return (
                            <div key={pId} className="flex justify-between font-mono">
                              <span>{qty}x {p?.name}:</span>
                              <span>R$ {((p?.price || 0) * qty).toFixed(2)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                  <div className="border-t border-white/5 pt-2 flex justify-between font-bold text-sm">
                    <span className="text-slate-300">Crédito Líquido no Cartão:</span>
                    <span className="font-mono text-green-400">R$ {(parseFloat(amount) - extraItemsTotal).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-[11px] text-slate-500 font-semibold">
                    <span>Saldo Final Estimado:</span>
                    <span className="font-mono">R$ {(scannedUser.balance + parseFloat(amount) - extraItemsTotal).toFixed(2)}</span>
                  </div>
                </div>
              </div>
            )}

            <div className="pt-4">
              {processing ? (
                <Button disabled className="w-full h-24 bg-slate-800 text-slate-600 font-black text-2xl rounded-[32px] border border-white/5">
                  <Loader2 className="h-8 w-8 animate-spin mr-3" /> PROCESSANDO
                </Button>
              ) : scannedUser && amount && parseFloat(amount) > 0 ? (
                <Button 
                  onClick={handleRecharge}
                  className="w-full h-24 bg-blue-600 hover:bg-blue-500 text-white font-black text-2xl shadow-2xl shadow-blue-900/40 rounded-[32px] transition-all hover:-translate-y-1 active:translate-y-0"
                >
                  CONFIRMAR CARGA
                </Button>
              ) : (
                <div className="h-24 w-full bg-white/[0.02] border-2 border-dashed border-white/5 rounded-[32px] flex items-center justify-center px-8 text-center">
                   <p className="text-slate-500 font-black text-xs uppercase tracking-[0.2em] leading-relaxed">
                      {!scannedUser ? 'ESCANEAR CLIENTE PARA CONTINUAR' : 'SELECIONE OU DIGITE UM VALOR'}
                   </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
      
      {isScanning && (
        <QRScanner onScan={onScanSuccess} onClose={() => setIsScanning(false)} title="Recarregar Cliente" />
      )}

      <AnimatePresence>
        {statusModal.show && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setStatusModal(prev => ({ ...prev, show: false }))}
              className="absolute inset-0 bg-slate-950/90 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-sm bg-slate-900 border border-white/10 rounded-[40px] shadow-2xl overflow-hidden text-center p-8"
            >
              <div className="flex flex-col items-center gap-6">
                <div className={`h-24 w-24 rounded-full flex items-center justify-center ${
                  statusModal.type === 'success' ? 'bg-green-500/10 text-green-500 ring-4 ring-green-500/5' :
                  statusModal.type === 'error' ? 'bg-red-500/10 text-red-500 ring-4 ring-red-500/5' :
                  'bg-blue-500/10 text-blue-500 ring-4 ring-blue-500/5'
                }`}>
                  {statusModal.type === 'success' ? <CheckCircle2 className="h-12 w-12" /> :
                   statusModal.type === 'error' ? <XCircle className="h-12 w-12" /> :
                   <QrCode className="h-12 w-12" />}
                </div>

                <div className="space-y-2 text-white">
                  <h3 className="text-2xl font-black uppercase tracking-tighter">
                    {statusModal.title}
                  </h3>
                  <p className="text-slate-400 text-sm font-medium whitespace-pre-wrap leading-relaxed">
                    {statusModal.message}
                  </p>
                </div>

                <Button 
                  onClick={() => setStatusModal(prev => ({ ...prev, show: false }))}
                  className={`w-full h-14 rounded-2xl font-black uppercase text-xs tracking-widest transition-all ${
                    statusModal.type === 'success' ? 'bg-green-600 hover:bg-green-500 shadow-xl shadow-green-600/20' :
                    statusModal.type === 'error' ? 'bg-red-600 hover:bg-red-500 shadow-xl shadow-red-600/20' :
                    'bg-blue-600 hover:bg-blue-500'
                  }`}
                >
                  Confirmar
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showCalcModal && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowCalcModal(false)}
              className="absolute inset-0 bg-slate-950/85 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-xl bg-slate-900 border border-white/10 rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[85vh] text-white"
            >
              <div className="p-6 border-b border-white/10 text-left">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-500/10 rounded-xl text-blue-400">
                      <Calculator className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-lg font-black text-white uppercase tracking-tight">Calculadora de Recarga</h3>
                      <p className="text-slate-400 text-xs font-semibold">Selecione os produtos para calcular automaticamente o valor total</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setShowCalcModal(false)}
                    className="h-10 w-10 flex items-center justify-center rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all active:scale-95 cursor-pointer"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="relative mt-4">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Buscar produto por nome ou categoria..."
                    value={calcSearch}
                    onChange={(e) => setCalcSearch(e.target.value)}
                    className="w-full bg-slate-950/55 border border-white/10 rounded-xl h-11 pl-10 pr-4 text-xs font-semibold text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500 transition-all"
                  />
                  {calcSearch && (
                    <button 
                      onClick={() => setCalcSearch('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs font-bold"
                    >
                      Limpar
                    </button>
                  )}
                </div>
              </div>

              {/* Products Grid / Group Container */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {Object.keys(groupedProducts).length === 0 ? (
                  <div className="h-40 flex flex-col items-center justify-center text-center space-y-2">
                    <p className="text-slate-500 font-black text-xs uppercase tracking-wider">Nenhum produto cadastrado / encontrado</p>
                    <p className="text-slate-600 text-xs">Ajuste o filtro ou cadastre produtos na aba de produtos.</p>
                  </div>
                ) : (
                  (Object.entries(groupedProducts) as [string, { stallName: string; items: Product[] }][]).map(([stallId, group]) => (
                    <div key={stallId} className="space-y-3">
                      <div className="flex items-center gap-1.5 px-1 border-b border-white/5 pb-2">
                        <Store className="h-3.5 w-3.5 text-blue-400" />
                        <h4 className="text-[10px] font-black uppercase text-blue-400 tracking-wider">
                          {group.stallName}
                        </h4>
                        <span className="text-[9px] font-bold text-slate-500 font-mono">({group.items.length})</span>
                      </div>
                      
                      <div className="grid grid-cols-1 gap-2.5">
                        {group.items.map(p => {
                          const qty = calcQuantities[p.id] || 0;
                          return (
                            <div 
                              key={p.id} 
                              className={`p-4 rounded-2xl border transition-all flex items-center justify-between ${
                                qty > 0 
                                  ? 'bg-blue-600/15 border-blue-500/40 text-white' 
                                  : 'bg-white/[0.02] border-white/5 hover:border-white/10 text-slate-300'
                              }`}
                            >
                              <div className="space-y-1 pr-4">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-extrabold text-sm tracking-tight text-white">{p.name}</span>
                                  {p.category && (
                                    <span className="text-[8px] font-black uppercase tracking-widest bg-white/5 text-slate-400 px-1.5 py-0.5 rounded">
                                      {p.category}
                                    </span>
                                  )}
                                </div>
                                <div className="font-mono text-sm font-black text-emerald-400">
                                  R$ {p.price.toFixed(2)}
                                </div>
                              </div>

                              <div className="flex items-center gap-2.5 bg-slate-950/60 p-1.5 rounded-xl border border-white/5 select-none">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCalcQuantities(prev => {
                                      const current = prev[p.id] || 0;
                                      if (current <= 1) {
                                        const copy = { ...prev };
                                        delete copy[p.id];
                                        return copy;
                                      }
                                      return { ...prev, [p.id]: current - 1 };
                                    });
                                  }}
                                  className={`h-8 w-8 rounded-lg flex items-center justify-center font-black transition-all ${
                                    qty > 0 
                                      ? 'bg-slate-800 text-white hover:bg-slate-700 cursor-pointer' 
                                      : 'opacity-20 cursor-not-allowed'
                                  }`}
                                  disabled={qty === 0}
                                >
                                  -
                                </button>
                                <span className="font-mono font-black text-sm w-7 text-center text-white">
                                  {qty}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCalcQuantities(prev => ({
                                      ...prev,
                                      [p.id]: (prev[p.id] || 0) + 1
                                    }));
                                  }}
                                  className="h-8 w-8 bg-blue-600 hover:bg-blue-500 rounded-lg flex items-center justify-center font-black text-white transition-all cursor-pointer"
                                >
                                  +
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Calculator Footer */}
              <div className="p-6 border-t border-white/10 bg-slate-950/45 text-left space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Valor total projetado</p>
                    <p className="text-3xl font-black text-green-400 tracking-tight">R$ {calcTotal.toFixed(2)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Produtos marcados</p>
                    <p className="text-sm font-extrabold text-slate-300">
                      {(Object.values(calcQuantities) as number[]).reduce((a, b) => a + b, 0)} unidade(s)
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 pt-1">
                  <Button 
                    variant="outline"
                    onClick={handleClearCalc}
                    disabled={Object.keys(calcQuantities).length === 0}
                    className="h-12 bg-white/5 border-white/10 hover:bg-white/10 text-slate-300 hover:text-white rounded-xl text-xs font-black uppercase tracking-wider disabled:opacity-20"
                  >
                    Visual Limpar
                  </Button>
                  <Button 
                    onClick={handleApplyCalc}
                    disabled={calcTotal <= 0}
                    className="col-span-2 h-12 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-extrabold rounded-xl text-xs uppercase tracking-wider shadow-lg shadow-emerald-950/50"
                  >
                    Inserir R$ {calcTotal.toFixed(2)}
                  </Button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CheckCircle2({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <path d="m9 11 3 3L22 4" />
    </svg>
  );
}

function XCircle({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </svg>
  );
}
