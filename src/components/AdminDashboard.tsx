import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db, auth } from '@/lib/firebase';
import { collection, addDoc, onSnapshot, query, deleteDoc, doc, updateDoc, orderBy, limit, Timestamp, increment, serverTimestamp, where, getDocs } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Stall, Product, UserProfile, Withdrawal, Order, Transaction } from '../types';
import { Plus, Trash2, Store, Package, Users, TrendingUp, DollarSign, History, LayoutDashboard, Settings as SettingsIcon, FileText, ShoppingCart, Smartphone, LogOut, ArrowLeftRight, QrCode, CircleCheck as CircleCheckIcon, Printer, Loader2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { toast } from 'sonner';
import VendorDashboard from './VendorDashboard';
import ShopView from './ShopView';
import { handleFirestoreError, OperationType } from '@/lib/error-handler';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type AdminTab = 'overview' | 'stalls' | 'products' | 'users' | 'terminal' | 'app_view' | 'recharge_pos' | 'transactions' | 'card_printer';

export default function AdminDashboard({ profile }: { profile: UserProfile }) {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  
  const [stalls, setStalls] = useState<Stall[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [recentSales, setRecentSales] = useState<any[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  
  const [newStallName, setNewStallName] = useState('');
  const [newProductName, setNewProductName] = useState('');
  const [newProductPrice, setNewProductPrice] = useState('');
  const [selectedStallId, setSelectedStallId] = useState('');
  
  const [withdrawalAmount, setWithdrawalAmount] = useState('');
  const [withdrawalStallId, setWithdrawalStallId] = useState('');

  useEffect(() => {
    const unsubStalls = onSnapshot(collection(db, 'stalls'), (snap) => {
      setStalls(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Stall)));
    });

    const unsubProducts = onSnapshot(collection(db, 'products'), (snap) => {
      setProducts(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product)));
    });

    const unsubUsers = onSnapshot(collection(db, 'users'), (snap) => {
      setUsers(snap.docs.map(doc => ({ ...doc.data(), uid: doc.id } as UserProfile)));
    });

    const qSales = query(collection(db, 'consumption'), orderBy('timestamp', 'desc'), limit(10));
    const unsubSales = onSnapshot(qSales, (snap) => {
      setRecentSales(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const unsubWithdrawals = onSnapshot(collection(db, 'withdrawals'), (snap) => {
      setWithdrawals(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Withdrawal)));
    });

    const unsubTransactions = onSnapshot(query(collection(db, 'transactions'), orderBy('timestamp', 'desc')), (snap) => {
      setTransactions(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction)));
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

  const statsByStall = useMemo(() => {
    return stalls.map(stall => {
      const sales = recentSales.filter(s => s.stallId === stall.id);
      const totalSales = sales.reduce((acc, curr) => acc + (curr.amount || 0), 0);
      const stallWithdrawals = withdrawals.filter(w => w.stallId === stall.id);
      const totalWithdrawn = stallWithdrawals.reduce((acc, curr) => acc + (curr.amount || 0), 0);
      
      return {
        ...stall,
        totalSales,
        totalWithdrawn,
        balance: totalSales - totalWithdrawn
      };
    });
  }, [stalls, recentSales, withdrawals]);

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
      toast.error('Erro ao registrar retirada');
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
      toast.error('Erro ao cadastrar barraca');
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
      toast.error('Erro ao cadastrar produto');
    }
  };

  const [rechargeAmounts, setRechargeAmounts] = useState<{[key: string]: string}>({});

  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserName, setNewUserName] = useState('');
  
  const [batchSize, setBatchSize] = useState(24);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showPrintView, setShowPrintView] = useState(false);
  const [cardBgUrl, setCardBgUrl] = useState('https://images.unsplash.com/photo-1614850523296-d8c1af93d400?auto=format&fit=crop&q=80&w=1000');

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
        role: 'student',
        balance: 0,
        vendorIds: [],
        qrCode: `TEMP-${Date.now()}`,
        timestamp: serverTimestamp()
      });

      setNewUserEmail('');
      setNewUserName('');
      toast.success('Membro pré-cadastrado com sucesso!');
    } catch (error) {
      toast.error('Erro ao cadastrar membro');
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
      toast.error('Erro ao processar recarga');
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
      toast.error('Erro ao atualizar associações');
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
      toast.error('Erro ao gerar cartões');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDeleteStall = async (id: string) => {
    if (!confirm('Excluir esta barraca e todos os seus produtos?')) return;
    try {
      await deleteDoc(doc(collection(db, 'stalls'), id));
      const stallProducts = products.filter(p => p.vendorId === id);
      for (const p of stallProducts) {
        await deleteDoc(doc(collection(db, 'products'), p.id));
      }
      toast.success('Barraca excluída');
    } catch (error) {
      toast.error('Erro ao excluir barraca');
    }
  };

  const handleDeleteProduct = async (id: string) => {
    try {
      await deleteDoc(doc(collection(db, 'products'), id));
      toast.success('Produto excluído');
    } catch (error) {
      toast.error('Erro ao excluir produto');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar */}
      <aside className="w-72 bg-slate-900 text-white p-6 flex flex-col gap-8 sticky top-0 h-screen overflow-hidden">
        <div className="flex items-center gap-3 px-2">
          <div className="p-2 bg-blue-600 rounded-lg">
            <LayoutDashboard className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="font-black text-xl tracking-tight leading-none">MAESTRO</h1>
            <p className="text-[10px] text-blue-400 font-bold uppercase tracking-widest mt-1">Gestão Central</p>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
          <div className="space-y-6">
            <section>
              <label className="text-[10px] font-black uppercase text-slate-500 px-3 mb-2 block tracking-widest">Administração</label>
              <nav className="flex flex-col gap-1">
                <Button 
                  variant="ghost" 
                  onClick={() => setActiveTab('overview')}
                  className={`justify-start gap-3 h-11 rounded-xl border-none transition-all ${activeTab === 'overview' ? 'bg-white/10 text-white shadow-sm' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                >
                  <TrendingUp className="h-4 w-4" /> Gestão Financeira
                </Button>
                <Button 
                  variant="ghost" 
                  onClick={() => setActiveTab('stalls')}
                  className={`justify-start gap-3 h-11 rounded-xl border-none transition-all ${activeTab === 'stalls' ? 'bg-white/10 text-white shadow-sm' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                >
                  <Store className="h-4 w-4" /> Barracas
                </Button>
                <Button 
                  variant="ghost" 
                  onClick={() => setActiveTab('products')}
                  className={`justify-start gap-3 h-11 rounded-xl border-none transition-all ${activeTab === 'products' ? 'bg-white/10 text-white shadow-sm' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                >
                  <Package className="h-4 w-4" /> Catálogo Geral
                </Button>
                <Button 
                  variant="ghost" 
                  onClick={() => setActiveTab('users')}
                  className={`justify-start gap-3 h-11 rounded-xl border-none transition-all ${activeTab === 'users' ? 'bg-white/10 text-white shadow-sm' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                >
                  <Users className="h-4 w-4" /> Gestão de Equipe
                </Button>
                <Button 
                  variant="ghost" 
                  onClick={() => setActiveTab('transactions')}
                  className={`justify-start gap-3 h-11 rounded-xl border-none transition-all ${activeTab === 'transactions' ? 'bg-white/10 text-white shadow-sm' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                >
                  <History className="h-4 w-4" /> Histórico de Vendas
                </Button>
                <Button 
                  variant="ghost" 
                  onClick={() => setActiveTab('card_printer')}
                  className={`justify-start gap-3 h-11 rounded-xl border-none transition-all ${activeTab === 'card_printer' ? 'bg-white/10 text-white shadow-sm' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                >
                  <Printer className="h-4 w-4" /> Impressor de Cartões
                </Button>
              </nav>
            </section>

            <section>
              <label className="text-[10px] font-black uppercase text-slate-500 px-3 mb-2 block tracking-widest">Canais de Venda</label>
              <nav className="flex flex-col gap-1">
                <Button 
                  variant="ghost" 
                  onClick={() => setActiveTab('terminal')}
                  className={`justify-start gap-3 h-11 rounded-xl border-none transition-all ${activeTab === 'terminal' ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                >
                  <ShoppingCart className="h-4 w-4" /> Terminal PDV (Caixa)
                </Button>
                <Button 
                  variant="ghost" 
                  onClick={() => setActiveTab('recharge_pos')}
                  className={`justify-start gap-3 h-11 rounded-xl border-none transition-all ${activeTab === 'recharge_pos' ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                >
                  <QrCode className="h-4 w-4" /> Carga e Recarga
                </Button>
                <Button 
                  variant="ghost" 
                  onClick={() => setActiveTab('app_view')}
                  className={`justify-start gap-3 h-11 rounded-xl border-none transition-all ${activeTab === 'app_view' ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                >
                  <Smartphone className="h-4 w-4" /> Portal do Aluno (App)
                </Button>
              </nav>
            </section>
          </div>
        </div>

        <div className="pt-6 border-t border-white/5">
          <div className="flex items-center gap-3 p-3 bg-white/5 rounded-2xl mb-4">
             <div className="h-8 w-8 rounded-full bg-slate-700 flex items-center justify-center text-[10px] font-bold">ADM</div>
             <div className="flex-1 overflow-hidden">
                <p className="text-xs font-bold truncate">{profile.name}</p>
                <p className="text-[10px] text-slate-500 truncate">Administrador</p>
             </div>
          </div>
          <Button 
            variant="ghost" 
            onClick={() => auth.signOut()}
            className="w-full justify-start gap-3 h-11 rounded-xl border-none text-red-400 hover:text-red-300 hover:bg-red-950/30"
          >
            <LogOut className="h-4 w-4" /> Sair do Sistema
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 h-screen overflow-y-auto">
        <div className="max-w-6xl mx-auto p-8">
          {activeTab === 'overview' && (
          <div className="space-y-8">
            <header>
              <h2 className="text-3xl font-black text-slate-900 uppercase tracking-tight">Gestão Financeira</h2>
              <p className="text-slate-500">Acompanhamento de vendas e retiradas de caixa</p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card className="shadow-sm border-none bg-blue-600 text-white">
                <CardHeader>
                  <CardTitle className="text-sm font-bold uppercase text-blue-100 flex items-center gap-2">
                    <DollarSign className="h-4 w-4" /> Vendas Totais
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-black">R$ {recentSales.reduce((a, b) => a + (b.amount || 0), 0).toFixed(2)}</p>
                  <p className="text-xs text-blue-200 mt-2">Volume histórico processado</p>
                </CardContent>
              </Card>

              <Card className="shadow-sm border-none bg-white">
                <CardHeader>
                  <CardTitle className="text-sm font-bold uppercase text-slate-500 flex items-center gap-2">
                    <History className="h-4 w-4 text-orange-500" /> Em Aberto
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-black text-slate-900">
                    R$ {(recentSales.reduce((a, b) => a + (b.amount || 0), 0) - withdrawals.reduce((a, b) => a + (b.amount || 0), 0)).toFixed(2)}
                  </p>
                  <p className="text-xs text-slate-400 mt-2">Valor pendente de retirada</p>
                </CardContent>
              </Card>

              <Card className="shadow-sm border-none bg-white">
                <CardHeader>
                  <CardTitle className="text-sm font-bold uppercase text-slate-500 flex items-center gap-2">
                    <FileText className="h-4 w-4 text-green-500" /> Retiradas
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-black text-slate-900">R$ {withdrawals.reduce((a, b) => a + (b.amount || 0), 0).toFixed(2)}</p>
                  <p className="text-xs text-slate-400 mt-2">Total já recolhido no caixa</p>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <Card className="shadow-sm border-none">
                <CardHeader>
                  <CardTitle>Retirada de Valor</CardTitle>
                  <CardDescription>Registre quando o valor físico for recolhido da barraca</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-2">
                    <select 
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={withdrawalStallId}
                      onChange={(e) => setWithdrawalStallId(e.target.value)}
                    >
                      <option value="">Selecione a Barraca</option>
                      {stalls.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <Input 
                      type="number"
                      placeholder="Valor R$" 
                      value={withdrawalAmount}
                      onChange={(e) => setWithdrawalAmount(e.target.value)}
                    />
                  </div>
                  <Button onClick={handleWithdraw} className="w-full bg-slate-900 hover:bg-slate-800">
                    Confirmar Entrega de Valores
                  </Button>
                </CardContent>
              </Card>

              <Card className="shadow-sm border-none">
                <CardHeader>
                  <CardTitle>Status por Barraca</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {statsByStall.map(stall => (
                      <div key={stall.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100">
                        <div>
                          <p className="font-bold text-slate-900">{stall.name}</p>
                          <p className="text-[10px] text-slate-400 uppercase font-black">Histórico: R$ {stall.totalSales.toFixed(2)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-black text-blue-600">Disp: R$ {stall.balance.toFixed(2)}</p>
                          <p className="text-[10px] text-slate-400 uppercase font-black">Retirado: R$ {stall.totalWithdrawn.toFixed(2)}</p>
                        </div>
                      </div>
                    ))}
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
                <div key={stall.id} className="p-6 bg-white rounded-2xl shadow-sm border border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-slate-50 rounded-xl">
                      <Store className="h-6 w-6 text-slate-400" />
                    </div>
                    <span className="font-black text-slate-900 uppercase text-sm tracking-widest">{stall.name}</span>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => handleDeleteStall(stall.id)} className="text-red-400 hover:text-red-600 hover:bg-red-50">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
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
                        <div key={product.id} className="flex items-center justify-between p-2 hover:bg-slate-50 rounded-lg group">
                          <div>
                            <p className="text-sm font-bold text-slate-900">{product.name}</p>
                            <p className="text-[10px] text-blue-600 font-bold">R$ {product.price.toFixed(2)}</p>
                          </div>
                          <Button variant="ghost" size="icon" onClick={() => handleDeleteProduct(product.id)} className="h-8 w-8 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'users' && (
          <div className="space-y-8 animate-in fade-in duration-500">
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-slate-200 pb-8">
              <div>
                <h2 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
                  <Users className="h-8 w-8 text-blue-600" />
                  EQUIPE DE VENDAS
                </h2>
                <p className="text-slate-500 mt-1 max-w-lg">
                  Gerencie acessos dos terminais, atribua barracas e controle saldos manuais de colaboradores e alunos.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Button 
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    try {
                      let bebidaStall = stalls.find(s => s.name === 'Bebida');
                      let stallId = bebidaStall?.id;

                      if (!bebidaStall) {
                        const docRef = await addDoc(collection(db, 'stalls'), {
                          name: 'Bebida',
                          createdAt: new Date().toISOString()
                        });
                        stallId = docRef.id;
                      }

                      const denisEmail = 'denis.alves@exemplo.com';
                      if (!users.find(u => u.email === denisEmail)) {
                        await addDoc(collection(db, 'users'), {
                          name: 'Denis Alves',
                          email: denisEmail,
                          role: 'vendor',
                          balance: 0,
                          vendorIds: [stallId],
                          qrCode: `TEMP-DENIS-${Date.now()}`,
                          timestamp: serverTimestamp()
                        });
                      }

                      const luisEmail = 'luis@exemplo.com';
                      if (!users.find(u => u.email === luisEmail)) {
                        await addDoc(collection(db, 'users'), {
                          name: 'Luis',
                          email: luisEmail,
                          role: 'admin',
                          balance: 0,
                          vendorIds: [],
                          qrCode: `TEMP-LUIS-${Date.now()}`,
                          timestamp: serverTimestamp()
                        });
                      }
                      toast.success('Configuração Denis/Luis aplicada!');
                    } catch (e) {
                      toast.error('Erro na configuração rápida');
                    }
                  }}
                  className="border-orange-200 text-orange-600 hover:bg-orange-50 font-bold text-[10px] uppercase tracking-widest px-4 h-10 rounded-xl"
                >
                  Configuração Rápida
                </Button>
              </div>
            </header>

            {/* Form Section */}
            <section className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
              <div className="flex flex-col md:flex-row items-center gap-8">
                <div className="md:w-1/3">
                  <h3 className="font-bold text-slate-900 text-lg uppercase tracking-tight">Novo Membro</h3>
                  <p className="text-slate-500 text-sm mt-1">Pré-cadastre usuários para que eles possam acessar o sistema.</p>
                </div>
                <form onSubmit={handleAddUser} className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5 flex-1">
                    <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Nome Completo</label>
                    <Input 
                      value={newUserName}
                      onChange={(e) => setNewUserName(e.target.value)}
                      placeholder="Ex: João Silva"
                      className="bg-slate-50 border-slate-200 h-11 focus-visible:ring-blue-500 rounded-xl"
                    />
                  </div>
                  <div className="space-y-1.5 flex-1">
                    <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">E-mail do Google</label>
                    <div className="flex gap-2">
                      <Input 
                        type="email"
                        value={newUserEmail}
                        onChange={(e) => setNewUserEmail(e.target.value)}
                        placeholder="exemplo@gmail.com"
                        className="bg-slate-50 border-slate-200 h-11 focus-visible:ring-blue-500 rounded-xl"
                      />
                      <Button type="submit" className="bg-slate-900 hover:bg-slate-800 text-white h-11 px-6 rounded-xl font-bold transition-all shrink-0">
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </form>
              </div>
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
              {users.filter(u => u.role !== 'admin').map(user => (
                <div key={user.uid} className="group flex flex-col bg-white rounded-3xl border border-slate-200 shadow-sm hover:shadow-md transition-all duration-300 overflow-hidden">
                  <div className="p-6 pb-0">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="h-12 w-12 rounded-2xl bg-blue-50 flex items-center justify-center text-blue-600 font-black text-lg border border-blue-100 uppercase">
                          {user.name.charAt(0)}
                        </div>
                        <div>
                          <h4 className="font-bold text-slate-900 uppercase tracking-tight">{user.name}</h4>
                          <p className="text-[11px] text-slate-400 font-medium truncate max-w-[140px] italic">{user.email}</p>
                        </div>
                      </div>
                      <div className={`text-[9px] font-black uppercase px-2.5 py-1 rounded-lg border ${
                        user.role === 'vendor' ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-slate-50 text-slate-500 border-slate-100'
                      }`}>
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
                      
                      /* Garantir cores e fundos */
                      * {
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                        color-adjust: exact !important;
                      }

                      /* Esconder tudo que não é o container de impressão */
                      body > div:not(#root), 
                      header, 
                      aside, 
                      nav, 
                      button:not(.print-only) {
                        display: none !important;
                      }

                      #root > div > div > main > div > section:not(.print-view-section),
                      #root > div > div > main > div > header {
                        display: none !important;
                      }

                      #printable-cards {
                        display: block !important;
                        position: absolute !important;
                        left: 0 !important;
                        top: 0 !important;
                        width: 100% !important;
                        visibility: visible !important;
                        background: white !important;
                      }

                      .print-card {
                        visibility: visible !important;
                        break-inside: avoid !important;
                        page-break-inside: avoid !important;
                        width: 85.6mm !important;
                        height: 53.98mm !important;
                        margin: 2mm !important;
                        display: inline-block !important;
                        position: relative !important;
                      }

                      .print-card img {
                        visibility: visible !important;
                        display: block !important;
                        width: 100% !important;
                        height: 100% !important;
                      }

                      #printable-cards * {
                        visibility: visible !important;
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
                <div>
                   <h2 className="text-2xl font-black text-white uppercase tracking-tighter">Terminal Integrado</h2>
                   <p className="text-slate-400 text-sm">Visão do vendedor/caixeiro em ambiente seguro</p>
                </div>
                <div className="px-3 py-1 bg-blue-600 text-white text-[10px] font-black rounded-full uppercase tracking-widest">Simulação Ativa</div>
              </div>
              <VendorDashboard profile={profile} />
            </div>
          )}

          {activeTab === 'recharge_pos' && (
            <div className="bg-slate-900 -m-8 min-h-screen p-8">
              <div className="mb-6 flex items-center justify-between border-b border-white/5 pb-6">
                <div>
                   <h2 className="text-2xl font-black text-white uppercase tracking-tighter">Carga e Recarga</h2>
                   <p className="text-slate-400 text-sm">Adicione créditos aos cartões dos alunos via QR Code</p>
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
        </div>
      </main>
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
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);

  useEffect(() => {
    if (isScanning && !scannerRef.current) {
      scannerRef.current = new Html5QrcodeScanner(
        "recharge-qr-reader",
        { fps: 10, qrbox: { width: 250, height: 250 } },
        false
      );
      
      scannerRef.current.render(async (decodedText) => {
        try {
          const q = query(collection(db, 'users'), where('qrCode', '==', decodedText));
          const snap = await getDocs(q);
          if (!snap.empty) {
            const userData = snap.docs[0].data() as UserProfile;
            setScannedUser({ ...userData, uid: snap.docs[0].id });
            setIsScanning(false);
            if (scannerRef.current) {
              await scannerRef.current.clear();
              scannerRef.current = null;
            }
          } else {
            toast.error('QR Code inválido ou usuário não encontrado');
          }
        } catch (error) {
          toast.error('Erro ao ler QR Code');
        }
      }, (error) => {
        // console.warn(error);
      });
    }

    return () => {
      if (scannerRef.current) {
        scannerRef.current.clear().catch(console.error);
        scannerRef.current = null;
      }
    };
  }, [isScanning]);

  const handleRecharge = async () => {
    const val = parseFloat(amount);
    if (!scannedUser || isNaN(val) || val <= 0) return;

    try {
      setProcessing(true);
      const userPath = `users/${scannedUser.uid}`;
      
      try {
        await updateDoc(doc(db, 'users', scannedUser.uid), {
          balance: increment(val)
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, userPath);
      }

      const txPath = 'transactions';
      try {
        await addDoc(collection(db, txPath), {
          userId: scannedUser.uid,
          userName: scannedUser.name,
          amount: val,
          type: 'credit',
          description: 'Carga/Recarga no Ponto de Venda',
          status: 'completed',
          timestamp: serverTimestamp()
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, txPath);
      }

      // Update local state to reflect new balance immediately
      setScannedUser(prev => prev ? { ...prev, balance: prev.balance + val } : null);
      setAmount('');
      toast.success(`Carga de R$ ${val.toFixed(2)} realizada com sucesso!`);
    } catch (error) {
      console.error('Erro no processamento da carga:', error);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-5xl mx-auto">
      <Card className="bg-slate-800 border-slate-700 text-white overflow-hidden">
        <CardHeader>
          <CardTitle>Identificação do Aluno</CardTitle>
          <CardDescription className="text-slate-400">Escaneie o QR Code para carga inicial ou novas recargas</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!isScanning && !scannedUser ? (
            <Button 
              onClick={() => setIsScanning(true)} 
              className="w-full h-48 bg-slate-700 hover:bg-slate-600 border-2 border-dashed border-slate-600 flex flex-col gap-4 rounded-3xl"
            >
              <QrCode className="h-12 w-12 text-blue-400" />
              <span className="font-bold text-lg">Clique para Escanear</span>
            </Button>
          ) : isScanning ? (
            <div className="space-y-4">
              <div id="recharge-qr-reader" className="w-full aspect-square rounded-2xl overflow-hidden bg-black border border-slate-700 shadow-inner"></div>
              <Button variant="ghost" onClick={() => setIsScanning(false)} className="w-full text-slate-400">Cancelar Leitura</Button>
            </div>
          ) : scannedUser ? (
            <div className="p-6 bg-blue-600/10 border border-blue-500/20 rounded-3xl space-y-4">
              <div className="flex justify-between items-start">
                <div>
                   <p className="text-[10px] font-black uppercase text-blue-400 tracking-widest mb-1">Aluno Identificado</p>
                   <h3 className="text-2xl font-black">{scannedUser.name}</h3>
                   <p className="text-slate-400 text-sm font-medium">{scannedUser.email}</p>
                </div>
                <Button variant="ghost" onClick={() => setScannedUser(null)} className="h-10 w-10 p-0 text-slate-500 hover:text-white">
                  <XCircle className="h-6 w-6" />
                </Button>
              </div>
              <div className="pt-4 border-t border-blue-500/10 flex items-center justify-between">
                <div>
                   <p className="text-xs text-slate-400 uppercase font-bold">Saldo Atual</p>
                   <p className="text-3xl font-black text-green-400">R$ {scannedUser.balance.toFixed(2)}</p>
                </div>
                <Button 
                  variant="outline" 
                  onClick={() => {
                    setScannedUser(null);
                    setAmount('');
                  }}
                  className="bg-slate-700/50 border-slate-600 text-slate-300 hover:text-white hover:bg-slate-700 rounded-xl"
                >
                  Próximo Aluno
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card className="bg-slate-800 border-slate-700 text-white">
          <CardHeader>
            <CardTitle>Valor da Carga</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 gap-3">
              {['10', '20', '50', '100'].map(val => (
                <Button 
                  key={val}
                  disabled={!scannedUser}
                  onClick={() => setAmount(val)}
                  className={`h-16 font-black text-xl border-none transition-all ${amount === val ? 'bg-blue-600 text-white shadow-lg' : 'bg-slate-700 hover:bg-slate-600 text-slate-300'}`}
                >
                  R$ {val}
                </Button>
              ))}
            </div>
            
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest px-1">Ou digite um valor manual</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 font-black text-slate-400">R$</span>
                <input 
                  type="number"
                  placeholder="0.00"
                  disabled={!scannedUser}
                  className="w-full bg-slate-900 border-slate-700 rounded-2xl h-14 pl-12 pr-4 font-black text-xl text-white focus:ring-2 focus:ring-blue-500 transition-all disabled:opacity-30"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
            </div>

            {processing ? (
              <Button disabled className="w-full h-20 bg-slate-700 text-slate-500 font-black text-2xl rounded-3xl">
                Processando...
              </Button>
            ) : scannedUser && amount ? (
              <Button 
                onClick={handleRecharge}
                className="w-full h-20 bg-green-600 hover:bg-green-500 text-white font-black text-2xl shadow-xl shadow-green-900/20 rounded-3xl transition-all"
              >
                Confirmar Carga
              </Button>
            ) : scannedUser && !amount ? (
              <Button 
                onClick={() => {
                  setScannedUser(null);
                  setAmount('');
                }}
                className="w-full h-20 bg-blue-600 hover:bg-blue-500 text-white font-black text-2xl rounded-3xl"
              >
                Próximo Aluno
              </Button>
            ) : (
              <Button 
                disabled
                className="w-full h-20 bg-slate-700 text-slate-500 font-black text-2xl disabled:opacity-30 rounded-3xl"
              >
                Aguardando QR Code
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
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
