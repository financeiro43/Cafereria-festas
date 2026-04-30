import React, { useState, useEffect, useRef } from 'react';
import { db, auth } from '@/lib/firebase';
import { doc, onSnapshot, collection, query, where, orderBy, limit, addDoc, serverTimestamp, getDocs } from 'firebase/firestore';
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

      if (response.data.checkoutUrl) {
        // Redireciona para o link da Rede (ou simulação)
        window.open(response.data.checkoutUrl, '_blank');
        toast.success('Link de pagamento gerado!');
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
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Olá, {profile.name}</h1>
            <p className="text-slate-500">Gestão de saldo escolar</p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => auth.signOut()}>
            <LogOut className="h-5 w-5 text-slate-400" />
          </Button>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="md:col-span-1 bg-white border-slate-100 overflow-hidden">
            <CardHeader className="bg-slate-900 text-white">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Wallet className="h-4 w-4" /> Saldo Atual
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="text-4xl font-bold text-slate-900">
                R$ {profile.balance.toFixed(2)}
              </div>
            </CardContent>
          </Card>

          <Card className="md:col-span-2 bg-white border-slate-100">
            <CardHeader>
              <CardTitle className="text-lg flex items-center justify-between">
                <span>Recarga via Rede</span>
                <Button variant="outline" size="sm" onClick={() => setIsScanning(true)} className="text-xs h-8">
                  <QrCode className="h-3 w-3 mr-1" /> Ler Cartão
                </Button>
              </CardTitle>
              <CardDescription>Adicione saldo instantaneamente</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
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
              <div className="flex gap-4">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-2.5 text-slate-400 font-medium text-sm">R$</span>
                  <Input 
                    type="number" 
                    value={rechargeAmount}
                    onChange={(e) => setRechargeAmount(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <Button onClick={handleRecharge} disabled={loading} className="bg-slate-900 hover:bg-slate-800">
                  <PlusCircle className="h-4 w-4 mr-2" /> Recarregar
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="shop" className="w-full">
          <TabsList className="bg-white border border-slate-100 shadow-sm mb-4">
            <TabsTrigger value="shop" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              <ShoppingBag className="h-4 w-4 mr-2" /> Comprar
            </TabsTrigger>
            <TabsTrigger value="orders" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              <ListChecks className="h-4 w-4 mr-2" /> Meus Pedidos
            </TabsTrigger>
            <TabsTrigger value="qr" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              <QrCode className="h-4 w-4 mr-2" /> Cartão Digital (QR)
            </TabsTrigger>
            <TabsTrigger value="history" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              <History className="h-4 w-4 mr-2" /> Extrato
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="shop">
            <ShopView profile={profile} />
          </TabsContent>

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
    </div>
  );
}
