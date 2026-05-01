import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle2, CreditCard, Loader2, ShieldCheck, Lock } from 'lucide-react';
import { db } from '@/lib/firebase';
import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { toast } from 'sonner';
import axios from 'axios';

interface RedePaymentFormProps {
  amount: number;
  uid: string;
  onSuccess: (tid: string) => void;
  onCancel: () => void;
}

export default function RedePaymentForm({ amount, uid, onSuccess, onCancel }: RedePaymentFormProps) {
  const [status, setStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle');
  const [loading, setLoading] = useState(false);
  const [cardData, setCardData] = useState({
    number: '',
    name: '',
    expiry: '',
    cvv: ''
  });

  const handleProcessPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (cardData.number.replace(/\s/g, '').length < 15 || !cardData.expiry.includes('/') || cardData.cvv.length < 3) {
      toast.error('Por favor, preencha os dados do cartão corretamente');
      return;
    }

    setLoading(true);
    setStatus('processing');
    const tid = `txn_${Date.now()}`;
    
    try {
      // Check if real credentials exist (server-side check happened in create-checkout, 
      // but let's just call process-payment and it will fail if not set)
      
      const response = await axios.post('/rede-api/process-payment', {
        cardData,
        amount: amount.toString(),
        transactionId: tid,
        userId: uid
      });

      if (response.data.success) {
        setStatus('success');
        toast.success('Recarga concluída com sucesso!');
        setTimeout(() => onSuccess(response.data.tid), 1500);
      }
    } catch (error: any) {
      console.error('Payment processing error:', error);
      
      // Fallback for demo/dev if REDE_PV is not set: simulate success IF in development
      // But user said "ambiente real", so we should show the error.
      const errorMsg = error.response?.data?.message || error.message;
      
      if (error.response?.data?.error === "Rede credentials not configured in secrets") {
         // This is a special case for AI Studio preview if user didn't add secrets yet
         // We'll show a helpful UI for it
         setStatus('error');
         toast.error("Gateway não configurado em 'Secrets'");
      } else {
         setStatus('error');
         toast.error(`Erro: ${errorMsg}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const formatCardNumber = (value: string) => {
    return value.replace(/\W/gi, '').replace(/(.{4})/g, '$1 ').trim();
  };

  if (status === 'success') {
    return (
      <div className="flex flex-col items-center gap-6 py-10 text-center animate-in fade-in zoom-in duration-500">
        <div className="h-20 w-20 bg-green-500/10 rounded-full flex items-center justify-center text-green-500 border border-green-500/20 shadow-[0_0_40px_rgba(34,197,94,0.1)]">
          <CheckCircle2 className="h-10 w-10" />
        </div>
        <div className="space-y-2">
           <h3 className="text-2xl font-black text-white uppercase tracking-tight">Recarga Aprovada</h3>
           <p className="text-slate-400 font-medium px-4">
             Seu saldo de R$ {amount.toFixed(2)} já está disponível.
           </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
         <div className="space-y-1">
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-blue-500 font-sans">Checkout Direto</span>
            <h2 className="text-xl font-black text-white uppercase tracking-tighter">Finalizar Recarga</h2>
         </div>
         <div className="bg-white/5 p-2 rounded-xl border border-white/5">
            <CreditCard className="text-white h-5 w-5" />
         </div>
      </div>

      <div className="bg-slate-950 p-4 rounded-2xl border border-white/5 flex justify-between items-center">
         <span className="text-[9px] font-black uppercase text-slate-500 tracking-widest">Valor Total</span>
         <span className="text-xl font-black text-white">R$ {amount.toFixed(2)}</span>
      </div>

      <form onSubmit={handleProcessPayment} className="space-y-4">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-[9px] font-black uppercase tracking-widest text-slate-500 ml-1">Número do Cartão</Label>
            <div className="relative">
              <Input 
                placeholder="0000 0000 0000 0000"
                maxLength={19}
                value={formatCardNumber(cardData.number)}
                onChange={(e) => setCardData({...cardData, number: e.target.value})}
                className="bg-slate-950 border-white/5 h-12 rounded-xl text-white font-mono tracking-widest pl-10 text-sm"
                required
              />
              <CreditCard className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-700 h-4 w-4" />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-[9px] font-black uppercase tracking-widest text-slate-500 ml-1">Nome no Cartão</Label>
            <Input 
              placeholder="COMO ESTÁ NO CARTÃO"
              value={cardData.name}
              onChange={(e) => setCardData({...cardData, name: e.target.value.toUpperCase()})}
              className="bg-slate-950 border-white/5 h-12 rounded-xl text-white font-black tracking-widest uppercase text-sm"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-[9px] font-black uppercase tracking-widest text-slate-500 ml-1">Validade</Label>
              <Input 
                placeholder="MM/YY"
                maxLength={5}
                value={cardData.expiry}
                onChange={(e) => {
                  let val = e.target.value.replace(/\D/g, '');
                  if (val.length >= 2) val = val.substring(0,2) + '/' + val.substring(2,4);
                  setCardData({...cardData, expiry: val})
                }}
                className="bg-slate-950 border-white/5 h-12 rounded-xl text-white font-black text-center text-sm"
                required
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[9px] font-black uppercase tracking-widest text-slate-500 ml-1">CVV</Label>
              <Input 
                placeholder="000"
                maxLength={4}
                value={cardData.cvv}
                onChange={(e) => setCardData({...cardData, cvv: e.target.value})}
                className="bg-slate-950 border-white/5 h-12 rounded-xl text-white font-black text-center text-sm"
                required
              />
            </div>
          </div>
        </div>

        <div className="pt-2 space-y-3">
          <Button 
            type="submit"
            disabled={loading}
            className="w-full h-14 bg-blue-600 hover:bg-blue-500 text-white font-black uppercase tracking-[.1em] rounded-xl shadow-xl transition-all active:scale-95 border-b-4 border-blue-800 active:border-b-0 text-xs"
          >
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              `Pagar Agora`
            )}
          </Button>
          <Button 
            type="button" 
            variant="ghost" 
            onClick={onCancel}
            disabled={loading}
            className="w-full text-slate-500 hover:text-white uppercase font-black text-[9px] tracking-widest"
          >
            Cancelar
          </Button>
          
          <div className="flex items-center justify-center gap-4 py-1 opacity-40">
             <div className="flex items-center gap-1.5 ">
                <ShieldCheck size={12} className="text-blue-500" />
                <span className="text-[8px] font-bold text-slate-300 uppercase tracking-tighter">Seguro</span>
             </div>
             <div className="h-1 w-1 bg-slate-800 rounded-full" />
             <div className="flex items-center gap-1.5 ">
                <Lock size={12} className="text-blue-500" />
                <span className="text-[8px] font-bold text-slate-300 uppercase tracking-tighter">PCI Compliant</span>
             </div>
          </div>
        </div>
      </form>
    </div>
  );
}
