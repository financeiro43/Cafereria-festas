import React, { useState, useEffect } from 'react';
import { db, auth } from '@/lib/firebase';
import { collection, onSnapshot, query, where, addDoc, serverTimestamp, doc, updateDoc, increment } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Stall, Product, UserProfile } from '../types';
import { Store, ShoppingCart, ArrowLeft, CheckCircle2, Package } from 'lucide-react';
import { toast } from 'sonner';
import { handleFirestoreError, OperationType } from '@/lib/error-handler';

export default function ShopView({ profile }: { profile: UserProfile }) {
  const [stalls, setStalls] = useState<Stall[]>([]);
  const [selectedStall, setSelectedStall] = useState<Stall | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<{product: Product, quantity: number}[]>([]);
  const [loading, setLoading] = useState(false);

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
                    <Button 
                      className="w-full h-12 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl"
                      disabled={loading || profile.balance < total}
                      onClick={handleCheckout}
                    >
                      {loading ? 'Processando...' : profile.balance < total ? 'Saldo Insuficiente' : 'Finalizar Pedido'}
                    </Button>
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
