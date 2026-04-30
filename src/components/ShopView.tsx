import React, { useState, useEffect } from 'react';
import { db, auth } from '@/lib/firebase';
import { collection, onSnapshot, query, where, addDoc, serverTimestamp, doc, updateDoc, increment } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Stall, Product, UserProfile } from '../types';
import { Store, ShoppingCart, ArrowLeft, CheckCircle2, Package, CreditCard, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import axios from 'axios';
import { handleFirestoreError, OperationType } from '@/lib/error-handler';

export default function ShopView({ profile }: { profile: UserProfile }) {
  const [stalls, setStalls] = useState<Stall[]>([]);
  const [selectedStall, setSelectedStall] = useState<Stall | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<{product: Product, quantity: number}[]>([]);
  const [loading, setLoading] = useState(false);
  const [payingWithRede, setPayingWithRede] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [currentTransactionId, setCurrentTransactionId] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'stalls'), (snap) => {
      setStalls(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Stall)));
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!selectedStall) {
      setProducts([]);
      return;
    }
    const q = query(collection(db, 'products'), where('vendorId', '==', selectedStall.id), where('active', '==', true));
    const unsub = onSnapshot(q, (snap) => {
      setProducts(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product)));
    });
    return () => unsub();
  }, [selectedStall]);

  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(item => item.product.id === product.id);
      if (existing) {
        return prev.map(item => item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  const removeFromCart = (productId: string) => {
    setCart(prev => {
      const existing = prev.find(item => item.product.id === productId);
      if (existing && existing.quantity > 1) {
        return prev.map(item => item.product.id === productId ? { ...item, quantity: item.quantity - 1 } : item);
      }
      return prev.filter(item => item.product.id !== productId);
    });
  };

  const total = cart.reduce((acc, item) => acc + (item.product.price * item.quantity), 0);

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    if (profile.balance < total) {
      toast.error('Saldo insuficiente');
      return;
    }

    try {
      setLoading(true);
      
      // Update balance
      const studentRef = doc(db, 'users', profile.uid);
      await updateDoc(studentRef, {
        balance: increment(-total)
      });

      // Create Order
      const orderRef = await addDoc(collection(db, 'orders'), {
        studentId: profile.uid,
        studentName: profile.name,
        stallId: selectedStall?.id,
        stallName: selectedStall?.name,
        items: cart.map(item => `${item.quantity}x ${item.product.name}`),
        total,
        status: 'pending',
        timestamp: serverTimestamp()
      });

      // Record transaction
      await addDoc(collection(db, 'transactions'), {
        userId: profile.uid,
        amount: -total,
        type: 'debit',
        description: `Pedido App: ${selectedStall?.name}`,
        status: 'completed',
        timestamp: serverTimestamp()
      });

      toast.success('Pedido realizado com sucesso!');
      setCart([]);
      setSelectedStall(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'orders');
      toast.error('Erro ao processar pedido');
    } finally {
      setLoading(false);
    }
  };

  const handleRedePayment = async () => {
    if (cart.length === 0) return;
    
    try {
      setPayingWithRede(true);
      
      // We calculate how much they need to pay. 
      // It can be the full total or just total - balance.
      // Usually it's cleaner to recharge the exact amount they are short, or just the full amount.
      // The user said "pay with Rede after purchase", so we'll treat it as a direct payment.
      const amountToPay = total;

      // Create a pending transaction
      const txnRef = await addDoc(collection(db, 'transactions'), {
        userId: profile.uid,
        amount: amountToPay,
        type: 'credit',
        status: 'pending',
        description: `Pagamento Pedido: ${selectedStall?.name}`,
        timestamp: serverTimestamp(),
      });

      const response = await axios.post('/api/rede/create-checkout', {
        amount: amountToPay,
        userId: profile.uid,
        studentName: profile.name,
        transactionId: txnRef.id
      });

      if (response.data.transactionId) {
        setCurrentTransactionId(response.data.transactionId);
        setShowPaymentModal(true);
      }
    } catch (error: any) {
      console.error('Rede payment error:', error);
      toast.error('Erro ao iniciar pagamento com Rede');
    } finally {
      setPayingWithRede(false);
    }
  };

  if (selectedStall) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => { setSelectedStall(null); setCart([]); }}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h2 className="text-xl font-bold">{selectedStall.name}</h2>
            <p className="text-sm text-slate-500">Escolha seus itens</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <h3 className="font-bold flex items-center gap-2 px-2">
              <Package className="h-4 w-4 text-slate-400" /> Cardápio
            </h3>
            <div className="grid grid-cols-1 gap-2">
              {products.map(product => (
                <div key={product.id} className="p-4 bg-white rounded-xl border border-slate-100 flex items-center justify-between shadow-sm">
                  <div>
                    <p className="font-bold">{product.name}</p>
                    <p className="text-blue-600 font-bold">R$ {product.price.toFixed(2)}</p>
                  </div>
                  <Button size="sm" onClick={() => addToCart(product)} className="bg-slate-900 border-none">
                    <PlusCircle className="h-4 w-4 mr-2" /> Adicionar
                  </Button>
                </div>
              ))}
              {products.length === 0 && <p className="text-slate-400 text-center py-10">Nenhum produto disponível.</p>}
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="font-bold flex items-center gap-2 px-2">
              <ShoppingCart className="h-4 w-4 text-slate-400" /> Seu Pedido
            </h3>
            <Card className="border-slate-100 shadow-sm sticky top-4">
              <CardContent className="pt-6 space-y-4">
                {cart.length === 0 ? (
                  <p className="text-center text-slate-400 py-6">Adicione itens para continuar</p>
                ) : (
                  <>
                    <div className="space-y-2">
                      {cart.map(item => (
                        <div key={item.product.id} className="flex justify-between items-center text-sm">
                          <div className="flex gap-2">
                            <span className="font-bold text-slate-400">{item.quantity}x</span>
                            <span>{item.product.name}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span>R$ {(item.product.price * item.quantity).toFixed(2)}</span>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-red-400" onClick={() => removeFromCart(item.product.id)}>
                              <MinusCircle className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="pt-4 border-t flex justify-between items-center">
                      <span className="font-bold">Total</span>
                      <span className="text-2xl font-black">R$ {total.toFixed(2)}</span>
                    </div>
                      <div className="space-y-4">
                        <Button 
                          className="w-full h-16 font-black rounded-2xl shadow-lg transition-all active:scale-95 flex flex-col items-center justify-center bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
                          disabled={loading || profile.balance < total || payingWithRede}
                          onClick={handleCheckout}
                        >
                          <span className="text-lg">
                            {loading ? 'Processando...' : profile.balance < total ? 'Saldo Insuficiente' : 'Pagar com Saldo'}
                          </span>
                          {!loading && profile.balance >= total && (
                            <span className="text-[10px] opacity-70 uppercase tracking-widest">Descontar R$ {total.toFixed(2)} da sua conta</span>
                          )}
                        </Button>
                        
                        {profile.balance < total && (
                           <div className="p-4 bg-orange-50 border border-orange-100 rounded-2xl animate-pulse">
                              <p className="text-xs text-orange-600 font-bold text-center">
                                Seu saldo de R$ {profile.balance.toFixed(2)} não é suficiente para esta compra.
                              </p>
                              <p className="text-[10px] text-orange-500 text-center uppercase tracking-tight font-black mt-1">
                                Use um cartão abaixo para pagar agora
                              </p>
                           </div>
                        )}

                        <div className="relative py-4">
                          <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-slate-200"></span></div>
                          <div className="relative flex justify-center text-[10px] uppercase"><span className="bg-white px-4 text-slate-400 font-black tracking-widest whitespace-nowrap">OU PAGAR COM CARTÃO (REDE)</span></div>
                        </div>

                        <Button 
                          variant="outline"
                          className="w-full h-20 border-blue-200 bg-blue-50/50 hover:bg-blue-100/50 hover:border-blue-400 text-blue-700 font-black rounded-3xl flex flex-col items-center justify-center gap-1 transition-all active:scale-95 shadow-md group relative"
                          disabled={payingWithRede || loading}
                          onClick={handleRedePayment}
                        >
                           <div className="flex items-center gap-3">
                              <CreditCard className="h-6 w-6 text-blue-600 group-hover:scale-110 transition-transform" />
                              <span className="text-xl">Cartão de Crédito</span>
                           </div>
                           <span className="text-[10px] text-blue-500/70 uppercase tracking-widest">Processado via Rede - R$ {total.toFixed(2)}</span>
                           {payingWithRede && <Loader2 className="h-4 w-4 animate-spin absolute right-4" />}
                        </Button>
                      </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {stalls.map(stall => (
          <Button
            key={stall.id}
            variant="ghost"
            onClick={() => setSelectedStall(stall)}
            className="h-32 flex flex-col items-center justify-center gap-3 bg-white hover:bg-slate-50 border border-slate-100 rounded-2xl shadow-sm transition-all hover:shadow-md border-none"
          >
            <div className="p-3 bg-blue-50 rounded-full">
              <Store className="h-6 w-6 text-blue-600" />
            </div>
            <span className="font-black uppercase tracking-tight text-slate-700">{stall.name}</span>
          </Button>
        ))}
      </div>

      {showPaymentModal && currentTransactionId && (
        <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4">
          <Card className="w-full max-w-sm">
            <CardHeader className="text-center pb-2">
              <CardTitle>Pagamento com Rede</CardTitle>
              <CardDescription>Simulação de Checkout e-Rede</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="p-4 bg-slate-50 rounded-xl space-y-2 border border-slate-100">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500 uppercase font-bold">Valor do Pedido:</span>
                  <span className="font-black text-slate-900">R$ {total.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-xs overflow-hidden">
                  <span className="text-slate-500 uppercase font-bold shrink-0">Terminal:</span>
                  <span className="font-mono text-slate-400 truncate">{currentTransactionId}</span>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-2">
                <Button variant="ghost" onClick={() => {
                  setShowPaymentModal(false);
                  setCurrentTransactionId(null);
                }} className="text-slate-500">
                  Cancelar
                </Button>
                <Button onClick={async () => {
                  try {
                    // Logic to approve the transaction
                    const txnRef = doc(db, 'transactions', currentTransactionId);
                    const userRef = doc(db, 'users', profile.uid);
                    
                    // Approval process (Simulation)
                    // We directly update balance and status
                    await updateDoc(userRef, {
                      balance: increment(total)
                    });
                    
                    await updateDoc(txnRef, {
                      status: 'completed',
                      updatedAt: serverTimestamp()
                    });

                    // Success!
                    toast.success('Crédito via Rede aprovado!');
                    setShowPaymentModal(false);
                    setCurrentTransactionId(null);
                    
                    // Now they can pay with their balance automatically or they have to click again?
                    // Let's try to complete the order automatically since they just "paid" the exact amount.
                    handleCheckout();
                  } catch (err) {
                    console.error(err);
                    toast.error('Erro ao processar aprovação simulada');
                  }
                }} className="bg-red-600 hover:bg-red-700 text-white font-bold">
                  Pagar Agora
                </Button>
              </div>
              
              <p className="text-[10px] text-center text-slate-400 leading-tight">
                Em ambiente real, você seria redirecionado para o ambiente seguro da Rede para inserir os dados do cartão.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function PlusCircle({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12h8" />
      <path d="M12 8v8" />
    </svg>
  );
}

function MinusCircle({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12h8" />
    </svg>
  );
}
