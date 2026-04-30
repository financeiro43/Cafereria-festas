import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db, auth } from '@/lib/firebase';
import { collection, addDoc, onSnapshot, query, deleteDoc, doc, updateDoc, orderBy, limit, Timestamp, increment, serverTimestamp, where, getDocs } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Stall, Product, UserProfile, Withdrawal, Order } from '../types';
import { Plus, Trash2, Store, Package, Users, TrendingUp, DollarSign, History, LayoutDashboard, Settings as SettingsIcon, FileText, ShoppingCart, Smartphone, LogOut, ArrowLeftRight, QrCode, CircleCheck as CircleCheckIcon } from 'lucide-react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { toast } from 'sonner';
import VendorDashboard from './VendorDashboard';
import ShopView from './ShopView';

type AdminTab = 'overview' | 'stalls' | 'products' | 'users' | 'terminal' | 'app_view' | 'recharge_pos';

export default function AdminDashboard({ profile }: { profile: UserProfile }) {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  
  const [stalls, setStalls] = useState<Stall[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [recentSales, setRecentSales] = useState<any[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  
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

    return () => {
      unsubStalls();
      unsubProducts();
      unsubUsers();
      unsubSales();
      unsubWithdrawals();
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
          const snap = await getDocs(query(collection(db, 'users'), where('uid', '==', decodedText)));
          if (!snap.empty) {
            setScannedUser(snap.docs[0].data() as UserProfile);
            setIsScanning(false);
            if (scannerRef.current) {
              await scannerRef.current.clear();
              scannerRef.current = null;
            }
          } else {
            toast.error('Giro inválido ou usuário não encontrado');
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
      
      await updateDoc(doc(collection(db, 'users'), scannedUser.uid), {
        balance: increment(val)
      });

      await addDoc(collection(db, 'transactions'), {
        userId: scannedUser.uid,
        amount: val,
        type: 'credit',
        description: 'Carga/Recarga no Ponto de Venda',
        status: 'completed',
        timestamp: serverTimestamp()
      });

      toast.success(`Carga de R$ ${val.toFixed(2)} realizada para ${scannedUser.name}`);
      setScannedUser(null);
      setAmount('');
    } catch (error) {
      toast.error('Erro ao processar carga');
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
              <div className="pt-4 border-t border-blue-500/10">
                 <p className="text-xs text-slate-400 uppercase font-bold">Saldo Atual</p>
                 <p className="text-3xl font-black text-green-400">R$ {scannedUser.balance.toFixed(2)}</p>
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

            <Button 
              disabled={!scannedUser || !amount || processing}
              onClick={handleRecharge}
              className="w-full h-20 bg-green-600 hover:bg-green-500 text-white font-black text-2xl shadow-xl shadow-green-900/20 disabled:opacity-20 rounded-3xl transition-all"
            >
              {processing ? 'Processando...' : 'Confirmar Carga'}
            </Button>
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
