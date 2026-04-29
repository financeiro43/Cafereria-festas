import React, { useState, useEffect } from 'react';
import { db, auth } from '../lib/firebase';
import { doc, onSnapshot, collection, query, where, orderBy, limit } from 'firebase/firestore';
import { QRCodeSVG } from 'qrcode.react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UserProfile, Transaction } from '../types';
import { PlusCircle, History, QrCode, LogOut, Wallet } from 'lucide-react';
import axios from 'axios';
import { toast } from 'sonner';

export default function ParentDashboard({ profile }: { profile: UserProfile }) {
  const [rechargeAmount, setRechargeAmount] = useState<string>('50');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!profile.uid) return;
    
    const q = query(
      collection(db, 'transactions'),
      where('userId', '==', profile.uid),
      orderBy('timestamp', 'desc'),
      limit(10)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const txs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction));
      setTransactions(txs);
    });

    return () => unsubscribe();
  }, [profile.uid]);

  const handleRecharge = async () => {
    try {
      setLoading(true);
      const amount = parseFloat(rechargeAmount);
      if (isNaN(amount) || amount <= 0) {
        toast.error('Valor inválido');
        return;
      }

      const response = await axios.post('/api/rede/create-checkout', {
        amount,
        userId: profile.uid,
        studentName: profile.name
      });

      if (response.data.checkoutUrl) {
        // Redireciona para o link da Rede (ou simulação)
        window.open(response.data.checkoutUrl, '_blank');
        toast.success('Link de pagamento gerado!');
      }
    } catch (error) {
      console.error('Recharge error:', error);
      toast.error('Erro ao processar recarga');
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
              <CardTitle className="text-lg">Recarga via Rede</CardTitle>
              <CardDescription>Adicione saldo instantaneamente</CardDescription>
            </CardHeader>
            <CardContent className="flex gap-4">
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
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="qr" className="w-full">
          <TabsList className="bg-white border border-slate-100 shadow-sm mb-4">
            <TabsTrigger value="qr" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              <QrCode className="h-4 w-4 mr-2" /> Cartão Digital (QR)
            </TabsTrigger>
            <TabsTrigger value="history" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              <History className="h-4 w-4 mr-2" /> Extrato
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="qr">
            <Card className="bg-white border-slate-100">
              <CardContent className="flex flex-col items-center justify-center p-12 text-center">
                <div className="p-4 bg-white border-2 border-slate-100 rounded-2xl shadow-inner mb-6">
                  <QRCodeSVG value={profile.qrCode} size={200} />
                </div>
                <h3 className="text-lg font-semibold text-slate-900">Mostre este QR na barraca</h3>
                <p className="text-slate-500 max-w-xs mt-2">O valor da compra será descontado automaticamente do seu saldo.</p>
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
