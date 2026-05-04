import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db, auth } from '@/lib/firebase';
import { collection, addDoc, onSnapshot, query, deleteDoc, doc, updateDoc, orderBy, limit, Timestamp, increment, serverTimestamp, where, getDocs, getDoc, setDoc } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Stall, Product, UserProfile, Withdrawal, Order, Transaction, UserRole } from '../types';
import { Plus, Trash2, Store, Package, Users, TrendingUp, DollarSign, History, LayoutDashboard, Settings as SettingsIcon, FileText, ShoppingCart, Smartphone, LogOut, ArrowLeftRight, QrCode, CircleCheck as CircleCheckIcon, Printer, Loader2, Menu, X, Search, CreditCard, ShieldCheck as ShieldCheckIcon, User as UserIcon, Edit2, Filter, Sparkles, Ticket } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import VendorDashboard from './VendorDashboard';
import ShopView from './ShopView';
import { handleFirestoreError, OperationType } from '@/lib/error-handler';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

import QRScanner from './QRScanner';

type AdminTab = 'overview' | 'stalls' | 'products' | 'users' | 'terminal' | 'app_view' | 'recharge_pos' | 'transactions' | 'card_printer';

export default function AdminDashboard({ profile, forcedTab }: { profile: UserProfile, forcedTab?: AdminTab }) {
  const [activeTab, setActiveTab] = useState<AdminTab>(forcedTab || 'overview');
  const [isMenuOpen, setIsMenuOpen] = useState(false);

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

    const unsubUsers = onSnapshot(collection(db, 'users'), (snap) => {
      setUsers(snap.docs.map(doc => ({ ...doc.data(), uid: doc.id } as UserProfile)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'users');
    });

    const qSales = query(collection(db, 'consumption'), orderBy('timestamp', 'desc'));
    const unsubSales = onSnapshot(qSales, (snap) => {
      setRecentSales(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'consumption');
    });

    const unsubWithdrawals = onSnapshot(collection(db, 'withdrawals'), (snap) => {
      setWithdrawals(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Withdrawal)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'withdrawals');
    });

    const unsubTransactions = onSnapshot(query(collection(db, 'transactions'), orderBy('timestamp', 'desc')), (snap) => {
      setTransactions(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'transactions');
    });

    return () => {
      unsubStalls();
      unsubProducts();
      unsubUsers();
      unsubSales();
      unsubWithdrawals();
      unsubTransactions();
    };
  }, []);

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

  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserRole, setNewUserRole] = useState<UserRole>('student');
  const [newUserVendorIds, setNewUserVendorIds] = useState<string[]>([]);
  const [settings, setSettings] = useState({
    siteName: 'Festa Pass',
    contactEmail: 'financeiro@modeloalpha.com.br',
    redePV: '',
    redeToken: '',
    isProduction: false
  });

  useEffect(() => {
    const fetchSettings = async () => {
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
  }, []);

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

  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all');
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);

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
    if (!window.confirm('Tem certeza que deseja excluir este usuário? Esta ação é irreversível.')) return;
    try {
      await deleteDoc(doc(db, 'users', userId));
      toast.success('Usuário removido com sucesso');
      if (editingUser?.uid === userId) setEditingUser(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${userId}`);
    }
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
        description: 'Recarga manual (Administrador)',
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
    if (!window.confirm('Excluir esta barraca e todos os seus produtos?')) return;
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
    if (!window.confirm('Excluir este produto?')) return;
    try {
      await deleteDoc(doc(db, 'products', id));
      toast.success('Produto excluído');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `products/${id}`);
    }
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
    { id: 'users', icon: Users, label: 'Gestão de Equipe', category: 'Administração' },
    { id: 'transactions', icon: History, label: 'Histórico de Vendas', category: 'Administração' },
    { id: 'card_printer', icon: Printer, label: 'Impressor de Cartões', category: 'Administração' },
    { id: 'terminal', icon: ShoppingCart, label: 'Terminal PDV (Caixa)', category: 'Canais de Venda' },
    { id: 'recharge_pos', icon: QrCode, label: 'Carga e Recarga', category: 'Canais de Venda' },
    { id: 'app_view', icon: Smartphone, label: 'Portal do Aluno (App)', category: 'Canais de Venda' },
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
                  GESTÃO DE EQUIPE
                </h2>
                <p className="text-slate-500 text-lg font-medium max-w-xl leading-relaxed">
                  Gerencie permissões, atribua barracas e controle acessos de colaboradores e estudantes de forma centralizada.
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
                  <h3 className="font-black text-slate-900 text-xl uppercase tracking-tighter">Pré-Cadastro de Membros</h3>
                  <p className="text-slate-500 text-sm mt-1 max-w-md">Adicione membros à equipe ou estudantes. Eles entrarão com as permissões definidas ao fazer login.</p>
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
                        { id: 'student', label: 'Estudante', icon: UserIcon },
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
                      { id: 'student', label: 'Estudantes', icon: UserIcon },
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
                        {user.role}
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
                            {user.vendorIds?.includes(s.id) && <CircleCheckIcon className="h-3 w-3" />}
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
                              <span className="font-bold text-slate-700 text-xs truncate max-w-[150px]">{tx.userId}</span>
                              <span className="text-[9px] text-slate-400 font-medium">#{tx.id.slice(0, 8)}</span>
                            </div>
                          </TableCell>
                          <TableCell className="py-4 text-right">
                            <span className={`font-black tracking-tight ${tx.type === 'credit' ? 'text-green-600' : 'text-slate-900'}`}>
                              {tx.type === 'credit' ? '+' : '-'} R$ {tx.amount.toFixed(2)}
                            </span>
                          </TableCell>
                          <TableCell className="py-4 text-center">
                            <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${
                              tx.type === 'credit' ? 'bg-green-50 text-green-600 border-green-100' : 'bg-slate-100 text-slate-500 border-slate-200'
                            }`}>
                              {tx.type === 'credit' ? 'Crédito' : 'Débito'}
                            </span>
                          </TableCell>
                          <TableCell className="py-4">
                            <span className="text-sm text-slate-600">{tx.description}</span>
                          </TableCell>
                          <TableCell className="py-4 text-right pr-8">
                            <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                              tx.status === 'completed' ? 'bg-blue-100 text-blue-600' : 'bg-orange-100 text-orange-600'
                            }`}>
                              {tx.status}
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
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-slate-200 pb-8">
              <div>
                <h2 className="text-3xl font-black text-slate-900 uppercase tracking-tight flex items-center gap-3">
                  <Printer className="h-8 w-8 text-blue-600" />
                  CARTÃO FÍSICO
                </h2>
                <p className="text-slate-500 mt-1">Gere cartões profissionais com QR Code para recarga e pagamentos presenciais.</p>
              </div>
              <div className="flex gap-3">
                <Button 
                  onClick={() => window.print()} 
                  variant="outline"
                  className="bg-white border-slate-200 text-slate-900 font-bold rounded-xl h-11"
                >
                  <Printer className="h-4 w-4 mr-2" /> Imprimir Agora
                </Button>
                <Button 
                  onClick={() => setShowPrintView(!showPrintView)} 
                  className="bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl h-11"
                >
                  {showPrintView ? 'Editar Lote' : 'Visualização de Impressão'}
                </Button>
              </div>
            </header>

            {!showPrintView ? (
              <section className="space-y-8">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <Card className="bg-slate-900 border-none rounded-3xl shadow-xl overflow-hidden p-8">
                    <div className="space-y-6">
                      <div className="space-y-1">
                        <h3 className="text-white font-black text-xl uppercase tracking-tight">Configurar Lote</h3>
                        <p className="text-slate-400 text-sm">Defina a quantidade e a identidade visual dos cartões.</p>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                          <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Qtd. de Cartões</label>
                          <Input 
                            type="number"
                            value={batchSize}
                            onChange={(e) => setBatchSize(parseInt(e.target.value))}
                            className="bg-slate-800 border-slate-700 text-white h-11 focus:ring-blue-500 rounded-xl"
                          />
                        </div>
                        <div className="space-y-4">
                          <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest block">Design do Cartão (Fundo)</label>
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
                                    reader.onloadend = () => setCardBgUrl(reader.result as string);
                                    reader.readAsDataURL(file);
                                  }
                                }}
                              />
                              <label 
                                htmlFor="card-bg-upload"
                                className="flex-1 flex items-center justify-center gap-2 bg-slate-800 border-2 border-dashed border-slate-700 text-slate-300 hover:text-white hover:border-blue-500 transition-all h-11 px-6 rounded-xl cursor-pointer text-xs font-bold"
                              >
                                <Store className="h-4 w-4" /> Selecionar Foto de Fundo
                              </label>
                            </div>
                            <div className="p-3 bg-blue-500/10 rounded-xl border border-blue-500/20">
                              <p className="text-[10px] text-blue-400 font-bold uppercase tracking-tight">Medidas Recomendadas:</p>
                              <p className="text-[9px] text-slate-400 leading-relaxed mt-1">
                                Padrão ID-1 (CR80): <span className="text-slate-300">85.6mm x 54mm</span><br/>
                                Proporção: <span className="text-slate-300">1.586 : 1</span><br/>
                                Qualidade (300 DPI): <span className="text-slate-300">1011 x 638 pixels</span>
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>

                      <Button 
                        onClick={handleGenerateCards} 
                        disabled={isGenerating}
                        className="w-full bg-blue-600 hover:bg-blue-500 text-white h-12 font-black uppercase tracking-tight disabled:opacity-50 rounded-xl"
                      >
                        {isGenerating ? <Loader2 className="h-5 w-5 animate-spin" /> : <><Plus className="h-4 w-4 mr-2" /> Gerar Novos Cartões</>}
                      </Button>
                    </div>
                  </Card>

                  <div className="flex flex-col justify-center items-center bg-slate-50 rounded-3xl border-2 border-dashed border-slate-200 p-8">
                    <p className="text-[10px] font-black uppercase text-slate-400 mb-4 tracking-widest">Preview do Cartão</p>
                    <div className="relative w-[340px] h-[215px] rounded-2xl shadow-2xl overflow-hidden border border-slate-200 bg-white">
                      <img src={cardBgUrl} alt="Background" className="absolute inset-0 w-full h-full object-cover opacity-80" referrerPolicy="no-referrer" />
                      <div className="absolute inset-0 bg-gradient-to-br from-slate-900/40 to-transparent" />
                      <div className="relative h-full p-6 flex flex-col justify-between text-white">
                         <div className="flex justify-between items-start">
                            <span className="text-[10px] font-black tracking-widest uppercase opacity-80">Maestro Card</span>
                            <LayoutDashboard className="h-6 w-6 opacity-80" />
                         </div>
                         <div className="flex justify-between items-end">
                            <div className="space-y-1">
                               <p className="text-[8px] font-bold text-white/60 uppercase tracking-widest">Portador</p>
                               <p className="text-sm font-black uppercase tracking-tight">Nome do Aluno/Cliente</p>
                            </div>
                            <div className="bg-white p-2 rounded-xl border border-white/20 shadow-lg">
                               <QRCodeSVG value="PREVIEW" size={70} />
                            </div>
                         </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">Cartões Gerados Recentemente</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {users.filter(u => u.isPhysicalCard).sort((a, b) => (b.timestamp?.toMillis?.() || 0) - (a.timestamp?.toMillis?.() || 0)).slice(0, 50).map(card => (
                      <Card key={card.uid} className="bg-white border-slate-200 rounded-2xl shadow-sm overflow-hidden group border">
                        <div className="relative h-32 w-full overflow-hidden">
                          <img src={cardBgUrl} alt="Background" className="absolute inset-0 w-full h-full object-cover group-hover:scale-110 transition-transform duration-500 opacity-60" referrerPolicy="no-referrer" />
                          <div className="absolute inset-0 bg-slate-900/10" />
                          <div className="absolute inset-0 flex items-center justify-center p-4">
                             <div className="bg-white p-2 rounded-lg border border-slate-100 shadow-sm">
                               <QRCodeSVG value={card.qrCode} size={60} />
                             </div>
                          </div>
                        </div>
                        <div className="p-4 space-y-3">
                          <div>
                            <p className="font-bold text-slate-900 text-xs uppercase tracking-tight">{card.name}</p>
                            <p className="text-[9px] text-slate-400 font-mono mt-0.5">{card.qrCode}</p>
                          </div>
                          <div className="flex items-center justify-between pt-3 border-t border-slate-50">
                             <p className="text-[10px] font-black text-blue-600 uppercase">Saldo: R$ {card.balance.toFixed(2)}</p>
                             <Button 
                              variant="ghost" 
                              size="icon" 
                              onClick={async () => {
                                if(confirm('Excluir este cartão?')) {
                                  await deleteDoc(doc(db, 'users', card.uid));
                                  toast.success('Cartão excluído');
                                }
                              }}
                              className="h-6 w-6 text-slate-300 hover:text-red-500"
                             >
                               <Trash2 className="h-3 w-3" />
                             </Button>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
              </section>
            ) : (
              <section className="bg-slate-100 p-8 md:p-12 rounded-3xl border border-slate-200 print-view-section">
                <div id="printable-cards" className="print:block">
                  <div className="grid grid-cols-2 gap-y-8 gap-x-8 justify-center items-center print:gap-x-4 print:gap-y-4">
                    {users.filter(u => u.isPhysicalCard).sort((a, b) => (b.timestamp?.toMillis?.() || 0) - (a.timestamp?.toMillis?.() || 0)).slice(0, batchSize).map(card => (
                      <div key={card.uid} className="relative print-card w-[85.6mm] h-[53.98mm] rounded-[12px] overflow-hidden bg-white shadow-sm border border-slate-200 print:shadow-none mx-auto">
                        <img src={cardBgUrl} alt="Background" className="absolute inset-0 w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-slate-900/10" />
                        <div className="relative h-full p-6 flex flex-col justify-between text-white">
                           <div className="flex justify-between items-start">
                              <span className="text-[10px] font-black tracking-widest uppercase drop-shadow-sm">MAESTRO EVENTOS</span>
                              <div className="h-8 w-8 bg-white/20 backdrop-blur-sm rounded-lg border border-white/20 flex items-center justify-center">
                                 <LayoutDashboard className="h-4 w-4 text-white" />
                              </div>
                           </div>
                           <div className="flex justify-between items-end">
                              <div className="space-y-1">
                                 <p className="text-[8px] font-bold text-white uppercase tracking-[0.2em] drop-shadow-sm">Identificação</p>
                                 <p className="text-sm font-black uppercase tracking-tight drop-shadow-md">{card.name}</p>
                                 <p className="text-[8px] font-mono text-white/70 uppercase tracking-tighter drop-shadow-sm">{card.qrCode}</p>
                              </div>
                              <div className="bg-white p-3 rounded-xl border border-white/10 shadow-2xl">
                                 <QRCodeSVG value={card.qrCode} size={80} level="M" />
                              </div>
                           </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <style>{`
                    @media print {
                      @page {
                        size: A4 portrait;
                        margin: 10mm;
                      }
                      
                      * {
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                        color-adjust: exact !important;
                      }

                      body {
                        visibility: hidden !important;
                      }

                      #printable-cards, #printable-cards * {
                        visibility: visible !important;
                      }

                      #printable-cards {
                        display: block !important;
                        position: absolute !important;
                        left: 0 !important;
                        top: 0 !important;
                        width: 100% !important;
                        background: white !important;
                      }

                      .print-card {
                        break-inside: avoid !important;
                        page-break-inside: avoid !important;
                        width: 85.6mm !important;
                        height: 53.98mm !important;
                        margin: 2mm !important;
                        display: inline-block !important;
                        position: relative !important;
                        border: 0.1mm solid #ddd !important;
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
            )}
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
              <VendorDashboard profile={profile} />
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
                    <p className="text-slate-400 text-sm">Adicione créditos aos cartões dos alunos via QR Code</p>
                  </div>
                </div>
                <div className="px-3 py-1 bg-green-600 text-white text-[10px] font-black rounded-full uppercase tracking-widest">Caixa Aberto</div>
              </div>
              <RechargePortal />
            </div>
          )}

          {activeTab === 'app_view' && (
            <div className="bg-white -m-8 min-h-screen p-8">
              <div className="mb-8 p-6 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-between">
                <div>
                   <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tighter">Portal do Aluno</h2>
                   <p className="text-slate-500 text-sm">Como os alunos e pais visualizam e compram via app</p>
                </div>
                <div className="flex gap-2">
                   <div className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl">
                      <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                      <span className="text-xs font-bold text-slate-600 uppercase tracking-widest">Preview Live</span>
                   </div>
                </div>
              </div>
              <div className="max-w-4xl mx-auto bg-slate-100 p-8 rounded-[40px] shadow-2xl border-4 border-white">
                <div className="bg-white rounded-[32px] overflow-hidden min-h-[600px] shadow-inner">
                   <ShopView profile={profile} />
                </div>
              </div>
            </div>
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
                       <CreditCard className="h-5 w-5 text-blue-600" />
                       GATEWAY REDE (PAGAMENTO)
                     </h3>
                     <div className="grid grid-cols-1 gap-6">
                        <div className="space-y-2">
                          <Label className="text-[10px] uppercase font-black tracking-widest text-slate-400 ml-1">PV (Número do Estabelecimento)</Label>
                          <Input 
                            placeholder="Ex: 123456789"
                            value={settings.redePV}
                            onChange={(e) => setSettings({ ...settings, redePV: e.target.value })}
                            className="bg-slate-50 border-slate-200 h-14 rounded-2xl font-medium"
                          />
                          <p className="text-[10px] text-slate-400 font-medium px-1">O seu "PV" fornecido pela Rede para integração e-commerce.</p>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-[10px] uppercase font-black tracking-widest text-slate-400 ml-1">Token de Autenticação</Label>
                          <Input 
                            type="password"
                            placeholder="••••••••••••••••"
                            value={settings.redeToken}
                            onChange={(e) => setSettings({ ...settings, redeToken: e.target.value })}
                            className="bg-slate-50 border-slate-200 h-14 rounded-2xl font-medium"
                          />
                          <p className="text-[10px] text-slate-400 font-medium px-1">A chave de segurança secreta para autorizar transações.</p>
                        </div>
                        <div className="flex items-center gap-4 p-4 bg-blue-50 border border-blue-100 rounded-2xl">
                          <div className={`h-10 w-20 rounded-full bg-white border border-blue-200 flex items-center p-1 cursor-pointer transition-all ${settings.isProduction ? 'justify-end bg-blue-600 border-blue-600' : 'justify-start'}`}
                               onClick={() => setSettings({ ...settings, isProduction: !settings.isProduction })}>
                             <div className="h-8 w-8 bg-white rounded-full shadow-md" />
                          </div>
                          <div>
                            <p className="text-[10px] font-black uppercase text-blue-900">Modo Produção</p>
                            <p className="text-[8px] font-bold text-blue-700/60 uppercase tracking-widest">
                              {settings.isProduction ? 'Transações Reais Ativadas' : 'Ambiente de Testes (Sandbox)'}
                            </p>
                          </div>
                        </div>
                     </div>
                   </div>
                </div>

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
                      { id: 'student', label: 'Estudante', icon: UserIcon },
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

function RechargePortal() {
  const [scannedUser, setScannedUser] = useState<UserProfile | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [amount, setAmount] = useState<string>('');
  const [processing, setProcessing] = useState(false);

  const onScanSuccess = async (decodedText: string) => {
    try {
      const q = query(collection(db, 'users'), where('qrCode', '==', decodedText));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const userData = snap.docs[0].data() as UserProfile;
        setScannedUser({ ...userData, uid: snap.docs[0].id });
        setIsScanning(false);
        toast.success(`Identificado: ${userData.name}`);
      } else {
        toast.error('QR Code inválido ou usuário não encontrado');
      }
    } catch (error) {
      toast.error('Erro ao ler QR Code');
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
        description: 'Carga/Recarga no Ponto de Venda',
        status: 'completed',
        timestamp: serverTimestamp()
      });

      setScannedUser(prev => prev ? { ...prev, balance: prev.balance + val } : null);
      setAmount('');
      toast.success(`Carga de R$ ${val.toFixed(2)} realizada com sucesso!`);
    } catch (error) {
      console.error('Erro no processamento da carga:', error);
      toast.error('Ocorreu um erro ao processar a carga.');
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
            <CardDescription className="text-slate-400 text-sm">Escaneie o cartão do aluno para iniciar a recarga</CardDescription>
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
                     <p className="text-[10px] font-black uppercase text-blue-400 tracking-[0.2em]">Aluno Confirmado</p>
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
                  Trocar de Aluno
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
                      {!scannedUser ? 'ESCANEAR ALUNO PARA CONTINUAR' : 'SELECIONE OU DIGITE UM VALOR'}
                   </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
      
      {isScanning && (
        <QRScanner onScan={onScanSuccess} onClose={() => setIsScanning(false)} title="Recarregar Aluno" />
      )}
    </div>
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
