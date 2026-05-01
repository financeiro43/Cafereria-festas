import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle2, CreditCard, Loader2, ShieldCheck, Lock, ChevronLeft } from 'lucide-react';
import { db } from '@/lib/firebase';
import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { toast } from 'sonner';
import axios from 'axios';

export default function MockPayment() {
  const [status, setStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle');
  const [cardData, setCardData] = useState({
    number: '',
    name: '',
    expiry: '',
    cvv: ''
  });

  const params = new URLSearchParams(window.location.search);
  const tid = params.get('tid') || '';
  const amt = params.get('amt') || '0';
  const uid = params.get('uid') || '';
  const isReal = params.get('real') === 'true';

  const handleProcessPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tid || !uid || !amt) {
      toast.error('Dados da transação ausentes');
      return;
    }

    // Basic validation
    if (cardData.number.length < 16 || !cardData.expiry.includes('/') || cardData.cvv.length < 3) {
      toast.error('Por favor, preencha os dados do cartão corretamente');
      return;
    }

    setStatus('processing');
    
    try {
      if (isReal) {
        // CALL REAL BACKEND REDE API
        const response = await axios.post('/rede-api/process-payment', {
          cardData,
          amount: amt,
          transactionId: tid,
          userId: uid
        });

        if (response.data.success) {
          setStatus('success');
          toast.success('Pagamento real processado com sucesso via Rede!');
        }
      } else {
        // SIMULATION LOGIC
        await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate delay
        
        await runTransaction(db, async (transaction) => {
          const txnRef = doc(db, 'transactions', tid);
          const userRef = doc(db, 'users', uid);
          
          const txnDoc = await transaction.get(txnRef);
          const userDoc = await transaction.get(userRef);

          if (!userDoc.exists()) throw new Error('Usuário não encontrado');
          
          if (!txnDoc.exists()) {
            transaction.set(txnRef, {
              userId: uid,
              amount: parseFloat(amt),
              type: 'credit',
              status: 'pending',
              description: 'Recarga Digital (Simulada)',
              timestamp: serverTimestamp()
            });
          }

          transaction.update(userRef, { 
            balance: (userDoc.data().balance || 0) + parseFloat(amt) 
          });
          
          transaction.update(txnRef, { 
            status: 'completed',
            updatedAt: serverTimestamp()
          });
        });

        setStatus('success');
        toast.success('Simulação de pagamento concluída!');
      }
    } catch (error: any) {
      console.error('Payment processing error:', error);
      setStatus('error');
      const errorMsg = error.response?.data?.message || error.message;
      toast.error(`Erro no processamento: ${errorMsg}`);
    }
  };

  const formatCardNumber = (value: string) => {
    return value.replace(/\W/gi, '').replace(/(.{4})/g, '$1 ').trim();
  };

  if (status === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-6">
        <Card className="w-full max-w-md bg-slate-900 border-white/5 text-center py-12 rounded-[40px] shadow-2xl">
          <CardContent className="flex flex-col items-center gap-6">
            <div className="h-24 w-24 bg-green-500/10 rounded-full flex items-center justify-center text-green-500 mb-2 border border-green-500/20 shadow-[0_0_40px_rgba(34,197,94,0.1)]">
              <CheckCircle2 className="h-12 w-12" />
            </div>
            <CardTitle className="text-3xl font-black text-white uppercase tracking-tight">Sucesso!</CardTitle>
            <CardDescription className="text-slate-400 font-medium px-4">
              Seu pagamento de <strong className="text-white">R$ {parseFloat(amt).toFixed(2)}</strong> foi aprovado. O saldo já está disponível na sua conta.
            </CardDescription>
            <Button onClick={() => window.close()} className="mt-4 w-full h-14 bg-white text-black hover:bg-slate-200 font-black rounded-2xl uppercase tracking-widest transition-all active:scale-95">
              Voltar ao Aplicativo
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Background decorativo */}
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none opacity-20">
        <div className="absolute top-[-20%] right-[-10%] w-[60%] h-[60%] bg-blue-600 blur-[150px] rounded-full" />
        <div className="absolute bottom-[-20%] left-[-10%] w-[60%] h-[60%] bg-purple-600 blur-[150px] rounded-full" />
      </div>

      <div className="w-full max-w-lg relative z-10 space-y-6">
        <header className="flex items-center justify-between px-2">
           <button onClick={() => window.close()} className="text-slate-500 hover:text-white transition-colors flex items-center gap-2 font-black uppercase text-[10px] tracking-widest">
              <ChevronLeft size={16} /> Voltar
           </button>
           <div className="flex items-center gap-2 text-slate-500 font-black uppercase text-[10px] tracking-widest">
              <Lock size={12} className="text-green-500" /> Checkout Seguro
           </div>
        </header>

        <Card className="bg-slate-900/40 border-white/5 backdrop-blur-3xl rounded-[40px] shadow-2xl overflow-hidden">
          <CardHeader className="p-8 pb-4">
            <div className="flex justify-between items-start">
               <div className="space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-[0.3em] text-blue-500">Gateway Rede</span>
                  <CardTitle className="text-3xl font-black text-white uppercase tracking-tighter">Recarga Digital</CardTitle>
               </div>
               <div className="bg-white/5 p-3 rounded-2xl border border-white/5">
                  <CreditCard className="text-white h-6 w-6" />
               </div>
            </div>
            <CardDescription className="text-slate-500 font-bold uppercase text-[10px] tracking-widest mt-4">
              Valor a carregar: <span className="text-white text-lg">R$ {parseFloat(amt).toFixed(2)}</span>
            </CardDescription>
          </CardHeader>
          
          <CardContent className="p-8 pt-4">
            <form onSubmit={handleProcessPayment} className="space-y-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Número do Cartão</Label>
                  <div className="relative">
                    <Input 
                      placeholder="0000 0000 0000 0000"
                      maxLength={19}
                      value={formatCardNumber(cardData.number)}
                      onChange={(e) => setCardData({...cardData, number: e.target.value})}
                      className="bg-slate-950 border-white/5 h-14 rounded-2xl text-white font-mono tracking-widest pl-12"
                      required
                    />
                    <CreditCard className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-700 h-5 w-5" />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Nome no Cartão</Label>
                  <Input 
                    placeholder="COMO ESTÁ NO CARTÃO"
                    value={cardData.name}
                    onChange={(e) => setCardData({...cardData, name: e.target.value.toUpperCase()})}
                    className="bg-slate-950 border-white/5 h-14 rounded-2xl text-white font-black tracking-widest uppercase"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Validade</Label>
                    <Input 
                      placeholder="MM/YY"
                      maxLength={5}
                      value={cardData.expiry}
                      onChange={(e) => {
                        let val = e.target.value.replace(/\D/g, '');
                        if (val.length >= 2) val = val.substring(0,2) + '/' + val.substring(2,4);
                        setCardData({...cardData, expiry: val})
                      }}
                      className="bg-slate-950 border-white/5 h-14 rounded-2xl text-white font-black text-center"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">CVV</Label>
                    <Input 
                      placeholder="000"
                      maxLength={4}
                      value={cardData.cvv}
                      onChange={(e) => setCardData({...cardData, cvv: e.target.value})}
                      className="bg-slate-950 border-white/5 h-14 rounded-2xl text-white font-black text-center"
                      required
                    />
                  </div>
                </div>
              </div>

              <div className="pt-4 space-y-4">
                <Button 
                  type="submit"
                  disabled={status === 'processing'}
                  className="w-full h-16 bg-blue-600 hover:bg-blue-500 text-white font-black uppercase tracking-[.2em] rounded-[24px] shadow-2xl transition-all active:scale-95 border-b-4 border-blue-800 active:border-b-0"
                >
                  {status === 'processing' ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : (
                    `Finalizar e Pagar R$ ${parseFloat(amt).toFixed(2)}`
                  )}
                </Button>
                
                <div className="flex items-center justify-center gap-4 py-2">
                   <div className="flex items-center gap-1.5 opacity-40">
                      <ShieldCheck size={14} className="text-blue-500" />
                      <span className="text-[9px] font-bold text-slate-300 uppercase tracking-tighter">Tokenização Ativa</span>
                   </div>
                   <div className="h-1 w-1 bg-slate-800 rounded-full" />
                   <div className="flex items-center gap-1.5 opacity-40">
                      <Lock size={14} className="text-blue-500" />
                      <span className="text-[9px] font-bold text-slate-300 uppercase tracking-tighter">PCI Compliant</span>
                   </div>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>

        {isReal ? (
          <p className="text-center text-[10px] text-amber-500 font-black uppercase tracking-widest animate-pulse">
            Ambiente Real Ativo • Processamento Direto via Rede
          </p>
        ) : (
          <p className="text-center text-[10px] text-slate-600 font-black uppercase tracking-widest">
            Ambiente de Simulação • Use qualquer dado fictício
          </p>
        )}
      </div>
    </div>
  );
}
