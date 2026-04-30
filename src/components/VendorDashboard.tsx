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
import { QrCode, ShoppingCart, Users, LogOut, CheckCircle2, XCircle, Plus, Minus, Trash2, Store, Clock, PackageCheck } from 'lucide-react';
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
    <div className="min-h-screen bg-slate-900 text-white p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex justify-between items-center bg-slate-800 p-6 rounded-2xl shadow-lg border border-slate-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600 rounded-lg">
              <Store className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-xs text-slate-400 font-bold uppercase tracking-widest leading-none mb-1">Terminal de Vendas</p>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-black text-white">{stall?.name || 'Selecione uma Barraca'}</h2>
                {(profile.role === 'admin' || (profile.vendorIds && profile.vendorIds.length > 1)) && (
                  <select 
                    className="bg-slate-700 text-[10px] p-1 rounded border-none font-bold text-blue-400 uppercase cursor-pointer ml-2"
                    value={activeStallId || ''}
                    onChange={(e) => setActiveStallId(e.target.value)}
                  >
                    {profile.role === 'admin' && <option value="">Selecionar...</option>}
                    {availableStalls.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                )}
              </div>
            </div>
          </div>
          <Button variant="ghost" onClick={() => auth.signOut()} className="text-slate-400 hover:text-white hover:bg-slate-700 h-10 w-10 p-0">
            <LogOut className="h-5 w-5" />
          </Button>
        </header>

        <Tabs defaultValue="pos" className="w-full">
          <TabsList className="bg-slate-800 border border-slate-700 shadow-sm mb-6">
            <TabsTrigger value="pos" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-slate-400">
              <ShoppingCart className="h-4 w-4 mr-2" /> Venda Balcão
            </TabsTrigger>
            <TabsTrigger value="orders" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-slate-400">
              <Clock className="h-4 w-4 mr-2" /> Pedidos App ({orders.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pos">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Product Selection */}
              <div className="lg:col-span-2 space-y-6">
                <Card className="bg-slate-800 border-slate-700 text-white">
                  <CardHeader>
                    <CardTitle>Produtos da {stall?.name || 'Barraca'}</CardTitle>
                    <CardDescription className="text-slate-400">Clique para adicionar ao carrinho</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {products.length === 0 ? (
                      <div className="py-20 text-center text-slate-500 border-2 border-dashed border-slate-700 rounded-2xl">
                        Nenhum produto cadastrado para esta barraca.
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {products.map(product => (
                          <Button
                            key={product.id}
                            onClick={() => addToCart(product)}
                            className="h-24 flex flex-col items-center justify-center gap-1 bg-slate-700 hover:bg-slate-600 border-none transition-all active:scale-95"
                          >
                            <span className="text-sm font-medium text-center leading-tight">{product.name}</span>
                            <span className="text-blue-400 font-bold">R$ {product.price.toFixed(2)}</span>
                          </Button>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Cart & Checkout */}
              <div className="space-y-6">
                <Card className="bg-slate-800 border-slate-700 text-white">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center justify-between">
                      <span>Pedido Atual</span>
                      {cart.length > 0 && (
                        <Button variant="ghost" size="sm" onClick={clearCart} className="text-slate-400 hover:text-red-400">
                          Limpar
                        </Button>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {cart.length === 0 ? (
                      <div className="py-8 text-center text-slate-500 border-2 border-dashed border-slate-700 rounded-xl">
                        Carrinho vazio
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="max-h-[200px] overflow-y-auto space-y-2 pr-2">
                          {cart.map(item => (
                            <div key={item.id} className="flex items-center justify-between bg-slate-700/50 p-3 rounded-lg">
                              <div className="flex-1">
                                <p className="font-medium text-sm">{item.name}</p>
                                <p className="text-xs text-blue-400">R$ {(item.price * item.quantity).toFixed(2)}</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <Button variant="secondary" size="icon" className="h-7 w-7 rounded-full bg-slate-600 border-none" onClick={() => removeFromCart(item.id)}>
                                  <Minus className="h-3 w-3" />
                                </Button>
                                <span className="w-4 text-center text-sm font-bold">{item.quantity}</span>
                                <Button variant="secondary" size="icon" className="h-7 w-7 rounded-full bg-slate-600 border-none" onClick={() => addToCart(item)}>
                                  <Plus className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="pt-3 border-t border-slate-700 flex justify-between items-center text-lg">
                          <span className="font-medium">Total</span>
                          <span className="font-bold text-white text-2xl">R$ {cartTotal.toFixed(2)}</span>
                        </div>
                      </div>
                    )}

                        <div className="space-y-4 pt-4 border-t border-slate-700">
                          <div className="space-y-2">
                            <label className="text-xs text-slate-400 font-bold uppercase tracking-widest">Identificação do Aluno</label>
                            {!isScanning && !scannedUser ? (
                              <Button onClick={() => setIsScanning(true)} className="w-full h-14 bg-blue-600 hover:bg-blue-500 text-white font-bold flex items-center gap-2 rounded-xl transition-all shadow-lg shadow-blue-900/40">
                                <QrCode className="h-5 w-5" /> Escanear QR Code
                              </Button>
                            ) : isScanning ? (
                              <div className="space-y-2">
                                <QRScanner onScan={onScanSuccess} onClose={() => setIsScanning(false)} title="Identificar Aluno" />
                                <Button variant="ghost" onClick={() => setIsScanning(false)} className="w-full text-slate-400">Cancelar</Button>
                              </div>
                            ) : scannedUser ? (
                              <div className="bg-green-500/10 border border-green-500/20 p-4 rounded-xl flex items-center justify-between">
                                <div>
                                  <p className="text-xl font-bold">{scannedUser.name}</p>
                                  <p className={`font-mono text-sm ${scannedUser.balance < cartTotal ? 'text-red-400' : 'text-green-400'}`}>
                                    Saldo: R$ {scannedUser.balance.toFixed(2)}
                                  </p>
                                </div>
                                <div className="flex flex-col gap-2">
                                  <Button variant="ghost" onClick={() => setScannedUser(null)} className="h-10 w-10 p-0 text-slate-400 hover:text-white">
                                    <XCircle className="h-6 w-6" />
                                  </Button>
                                  {cart.length === 0 && (
                                    <Button size="sm" variant="outline" onClick={() => setScannedUser(null)} className="text-[10px] h-6 bg-slate-700 border-slate-600">
                                      PRÓXIMO
                                    </Button>
                                  )}
                                </div>
                              </div>
                            ) : null}
                          </div>

      {processing ? (
        <Button disabled className="w-full h-20 bg-slate-700 text-slate-500 font-black text-2xl rounded-2xl">
          Processando...
        </Button>
      ) : cart.length > 0 ? (
        <Button 
          onClick={handleSale} 
          disabled={!scannedUser || scannedUser.balance < cartTotal}
          className="w-full h-20 bg-white text-slate-900 hover:bg-slate-200 font-black text-2xl shadow-xl shadow-white/5 disabled:opacity-30 rounded-2xl transition-all"
        >
          {scannedUser && scannedUser.balance < cartTotal ? 'Saldo Insuficiente' : 'PAGAR AGORA'}
        </Button>
      ) : scannedUser ? (
        <Button 
          onClick={() => setScannedUser(null)}
          className="w-full h-20 bg-blue-600 hover:bg-blue-500 text-white font-black text-xl rounded-2xl"
        >
          PRÓXIMO ALUNO
        </Button>
      ) : (
        <div className="h-20 flex items-center justify-center text-slate-500 font-medium italic border-2 border-dashed border-slate-700 rounded-2xl">
          Aguardando Itens e QR Code
        </div>
      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="orders">
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
    </div>
  );
}
