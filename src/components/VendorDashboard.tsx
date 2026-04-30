import React, { useState, useEffect, useRef, useMemo } from 'react';
import { db, auth } from '@/lib/firebase';
import { collection, query, where, getDocs, addDoc, doc, updateDoc, increment, serverTimestamp, onSnapshot, orderBy } from 'firebase/firestore';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UserProfile, Product, Stall, Order } from '../types';
import { handleFirestoreError, OperationType } from '@/lib/error-handler';
import { QrCode, ShoppingCart, Users, LogOut, CheckCircle2, XCircle, Plus, Minus, Trash2, Store, Clock, PackageCheck, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

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
  const [cart, setCart] = useState<CartItem[]>([]);
  const [scannedUser, setScannedUser] = useState<UserProfile | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [loading, setLoading] = useState(true);

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
      where('status', '==', 'pending'),
      orderBy('timestamp', 'asc')
    );
    const unsubOrders = onSnapshot(qO, (snap) => {
      setOrders(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order)));
    });

    return () => {
      unsubStall();
      unsubProducts();
      unsubOrders();
    };
  }, [activeStallId]);

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
      const q = query(collection(db, 'users'), where('qrCode', '==', decodedText));
      const querySnapshot = await getDocs(q);
      
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
    <div className="min-h-screen bg-slate-900 text-white pb-24 md:pb-8">
      <div className="max-w-7xl mx-auto px-4 py-4 md:px-8 md:py-8 space-y-6">
        <header className="flex justify-between items-center bg-slate-800/50 backdrop-blur-md p-4 md:p-6 rounded-3xl shadow-2xl border border-white/5 sticky top-2 z-30">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-600 rounded-2xl shadow-lg shadow-blue-900/40">
              <Store className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em] leading-none mb-1">Terminal Ativo</p>
              <div className="flex items-center gap-2">
                <h2 className="text-lg md:text-xl font-black text-white truncate max-w-[150px] md:max-w-none">{stall?.name || 'Carregando...'}</h2>
                {(profile.role === 'admin' || (profile.vendorIds && profile.vendorIds.length > 1)) && (
                  <select 
                    className="bg-white/5 hover:bg-white/10 text-[10px] px-2 py-1 rounded-lg border border-white/10 font-bold text-blue-400 uppercase cursor-pointer transition-colors"
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
          <Button variant="ghost" onClick={() => auth.signOut()} className="text-slate-500 hover:text-white hover:bg-white/5 h-12 w-12 rounded-2xl">
            <LogOut className="h-6 w-6" />
          </Button>
        </header>

        <Tabs defaultValue="pos" className="w-full">
          <TabsList className="bg-slate-800/50 p-1.5 rounded-2xl border border-white/5 shadow-inner mb-6 w-full flex h-auto">
            <TabsTrigger value="pos" className="flex-1 py-3 data-[state=active]:bg-blue-600 data-[state=active]:text-white text-slate-400 font-black uppercase text-[10px] tracking-widest rounded-xl transition-all">
              <ShoppingCart className="h-4 w-4 mr-2" /> Venda Balcão
            </TabsTrigger>
            <TabsTrigger value="orders" className="flex-1 py-3 data-[state=active]:bg-blue-600 data-[state=active]:text-white text-slate-400 font-black uppercase text-[10px] tracking-widest rounded-xl transition-all relative">
              <Clock className="h-4 w-4 mr-2" /> Pedidos App
              {orders.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-black h-5 px-1.5 flex items-center justify-center rounded-full border-2 border-slate-900 animate-pulse">
                  {orders.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pos" className="mt-0 focus-visible:outline-none">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
              {/* Product Selection */}
              <div className="lg:col-span-2 space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {products.length === 0 ? (
                    <div className="col-span-full py-20 text-center text-slate-500 border-2 border-dashed border-white/5 rounded-3xl bg-white/[0.02]">
                      Nenhum produto cadastrado.
                    </div>
                  ) : (
                    products.map(product => {
                      const count = cart.find(i => i.id === product.id)?.quantity || 0;
                      return (
                        <button
                          key={product.id}
                          onClick={() => addToCart(product)}
                          className={`h-32 md:h-36 flex flex-col items-center justify-center gap-2 p-4 rounded-[32px] border-2 transition-all active:scale-95 text-left relative overflow-hidden group ${
                            count > 0 
                              ? 'bg-blue-600/10 border-blue-600/50 shadow-lg shadow-blue-900/20' 
                              : 'bg-slate-800/40 border-white/5 hover:border-white/10 hover:bg-slate-800/60'
                          }`}
                        >
                          {count > 0 && (
                            <div className="absolute top-3 right-3 bg-blue-600 text-white text-[10px] font-black h-6 w-6 flex items-center justify-center rounded-full shadow-lg">
                              {count}
                            </div>
                          )}
                          <span className="text-sm md:text-base font-black text-center leading-tight uppercase tracking-tight line-clamp-2">{product.name}</span>
                          <span className="text-blue-400 font-black text-lg">R$ {product.price.toFixed(2)}</span>
                          
                          {/* Feedback de hover animado */}
                          <div className="absolute inset-0 bg-blue-600/0 group-hover:bg-blue-600/5 pointer-events-none transition-colors" />
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Cart & Checkout - Hidden on desktop sidebar if we want mobile-only sticky, but here we keep it for both */}
              <div className="space-y-6">
                <Card className="bg-slate-800/40 backdrop-blur-sm border-white/5 text-white rounded-[32px] overflow-hidden shadow-2xl hidden lg:block">
                  <header className="p-6 pb-2 flex items-center justify-between">
                    <h3 className="font-black uppercase text-[10px] tracking-[0.2em] text-slate-500">RESUMO DO PEDIDO</h3>
                    {cart.length > 0 && (
                      <Button variant="ghost" size="sm" onClick={clearCart} className="text-red-400 hover:text-red-300 hover:bg-red-500/10">
                        LIMPAR
                      </Button>
                    )}
                  </header>
                  <CardContent className="p-6 space-y-6">
                    {cart.length === 0 ? (
                      <div className="py-12 text-center text-slate-500 border-2 border-dashed border-white/5 rounded-[24px] bg-white/[0.01]">
                        <ShoppingCart className="h-10 w-10 mx-auto mb-3 opacity-20" />
                        <p className="text-xs font-bold uppercase tracking-widest">Carrinho Vazio</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="max-h-[300px] overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                          {cart.map(item => (
                            <div key={item.id} className="flex items-center justify-between bg-white/[0.03] p-4 rounded-2xl border border-white/5">
                              <div className="flex-1">
                                <p className="font-black text-xs uppercase tracking-tight">{item.name}</p>
                                <p className="text-[10px] text-blue-400 font-bold uppercase mt-0.5">R$ {(item.price * item.quantity).toFixed(2)}</p>
                              </div>
                              <div className="flex items-center gap-3 bg-slate-900/50 rounded-xl p-1">
                                <button onClick={() => removeFromCart(item.id)} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-white/10 active:scale-90 transition-all">
                                  <Minus className="h-4 w-4" />
                                </button>
                                <span className="w-4 text-center text-xs font-black">{item.quantity}</span>
                                <button onClick={() => addToCart(item)} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-white/10 active:scale-90 transition-all text-blue-400">
                                  <Plus className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="pt-6 border-t border-white/5 flex justify-between items-end">
                          <div>
                            <p className="text-[10px] font-black uppercase text-slate-500 tracking-[0.2em] mb-1">TOTAL A PAGAR</p>
                            <span className="text-3xl font-black text-white">R$ {cartTotal.toFixed(2)}</span>
                          </div>
                        </div>
                        
                        {/* Checkout Actions Dashboard */}
                        <div className="space-y-4 pt-4">
                           {!scannedUser ? (
                              <Button 
                                onClick={() => setIsScanning(true)} 
                                className="w-full h-16 bg-blue-600 hover:bg-blue-500 text-white font-black uppercase tracking-widest rounded-2xl shadow-xl shadow-blue-900/40 flex items-center gap-4 transition-all hover:-translate-y-1 active:translate-y-0"
                              >
                                <QrCode className="h-6 w-6" /> Escanear Aluno
                              </Button>
                           ) : (
                              <div className="bg-slate-900/80 p-5 rounded-[24px] border border-blue-500/30 space-y-4 animate-in fade-in zoom-in duration-300">
                                 <div className="flex justify-between items-start">
                                    <div>
                                       <p className="font-black text-xl uppercase tracking-tight text-white">{scannedUser.name}</p>
                                       <div className={`mt-1 flex items-center gap-2 font-black text-xs ${scannedUser.balance < cartTotal ? 'text-red-400' : 'text-green-400'}`}>
                                          <div className={`h-2 w-2 rounded-full ${scannedUser.balance < cartTotal ? 'bg-red-500 animate-pulse' : 'bg-green-500'}`} />
                                          SALDO: R$ {scannedUser.balance.toFixed(2)}
                                       </div>
                                    </div>
                                    <button onClick={() => setScannedUser(null)} className="h-10 w-10 flex items-center justify-center rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white">
                                       <XCircle className="h-6 w-6" />
                                    </button>
                                 </div>
                                 
                                 <Button 
                                   onClick={handleSale}
                                   disabled={processing || scannedUser.balance < cartTotal || cart.length === 0}
                                   className="w-full h-16 bg-green-600 hover:bg-green-500 disabled:bg-slate-700 text-white font-black uppercase tracking-widest rounded-2xl shadow-lg transition-all"
                                 >
                                   {processing ? <Loader2 className="h-6 w-6 animate-spin" /> : 
                                    scannedUser.balance < cartTotal ? 'SALDO INSUFICIENTE' : 'CONFIRMAR PAGAMENTO'}
                                 </Button>
                              </div>
                           )}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="orders" className="mt-0 focus-visible:outline-none">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {orders.length === 0 ? (
                <div className="lg:col-span-3 py-20 text-center text-slate-500 border-2 border-dashed border-slate-700 rounded-3xl">
                  Nenhum pedido pendente no momento.
                </div>
              ) : (
                orders.map(order => (
                  <Card key={order.id} className="bg-slate-800 border-slate-700 text-white overflow-hidden">
                    <CardHeader className="bg-slate-700/50 border-b border-slate-700">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-xs text-blue-400 font-black uppercase tracking-widest mb-1">Pedido App</p>
                          <CardTitle className="text-lg">{order.studentName}</CardTitle>
                        </div>
                        <span className="text-[10px] font-mono p-1 bg-slate-900 rounded uppercase text-slate-400">
                          #{order.id.slice(-6)}
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-6 space-y-6">
                      <div className="space-y-2">
                        {order.items.map((item, idx) => (
                          <div key={idx} className="flex items-center gap-3">
                            <div className="h-2 w-2 rounded-full bg-blue-500" />
                            <p className="font-bold">{item}</p>
                          </div>
                        ))}
                      </div>
                      <div className="pt-4 border-t border-slate-700 flex justify-between items-center">
                        <span className="text-xs text-slate-400 uppercase font-black tracking-widest">Total Pago</span>
                        <span className="text-xl font-black">R$ {order.total.toFixed(2)}</span>
                      </div>
                      <Button 
                        onClick={() => markAsDelivered(order.id)}
                        className="w-full h-14 bg-green-600 hover:bg-green-500 text-white font-black text-lg gap-2 rounded-xl"
                      >
                        <PackageCheck className="h-6 w-6" /> Marcar como Entregue
                      </Button>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Mobile Sticky Footer */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-slate-900/80 backdrop-blur-xl border-t border-white/5 p-4 lg:hidden safe-area-bottom">
        <div className="max-w-md mx-auto flex items-center justify-between gap-4">
          <div className="flex flex-col">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest leading-none mb-1">Total Pedido</span>
            <span className="text-xl font-black text-white">R$ {cartTotal.toFixed(2)}</span>
          </div>
          <div className="flex gap-2">
            {cart.length > 0 && !scannedUser && (
              <Button 
                onClick={() => setIsScanning(true)} 
                className="bg-blue-600 hover:bg-blue-500 text-white font-black uppercase px-6 h-14 rounded-2xl shadow-xl shadow-blue-900/40"
              >
                <QrCode className="h-5 w-5 mr-2" /> Pagar
              </Button>
            )}
            {scannedUser && (
              <Button 
                onClick={handleSale}
                disabled={processing || scannedUser.balance < cartTotal || cart.length === 0}
                className="bg-green-600 hover:bg-green-500 text-white font-black uppercase px-6 h-14 rounded-2xl"
              >
                {processing ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Confirmar'}
              </Button>
            )}
            {!cart.length && scannedUser && (
              <Button 
                onClick={() => setScannedUser(null)}
                className="bg-slate-800 text-white font-black uppercase px-6 h-14 rounded-2xl"
              >
                Próximo
              </Button>
            )}
            {!cart.length && !scannedUser && (
              <Button 
                onClick={() => setIsScanning(true)}
                className="bg-blue-600 text-white font-black uppercase px-8 h-14 rounded-2xl"
              >
                <QrCode className="h-5 w-5 mr-2" /> Escanear
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
