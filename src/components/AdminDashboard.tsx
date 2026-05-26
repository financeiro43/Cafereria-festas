import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db, auth } from '@/lib/firebase';
import { collection, addDoc, onSnapshot, query, deleteDoc, doc, updateDoc, orderBy, limit, Timestamp, increment, serverTimestamp, where, getDocs, getDoc, setDoc } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Stall, Product, UserProfile, Withdrawal, Order, Transaction, UserRole, CartItem } from '../types';
import { Plus, Trash2, Store, Package, Users, TrendingUp, DollarSign, History, LayoutDashboard, Settings as SettingsIcon, FileText, ShoppingCart, Smartphone, LogOut, ArrowLeftRight, QrCode, Printer, Loader2, Menu, X, Search, CreditCard, ShieldCheck as ShieldCheckIcon, User as UserIcon, Edit2, Filter, Sparkles, Ticket, Zap, CheckSquare, Square, Copy, RefreshCw, Palette } from 'lucide-react';
import { QRCodeSVG, QRCodeCanvas } from 'qrcode.react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import VendorDashboard from './VendorDashboard';
import { handleFirestoreError, OperationType } from '@/lib/error-handler';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

import QRScanner from './QRScanner';
import ReportsPortal from './ReportsPortal';

type AdminTab = 'overview' | 'stalls' | 'products' | 'users' | 'terminal' | 'recharge_pos' | 'transactions' | 'card_printer' | 'reports';

export default function AdminDashboard({ profile, forcedTab }: { profile: UserProfile, forcedTab?: AdminTab }) {
  const [activeTab, setActiveTab] = useState<AdminTab>(forcedTab || 'overview');
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // SHARED STATE FOR TERMINAL & RECHARGE
  const [sharedCart, setSharedCart] = useState<CartItem[]>([]);
  const [sharedScannedUser, setSharedScannedUser] = useState<UserProfile | null>(null);

  useEffect(() => {
    if (forcedTab) {
      setActiveTab(forcedTab);
    }
  }, [forcedTab]);
  
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
    const totalTransactions = transactions.filter(t => t.type === 'debit');
    const totalRevenue = totalTransactions.reduce((acc, t) => acc + (t.amount || 0), 0);
    
    // Identificar usuários que já colocaram valores (pelo menos um crédito)
    const rechargedUserIds = new Set(transactions.filter(t => t.type === 'credit' && t.status === 'completed').map(t => t.userId));
    
    const activePhysicalCards = users.filter(u => u.isPhysicalCard && rechargedUserIds.has(u.uid)).length;
    const activeVirtualCards = users.filter(u => !u.isPhysicalCard && rechargedUserIds.has(u.uid)).length;
    
    const totalUsers = users.length;
    
    const credited = transactions.filter(t => t.type === 'credit' && t.status === 'completed').reduce((acc, t) => acc + (t.amount || 0), 0);
    const debited = totalRevenue;
    const totalWithdrawn = withdrawals.reduce((acc, curr) => acc + (curr.amount || 0), 0);
    
    return {
      totalRevenue,
      totalSalesCount: totalTransactions.length,
      activePhysicalCards,
      activeVirtualCards,
      totalUsers,
      credited,
      debited,
      totalWithdrawn,
      balance: debited - totalWithdrawn
    };
  }, [transactions, users, withdrawals]);

  const statsByStall = useMemo(() => {
    return stalls.map(stall => {
      const stallTransactions = transactions.filter(t => t.type === 'debit' && t.description?.includes(stall.name));
      const totalSales = stallTransactions.reduce((acc, curr) => acc + (curr.amount || 0), 0);
      
      // Contagem de produtos vendidos usando a collection consumption
      const stallConsumption = recentSales.filter(s => s.stallId === stall.id);
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

      const stallWithdrawals = withdrawals.filter(w => w.stallId === stall.id);
      const totalWithdrawn = stallWithdrawals.reduce((acc, curr) => acc + (curr.amount || 0), 0);
      
      return {
        ...stall,
        totalSales,
        totalWithdrawn,
        productsSold,
        balance: totalSales - totalWithdrawn
      };
    });
  }, [stalls, transactions, withdrawals, recentSales]);

  const handleWithdraw = async () => {
    if (!withdrawalStallId || !withdrawalAmount) return;
    try {
      await addDoc(collection(db, 'withdrawals'), {
        stallId: withdrawalStallId,
        amount: parseFloat(withdrawalAmount),
        adminId: auth.currentUser?.uid,
        timestamp: new Date().toISOString()
      });
      setWithdrawalAmount('');
      toast.success('Retirada registrada com sucesso!');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'withdrawals');
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
        // Log transaction for audit
        await addDoc(collection(db, 'transactions'), {
          userId: uid,
          amount: rechargeValue,
          type: 'credit',
          paymentMethod: 'Saldo Admin',
          status: 'completed',
          description: 'Recarga administrativa em lote',
          timestamp: serverTimestamp()
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

  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all');
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string, type: 'stall' | 'product' | 'user', action: () => void } | null>(null);

  const filteredUsers = useMemo(() => {
    return users.filter(user => {
      if (user.role === 'admin' && profile.email !== 'financeiro@modeloalpha.com.br') return false; // Hide other admins unless super admin
      
      const matchesSearch = 
        user.name.toLowerCase().includes(userSearchQuery.toLowerCase()) ||
        user.email.toLowerCase().includes(userSearchQuery.toLowerCase()) ||
        user.qrCode?.toLowerCase().includes(userSearchQuery.toLowerCase());
      
      const matchesRole = roleFilter === 'all' || user.role === roleFilter;

      return matchesSearch && matchesRole;
    });
  }, [users, userSearchQuery, roleFilter, profile.email]);

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

  const handleManualRecharge = async (userId: string) => {
    const amount = parseFloat(rechargeAmounts[userId] || '0');
    const paymentMethod = rechargePaymentMethods[userId] || 'Dinheiro';
    
    if (isNaN(amount) || amount <= 0) {
      toast.error('Insira um valor válido para recarga');
      return;
    }

    try {
      // Update balance
      await updateDoc(doc(collection(db, 'users'), userId), {
        balance: increment(amount)
      });

      // Record transaction
      await addDoc(collection(db, 'transactions'), {
        userId,
        amount,
        type: 'credit',
        description: `Recarga manual (${paymentMethod})`,
        paymentMethod,
        status: 'completed',
        timestamp: serverTimestamp()
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
    { id: 'transactions', icon: History, label: 'Histórico de Vendas', category: 'Administração' },
    { id: 'reports', icon: FileText, label: 'Relatórios do Evento', category: 'Administração' },
    { id: 'card_printer', icon: Printer, label: 'Impressor de Cartões', category: 'Administração' },
    { id: 'terminal', icon: ShoppingCart, label: 'Terminal PDV (Caixa)', category: 'Canais de Venda' },
    { id: 'recharge_pos', icon: QrCode, label: 'Carga e Recarga', category: 'Canais de Venda' },
    { id: 'settings', icon: SettingsIcon, label: 'Configurações', category: 'Sistema' },
  ];

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
              <header className="px-2 md:px-0">
                <h2 className="text-2xl md:text-3xl font-black text-slate-900 uppercase tracking-tight leading-none">Gestão Financeira</h2>
                <p className="text-slate-500 text-sm mt-2">Dashboard consolidado do evento</p>
              </header>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 px-2 md:px-0">
                <Card className="shadow-2xl shadow-blue-500/10 border-none bg-blue-600 text-white rounded-[32px] overflow-hidden relative group">
                  <div className="absolute -right-4 -top-4 w-24 h-24 bg-white/10 blur-3xl rounded-full group-hover:scale-150 transition-transform duration-700" />
                  <CardContent className="p-6 md:p-8 space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-100 flex items-center gap-2">
                      <DollarSign className="h-3 w-3" /> Faturamento
                    </p>
                    <h4 className="text-3xl font-black tabular-nums tracking-tighter">R$ {stats.totalRevenue.toFixed(2)}</h4>
                    <p className="text-[9px] text-blue-200 font-bold uppercase tracking-widest">{stats.totalSalesCount} Vendas Realizadas</p>
                  </CardContent>
                </Card>

                <Card className="shadow-sm border-none bg-white rounded-[32px] overflow-hidden group">
                  <CardContent className="p-6 md:p-8 space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2">
                      <History className="h-3 w-3 text-orange-500" /> Em Aberto
                    </p>
                    <h4 className="text-3xl font-black text-slate-900 tabular-nums tracking-tighter">R$ {stats.balance.toFixed(2)}</h4>
                    <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">Pendente de Retirada</p>
                  </CardContent>
                </Card>

                <Card className="shadow-sm border-none bg-white rounded-[32px] overflow-hidden">
                  <CardContent className="p-6 md:p-8 space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2">
                      <FileText className="h-3 w-3 text-green-500" /> Retiradas
                    </p>
                    <h4 className="text-3xl font-black text-slate-900 tabular-nums tracking-tighter">R$ {stats.totalWithdrawn.toFixed(2)}</h4>
                    <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">Total já recolhido</p>
                  </CardContent>
                </Card>

                <Card className="shadow-sm border-none bg-indigo-950 text-white rounded-[32px] overflow-hidden relative group h-full">
                   <div className="absolute -right-4 -top-4 w-24 h-24 bg-indigo-500/10 blur-3xl rounded-full group-hover:scale-150 transition-transform duration-700" />
                   <CardContent className="p-6 md:p-8 space-y-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-300 flex items-center gap-2">
                      <QrCode className="h-3 w-3" /> Cartões Ativos
                    </p>
                    <div className="flex items-end justify-between">
                      <h4 className="text-4xl font-black tabular-nums tracking-tighter">
                        {stats.activePhysicalCards + stats.activeVirtualCards}
                      </h4>
                      <div className="text-right pb-1">
                        <div className="flex items-center gap-2 justify-end">
                          <div className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                          <p className="text-[9px] text-indigo-200 font-bold uppercase tracking-widest">{stats.activePhysicalCards} Físicos</p>
                        </div>
                        <div className="flex items-center gap-2 justify-end">
                          <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                          <p className="text-[9px] text-indigo-200 font-bold uppercase tracking-widest">{stats.activeVirtualCards} Virtuais</p>
                        </div>
                      </div>
                    </div>
                    <p className="text-[8px] text-indigo-400/60 font-black uppercase tracking-[0.2em] border-t border-white/5 pt-3">Apenas com carga efetuada</p>
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8 px-2 md:px-0 pb-24 md:pb-0">
                <Card className="shadow-sm border-none rounded-[32px] overflow-hidden h-fit">
                  <CardHeader className="bg-slate-50 border-b border-slate-100 p-6 md:p-8">
                    <CardTitle className="text-xs font-black uppercase tracking-[0.2em] text-slate-900 flex items-center gap-2">
                      <ArrowLeftRight className="h-4 w-4 text-blue-600" /> Retirada de Valores
                    </CardTitle>
                    <CardDescription className="text-[10px] uppercase font-bold text-slate-400 tracking-widest mt-1">Registre o recolhimento físico das barracas</CardDescription>
                  </CardHeader>
                  <CardContent className="p-6 md:p-8 space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest ml-1">Ponto de Venda</label>
                        <select 
                          className="flex h-14 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                          value={withdrawalStallId}
                          onChange={(e) => setWithdrawalStallId(e.target.value)}
                        >
                          <option value="">Selecionar Barraca</option>
                          {stalls.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
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
                    </div>
                    <Button onClick={handleWithdraw} className="w-full h-14 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl font-black uppercase tracking-[0.2em] text-[10px] shadow-xl active:scale-95 transition-all">
                      Confirmar Entrega de Valores
                    </Button>
                  </CardContent>
                </Card>

                <Card className="shadow-sm border-none rounded-[32px] overflow-hidden">
                  <CardHeader className="bg-slate-50 border-b border-slate-100 p-6 md:p-8 flex flex-row items-center justify-between">
                    <div>
                      <CardTitle className="text-xs font-black uppercase tracking-[0.2em] text-slate-900">Status por Barraca</CardTitle>
                      <CardDescription className="text-[10px] uppercase font-bold text-slate-400 tracking-widest mt-1">Balanço individualizado</CardDescription>
                    </div>
                    <Store className="h-5 w-5 text-slate-300" />
                  </CardHeader>
                  <CardContent className="p-6 md:p-8">
                    <div className="space-y-4 max-h-[350px] overflow-y-auto pr-2 custom-scrollbar">
                      {statsByStall.length === 0 ? (
                        <div className="py-20 text-center space-y-4">
                           <div className="h-12 w-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-300">
                             <Package className="h-6 w-6" />
                           </div>
                           <p className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em]">Nenhum dado disponível</p>
                        </div>
                      ) : (
                        statsByStall.map(stall => (
                          <div key={stall.id} className="flex items-center justify-between p-5 bg-slate-50 hover:bg-white hover:shadow-md hover:border-blue-100 rounded-3xl border border-slate-100 transition-all group">
                            <div className="flex items-center gap-4">
                              <div className="h-12 w-12 rounded-2xl bg-white border border-slate-100 flex items-center justify-center text-slate-400 group-hover:text-blue-600 transition-colors">
                                <Store className="h-5 w-5" />
                              </div>
                              <div className="space-y-0.5">
                                <p className="font-black text-slate-900 uppercase tracking-tight text-xs">{stall.name}</p>
                                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">Retirado: R$ {stall.totalWithdrawn.toFixed(2)}</p>
                                <div className="flex items-center gap-1.5">
                                  <div className="h-1 w-1 rounded-full bg-blue-500" />
                                  <p className="text-[9px] text-blue-600 font-black uppercase tracking-widest">{stall.productsSold || 0} Prod. Vendidos</p>
                                </div>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-lg font-black text-blue-600 tabular-nums tracking-tighter">R$ {stall.balance.toFixed(2)}</p>
                              <p className="text-[9px] text-slate-400 font-black uppercase tracking-widest">Saldo Disp.</p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
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
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div className="space-y-4 flex-1 max-w-2xl">
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
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border shadow-sm ${
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
                  
                  <div className="relative flex-1">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input 
                      placeholder="Buscar por nome, e-mail ou cartão..." 
                      value={userSearchQuery}
                      onChange={(e) => setUserSearchQuery(e.target.value)}
                      className="pl-12 h-14 bg-white border-slate-200 rounded-2xl shadow-sm focus:ring-blue-500 text-base"
                    />
                  </div>
                </div>
                
                <div className="text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em] px-4 mb-2">
                  <span className="text-blue-600">{filteredUsers.length}</span> Membros encontrados
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
              {filteredUsers.map(user => (
                <div key={user.uid} className="group flex flex-col bg-white rounded-[32px] border border-slate-200 shadow-sm hover:shadow-xl hover:border-blue-200 transition-all duration-500 overflow-hidden relative">
                  <div className="p-8">
                    <div className="flex items-start justify-between mb-8">
                      <div className="flex items-center gap-4">
                        <div className="h-16 w-16 rounded-2xl bg-slate-50 flex items-center justify-center text-blue-600 font-black text-2xl border border-slate-100 uppercase transition-transform group-hover:scale-110 shadow-inner">
                          {user.name.charAt(0)}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-black text-slate-900 uppercase tracking-tighter text-lg">{user.name}</h4>
                            <button 
                              onClick={() => setEditingUser(user)}
                              className="p-1 text-slate-400 hover:text-blue-600 transition-colors"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                            <button 
                              onClick={() => handleDeleteUser(user.uid)}
                              className="p-1 text-slate-400 hover:text-red-600 transition-colors"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <p className="text-[11px] text-slate-400 font-bold truncate max-w-[160px] uppercase tracking-widest">{user.email}</p>
                        </div>
                      </div>
                      <div className={`flex items-center gap-1.5 text-[9px] font-black uppercase px-3 py-1.5 rounded-xl border shadow-sm ${
                        user.role === 'vendor' ? 'bg-blue-50 text-blue-600 border-blue-100' : 
                        user.role === 'recharge' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                        user.role === 'admin' ? 'bg-slate-900 text-white border-slate-800' :
                        'bg-slate-50 text-slate-500 border-slate-100'
                      }`}>
                        {getRoleIcon(user.role)}
                        {user.role === 'student' ? 'Cliente' : 
                         user.role === 'vendor' ? 'Vendedor' : 
                         user.role === 'recharge' ? 'Recarga' : 'Admin'}
                      </div>
                    </div>

                    <div className="mt-8 mb-6 p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Saldo Disponível</label>
                        <p className="text-sm font-black text-slate-900">R$ {user.balance.toFixed(2)}</p>
                      </div>
                      <div className="flex gap-2">
                        <div className="relative flex-1 group/input">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400">R$</span>
                          <input 
                            type="number"
                            placeholder="0,00"
                            className="w-full text-xs font-bold rounded-xl border-slate-200 bg-white pl-8 p-2.5 transition-all focus:border-blue-500 outline-none"
                            value={rechargeAmounts[user.uid] || ''}
                            onChange={(e) => setRechargeAmounts(prev => ({ ...prev, [user.uid]: e.target.value }))}
                          />
                        </div>
                        <select
                          className="text-[10px] font-black uppercase tracking-tight rounded-xl border-slate-200 bg-white px-2 focus:border-blue-500 outline-none"
                          value={rechargePaymentMethods[user.uid] || 'Dinheiro'}
                          onChange={(e) => setRechargePaymentMethods(prev => ({ ...prev, [user.uid]: e.target.value }))}
                        >
                          <option value="Dinheiro">DINHEIRO</option>
                          <option value="Pix">PIX</option>
                          <option value="Débito">DÉBITO</option>
                          <option value="Crédito">CRÉDITO</option>
                          <option value="Conta">CONTA</option>
                        </select>
                        <Button 
                          size="sm" 
                          onClick={() => handleManualRecharge(user.uid)}
                          className="bg-slate-900 hover:bg-slate-800 text-white rounded-xl px-4 h-10 font-bold border-none"
                        >
                          Recarregar
                        </Button>
                      </div>
                    </div>
                  </div>
                  
                  <div className="mt-auto bg-white p-6 pt-0">
                    <div className="space-y-4 pt-6 border-t border-slate-100">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Acesso às Barracas</label>
                        <span className="text-[10px] text-slate-400 font-bold">{user.vendorIds?.length || 0} Ativa(s)</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {stalls.map(s => (
                          <label key={s.id} className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-tight cursor-pointer transition-all border ${
                            user.vendorIds?.includes(s.id) 
                              ? 'bg-blue-600 text-white border-blue-600 shadow-sm' 
                              : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                          }`}>
                            <input 
                              type="checkbox"
                              className="hidden"
                              checked={!!user.vendorIds?.includes(s.id)}
                              onChange={(e) => setUserVendorIds(user.uid, s.id, e.target.checked)}
                            />
                            {user.vendorIds?.includes(s.id) && <ShieldCheckIcon className="h-3 w-3" />}
                            {s.name}
                          </label>
                        ))}
                        {stalls.length === 0 && <p className="text-[10px] text-slate-400 italic">Cadastre barracas primeiro.</p>}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
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
                      <TableHead className="font-bold text-slate-900 py-4 uppercase text-[10px] tracking-widest">ID do Usuário</TableHead>
                      <TableHead className="font-bold text-slate-900 py-4 uppercase text-[10px] tracking-widest text-right">Valor</TableHead>
                      <TableHead className="font-bold text-slate-900 py-4 uppercase text-[10px] tracking-widest text-center">Tipo</TableHead>
                      <TableHead className="font-bold text-slate-900 py-4 uppercase text-[10px] tracking-widest">Descrição</TableHead>
                      <TableHead className="font-bold text-slate-900 py-4 uppercase text-[10px] tracking-widest text-right pr-8">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactions.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-12 text-slate-400 italic">
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
                                {users.find(u => u.uid === tx.userId)?.name || tx.userId}
                              </span>
                              <span className="text-[9px] text-slate-400 font-medium">#{tx.id.slice(0, 8)}</span>
                            </div>
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
                            <span className={`text-[10px] font-black uppercase px-3 py-1 rounded-full ${
                              tx.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 
                              tx.status === 'pending' ? 'bg-amber-100 text-amber-700' : 
                              'bg-rose-100 text-rose-700'
                            }`}>
                              {tx.status === 'completed' ? 'Pago' : tx.status === 'pending' ? 'Pendente' : 'Erro'}
                            </span>
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
                          await updateDoc(doc(db, 'users', uid), updateData);
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
  onSuccess 
}: { 
  externalScannedUser?: UserProfile | null, 
  setExternalScannedUser?: React.Dispatch<React.SetStateAction<UserProfile | null>>,
  onSuccess?: () => void
}) {
  const [internalScannedUser, setInternalScannedUser] = useState<UserProfile | null>(null);
  const scannedUser = externalScannedUser !== undefined ? externalScannedUser : internalScannedUser;
  const setScannedUser = setExternalScannedUser !== undefined ? setExternalScannedUser : setInternalScannedUser;

  const [isScanning, setIsScanning] = useState(false);
  const [amount, setAmount] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<string>('Dinheiro');
  const [processing, setProcessing] = useState(false);
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
      
      let q = query(collection(db, 'users'), where('qrCode', '==', cleanText));
      let snap = await getDocs(q);
      
      if (snap.empty) {
        q = query(collection(db, 'users'), where('linkedCards', 'array-contains', cleanText));
        snap = await getDocs(q);
      }

      if (!snap.empty) {
        const userData = snap.docs[0].data() as UserProfile;
        setScannedUser({ ...userData, uid: snap.docs[0].id });
        setIsScanning(false);
        setStatusModal({
          show: true,
          type: 'success',
          title: 'Cliente Identificado',
          message: `O cartão de ${userData.name} foi validado com sucesso.\nSaldo Atual: R$ ${userData.balance.toFixed(2)}`
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

    try {
      setProcessing(true);
      await updateDoc(doc(db, 'users', scannedUser.uid), {
        balance: increment(val)
      });

      await addDoc(collection(db, 'transactions'), {
        userId: scannedUser.uid,
        userName: scannedUser.name,
        amount: val,
        type: 'credit',
        description: `Recarga Ponto de Venda (${paymentMethod})`,
        paymentMethod,
        status: 'completed',
        timestamp: serverTimestamp()
      });

      setScannedUser(null);
      setAmount('');
      if (onSuccess) onSuccess();
      
      setStatusModal({
        show: true,
        type: 'success',
        title: 'Recarga Concluída',
        message: `A carga de R$ ${val.toFixed(2)} (${paymentMethod}) foi adicionada ao saldo de ${scannedUser.name}.\nNovo Saldo: R$ ${(scannedUser.balance + val).toFixed(2)}`
      });
    } catch (error) {
      console.error('Erro no processamento da carga:', error);
      setStatusModal({
        show: true,
        type: 'error',
        title: 'Falha na Recarga',
        message: 'Não foi possível processar o crédito. Verifique sua conexão e tente novamente.'
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
              <button 
                onClick={() => setIsScanning(true)} 
                className="w-full h-56 bg-white/[0.03] hover:bg-white/[0.05] border-2 border-dashed border-white/10 flex flex-col items-center justify-center gap-4 rounded-[40px] transition-all group active:scale-95"
              >
                <div className="p-5 bg-blue-600 rounded-full shadow-2xl shadow-blue-900/40 group-hover:scale-110 transition-transform">
                   <QrCode className="h-10 w-10 text-white" />
                </div>
                <span className="font-black text-xs uppercase tracking-[0.2em] text-slate-400">Toque para Escanear</span>
              </button>
            ) : isScanning ? (
              <div className="h-56 flex items-center justify-center bg-slate-900 rounded-[40px] border-2 border-dashed border-white/5">
                 <Loader2 className="h-10 w-10 text-blue-500 animate-spin" />
              </div>
            ) : scannedUser ? (
              <div className="p-8 bg-blue-600/10 border border-blue-500/20 rounded-[40px] space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
                <div className="flex justify-between items-start">
                  <div className="space-y-1">
                     <p className="text-[10px] font-black uppercase text-blue-400 tracking-[0.2em]">Cliente Confirmado</p>
                     <h3 className="text-3xl font-black tracking-tight">{scannedUser.name}</h3>
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
              <label className="text-[10px] font-black uppercase text-slate-500 tracking-[0.2em] px-2 block">Valor Personalizado</label>
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
