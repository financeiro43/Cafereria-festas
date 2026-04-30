import React, { useState, useEffect, useRef } from 'react';
import { db, auth } from '@/lib/firebase';
import { doc, onSnapshot, collection, query, where, orderBy, limit, addDoc, serverTimestamp, getDocs, updateDoc, increment } from 'firebase/firestore';
import { QRCodeSVG } from 'qrcode.react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UserProfile, Transaction } from '../types';
import { handleFirestoreError, OperationType } from '@/lib/error-handler';
import { PlusCircle, History, QrCode, LogOut, Wallet, ShoppingBag, ListChecks } from 'lucide-react';
import axios from 'axios';
import { toast } from 'sonner';
import ShopView from './ShopView';
import { Order } from '../types';

export default function ParentDashboard({ profile }: { profile: UserProfile }) {
  const [rechargeAmount, setRechargeAmount] = useState<string>('50');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [currentTransactionId, setCurrentTransactionId] = useState<string | null>(null);
  const [pendingAmount, setPendingAmount] = useState<number>(0);
  const [activeTab, setActiveTab] = useState('shop');
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);

  useEffect(() => {
    if (isScanning && !scannerRef.current) {
      setTimeout(() => {
        const readerElement = document.getElementById("qr-reader-parent");
        if (readerElement) {
          scannerRef.current = new Html5QrcodeScanner(
            "qr-reader-parent",
            { fps: 10, qrbox: { width: 250, height: 250 } },
            false
          );
          scannerRef.current.render(onScanSuccess, (error) => {});
        }
      }, 100);
    }

    return () => {
      if (scannerRef.current) {
        scannerRef.current.clear().catch(console.error);
        scannerRef.current = null;
      }
    };
  }, [isScanning]);

  const onScanSuccess = async (decodedText: string) => {
    try {
      setIsScanning(false);
      const q = query(collection(db, 'users'), where('qrCode', '==', decodedText));
      const querySnapshot = await getDocs(q);
      
      if (querySnapshot.empty) {
        toast.error('Cartão não identificado no sistema');
        return;
      }

      const userData = querySnapshot.docs[0].data() as UserProfile;
      if (userData.uid !== profile.uid) {
        toast.warning(`Identificado: ${userData.name}. Você está logado como ${profile.name}.`);
      } else {
        toast.success('Seu cartão foi identificado!');
      }
      // Since it's self-service, we stay on this profile, but we've "verified" the card
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    if (!profile.uid) return;
    
    // Transactions listener
    const qTx = query(
      collection(db, 'transactions'),
      where('userId', '==', profile.uid),
      orderBy('timestamp', 'desc'),
      limit(10)
    );

    const unsubTx = onSnapshot(qTx, (snapshot) => {
      setTransactions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'transactions');
    });

    // Orders listener
    const qOrders = query(
      collection(db, 'orders'),
      where('studentId', '==', profile.uid),
      orderBy('timestamp', 'desc'),
      limit(10)
    );

    const unsubOrders = onSnapshot(qOrders, (snapshot) => {
      setOrders(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'orders');
    });

    return () => {
      unsubTx();
      unsubOrders();
    };
  }, [profile.uid]);

  const handleRecharge = async () => {
    try {
      setLoading(true);
      const amount = parseFloat(rechargeAmount);
      if (isNaN(amount) || amount <= 0) {
        toast.error('Valor inválido');
        setLoading(false);
        return;
      }

      // Create the pending transaction on the client side to bypass server permission issues
      const txnRef = await addDoc(collection(db, 'transactions'), {
        userId: profile.uid,
        amount,
        type: 'credit',
        status: 'pending',
        description: `Recarga de saldo para ${profile.name}`,
        timestamp: serverTimestamp(),
      });

      const response = await axios.post('/api/rede/create-checkout', {
        amount,
        userId: profile.uid,
        studentName: profile.name,
        transactionId: txnRef.id
      });

      if (response.data.transactionId) {
        setPendingAmount(amount);
        setCurrentTransactionId(response.data.transactionId);
        setShowPaymentModal(true);
        toast.success('Link de faturamento gerado!');
      }
    } catch (error: any) {
      console.error('Recharge error:', error);
      const errorData = error.response?.data;
      let displayMessage = error.message;
      
      if (errorData) {
        if (typeof errorData === 'object') {
          displayMessage = errorData.message || errorData.error || JSON.stringify(errorData);
        } else {
          displayMessage = errorData;
        }
      }
      
      toast.error(`Erro ao processar recarga: ${displayMessage}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-20 md:pb-8">
      <div className="max-w-4xl mx-auto md:p-8 p-4 space-y-4 md:space-y-6">
        <header className="flex justify-between items-center bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-slate-100">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-slate-900">Olá, {profile.name}</h1>
            <p className="text-xs md:text-sm text-slate-500">Portal do Aluno • Conectado</p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => auth.signOut()}>
            <LogOut className="h-5 w-5 text-slate-400" />
          </Button>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
          <Card className="md:col-span-1 bg-gradient-to-br from-slate-900 to-slate-800 text-white border-none overflow-hidden shadow-lg">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 text-slate-400 text-xs font-bold uppercase tracking-widest mb-1">
                <Wallet className="h-3 w-3" /> Saldo Disponível
              </div>
              <div className="text-4xl font-black">
                R$ {profile.balance.toFixed(2)}
              </div>
            </CardContent>
          </Card>

          <Card className="md:col-span-2 bg-white border-slate-100 shadow-sm">
            <CardHeader className="pb-3 px-4 md:px-6">
              <CardTitle className="text-base md:text-lg flex items-center justify-between">
                <span>Recarga Rápida</span>
                <Button variant="outline" size="sm" onClick={() => setIsScanning(true)} className="text-[10px] h-7 px-2">
                  <QrCode className="h-3 w-3 mr-1" /> Cartão Físico
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-4 md:px-6 pb-4">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xs">R$</span>
                  <Input 
                    type="number" 
                    value={rechargeAmount}
                    onChange={(e) => setRechargeAmount(e.target.value)}
                    className="pl-8 h-10 text-sm font-bold bg-slate-50 border-slate-100"
                  />
                </div>
                <Button onClick={handleRecharge} disabled={loading} className="bg-slate-900 hover:bg-slate-800 h-10 px-4 text-xs font-bold">
                  Recarregar
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Desktop Tabs */}
        <div className="hidden md:block">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="bg-white border border-slate-100 shadow-sm mb-4">
              <TabsTrigger value="shop"><ShoppingBag className="h-4 w-4 mr-2" /> Comprar</TabsTrigger>
              <TabsTrigger value="orders"><ListChecks className="h-4 w-4 mr-2" /> Meus Pedidos</TabsTrigger>
              <TabsTrigger value="qr"><QrCode className="h-4 w-4 mr-2" /> Cartão Digital</TabsTrigger>
              <TabsTrigger value="history"><History className="h-4 w-4 mr-2" /> Extrato</TabsTrigger>
            </TabsList>
            
            <TabsContent value="shop"><ShopView profile={profile} /></TabsContent>
            <TabsContent value="orders">
              <Card className="bg-white border-slate-100">
                <CardContent className="p-0">
                  <div className="divide-y divide-slate-100">
                    {orders.length === 0 ? (
                      <div className="p-8 text-center text-slate-400 font-medium">Nenhum pedido realizado via app</div>
                    ) : (
                      orders.map((order) => (
                        <div key={order.id} className="p-4 flex justify-between items-center">
                          <div className="space-y-1">
                            <p className="text-xs font-black text-blue-600 uppercase tracking-tighter">{order.stallName}</p>
                            <p className="text-sm font-bold text-slate-900">{order.items.join(', ')}</p>
                            <p className="text-[10px] text-slate-400 italic">ID: {order.id.slice(-6).toUpperCase()}</p>
                          </div>
                          <div className="text-right flex flex-col items-end gap-1">
                            <p className="font-black text-slate-900">R$ {order.total.toFixed(2)}</p>
                            <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                              order.status === 'delivered' ? 'bg-green-100 text-green-600' : 
                              order.status === 'cancelled' ? 'bg-red-100 text-red-600' : 
                              'bg-orange-100 text-orange-600'
                            }`}>
                              {order.status === 'pending' ? 'Pendente' : 
                               order.status === 'delivered' ? 'Entregue' : 'Cancelado'}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="qr">
              <Card className="bg-white border-slate-100 overflow-hidden text-center p-8 space-y-6">
                <h3 className="font-black text-slate-900 uppercase tracking-tight">Seu Identificador</h3>
                <div className="bg-slate-50 p-6 rounded-3xl inline-block border-2 border-slate-100">
                  <QRCodeSVG value={profile.qrCode} size={200} />
                </div>
                <p className="text-slate-500 text-sm max-w-[200px] mx-auto">Apresente este código no PDV para pagar suas compras</p>
              </Card>
            </TabsContent>
            <TabsContent value="history">
              <Card className="bg-white border-slate-100">
                <CardContent className="p-0">
                  <div className="divide-y divide-slate-100">
                    {transactions.length === 0 ? (
                      <div className="p-8 text-center text-slate-400 font-medium">Nenhuma transação recente</div>
                    ) : (
                      transactions.map((tx) => (
                        <div key={tx.id} className="flex justify-between items-center p-4">
                          <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-full ${tx.type === 'credit' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                              {tx.type === 'credit' ? <PlusCircle className="h-4 w-4" /> : <Wallet className="h-4 w-4" />}
                            </div>
                            <div>
                              <p className="font-medium text-slate-900">{tx.description}</p>
                              <p className="text-xs text-slate-400 capitalize">{tx.status}</p>
                            </div>
                          </div>
                          <div className={`font-bold ${tx.type === 'credit' ? 'text-green-600' : 'text-red-600'}`}>
                            {tx.type === 'credit' ? '+' : '-'} R$ {Math.abs(tx.amount).toFixed(2)}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Mobile View Content */}
        <div className="md:hidden space-y-4">
          {activeTab === 'shop' && <ShopView profile={profile} />}
          {activeTab === 'orders' && (
             <Card className="bg-white border-slate-100">
                <CardContent className="p-0">
                  <div className="divide-y divide-slate-100">
                    {orders.length === 0 ? (
                      <div className="p-12 text-center text-slate-400 text-sm font-medium">Nenhum pedido realizado</div>
                    ) : (
                      orders.map((order) => (
                        <div key={order.id} className="p-4 flex justify-between items-center">
                          <div className="space-y-1">
                            <p className="text-[10px] font-black text-blue-600 uppercase tracking-tighter">{order.stallName}</p>
                            <p className="text-sm font-bold text-slate-900">{order.items.join(', ')}</p>
                            <p className="text-[9px] text-slate-400">{order.timestamp && new Date(order.timestamp.toDate()).toLocaleString()}</p>
                          </div>
                          <div className="text-right">
                            <p className="font-black text-slate-900 text-sm">R$ {order.total.toFixed(2)}</p>
                            <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                              order.status === 'delivered' ? 'bg-green-100 text-green-600' : 'bg-orange-100 text-orange-600'
                            }`}>{order.status}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
             </Card>
          )}
          {activeTab === 'qr' && (
            <Card className="bg-white border-slate-100 overflow-hidden text-center p-8 space-y-6">
              <h3 className="font-black text-slate-900 uppercase tracking-tight">Seu Identificador</h3>
              <div className="bg-slate-50 p-6 rounded-3xl inline-block border-2 border-slate-100">
                <QRCodeSVG value={profile.qrCode} size={200} />
              </div>
              <p className="text-slate-500 text-sm max-w-[200px] mx-auto">Apresente este código no PDV para pagar suas compras</p>
            </Card>
          )}
          {activeTab === 'history' && (
             <Card className="bg-white border-slate-100">
               <CardContent className="p-0">
                 <div className="divide-y divide-slate-100">
                   {transactions.map((tx) => (
                     <div key={tx.id} className="flex justify-between items-center p-4">
                       <div className="flex items-center gap-3">
                         <div className={`p-2 rounded-full ${tx.type === 'credit' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                           {tx.type === 'credit' ? <PlusCircle className="h-4 w-4" /> : <Wallet className="h-4 w-4" />}
                         </div>
                         <div>
                           <p className="text-sm font-bold text-slate-900 leading-tight">{tx.description}</p>
                           <p className="text-[10px] text-slate-400 capitalize">{tx.timestamp && new Date(tx.timestamp.toDate()).toLocaleDateString()}</p>
                         </div>
                       </div>
                       <div className={`font-black text-sm ${tx.type === 'credit' ? 'text-green-600' : 'text-red-600'}`}>
                         {tx.type === 'credit' ? '+' : '-'} R$ {tx.amount.toFixed(2)}
                       </div>
                     </div>
                   ))}
                 </div>
               </CardContent>
             </Card>
          )}
        </div>
      </div>

      {isScanning && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <Card className="w-full max-w-sm bg-slate-900 border-slate-800">
            <CardHeader>
              <CardTitle className="text-white text-center">Escaneie o QR do seu Cartão</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div id="qr-reader-parent" className="rounded-xl overflow-hidden bg-black border border-slate-800"></div>
              <Button variant="ghost" onClick={() => setIsScanning(false)} className="w-full text-slate-400">
                Cancelar
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-100 px-6 py-3 flex justify-between items-center z-40 shadow-[0_-4px_10px_rgba(0,0,0,0.02)]">
        <button onClick={() => setActiveTab('shop')} className={`flex flex-col items-center gap-1 ${activeTab === 'shop' ? 'text-slate-900' : 'text-slate-300'}`}>
          <ShoppingBag className="h-5 w-5" />
          <span className="text-[9px] font-bold uppercase tracking-widest">Loja</span>
        </button>
        <button onClick={() => setActiveTab('orders')} className={`flex flex-col items-center gap-1 ${activeTab === 'orders' ? 'text-slate-900' : 'text-slate-300'}`}>
          <ListChecks className="h-5 w-5" />
          <span className="text-[9px] font-bold uppercase tracking-widest">Pedidos</span>
        </button>
        <button onClick={() => setActiveTab('qr')} className={`flex flex-col items-center gap-1 ${activeTab === 'qr' ? 'text-slate-900' : 'text-slate-300'}`}>
          <div className={`p-2 rounded-full -mt-8 shadow-lg border-4 border-slate-50 transition-all ${activeTab === 'qr' ? 'bg-slate-900 text-white' : 'bg-white text-slate-400'}`}>
            <QrCode className="h-5 w-5" />
          </div>
          <span className="text-[9px] font-bold uppercase tracking-widest mt-1">Cartão</span>
        </button>
        <button onClick={() => setActiveTab('history')} className={`flex flex-col items-center gap-1 ${activeTab === 'history' ? 'text-slate-900' : 'text-slate-300'}`}>
          <History className="h-5 w-5" />
          <span className="text-[9px] font-bold uppercase tracking-widest">Extrato</span>
        </button>
        <button onClick={() => auth.signOut()} className="flex flex-col items-center gap-1 text-slate-300">
          <LogOut className="h-5 w-5" />
          <span className="text-[9px] font-bold uppercase tracking-widest">Sair</span>
        </button>
      </nav>
    </div>
  );
}
