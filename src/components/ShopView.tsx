import React, { useState, useEffect } from 'react';
import { db, auth } from '@/lib/firebase';
import { collection, onSnapshot, query, where, addDoc, serverTimestamp, doc, updateDoc, increment } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Stall, Product, UserProfile } from '../types';
import { Store, ShoppingCart, ArrowLeft, CheckCircle2, Package, CreditCard, Loader2, PlusCircle as PlusCircleIcon, MinusCircle as MinusCircleIcon, Trash2, Info } from 'lucide-react';
import { toast } from 'sonner';
import axios from 'axios';
import { handleFirestoreError, OperationType } from '@/lib/error-handler';
import { motion, AnimatePresence } from 'motion/react';

import QRScanner from './QRScanner';
import RedePaymentForm from './RedePaymentForm';
import { Dialog, DialogContent } from '@/components/ui/dialog';

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
      toast.error(`Ops! Seu saldo atual de R$ ${profile.balance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} não é suficiente para esta compra de R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`);
      return;
    }

    try {
      setLoading(true);
      
      // Update balance
      const studentRef = doc(db, 'users', profile.uid);
      try {
        await updateDoc(studentRef, {
          balance: increment(-total)
        });
      } catch (e) {
        return handleFirestoreError(e, OperationType.UPDATE, `users/${profile.uid}`);
      }

      // Create Order
      try {
        await addDoc(collection(db, 'orders'), {
          studentId: profile.uid,
          studentName: profile.name,
          stallId: selectedStall?.id,
          stallName: selectedStall?.name,
          items: cart.map(item => `${item.quantity}x ${item.product.name}`),
          total,
          status: 'pending',
          timestamp: serverTimestamp()
        });
      } catch (e) {
        handleFirestoreError(e, OperationType.CREATE, 'orders');
      }

      // Record transaction
      try {
        await addDoc(collection(db, 'transactions'), {
          userId: profile.uid,
          amount: -total,
          type: 'debit',
          description: `Pedido App: ${selectedStall?.name}`,
          stallName: selectedStall?.name || 'Barraca',
          items: cart.map(item => `${item.quantity}x ${item.product.name}`),
          status: 'completed',
          timestamp: serverTimestamp()
        });
      } catch (e) {
        handleFirestoreError(e, OperationType.CREATE, 'transactions');
      }

      toast.success('Pedido realizado com sucesso!');
      setCart([]);
      setSelectedStall(null);
    } catch (error) {
      console.error('Checkout error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRedePayment = () => {
    if (cart.length === 0) return;
    setShowPaymentModal(true);
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
                    <div className="space-y-4">
                      {profile.balance < total && (
                        <motion.div 
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex flex-col items-center gap-2"
                        >
                          <div className="flex items-center gap-2 text-red-600 font-black uppercase text-[10px] tracking-widest">
                            <Info className="h-4 w-4" /> Notificação de Saldo
                          </div>
                          <p className="text-xs text-red-600 font-bold text-center leading-relaxed">
                            Seu saldo atual (R$ {profile.balance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}) não cobre o valor total.
                          </p>
                          <div className="h-px w-full bg-red-500/10 my-1" />
                          <p className="text-[9px] text-red-500 text-center uppercase tracking-tight font-black animate-pulse">
                            Complete o pagamento com cartão ou faça uma recarga.
                          </p>
                        </motion.div>
                      )}

                      <div className="space-y-2">
                        {cart.map(item => (
                          <div key={item.product.id} className="flex justify-between items-center p-3 bg-slate-50/50 rounded-xl border border-slate-100 group">
                            <div className="flex flex-col gap-0.5">
                              <span className="font-bold text-slate-900 text-sm">{item.product.name}</span>
                              <span className="text-[10px] text-blue-600 font-black">R$ {(item.product.price * item.quantity).toFixed(2)}</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="flex items-center bg-white border border-slate-200 rounded-lg overflow-hidden h-8">
                                <button 
                                  onClick={() => removeFromCart(item.product.id)}
                                  className="px-2 h-full hover:bg-slate-50 text-slate-500 active:bg-slate-100 transition-colors"
                                >
                                  <MinusCircle className="h-3 w-3" />
                                </button>
                                <div className="px-2 font-black text-xs min-w-[24px] text-center border-x border-slate-100">
                                  {item.quantity}
                                </div>
                                <button 
                                  onClick={() => addToCart(item.product)}
                                  className="px-2 h-full hover:bg-slate-50 text-slate-500 active:bg-slate-100 transition-colors"
                                >
                                  <PlusCircle className="h-3 w-3" />
                                </button>
                              </div>
                              <button 
                                onClick={() => setCart(prev => prev.filter(p => p.product.id !== item.product.id))}
                                className="h-8 w-8 flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
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
                          <span className="text-lg flex items-center gap-2">
                            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : 
                             profile.balance < total ? 'Saldo Insuficiente' : 'Pagar com Saldo'}
                          </span>
                          {!loading && profile.balance >= total && (
                            <span className="text-[10px] opacity-70 uppercase tracking-widest">Descontar R$ {total.toFixed(2)} da sua conta</span>
                          )}
                        </Button>
                        
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

      <Dialog open={showPaymentModal} onOpenChange={setShowPaymentModal}>
        <DialogContent className="sm:max-w-md bg-slate-900 border-white/5 rounded-[32px] p-0 overflow-hidden outline-none">
          <div className="p-8">
            <RedePaymentForm 
              amount={total} 
              uid={profile.uid} 
              onSuccess={() => {
                setTimeout(() => {
                  setShowPaymentModal(false);
                  handleCheckout(); // Automatically try to process the order once credit is added
                }, 2000);
              }}
              onCancel={() => setShowPaymentModal(false)}
            />
          </div>
        </DialogContent>
      </Dialog>
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
