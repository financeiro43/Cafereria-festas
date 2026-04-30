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
    <div className="min-h-screen bg-slate-900 text-white pb-32 md:pb-8">
      <div className="max-w-7xl mx-auto px-4 py-4 md:px-8 md:py-8 space-y-6">
        <header className="flex justify-between items-center bg-slate-800/80 backdrop-blur-xl p-4 md:p-6 rounded-[32px] shadow-2xl border border-white/5 sticky top-2 z-30">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 bg-blue-600 rounded-2xl shadow-lg shadow-blue-900/40 flex items-center justify-center">
              <Store className="h-7 w-7 text-white" />
            </div>
            <div>
              <p className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em] mb-1">Ponto de Venda</p>
              <div className="flex items-center gap-3">
                <h2 className="text-xl md:text-2xl font-black text-white truncate max-w-[140px] md:max-w-none leading-none">{stall?.name || 'Carregando...'}</h2>
                {(profile.role === 'admin' || (profile.vendorIds && profile.vendorIds.length > 1)) && (
                  <select 
                    className="bg-white/5 hover:bg-white/10 text-[10px] px-3 py-1.5 rounded-xl border border-white/10 font-black text-blue-400 uppercase cursor-pointer transition-all outline-none"
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
          <Button variant="ghost" onClick={() => auth.signOut()} className="text-slate-500 hover:text-white hover:bg-red-500/10 h-12 w-12 rounded-2xl transition-all">
            <LogOut className="h-6 w-6" />
          </Button>
        </header>

        <Tabs defaultValue="pos" className="w-full">
          <TabsList className="bg-slate-800/80 p-1.5 rounded-[24px] border border-white/5 shadow-inner mb-6 w-full flex h-16">
            <TabsTrigger value="pos" className="flex-1 py-3 text-sm data-[state=active]:bg-blue-600 data-[state=active]:text-white text-slate-400 font-black uppercase tracking-widest rounded-xl transition-all shadow-lg">
              <ShoppingCart className="h-4 w-4 mr-2" /> PDV
            </TabsTrigger>
            <TabsTrigger value="orders" className="flex-1 py-3 text-sm data-[state=active]:bg-blue-600 data-[state=active]:text-white text-slate-400 font-black uppercase tracking-widest rounded-xl transition-all relative">
              <Clock className="h-4 w-4 mr-2" /> Pedidos
              {orders.length > 0 && (
                <span className="ml-2 bg-red-500 text-white text-[10px] font-black h-5 w-5 flex items-center justify-center rounded-full border-2 border-slate-900">
                  {orders.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pos" className="mt-0 focus-visible:outline-none">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              {/* Product Grid */}
              <div className="lg:col-span-8">
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
                  {products.length === 0 ? (
                    <div className="col-span-full py-32 text-center text-slate-500 border-2 border-dashed border-white/10 rounded-[40px] bg-white/[0.02] flex flex-col items-center justify-center gap-4">
                      <PackageCheck className="h-16 w-16 opacity-10" />
                      <p className="font-bold text-lg">Nenhum produto ativo</p>
                    </div>
                  ) : (
                    products.map(product => {
                      const count = cart.find(i => i.id === product.id)?.quantity || 0;
                      return (
                        <button
                          key={product.id}
                          onClick={() => addToCart(product)}
                          className={`aspect-square sm:aspect-auto sm:h-44 flex flex-col items-start justify-end p-5 rounded-[32px] border-2 transition-all active:scale-95 text-left relative overflow-hidden group shadow-xl ${
                            count > 0 
                              ? 'bg-blue-600 border-blue-400 shadow-blue-500/20' 
                              : 'bg-slate-800/60 border-white/5 hover:border-blue-600/30 hover:bg-slate-800'
                          }`}
                        >
                          {count > 0 && (
                            <div className="absolute top-4 right-4 bg-white text-blue-600 text-sm font-black h-8 w-8 flex items-center justify-center rounded-full shadow-2xl animate-in zoom-in">
                              {count}
                            </div>
                          )}
                          <div className="relative z-10 w-full">
                            <span className={`block text-sm md:text-base font-black leading-tight uppercase tracking-tight mb-1 ${count > 0 ? 'text-white' : 'text-slate-200'}`}>
                              {product.name}
                            </span>
                            <span className={`text-lg font-black ${count > 0 ? 'text-blue-100' : 'text-blue-400'}`}>
                              R$ {product.price.toFixed(2)}
                            </span>
                          </div>
                          
                          <div className="absolute top-0 right-0 p-8 transform translate-x-4 -translate-y-4 opacity-5 group-hover:scale-125 transition-transform duration-500">
                             <Plus className="h-16 w-16" />
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Order Summary (Desktop) */}
              <div className="lg:col-span-4 hidden lg:block">
                <Card className="bg-slate-800/60 backdrop-blur-xl border-white/10 text-white rounded-[40px] sticky top-28 overflow-hidden shadow-2xl">
                  <CardHeader className="p-8 pb-4">
                    <div className="flex items-center justify-between">
                       <h3 className="font-black text-xs uppercase tracking-[0.3em] text-slate-500">Carrinho</h3>
                       {cart.length > 0 && (
                         <Button variant="ghost" size="sm" onClick={clearCart} className="text-red-400 font-bold hover:bg-red-500/10 rounded-xl px-4">
                           LIMPAR
                         </Button>
                       )}
                    </div>
                  </CardHeader>
                  <CardContent className="p-8 pt-0 space-y-8">
                    {cart.length === 0 ? (
                      <div className="py-20 text-center text-slate-500 border-2 border-dashed border-white/5 rounded-[32px] bg-slate-900/40 flex flex-col gap-4">
                        <ShoppingCart className="h-12 w-12 mx-auto opacity-10" />
                        <p className="text-sm font-black uppercase tracking-widest opacity-30">Selecione os itens</p>
                      </div>
                    ) : (
                      <>
                        <div className="space-y-4 max-h-[350px] overflow-y-auto pr-2 custom-scrollbar">
                          {cart.map(item => (
                            <div key={item.id} className="flex items-center justify-between bg-white/[0.03] p-4 rounded-2xl border border-white/5 group hover:bg-white/[0.05] transition-all">
                              <div className="flex-1 min-w-0 mr-4">
                                <p className="font-black text-xs uppercase truncate text-white">{item.name}</p>
                                <p className="text-[10px] text-blue-400 font-black mt-1">
                                  {item.quantity}x R$ {item.price.toFixed(2)}
                                </p>
                              </div>
                              <div className="flex items-center gap-2 bg-slate-900/60 p-1 rounded-xl">
                                <button onClick={() => removeFromCart(item.id)} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-all">
                                  <Minus className="h-4 w-4" />
                                </button>
                                <span className="w-4 text-center text-xs font-black">{item.quantity}</span>
                                <button onClick={() => addToCart(item)} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-blue-500/20 text-blue-400 hover:text-blue-300 transition-all">
                                  <Plus className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>

                        <div className="space-y-6">
                           <div className="flex justify-between items-end border-t border-white/5 pt-6">
                              <div>
                                <p className="text-[10px] font-black uppercase text-slate-500 tracking-[0.2em] mb-2">Total</p>
                                <h3 className="text-4xl font-black text-white">R$ {cartTotal.toFixed(2)}</h3>
                              </div>
                           </div>

                           {!scannedUser ? (
                             <Button 
                               onClick={() => setIsScanning(true)} 
                               className="w-full h-16 bg-blue-600 hover:bg-blue-500 text-white font-black uppercase tracking-widest rounded-2xl shadow-xl shadow-blue-900/40 flex items-center justify-center gap-4 group transition-all"
                             >
                               <QrCode className="h-6 w-6 group-hover:scale-110 transition-transform" /> ESCANEAR ALUNO
                             </Button>
                           ) : (
                             <div className="bg-slate-900/80 p-6 rounded-[32px] border-2 border-blue-500/30 space-y-5 animate-in slide-in-from-bottom-4">
                                <div className="flex justify-between items-start">
                                   <div>
                                      <p className="font-black text-lg uppercase tracking-tight leading-tight mb-1">{scannedUser.name}</p>
                                      <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${
                                        scannedUser.balance < cartTotal ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'
                                      }`}>
                                         Saldo: R$ {scannedUser.balance.toFixed(2)}
                                      </div>
                                   </div>
                                   <button onClick={() => setScannedUser(null)} className="h-8 w-8 bg-white/5 rounded-lg flex items-center justify-center text-slate-500 hover:text-white">
                                      <XCircle className="h-5 w-5" />
                                   </button>
                                </div>
                                
                                <Button 
                                  onClick={handleSale}
                                  disabled={processing || scannedUser.balance < cartTotal || cart.length === 0}
                                  className={`w-full h-16 font-black uppercase tracking-widest rounded-2xl transition-all shadow-lg ${
                                    scannedUser.balance < cartTotal 
                                      ? 'bg-slate-700 text-slate-400 mix-blend-luminosity' 
                                      : 'bg-green-600 hover:bg-green-500 text-white shadow-green-900/20'
                                  }`}
                                >
                                  {processing ? <Loader2 className="h-6 w-6 animate-spin" /> : 
                                   scannedUser.balance < cartTotal ? 'SALDO INSUFICIENTE' : 'CONCLUIR VENDA'}
                                </Button>
                             </div>
                           )}
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="orders" className="mt-0 focus-visible:outline-none">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {orders.length === 0 ? (
                <div className="col-span-full py-40 text-center text-slate-500 border-2 border-dashed border-white/5 rounded-[40px] bg-white/[0.02]">
                  <Clock className="h-20 w-20 mx-auto opacity-10 mb-6" />
                  <p className="text-xl font-black uppercase tracking-widest opacity-30">Sem pedidos pendentes</p>
                </div>
              ) : (
                orders.map(order => (
                  <Card key={order.id} className="bg-slate-800/60 border-white/10 text-white rounded-[32px] overflow-hidden group hover:border-blue-500/50 transition-all shadow-xl">
                    <CardHeader className="bg-slate-800/40 border-b border-white/5 p-6 pb-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-[10px] text-blue-400 font-black uppercase tracking-[0.2em] mb-1">Via App Mobile</p>
                          <CardTitle className="text-xl font-black truncate max-w-[200px]">{order.studentName}</CardTitle>
                        </div>
                        <span className="text-[10px] font-black p-2 bg-slate-900/80 rounded-xl uppercase text-slate-500 border border-white/5 tracking-widest">
                          #{order.id.slice(-6)}
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent className="p-6 space-y-6">
                      <div className="space-y-3">
                        {order.items.map((item, idx) => (
                          <div key={idx} className="flex items-center gap-3 bg-white/[0.02] p-3 rounded-2xl border border-white/5 transition-all">
                            <div className="h-2 w-2 rounded-full bg-blue-500 shadow-[0_0_8px_blue]" />
                            <p className="font-black text-xs uppercase tracking-tight text-white/80">{item}</p>
                          </div>
                        ))}
                      </div>
                      <div className="pt-4 border-t border-white/5 flex justify-between items-center px-2">
                        <span className="text-[10px] text-slate-500 uppercase font-black tracking-widest">Total Pago</span>
                        <span className="text-2xl font-black text-white">R$ {order.total.toFixed(2)}</span>
                      </div>
                      <Button 
                        onClick={() => markAsDelivered(order.id)}
                        className="w-full h-16 bg-blue-600 hover:bg-blue-500 text-white font-black text-lg gap-3 rounded-2xl shadow-xl shadow-blue-900/30 transition-all group-hover:-translate-y-1"
                      >
                        <CheckCircle2 className="h-6 w-6" /> ENTREGAR AGORA
                      </Button>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Mobile Control Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-slate-900/90 backdrop-blur-2xl border-t border-white/10 px-6 py-5 lg:hidden safe-area-bottom shadow-[0_-20px_50px_rgba(0,0,0,0.5)]">
        <div className="max-w-md mx-auto flex items-center justify-between gap-6">
          <div className="flex flex-col">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Total</span>
            <span className="text-2xl font-black text-white">R$ {cartTotal.toFixed(2)}</span>
          </div>
          
          <div className="flex-1 flex gap-3">
            {cart.length > 0 && !scannedUser ? (
              <Button 
                onClick={() => setIsScanning(true)} 
                className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-black uppercase text-sm h-16 rounded-[20px] shadow-2xl shadow-blue-900/40"
              >
                <QrCode className="h-6 w-6" />
              </Button>
            ) : scannedUser ? (
              <Button 
                onClick={handleSale}
                disabled={processing || scannedUser.balance < cartTotal || cart.length === 0}
                className={`flex-1 h-16 text-white font-black uppercase text-sm rounded-[24px] shadow-xl ${
                   scannedUser.balance < cartTotal ? 'bg-slate-700' : 'bg-green-600'
                }`}
              >
                {processing ? <Loader2 className="h-6 w-6 animate-spin" /> : 
                 scannedUser.balance < cartTotal ? 'Saldo Insuficiente' : 'Pagar'}
              </Button>
            ) : (
              <Button 
                onClick={() => setIsScanning(true)}
                className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-black uppercase text-sm h-16 rounded-[24px]"
              >
                <QrCode className="h-6 w-6 mr-3" /> ESCANEAR
              </Button>
            )}

            {scannedUser && (
              <Button 
                 variant="ghost" 
                 size="icon" 
                 onClick={() => setScannedUser(null)}
                 className="h-16 w-16 bg-white/5 rounded-[24px] text-slate-400"
              >
                 <XCircle className="h-7 w-7" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {isScanning && (
        <QRScanner onScan={onScanSuccess} onClose={() => setIsScanning(false)} title="Identificar Aluno" />
      )}
    </div>
  );
}
