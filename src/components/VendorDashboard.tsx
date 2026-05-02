import React, { useState, useEffect, useRef, useMemo } from 'react';
import { db, auth } from '@/lib/firebase';
import { collection, query, where, getDocs, addDoc, doc, updateDoc, increment, serverTimestamp, onSnapshot, orderBy, limit } from 'firebase/firestore';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UserProfile, Product, Stall, Order } from '../types';
import { handleFirestoreError, OperationType } from '@/lib/error-handler';
import { QrCode, ShoppingCart, Users, LogOut, CheckCircle2, XCircle, Plus, Minus, Trash2, Store, Clock, PackageCheck, Loader2, Search, ChevronLeft, ChevronRight, BarChart3, TrendingUp, Package } from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';

import QRScanner from './QRScanner';

interface CartItem extends Product {
  quantity: number;
}

export default function VendorDashboard({ profile }: { profile: UserProfile }) {
  const [activeStallId, setActiveStallId] = useState<string | null>(profile.vendorIds?.[0] || null);
  const [availableStalls, setAvailableStalls] = useState<Stall[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [stall, setStall] = useState<Stall | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [activeTab, setActiveTab] = useState<'pos' | 'orders' | 'analytics'>('pos');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [scannedUser, setScannedUser] = useState<UserProfile | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  // POS View State
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 12;

  // Analytics State
  const [stats, setStats] = useState({ 
    totalRevenue: 0, 
    totalItems: 0, 
    productSales: {} as Record<string, { count: number; revenue: number; name: string }> 
  });
  const [statsLoading, setStatsLoading] = useState(false);

  useEffect(() => {
    if (profile.role === 'admin') {
      const unsub = onSnapshot(collection(db, 'stalls'), (snap) => {
        setAvailableStalls(snap.docs.map(d => ({ id: d.id, ...d.data() } as Stall)));
      });
      return () => unsub();
    } else if (profile.vendorIds && profile.vendorIds.length > 0) {
      const q = query(collection(db, 'stalls'), where('__name__', 'in', profile.vendorIds));
      const unsub = onSnapshot(q, (snap) => {
        setAvailableStalls(snap.docs.map(d => ({ id: d.id, ...d.data() } as Stall)));
      });
      return () => unsub();
    }
  }, [profile.vendorIds, profile.role]);

  useEffect(() => {
    if (profile.role === 'admin' && availableStalls.length > 0 && !activeStallId) {
      setActiveStallId(availableStalls[0].id);
    }
  }, [availableStalls, profile.role, activeStallId]);

  useEffect(() => {
    if (!activeStallId) {
      setLoading(false);
      return;
    }

    setLoading(true);

    // Fetch Stall Info
    const stallRef = doc(collection(db, 'stalls'), activeStallId);
    const unsubStall = onSnapshot(stallRef, (snap) => {
      if (snap.exists()) {
        setStall({ id: snap.id, ...snap.data() } as Stall);
      }
    });

    // Fetch Products for this Stall
    const qP = query(collection(db, 'products'), where('vendorId', '==', activeStallId), where('active', '==', true));
    const unsubProducts = onSnapshot(qP, (snap) => {
      setProducts(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product)));
      setLoading(false);
    });

    // Fetch Digital Orders
    const qO = query(
      collection(db, 'orders'), 
      where('stallId', '==', activeStallId), 
      where('status', '==', 'pending')
    );
    const unsubOrders = onSnapshot(qO, (snap) => {
      const ordersData = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order));
      // Sort on client side to avoid composite index requirement
      const sortedOrders = ordersData.sort((a, b) => {
        const timeA = a.timestamp?.toMillis ? a.timestamp.toMillis() : 0;
        const timeB = b.timestamp?.toMillis ? b.timestamp.toMillis() : 0;
        return timeA - timeB; // Oldest first for delivery queue
      });
      setOrders(sortedOrders);
    });

    return () => {
      unsubStall();
      unsubProducts();
      unsubOrders();
    };
  }, [activeStallId]);

  // Analytics Aggregation
  useEffect(() => {
    if (activeTab !== 'analytics' || !activeStallId) return;

    setStatsLoading(true);
    const q = query(collection(db, 'consumption'), where('stallId', '==', activeStallId), orderBy('timestamp', 'desc'), limit(1000));
    
    const unsub = onSnapshot(q, (snap) => {
      const newStats = { 
        totalRevenue: 0, 
        totalItems: 0, 
        productSales: {} as Record<string, { count: number; revenue: number; name: string }> 
      };
      
      snap.docs.forEach(doc => {
        const data = doc.data();
        newStats.totalRevenue += data.amount || 0;
        
        // Detailed items analysis (New format)
        if (data.detailedItems && Array.isArray(data.detailedItems)) {
          data.detailedItems.forEach((item: { name: string; quantity: number; subtotal: number }) => {
            newStats.totalItems += item.quantity;
            if (!newStats.productSales[item.name]) {
              newStats.productSales[item.name] = { count: 0, revenue: 0, name: item.name };
            }
            newStats.productSales[item.name].count += item.quantity;
            newStats.productSales[item.name].revenue += item.subtotal;
          });
        } 
        // Fallback for old simple "items" array format
        else if (data.items && Array.isArray(data.items)) {
          data.items.forEach((itemStr: string) => {
            const match = itemStr.match(/(\d+)x\s(.+)/);
            if (match) {
              const qty = parseInt(match[1]);
              const name = match[2];
              newStats.totalItems += qty;
              if (!newStats.productSales[name]) {
                newStats.productSales[name] = { count: 0, revenue: 0, name };
              }
              newStats.productSales[name].count += qty;
            }
          });
        }
      });

      setStats(newStats);
      setStatsLoading(false);
    });

    return () => unsub();
  }, [activeTab, activeStallId]);

  const filteredProducts = useMemo(() => {
    return products.filter(p => 
      p.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [products, searchQuery]);

  const paginatedProducts = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredProducts.slice(start, start + itemsPerPage);
  }, [filteredProducts, currentPage]);

  const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);

  const markAsDelivered = async (orderId: string) => {
    try {
      await updateDoc(doc(collection(db, 'orders'), orderId), {
        status: 'delivered',
        deliveredAt: serverTimestamp()
      });
      toast.success('Pedido entregue!');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `orders/${orderId}`);
    }
  };

  const cartTotal = useMemo(() => {
    return cart.reduce((acc, item) => acc + (item.price * item.quantity), 0);
  }, [cart]);

  const cartItemsNames = useMemo(() => {
    return cart.map(item => `${item.quantity}x ${item.name}`).join(', ');
  }, [cart]);

  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) {
        return prev.map(item => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { ...product, quantity: 1 }];
    });
  };

  const removeFromCart = (productId: string) => {
    setCart(prev => {
      const existing = prev.find(item => item.id === productId);
      if (existing && existing.quantity > 1) {
        return prev.map(item => item.id === productId ? { ...item, quantity: item.quantity - 1 } : item);
      }
      return prev.filter(item => item.id !== productId);
    });
  };

  const clearCart = () => setCart([]);

  const onScanSuccess = async (decodedText: string) => {
    try {
      setIsScanning(false);
      
      // Tentar encontrar por QR Code principal
      let q = query(collection(db, 'users'), where('qrCode', '==', decodedText));
      let querySnapshot = await getDocs(q);
      
      // Se não encontrar, tentar pelos cartões vinculados
      if (querySnapshot.empty) {
        q = query(collection(db, 'users'), where('linkedCards', 'array-contains', decodedText));
        querySnapshot = await getDocs(q);
      }
      
      if (querySnapshot.empty) {
        toast.error('Aluno não encontrado');
        return;
      }

      const userData = querySnapshot.docs[0].data() as UserProfile;
      setScannedUser({ ...userData, uid: querySnapshot.docs[0].id });
      toast.success(`Identificado: ${userData.name}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'users');
    }
  };

  const handleSale = async () => {
    if (!scannedUser || cartTotal <= 0) return;

    try {
      setProcessing(true);
      
      if (scannedUser.balance < cartTotal) {
        toast.error('Saldo insuficiente');
        return;
      }

      // We should use a transaction here for atomicity, but let's at least add error handling for each step
      try {
        await updateDoc(doc(db, 'users', scannedUser.uid), {
          balance: increment(-cartTotal)
        });
      } catch (e) {
        return handleFirestoreError(e, OperationType.UPDATE, `users/${scannedUser.uid}`);
      }

      try {
        await addDoc(collection(db, 'transactions'), {
          userId: scannedUser.uid,
          userName: scannedUser.name,
          amount: -cartTotal,
          type: 'debit',
          description: `Compra na barraca ${stall?.name || ''}: ${cartItemsNames}`,
          status: 'completed',
          timestamp: serverTimestamp()
        });
      } catch (e) {
        handleFirestoreError(e, OperationType.CREATE, 'transactions');
      }

      try {
        await addDoc(collection(db, 'consumption'), {
          studentId: scannedUser.uid,
          vendorId: profile.uid,
          stallId: activeStallId,
          amount: cartTotal,
          items: cart.map(item => `${item.quantity}x ${item.name}`),
          detailedItems: cart.map(item => ({
            productId: item.id,
            name: item.name,
            quantity: item.quantity,
            price: item.price,
            subtotal: item.price * item.quantity
          })),
          timestamp: serverTimestamp()
        });
      } catch (e) {
        handleFirestoreError(e, OperationType.CREATE, 'consumption');
      }

      toast.success(`Venda de R$ ${cartTotal.toFixed(2)} concluída!`);
      // Update local state to reflect new balance
      setScannedUser(prev => prev ? { ...prev, balance: prev.balance - cartTotal } : null);
      clearCart();
    } catch (error) {
      console.error('Erro no processamento da venda:', error);
      // Already handled by nested tries or generic catch if top-level logic fails
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return <div className="h-screen bg-slate-900 flex items-center justify-center font-bold text-white">Carregando Terminal...</div>;
  }

  if (!(profile.vendorIds && profile.vendorIds.length > 0) && profile.role !== 'admin') {
    return (
      <div className="h-screen bg-slate-900 flex flex-col items-center justify-center p-8 text-center text-white">
        <Store className="h-20 w-20 text-slate-700 mb-6" />
        <h1 className="text-3xl font-black mb-4">Barraca Não Vinculada</h1>
        <p className="text-slate-400 max-w-md">O administrador precisa vincular seu perfil a uma barraca nas configurações.</p>
        <Button variant="ghost" onClick={() => auth.signOut()} className="mt-8 text-slate-500">Sair da conta</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white pb-32 md:pb-8 relative overflow-hidden">
      {/* Background Decorative Elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-blue-600/10 blur-[120px] rounded-full" />
        <div className="absolute top-[20%] -right-[10%] w-[30%] h-[30%] bg-indigo-600/10 blur-[100px] rounded-full" />
        <div className="absolute -bottom-[10%] left-[20%] w-[50%] h-[40%] bg-blue-900/10 blur-[150px] rounded-full" />
      </div>

      <div className="max-w-[1536px] mx-auto px-4 py-4 md:px-6 md:py-6 space-y-6 relative z-10">
        <header className="flex flex-col md:flex-row justify-between items-center gap-4 bg-slate-900/40 backdrop-blur-xl border border-white/10 p-4 rounded-3xl shadow-2xl sticky top-2 z-30 transition-all duration-300">
          <div className="flex items-center gap-4 w-full md:w-auto">
            <div className="h-12 w-12 bg-gradient-to-br from-blue-500 to-blue-700 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20 ring-1 ring-white/20">
              <Store className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1">
              <p className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em] mb-1">Terminal Ativo</p>
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-black text-white tracking-tight leading-none">{stall?.name || 'Carregando...'}</h2>
                {(profile.role === 'admin' || (profile.vendorIds && profile.vendorIds.length > 1)) && (
                  <select 
                    className="bg-white/5 hover:bg-white/10 text-[10px] px-3 py-1.5 rounded-xl border border-white/10 font-black text-blue-400 uppercase outline-none transition-all cursor-pointer"
                    value={activeStallId || ''}
                    onChange={(e) => setActiveStallId(e.target.value)}
                  >
                    {profile.role === 'admin' && <option value="" className="bg-slate-900">Selecionar...</option>}
                    {availableStalls.map(s => <option key={s.id} value={s.id} className="bg-slate-900">{s.name}</option>)}
                  </select>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto justify-between sm:justify-end">
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="bg-white/5 p-1 rounded-2xl border border-white/5">
              <TabsList className="bg-transparent border-none h-10 gap-1">
                <TabsTrigger value="pos" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white font-black text-[10px] uppercase h-8 px-4 rounded-xl transition-all">
                   <ShoppingCart className="h-3.5 w-3.5 mr-2" /> PDV
                </TabsTrigger>
                <TabsTrigger value="orders" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white font-black text-[10px] uppercase h-8 px-4 rounded-xl transition-all relative">
                   <Clock className="h-3.5 w-3.5 mr-2" /> Pedidos
                   {orders.length > 0 && (
                     <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[8px] font-black h-5 w-5 flex items-center justify-center rounded-full border-2 border-slate-900 shadow-lg">
                       {orders.length}
                     </span>
                   )}
                </TabsTrigger>
                <TabsTrigger value="analytics" className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white font-black text-[10px] uppercase h-8 px-4 rounded-xl transition-all">
                   <BarChart3 className="h-3.5 w-3.5 mr-2" /> Análise
                </TabsTrigger>
              </TabsList>
            </Tabs>
            
            <div className="hidden sm:block h-8 w-px bg-white/10 mx-1" />

            <Button variant="ghost" onClick={() => auth.signOut()} className="text-slate-500 hover:text-white hover:bg-white/5 h-11 w-11 p-0 rounded-2xl shrink-0 transition-all">
              <LogOut className="h-5.5 w-5.5" />
            </Button>
          </div>
        </header>

        <AnimatePresence mode="wait">
          {activeTab === 'pos' ? (
            <motion.div 
              key="pos"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.02 }}
              className="grid grid-cols-1 lg:grid-cols-[1fr,380px] gap-8 items-start transition-all"
            >
              {/* Product Area */}
              <div className="w-full space-y-8">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-6 bg-white/[0.03] p-6 rounded-[32px] border border-white/5">
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-[0.4em] text-slate-500 mb-1">Cardápio Disponível</h3>
                    <p className="text-xs font-bold text-slate-400">Gerencie e venda itens com um toque</p>
                  </div>
                  <div className="relative w-full sm:w-80">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                    <Input 
                      placeholder="Procurar um produto..." 
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setCurrentPage(1);
                      }}
                      className="bg-slate-950 border-white/10 pl-11 h-12 text-sm font-bold rounded-2xl focus:ring-blue-500/20 focus:border-blue-500/50 transition-all shadow-inner"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 2xl:grid-cols-5 gap-4">
                  {paginatedProducts.length === 0 ? (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="col-span-full py-40 text-center text-slate-600 bg-white/[0.02] rounded-[40px] border-4 border-dashed border-white/5"
                    >
                      <PackageCheck className="h-16 w-16 mx-auto opacity-10 mb-4" />
                      <p className="text-lg font-black uppercase tracking-widest opacity-20">{searchQuery ? 'Sem resultados' : 'Aguardando estoque'}</p>
                    </motion.div>
                  ) : (
                    paginatedProducts.map((product, index) => {
                      const cartItem = cart.find(i => i.id === product.id);
                      const count = cartItem?.quantity || 0;
                      return (
                        <motion.button
                          key={product.id}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: index * 0.05 }}
                          onClick={() => addToCart(product)}
                          className={`group aspect-square h-auto flex flex-col items-start justify-end p-5 rounded-[28px] border-2 transition-all active:scale-[0.98] text-left relative overflow-hidden ${
                            count > 0 
                              ? 'bg-blue-600/90 border-blue-400 shadow-[0_20px_50px_rgba(37,99,235,0.2)] ring-4 ring-blue-500/10' 
                              : 'bg-white/[0.03] border-white/5 hover:border-blue-500/40 hover:bg-white/[0.05] hover:-translate-y-1'
                          }`}
                        >
                          <AnimatePresence>
                            {count > 0 && (
                              <motion.div 
                                initial={{ scale: 0, rotate: -45 }}
                                animate={{ scale: 1, rotate: 0 }}
                                exit={{ scale: 0, rotate: 45 }}
                                className="absolute top-3 right-3 bg-white text-blue-600 text-[11px] font-black h-8 w-8 flex items-center justify-center rounded-2xl shadow-xl z-20 border-2 border-blue-100"
                              >
                                {count}
                              </motion.div>
                            )}
                          </AnimatePresence>

                          <div className={`absolute -top-10 -left-10 w-32 h-32 blur-[40px] rounded-full transition-all duration-500 ${count > 0 ? 'bg-white/20' : 'bg-transparent group-hover:bg-blue-500/10'}`} />

                          <div className="relative z-10 w-full space-y-1">
                            <span className={`block text-[11px] font-black uppercase tracking-tight line-clamp-2 leading-tight transition-all ${count > 0 ? 'text-white' : 'text-slate-400 group-hover:text-blue-200'}`}>
                              {product.name}
                            </span>
                            <span className={`text-xl font-black transition-all ${count > 0 ? 'text-white' : 'text-white'}`}>
                              <span className="text-xs font-bold mr-0.5 opacity-60">R$</span> {product.price.toFixed(2)}
                            </span>
                          </div>
                        </motion.button>
                      );
                    })
                  )}
                </div>

                {/* Pagination Controls */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-6 pt-6 pb-4">
                    <Button 
                      variant="ghost" 
                      size="lg" 
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="text-slate-500 hover:text-white bg-white/5 hover:bg-white/10 rounded-2xl h-12 px-6 font-black text-[10px] uppercase"
                    >
                      <ChevronLeft className="h-4 w-4 mr-2" /> Anterior
                    </Button>
                    <div className="flex items-center gap-1">
                      {Array.from({length: totalPages}).map((_, i) => (
                        <div key={i} className={`h-1.5 rounded-full transition-all duration-300 ${currentPage === i + 1 ? 'w-8 bg-blue-500' : 'w-1.5 bg-white/10'}`} />
                      ))}
                    </div>
                    <Button 
                      variant="ghost" 
                      size="lg" 
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="text-slate-500 hover:text-white bg-white/5 hover:bg-white/10 rounded-2xl h-12 px-6 font-black text-[10px] uppercase"
                    >
                      Próxima <ChevronRight className="h-4 w-4 ml-2" />
                    </Button>
                  </div>
                )}
              </div>

              {/* Sidebar: Shopping Bag */}
              <div className="hidden lg:block w-full sticky top-24 space-y-6">
                <Card className="bg-slate-900/60 backdrop-blur-3xl border border-white/10 text-white rounded-[32px] overflow-hidden shadow-[0_50px_100px_-20px_rgba(0,0,0,0.5)] transition-all">
                  <header className="p-6 border-b border-white/5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 bg-white/5 rounded-xl flex items-center justify-center">
                        <ShoppingCart className="h-4 w-4 text-blue-400" />
                      </div>
                      <h3 className="font-black text-[11px] uppercase tracking-[0.2em] text-slate-400">Carrinho</h3>
                    </div>
                    {cart.length > 0 && (
                      <Button variant="ghost" size="sm" onClick={clearCart} className="text-red-400 h-8 text-[10px] font-black hover:bg-red-500/10 rounded-xl px-3 transition-colors">
                        LIMPAR
                      </Button>
                    )}
                  </header>
                  
                  <CardContent className="p-0">
                    <div className="max-h-[min(420px,55vh)] overflow-y-auto custom-scrollbar px-6">
                      {cart.length === 0 ? (
                        <div className="py-24 text-center space-y-4">
                          <div className="h-20 w-20 bg-white/[0.02] rounded-full flex items-center justify-center mx-auto ring-1 ring-white/5 shadow-inner">
                            <ShoppingCart className="h-10 w-10 opacity-10 text-slate-400" />
                          </div>
                          <p className="text-[11px] font-black text-slate-600 uppercase tracking-[0.2em] leading-relaxed">Sua sacola<br/>está vazia</p>
                        </div>
                      ) : (
                        <div className="py-4 space-y-3">
                          <AnimatePresence initial={false}>
                            {cart.map((item) => (
                              <motion.div 
                                key={item.id}
                                layout
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                className="flex items-center justify-between p-4 bg-white/[0.04] rounded-2xl border border-white/5 group hover:border-blue-500/30 transition-all"
                              >
                                <div className="flex-1 mr-4 min-w-0">
                                  <p className="font-black text-[11px] uppercase truncate text-white/90 tracking-tight leading-tight mb-1">{item.name}</p>
                                  <p className="text-[11px] text-blue-400 font-bold">R$ {item.price.toFixed(2)}</p>
                                </div>
                                <div className="flex items-center gap-2 bg-slate-950 p-1 rounded-xl ring-1 ring-white/5">
                                  <motion.button 
                                    whileTap={{ scale: 0.9 }}
                                    onClick={() => removeFromCart(item.id)} 
                                    className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-red-500/20 text-slate-500 hover:text-red-400 transition-colors"
                                  >
                                    <Minus size={12} strokeWidth={3}/>
                                  </motion.button>
                                  <span className="w-6 text-center text-[12px] font-black">{item.quantity}</span>
                                  <motion.button 
                                    whileTap={{ scale: 0.9 }}
                                    onClick={() => addToCart(item)} 
                                    className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-blue-500/20 text-blue-400 hover:text-blue-300 transition-colors"
                                  >
                                    <Plus size={12} strokeWidth={3}/>
                                  </motion.button>
                                </div>
                              </motion.div>
                            ))}
                          </AnimatePresence>
                        </div>
                      )}
                    </div>

                    <div className="p-8 bg-slate-950/40 border-t border-white/10 space-y-6">
                      <div className="flex justify-between items-end">
                        <div className="space-y-1">
                          <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Total Geral</span>
                          <div className="text-4xl font-black text-white tracking-tighter">
                            <span className="text-xl font-bold mr-1 opacity-40">R$</span>
                            {cartTotal.toFixed(2)}
                          </div>
                        </div>
                        <div className="text-[10px] font-black text-blue-500/50 uppercase tracking-widest bg-blue-500/5 px-3 py-1 rounded-full border border-blue-500/10">
                          {cart.reduce((a, b) => a + b.quantity, 0)} Itens
                        </div>
                      </div>

                      {!scannedUser ? (
                        <Button 
                          onClick={() => setIsScanning(true)}
                          disabled={cart.length === 0}
                          className="w-full h-16 bg-blue-600 hover:bg-blue-500 text-white font-black uppercase text-xs tracking-[0.3em] rounded-2xl shadow-[0_20px_40px_rgba(37,99,235,0.3)] border-b-4 border-blue-800 active:border-b-0 active:translate-y-1 transition-all group overflow-hidden relative"
                        >
                          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:animate-shimmer" />
                          <QrCode className="mr-3 h-6 w-6" /> Escanear Carteira
                        </Button>
                      ) : (
                        <motion.div 
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="bg-white/5 p-5 rounded-3xl border-2 border-blue-600/30 space-y-5"
                        >
                           <div className="flex justify-between items-center bg-slate-950/50 p-3 rounded-2xl border border-white/5">
                              <div className="min-w-0 flex items-center gap-3">
                                <div className="h-10 w-10 bg-blue-600 rounded-xl flex items-center justify-center font-black text-lg">
                                  {scannedUser.name.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                  <p className="font-black text-xs uppercase truncate text-white leading-none mb-1.5">{scannedUser.name}</p>
                                  <div className={`inline-flex items-center px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider ${
                                    scannedUser.balance < cartTotal ? 'bg-red-500/10 text-red-500' : 'bg-green-500/10 text-green-400'
                                  }`}>
                                    Saldo: R$ {scannedUser.balance.toFixed(2)}
                                  </div>
                                </div>
                              </div>
                              <button 
                                onClick={() => setScannedUser(null)} 
                                className="h-8 w-8 flex items-center justify-center hover:bg-white/10 rounded-xl transition-all text-slate-500 hover:text-white"
                              >
                                <XCircle size={20} />
                              </button>
                           </div>
                           
                           <Button 
                             onClick={handleSale}
                             disabled={processing || scannedUser.balance < cartTotal || cart.length === 0}
                             className={`w-full h-14 font-black uppercase text-xs tracking-[0.2em] rounded-2xl transition-all ${
                               scannedUser.balance < cartTotal 
                                ? 'bg-slate-800 text-slate-600 cursor-not-allowed' 
                                : 'bg-green-600 hover:bg-green-500 shadow-xl shadow-green-600/20 active:scale-95'
                             }`}
                           >
                              {processing ? <Loader2 size={24} className="animate-spin" /> : 
                               scannedUser.balance < cartTotal ? 'SALDO INSUFICIENTE' : 'CONCLUIR PAGAMENTO'}
                           </Button>
                        </motion.div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </motion.div>
          ) : activeTab === 'orders' ? (
          <motion.div 
            key="orders"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.02 }}
            className="space-y-8 pb-10"
          >
            <div className="flex items-center gap-4 bg-white/[0.03] p-6 rounded-[32px] border border-white/5">
               <div className="h-14 w-14 bg-gradient-to-br from-blue-500 to-blue-700 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20">
                  <Clock className="h-7 w-7 text-white" />
               </div>
               <div>
                  <h3 className="text-2xl font-black text-white uppercase tracking-tight">Pedidos em Espera</h3>
                  <p className="text-slate-500 text-xs font-bold uppercase tracking-widest">Acompanhe as solicitações via aplicativo</p>
               </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
              {orders.length === 0 ? (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="col-span-full py-48 text-center text-slate-500 border-4 border-dashed border-white/5 rounded-[48px] bg-white/[0.01] backdrop-blur-sm"
                >
                  <Clock className="h-24 w-24 mx-auto opacity-10 mb-8" />
                  <p className="text-xl font-black uppercase tracking-[0.2em] opacity-30">Sem novos pedidos</p>
                  <Button 
                    variant="ghost" 
                    onClick={() => setActiveTab('pos')} 
                    className="mt-6 font-black text-[10px] uppercase tracking-widest text-blue-500 hover:text-white hover:bg-blue-600/20 rounded-full px-8 py-6 h-auto transition-all"
                  >
                    VOLTAR AO TERMINAL
                  </Button>
                </motion.div>
              ) : (
                orders.map((order, idx) => (
                  <motion.div
                    key={order.id}
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.1 }}
                  >
                    <Card 
                      onClick={() => setSelectedOrder(order)}
                      className="bg-slate-900/40 backdrop-blur-xl border border-white/10 text-white rounded-[32px] overflow-hidden group hover:border-blue-500/50 transition-all shadow-2xl relative cursor-pointer active:scale-[0.98]"
                    >
                      <div className="absolute top-0 right-0 p-4">
                        <span className="text-[10px] font-black px-3 py-1.5 bg-slate-950/80 rounded-xl uppercase text-slate-500 border border-white/5 tracking-widest backdrop-blur-md">
                          #{order.id.slice(-4)}
                        </span>
                      </div>
                      
                      <CardHeader className="bg-white/5 border-b border-white/5 p-8">
                        <p className="text-[10px] text-blue-400 font-black uppercase tracking-[0.3em] mb-2">Comprador Mobile</p>
                        <CardTitle className="text-2xl font-black tracking-tighter truncate pr-16">{order.studentName}</CardTitle>
                      </CardHeader>

                      <CardContent className="p-8 space-y-8">
                        <div className="space-y-3">
                          {order.items.map((item, idx) => (
                            <div key={idx} className="flex items-center gap-4 bg-white/[0.03] p-4 rounded-2xl border border-white/5 ring-1 ring-inset ring-white/[0.02]">
                              <div className="h-2 w-2 rounded-full bg-blue-500 shadow-[0_0_10px_rgba(37,99,235,0.8)]" />
                              <p className="font-black text-[12px] uppercase text-white/90 tracking-tight">{item}</p>
                            </div>
                          ))}
                        </div>

                        <div className="pt-6 border-t border-white/10 flex justify-between items-end">
                          <div className="space-y-1">
                            <span className="text-[10px] text-slate-500 uppercase font-black tracking-[0.2em]">Valor Pago</span>
                            <div className="text-3xl font-black text-white tracking-tighter">
                              <span className="text-sm font-bold opacity-40 mr-1">R$</span>
                              {order.total.toFixed(2)}
                            </div>
                          </div>
                        </div>

                        <Button 
                          onClick={() => markAsDelivered(order.id)}
                          className="w-full h-16 bg-blue-600 hover:bg-blue-500 text-white font-black text-xs tracking-[0.2em] gap-3 rounded-2xl shadow-xl shadow-blue-900/40 transition-all group overflow-hidden relative"
                        >
                          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:animate-shimmer" />
                          <CheckCircle2 className="h-6 w-6" /> CONFIRMAR ENTREGA
                        </Button>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))
              )}
            </div>
          </motion.div>
        ) : (
          <motion.div 
             key="analytics"
             initial={{ opacity: 0, scale: 0.95 }}
             animate={{ opacity: 1, scale: 1 }}
             exit={{ opacity: 0, scale: 1.05 }}
             className="space-y-10 pb-10"
          >
              <div className="flex items-center gap-4 bg-white/[0.03] p-6 rounded-[32px] border border-white/5">
                <div className="h-14 w-14 bg-gradient-to-br from-indigo-500 to-purple-700 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
                    <BarChart3 className="h-7 w-7 text-white" />
                </div>
                <div>
                    <h3 className="text-2xl font-black text-white uppercase tracking-tight">Análise Estratégica</h3>
                    <p className="text-slate-500 text-xs font-bold uppercase tracking-widest">Desempenho da sua barraca em tempo real</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                 <motion.div whileHover={{ y: -5 }}>
                   <Card className="bg-slate-900/60 backdrop-blur-xl border border-white/10 rounded-[32px] overflow-hidden shadow-2xl relative group">
                      <div className="absolute -right-8 -top-8 w-24 h-24 bg-green-500/10 blur-3xl rounded-full group-hover:bg-green-500/20 transition-all" />
                      <CardContent className="p-10 space-y-4">
                         <div className="h-12 w-12 bg-green-500/10 rounded-2xl flex items-center justify-center ring-1 ring-green-500/20">
                            <TrendingUp className="h-6 w-6 text-green-500" />
                         </div>
                         <div className="space-y-1">
                            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 leading-none">Faturamento Total</p>
                            <h4 className="text-4xl font-black text-white tracking-tighter">
                              <span className="text-xl font-bold opacity-40 mr-1">R$</span>
                              {stats.totalRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </h4>
                         </div>
                      </CardContent>
                   </Card>
                 </motion.div>

                 <motion.div whileHover={{ y: -5 }}>
                   <Card className="bg-slate-900/60 backdrop-blur-xl border border-white/10 rounded-[32px] overflow-hidden shadow-2xl relative group">
                      <div className="absolute -right-8 -top-8 w-24 h-24 bg-blue-500/10 blur-3xl rounded-full group-hover:bg-blue-500/20 transition-all" />
                      <CardContent className="p-10 space-y-4">
                         <div className="h-12 w-12 bg-blue-500/10 rounded-2xl flex items-center justify-center ring-1 ring-blue-500/20">
                            <Package className="h-6 w-6 text-blue-500" />
                         </div>
                         <div className="space-y-1">
                            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 leading-none">Volumes Vendidos</p>
                            <h4 className="text-4xl font-black text-white tracking-tighter">
                              {stats.totalItems} <span className="text-xl font-bold opacity-40 ml-1">unid.</span>
                            </h4>
                         </div>
                      </CardContent>
                   </Card>
                 </motion.div>

                 <motion.div whileHover={{ y: -5 }}>
                   <Card className="bg-slate-900/60 backdrop-blur-xl border border-white/10 rounded-[32px] overflow-hidden shadow-2xl relative group">
                      <div className="absolute -right-8 -top-8 w-24 h-24 bg-purple-500/10 blur-3xl rounded-full group-hover:bg-purple-500/20 transition-all" />
                      <CardContent className="p-10 space-y-4">
                         <div className="h-12 w-12 bg-purple-500/10 rounded-2xl flex items-center justify-center ring-1 ring-purple-500/20">
                            <Users className="h-6 w-6 text-purple-500" />
                         </div>
                         <div className="space-y-1">
                            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 leading-none">Ticket Médio</p>
                            <h4 className="text-4xl font-black text-white tracking-tighter">
                              <span className="text-xl font-bold opacity-40 mr-1">R$</span>
                              {(stats.totalRevenue / (Object.keys(stats.productSales).length || 1)).toFixed(2)}
                            </h4>
                         </div>
                      </CardContent>
                   </Card>
                 </motion.div>
              </div>

              <div className="space-y-6">
                 <div className="flex items-center justify-between px-2">
                    <h3 className="text-xs font-black uppercase tracking-[0.4em] text-slate-600">Ranking de Produtos</h3>
                    <div className="h-px flex-1 bg-white/5 mx-6" />
                 </div>
                 <div className="bg-white/[0.02] backdrop-blur-xl border border-white/5 rounded-[48px] overflow-hidden shadow-2xl">
                    <div className="divide-y divide-white/5">
                       {statsLoading ? (
                          <div className="p-32 text-center">
                            <Loader2 className="h-12 w-12 animate-spin mx-auto text-blue-600/40" />
                            <p className="text-[10px] font-black text-slate-700 uppercase tracking-widest mt-4">Calculando dados...</p>
                          </div>
                       ) : Object.keys(stats.productSales).length === 0 ? (
                          <div className="p-32 text-center">
                            <Package className="h-16 w-16 mx-auto opacity-5 text-white mb-6" />
                            <p className="text-[11px] text-slate-600 font-black uppercase tracking-[0.3em]">Nenhum registro de venda</p>
                          </div>
                       ) : (
                          Object.values(stats.productSales)
                            .sort((a, b) => (b as any).count - (a as any).count)
                            .map((item: any, i) => (
                              <motion.div 
                                key={i} 
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: i * 0.05 }}
                                className="flex items-center justify-between p-8 hover:bg-white/[0.03] transition-all group"
                              >
                                 <div className="flex items-center gap-8">
                                    <div className={`h-14 w-14 rounded-2xl flex items-center justify-center font-black text-xl shadow-lg transition-transform group-hover:scale-110 ${
                                      i === 0 ? 'bg-amber-500 text-white shadow-amber-900/20 ring-4 ring-amber-500/10' : 
                                      i === 1 ? 'bg-slate-400 text-white shadow-slate-900/20' :
                                      i === 2 ? 'bg-orange-600 text-white shadow-orange-900/20' :
                                      'bg-slate-800 text-slate-500 ring-1 ring-white/5'
                                    }`}>
                                       {i + 1}
                                    </div>
                                    <div>
                                       <p className="text-lg font-black text-white/90 uppercase tracking-tight mb-0.5">{item.name}</p>
                                       <p className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em]">{item.count} unidades vendidas</p>
                                    </div>
                                 </div>
                                 {item.revenue > 0 && (
                                   <div className="text-2xl font-black text-white tracking-tighter">
                                      <span className="text-sm font-bold opacity-40 mr-1">R$</span>
                                      {item.revenue.toFixed(2)}
                                   </div>
                                 )}
                              </motion.div>
                            ))
                       )}
                    </div>
                 </div>
              </div>
          </motion.div>
        )}
        </AnimatePresence>
      </div>

      {/* Mobile Control Bar - Premium Refinement */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-slate-950/80 backdrop-blur-3xl border-t border-white/10 px-8 py-6 lg:hidden safe-area-bottom shadow-[0_-30px_60px_rgba(0,0,0,0.8)]">
        <div className="max-w-md mx-auto flex items-center justify-between gap-8">
          <div className="space-y-1">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] leading-none">Total Agora</span>
            <div className="text-3xl font-black text-white tracking-tighter">
              <span className="text-sm font-bold opacity-40 mr-1">R$</span>
              {cartTotal.toFixed(2)}
            </div>
          </div>
          
          <div className="flex-1 flex gap-4 h-16">
            <AnimatePresence mode="popLayout">
              {cart.length > 0 && !scannedUser ? (
                <motion.div 
                  key="scan-btn"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="flex-1"
                >
                  <Button 
                    onClick={() => setIsScanning(true)} 
                    className="w-full h-full bg-blue-600 hover:bg-blue-500 text-white font-black uppercase text-xs tracking-[0.2em] rounded-[24px] shadow-2xl shadow-blue-500/30 border-b-4 border-blue-900 active:border-b-0 active:translate-y-1 transition-all"
                  >
                    <QrCode className="h-6 w-6 mr-3" /> ESCANEAR
                  </Button>
                </motion.div>
              ) : scannedUser ? (
                <motion.div 
                  key="pay-btn-group"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="flex-1 flex gap-3"
                >
                  <Button 
                    onClick={handleSale}
                    disabled={processing || scannedUser.balance < cartTotal || cart.length === 0}
                    className={`flex-1 h-full font-black uppercase text-xs tracking-widest rounded-[24px] shadow-2xl transition-all ${
                       scannedUser.balance < cartTotal 
                       ? 'bg-slate-800 text-slate-600' 
                       : 'bg-green-600 hover:bg-green-500 shadow-green-600/20 active:translate-y-1'
                    }`}
                  >
                    {processing ? <Loader2 className="h-6 w-6 animate-spin" /> : 
                     scannedUser.balance < cartTotal ? 'SALDO BAIXO' : 'CONFIRMAR'}
                  </Button>
                  <Button 
                    variant="ghost" 
                    onClick={() => setScannedUser(null)}
                    className="w-16 h-full bg-white/5 rounded-[24px] text-slate-500 hover:text-white border border-white/5"
                  >
                    <XCircle className="h-7 w-7" />
                  </Button>
                </motion.div>
              ) : (
                <motion.div 
                  key="empty-scan"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex-1"
                >
                  <Button 
                    onClick={() => setIsScanning(true)}
                    className="w-full h-full bg-white/5 hover:bg-white/10 text-slate-400 font-extrabold uppercase text-[10px] tracking-widest rounded-[24px] border border-white/10"
                  >
                    <QrCode className="h-5 w-5 mr-3 opacity-50" /> QR CODE
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {isScanning && (
        <QRScanner onScan={onScanSuccess} onClose={() => setIsScanning(false)} title="Identificar Aluno" />
      )}

      <AnimatePresence>
        {selectedOrder && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedOrder(null)}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-lg bg-slate-900 border border-white/10 rounded-[40px] shadow-2xl overflow-hidden"
            >
              <div className="absolute top-6 right-6">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={() => setSelectedOrder(null)}
                  className="rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white"
                >
                  <XCircle className="h-6 w-6" />
                </Button>
              </div>

              <div className="p-8 space-y-8">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.3em] text-blue-500">
                    <Clock className="h-3 w-3" />
                    <span>Detalhes do Pedido</span>
                  </div>
                  <h3 className="text-3xl font-black text-white tracking-tighter">
                    {(selectedOrder as any).studentName}
                  </h3>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                    ID: #{selectedOrder.id.slice(-8)}
                  </p>
                </div>

                <div className="bg-white/[0.02] rounded-3xl border border-white/5 p-6 space-y-4">
                  <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-slate-500">
                    <span>Horário da Solicitação</span>
                    <span className="text-white">
                      {selectedOrder.timestamp?.toDate ? 
                        new Intl.DateTimeFormat('pt-BR', { 
                          hour: '2-digit', 
                          minute: '2-digit', 
                          second: '2-digit',
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric'
                        }).format(selectedOrder.timestamp.toDate()) : 
                        'Data indisponível'
                      }
                    </span>
                  </div>
                  <div className="h-px bg-white/5" />
                  <div className="space-y-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Itens Solicitados</p>
                    <div className="space-y-2">
                      {selectedOrder.items.map((item, idx) => (
                        <div key={idx} className="flex items-center gap-4 bg-white/5 p-4 rounded-2xl border border-white/5 ring-1 ring-inset ring-white/[0.02]">
                          <div className="h-2 w-2 rounded-full bg-blue-500 shadow-[0_0_10px_rgba(37,99,235,0.8)]" />
                          <p className="font-black text-sm uppercase text-white/90 tracking-tight">{item}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between bg-blue-600/10 p-6 rounded-3xl border border-blue-500/20">
                  <span className="text-sm font-black text-blue-400 uppercase tracking-widest">Total Pago</span>
                  <div className="text-3xl font-black text-white tracking-tighter">
                    <span className="text-base font-bold opacity-40 mr-1">R$</span>
                    {selectedOrder.total.toFixed(2)}
                  </div>
                </div>

                <Button 
                  onClick={() => {
                    markAsDelivered(selectedOrder.id);
                    setSelectedOrder(null);
                  }}
                  className="w-full h-16 bg-blue-600 hover:bg-blue-500 text-white font-black text-xs tracking-[0.2em] gap-3 rounded-2xl shadow-xl shadow-blue-500/20 active:scale-95 transition-all"
                >
                  <CheckCircle2 className="h-6 w-6" /> CONFIRMAR ENTREGA AGORA
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
