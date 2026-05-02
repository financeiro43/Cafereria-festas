import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
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
      
      const response = await axios.post('/api/rede/process-payment', {
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
      
      const errorData = error.response?.data;
      let errorMsg = errorData?.message || errorData?.error || error.message;
      
      // Tradução/Melhoria de erros comuns da Rede
      if (errorMsg.includes('Unauthorized') || errorMsg.includes('Contact issuer')) {
        errorMsg = 'Transação negada pelo banco. Por favor, verifique seu limite ou entre em contato com a operadora do cartão.';
      } else if (errorMsg.includes('expired')) {
        errorMsg = 'Cartão expirado ou data de validade incorreta.';
      } else if (errorMsg.includes('Invalid parameter format')) {
        errorMsg = 'Dados do cartão em formato inválido. Verifique o número e CVV.';
      }

      setStatus('error');
      toast.error(errorMsg, { duration: 5000 });
    } finally {
      setLoading(false);
    }
  };

  const formatCardNumber = (value: string) => {
    return value.replace(/\W/gi, '').replace(/(.{4})/g, '$1 ').trim();
  };

  if (status === 'success') {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center overflow-hidden">
        <motion.div
          initial={{ scale: 0, rotate: -20 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ 
            type: 'spring', 
            stiffness: 260, 
            damping: 20,
            delay: 0.1 
          }}
          className="relative h-24 w-24 bg-green-500 rounded-full flex items-center justify-center text-white shadow-[0_20px_50px_rgba(34,197,94,0.3)] mb-8"
        >
          <CheckCircle2 className="h-12 w-12" strokeWidth={3} />
          <motion.div 
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: [0, 1, 0], scale: [1, 2, 2.5] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut" }}
            className="absolute inset-0 bg-green-500 rounded-full"
          />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="space-y-3"
        >
           <h3 className="text-3xl font-black text-white uppercase tracking-tighter">Recarga Concluída!</h3>
           <p className="text-slate-400 font-bold text-sm max-w-[240px] leading-relaxed">
             Seu saldo de <span className="text-white">R$ {amount.toFixed(2)}</span> foi creditado e já está pronto para uso.
           </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="mt-8 flex gap-1 justify-center"
        >
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              animate={{ 
                scale: [1, 1.2, 1],
                opacity: [0.3, 1, 0.3]
              }}
              transition={{ 
                duration: 1, 
                repeat: Infinity, 
                delay: i * 0.2 
              }}
              className="h-1.5 w-1.5 bg-green-500 rounded-full"
            />
          ))}
        </motion.div>
      </div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="space-y-6"
    >
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
            className="w-full h-16 bg-blue-600 hover:bg-blue-500 text-white font-black uppercase tracking-[.2em] rounded-2xl shadow-[0_20px_40px_rgba(37,99,235,0.2)] transition-all active:scale-95 border-b-4 border-blue-800 active:border-b-0 text-xs relative overflow-hidden group"
          >
            {loading && (
              <motion.div 
                initial={{ x: '-100%' }}
                animate={{ x: '100%' }}
                transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
              />
            )}
            
            <span className="relative flex items-center justify-center gap-3">
              {loading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>Processando...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="h-5 w-5 opacity-50" />
                  <span>Confirmar Pagamento</span>
                </>
              )}
            </span>
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
    </motion.div>
  );
}
