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
  const [activeTab, setActiveTab] = useState<'pos' | 'orders'>('pos');
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
    <div className="min-h-screen bg-slate-950 text-white pb-32 md:pb-8">
      <div className="max-w-[1536px] mx-auto px-4 py-4 md:px-6 md:py-6 space-y-6">
        <header className="flex justify-between items-center bg-slate-900 border border-white/5 p-4 rounded-xl shadow-xl sticky top-2 z-30">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-900/20">
              <Store className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">Terminal Aberto</p>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black text-white leading-none">{stall?.name || 'Carregando...'}</h2>
                {(profile.role === 'admin' || (profile.vendorIds && profile.vendorIds.length > 1)) && (
                  <select 
                    className="bg-slate-800 text-[9px] px-2 py-1 rounded border border-white/10 font-bold text-blue-400 uppercase outline-none"
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

          <div className="flex items-center gap-2">
            <Button 
              variant={activeTab === 'orders' ? 'default' : 'ghost'} 
              size="sm"
              onClick={() => setActiveTab(activeTab === 'pos' ? 'orders' : 'pos')}
              className={`h-10 px-3 rounded-lg font-bold text-xs uppercase tracking-widest relative ${activeTab === 'orders' ? 'bg-blue-600' : 'text-slate-400 hover:text-white'}`}
            >
              {activeTab === 'pos' ? (
                <>
                  <Clock className="h-4 w-4 mr-2" />
                  Pedidos App
                  {orders.length > 0 && (
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] h-5 w-5 flex items-center justify-center rounded-full border-2 border-slate-900 animate-pulse">
                      {orders.length}
                    </span>
                  )}
                </>
              ) : (
                <>
                  <ShoppingCart className="h-4 w-4 mr-2" />
                  Voltar ao PDV
                </>
              )}
            </Button>
            
            <div className="h-6 w-px bg-white/10 mx-1" />

            <Button variant="ghost" onClick={() => auth.signOut()} className="text-slate-500 hover:text-white h-10 w-10 p-0">
              <LogOut className="h-5 w-5" />
            </Button>
          </div>
        </header>

        {activeTab === 'pos' ? (
          <div className="grid grid-cols-1 xl:grid-cols-[1fr,360px] gap-8 items-start animate-in fade-in duration-500">
            {/* Product Area */}
            <div className="w-full space-y-4">
              <div className="flex items-center justify-between px-2">
                <h3 className="text-xs font-black uppercase tracking-[0.3em] text-slate-500">Produtos Disponíveis</h3>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 2xl:grid-cols-5 gap-3">
                {products.length === 0 ? (
                  <div className="col-span-full py-32 text-center text-slate-700 bg-slate-900/50 rounded-xl border-2 border-dashed border-white/5">
                    <PackageCheck className="h-10 w-10 mx-auto opacity-10 mb-2" />
                    <p className="text-sm font-bold">Aguardando produtos...</p>
                  </div>
                ) : (
                  products.map(product => {
                    const count = cart.find(i => i.id === product.id)?.quantity || 0;
                    return (
                      <button
                        key={product.id}
                        onClick={() => addToCart(product)}
                        className={`aspect-square sm:aspect-auto sm:h-32 flex flex-col items-start justify-end p-3 rounded-xl border transition-all active:scale-95 text-left relative overflow-hidden group ${
                          count > 0 
                            ? 'bg-blue-600 border-blue-400 shadow-lg' 
                            : 'bg-slate-900 border-white/5 hover:border-blue-500/30'
                        }`}
                      >
                        {count > 0 && (
                          <div className="absolute top-2 right-2 bg-white text-blue-600 text-[10px] font-black h-6 w-6 flex items-center justify-center rounded-full shadow-lg z-20">
                            {count}
                          </div>
                        )}
                        <div className="relative z-10 w-full">
                          <span className="block text-[10px] md:text-[11px] font-bold uppercase tracking-tight line-clamp-2 mb-1 leading-tight text-white/90">
                            {product.name}
                          </span>
                          <span className="text-sm md:text-base font-black text-white">
                            R$ {product.price.toFixed(2)}
                          </span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Sidebar: Cart & User */}
            <div className="hidden xl:block w-full sticky top-24 space-y-4">
              <Card className="bg-slate-900 border-white/10 text-white rounded-xl overflow-hidden shadow-2xl">
                <header className="p-4 border-b border-white/5 flex items-center justify-between bg-slate-900/50">
                  <h3 className="font-bold text-[10px] uppercase tracking-widest text-slate-500">Resumo da Venda</h3>
                  {cart.length > 0 && (
                    <Button variant="ghost" size="sm" onClick={clearCart} className="text-red-400 h-7 text-[10px] font-bold hover:bg-red-400/10">
                      LIMPAR
                    </Button>
                  )}
                </header>
                
                <CardContent className="p-0">
                  <div className="max-h-[min(380px,50vh)] overflow-y-auto custom-scrollbar">
                    {cart.length === 0 ? (
                      <div className="py-20 text-center">
                        <ShoppingCart className="h-8 w-8 mx-auto opacity-10 mb-2 text-slate-400" />
                        <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest leading-relaxed">Selecione os produtos<br/>para iniciar a venda</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-white/5">
                        {cart.map(item => (
                          <div key={item.id} className="flex items-center justify-between p-3.5 bg-white/[0.01]">
                            <div className="flex-1 mr-4">
                              <p className="font-bold text-[10px] uppercase truncate text-white/90">{item.name}</p>
                              <p className="text-[10px] text-blue-400 font-bold mt-0.5">R$ {item.price.toFixed(2)}</p>
                            </div>
                            <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-lg border border-white/5">
                              <button onClick={() => removeFromCart(item.id)} className="h-6 w-6 flex items-center justify-center rounded hover:bg-red-500/20 text-slate-500 hover:text-red-400">
                                <Minus size={10}/>
                              </button>
                              <span className="w-5 text-center text-[10px] font-black">{item.quantity}</span>
                              <button onClick={() => addToCart(item)} className="h-6 w-6 flex items-center justify-center rounded hover:bg-blue-500/20 text-blue-400 hover:text-blue-300">
                                <Plus size={10}/>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="p-5 bg-slate-950/40 border-t border-white/5 space-y-4">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Total</span>
                      <div className="text-3xl font-black text-white">R$ {cartTotal.toFixed(2)}</div>
                    </div>

                    {!scannedUser ? (
                      <Button 
                        onClick={() => setIsScanning(true)}
                        disabled={cart.length === 0}
                        className="w-full h-14 bg-blue-600 hover:bg-blue-500 text-white font-black uppercase text-xs tracking-[0.2em] rounded-xl shadow-lg border-b-4 border-blue-800 active:border-b-0 active:translate-y-1 transition-all"
                      >
                        <QrCode className="mr-2 h-5 w-5" /> Escanear Carteira
                      </Button>
                    ) : (
                      <div className="bg-slate-900 p-4 rounded-xl border-2 border-blue-600/30 space-y-4 animate-in slide-in-from-bottom-4">
                         <div className="flex justify-between items-start gap-4">
                            <div className="min-w-0">
                              <p className="font-black text-xs uppercase truncate text-white">{scannedUser.name}</p>
                              <div className={`inline-flex items-center px-2 py-0.5 mt-1 rounded-full text-[9px] font-black uppercase tracking-wider ${
                                scannedUser.balance < cartTotal ? 'bg-red-500/20 text-red-500' : 'bg-green-500/20 text-green-400'
                              }`}>
                                Saldo: R$ {scannedUser.balance.toFixed(2)}
                              </div>
                            </div>
                            <button onClick={() => setScannedUser(null)} className="p-1 hover:bg-white/10 rounded transition-colors">
                              <XCircle size={16} className="text-slate-500" />
                            </button>
                         </div>
                         
                         <Button 
                           onClick={handleSale}
                           disabled={processing || scannedUser.balance < cartTotal || cart.length === 0}
                           className={`w-full h-12 font-black uppercase text-xs tracking-widest rounded-xl transition-all ${
                             scannedUser.balance < cartTotal 
                              ? 'bg-slate-800 text-slate-500' 
                              : 'bg-green-600 hover:bg-green-500 shadow-xl shadow-green-900/20'
                           }`}
                         >
                            {processing ? <Loader2 size={16} className="animate-spin" /> : 
                             scannedUser.balance < cartTotal ? 'SALDO INSUFICIENTE' : 'CONCLUIR VENDA'}
                         </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        ) : (
          <div className="animate-in slide-in-from-right-8 duration-500">
            <div className="flex items-center gap-4 mb-8">
               <div className="h-12 w-12 bg-blue-600 rounded-xl flex items-center justify-center">
                  <Clock className="h-6 w-6 text-white" />
               </div>
               <div>
                  <h3 className="text-2xl font-black text-white uppercase tracking-tight">Pedidos do App</h3>
                  <p className="text-slate-500 text-xs font-bold uppercase tracking-widest">Aguardando entrega no balcão</p>
               </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
              {orders.length === 0 ? (
                <div className="col-span-full py-40 text-center text-slate-500 border-2 border-dashed border-white/5 rounded-[40px] bg-white/[0.02]">
                  <Clock className="h-20 w-20 mx-auto opacity-10 mb-6" />
                  <p className="text-xl font-black uppercase tracking-widest opacity-30">Nenhum pedido pendente</p>
                  <Button variant="link" onClick={() => setActiveTab('pos')} className="text-blue-500 mt-4 font-black">VOLTAR AO TERMINAL</Button>
                </div>
              ) : (
                orders.map(order => (
                  <Card key={order.id} className="bg-slate-900 border-white/10 text-white rounded-3xl overflow-hidden group hover:border-blue-500/50 transition-all shadow-xl">
                    <CardHeader className="bg-slate-800/40 border-b border-white/5 p-6">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-[10px] text-blue-400 font-black uppercase tracking-[0.2em] mb-1">Pedido Mobile</p>
                          <CardTitle className="text-xl font-black truncate max-w-[180px]">{order.studentName}</CardTitle>
                        </div>
                        <span className="text-[10px] font-black p-2 bg-slate-950 rounded-lg uppercase text-slate-500 border border-white/5 tracking-widest">
                          #{order.id.slice(-4)}
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent className="p-6 space-y-6">
                      <div className="space-y-2">
                        {order.items.map((item, idx) => (
                          <div key={idx} className="flex items-center gap-3 bg-white/[0.02] p-3 rounded-xl border border-white/5">
                            <div className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                            <p className="font-bold text-[11px] uppercase text-white/80">{item}</p>
                          </div>
                        ))}
                      </div>
                      <div className="pt-4 border-t border-white/5 flex justify-between items-center px-1">
                        <span className="text-[10px] text-slate-500 uppercase font-black tracking-widest">Total Pago</span>
                        <span className="text-xl font-black text-white">R$ {order.total.toFixed(2)}</span>
                      </div>
                      <Button 
                        onClick={() => markAsDelivered(order.id)}
                        className="w-full h-14 bg-blue-600 hover:bg-blue-500 text-white font-black text-sm gap-2 rounded-xl shadow-lg transition-all"
                      >
                        <CheckCircle2 className="h-5 w-5" /> CONFIRMAR ENTREGA
                      </Button>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </div>
        ) }
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
