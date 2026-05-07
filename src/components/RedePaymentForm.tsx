import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle2, CreditCard, Loader2, ShieldCheck, Lock, XCircle, Smartphone, SmartphoneNfc, Wallet, Copy, Check, QrCode } from 'lucide-react';
import { db } from '@/lib/firebase';
import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { toast } from 'sonner';
import axios from 'axios';
import { QRCodeSVG } from 'qrcode.react';

interface RedePaymentFormProps {
  amount: number;
  uid: string;
  onSuccess: (tid: string) => void;
  onCancel: () => void;
}

type PaymentMethod = 'credit' | 'debit' | 'pix';

export default function RedePaymentForm({ amount, uid, onSuccess, onCancel }: RedePaymentFormProps) {
  const [status, setStatus] = useState<'idle' | 'processing' | 'success' | 'error' | 'awaiting_pix'>('idle');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('credit');
  const [loading, setLoading] = useState(false);
  const [pixData, setPixData] = useState<{ qrcode: string, tid: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [cardData, setCardData] = useState({
    number: '',
    name: '',
    expiry: '',
    cvv: ''
  });

  const handleProcessPayment = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    
    if (paymentMethod !== 'pix' && (cardData.number.replace(/\s/g, '').length < 15 || !cardData.expiry.includes('/') || cardData.cvv.length < 3)) {
      toast.error('Por favor, preencha os dados do cartão corretamente');
      return;
    }

    setLoading(true);
    setStatus('processing');
    const tid = `txn_${Date.now()}`;
    
    try {
      const response = await axios.post('/api/rede/process-payment', {
        cardData: paymentMethod === 'pix' ? null : cardData,
        amount: amount.toString(),
        transactionId: tid,
        userId: uid,
        paymentMethod
      });

      if (response.data.success) {
        if (paymentMethod === 'pix' && response.data.pix) {
          setPixData({ qrcode: response.data.pix.qrCode, tid: response.data.tid });
          setStatus('awaiting_pix');
        } else {
          setStatus('success');
          toast.success('Recarga concluída com sucesso!');
          setTimeout(() => onSuccess(response.data.tid), 1500);
        }
      }
    } catch (error: any) {
      console.error('Payment processing error:', error);
      
      const errorData = error.response?.data;
      let errorMsg = errorData?.message || errorData?.error || error.message;
      
      if (errorMsg.includes('Unauthorized') || errorMsg.includes('Contact issuer')) {
        errorMsg = 'Transação negada pelo banco. Verifique seu limite ou tente outro cartão.';
      }

      setStatus('error');
      toast.error(errorMsg, { duration: 5000 });
    } finally {
      setLoading(false);
    }
  };

  const copyPix = () => {
    if (pixData) {
      navigator.clipboard.writeText(pixData.qrcode);
      setCopied(true);
      toast.success('Código Pix copiado!');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const formatCardNumber = (value: string) => {
    return value.replace(/\W/gi, '').replace(/(.{4})/g, '$1 ').trim();
  };

  if (status === 'processing') {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="relative">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            className="h-24 w-24 border-t-4 border-r-4 border-blue-500 rounded-full"
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <CreditCard className="h-8 w-8 text-blue-500 animate-pulse" />
          </div>
        </div>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-8 space-y-2"
        >
          <h3 className="text-xl font-black text-white uppercase tracking-tighter">Processando Pagamento</h3>
          <p className="text-slate-500 text-xs font-bold uppercase tracking-widest">Aguarde a confirmação da operadora...</p>
        </motion.div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center overflow-hidden">
        <motion.div
          initial={{ scale: 0, rotate: 20 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ 
            type: 'spring', 
            stiffness: 260, 
            damping: 20,
            delay: 0.1 
          }}
          className="relative h-24 w-24 bg-red-500 rounded-full flex items-center justify-center text-white shadow-[0_20px_50px_rgba(239,68,68,0.3)] mb-8"
        >
          <XCircle className="h-12 w-12" strokeWidth={3} />
          <motion.div 
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: [0, 1, 0], scale: [1, 2, 2.5] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut" }}
            className="absolute inset-0 bg-red-500 rounded-full"
          />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="space-y-3"
        >
           <h3 className="text-3xl font-black text-white uppercase tracking-tighter">Ops! Algo deu errado</h3>
           <p className="text-slate-400 font-bold text-sm max-w-[240px] leading-relaxed mx-auto">
             Não foi possível processar seu pagamento. Verifique seus dados ou tente outro cartão.
           </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="mt-10 w-full"
        >
          <Button 
            onClick={() => setStatus('idle')}
            className="w-full h-14 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-black uppercase tracking-[.2em] rounded-xl text-[10px]"
          >
            Tentar Novamente
          </Button>
        </motion.div>
      </div>
    );
  }

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
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-blue-500">Checkout Seguro</span>
            <h2 className="text-xl font-black text-white uppercase tracking-tighter">Escolha o Pagamento</h2>
         </div>
         <div className="bg-white/5 p-2 rounded-xl border border-white/5">
            <ShieldCheck className="text-blue-500 h-5 w-5" />
         </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
         {[
           { id: 'pix', label: 'Pix', icon: QrCode },
           { id: 'credit', label: 'Crédito', icon: CreditCard },
           { id: 'debit', label: 'Débito', icon: SmartphoneNfc }
         ].map((method) => (
           <button
             key={method.id}
             onClick={() => {
               setPaymentMethod(method.id as PaymentMethod);
               if (status === 'awaiting_pix') setStatus('idle');
             }}
             className={`flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all gap-2 ${
               paymentMethod === method.id 
                ? 'bg-blue-600 border-blue-400 shadow-lg shadow-blue-600/20 text-white' 
                : 'bg-white/5 border-white/5 text-slate-400 hover:bg-white/10'
             }`}
           >
             <method.icon className="h-5 w-5" />
             <span className="text-[9px] font-black uppercase tracking-widest">{method.label}</span>
           </button>
         ))}
      </div>

      <div className="bg-slate-950 p-4 rounded-2xl border border-white/5 flex justify-between items-center">
         <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-slate-500" />
            <span className="text-[9px] font-black uppercase text-slate-500 tracking-widest">Valor da Recarga</span>
         </div>
         <span className="text-xl font-black text-white">R$ {amount.toFixed(2)}</span>
      </div>

      <AnimatePresence mode="wait">
        {paymentMethod === 'pix' ? (
          <motion.div key="pix" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
             {status === 'awaiting_pix' ? (
                <div className="flex flex-col items-center justify-center py-4 text-center space-y-6">
                  <div className="p-4 bg-white rounded-[32px] shadow-2xl">
                    {pixData && <QRCodeSVG value={pixData.qrcode} size={180} level="H" includeMargin />}
                  </div>
                  <div className="w-full space-y-3">
                    <Button onClick={copyPix} className="w-full h-14 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-black uppercase text-[10px] tracking-widest rounded-2xl flex items-center justify-center gap-3">
                      {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                      {copied ? 'Copiado!' : 'Copiar Código Pix'}
                    </Button>
                    <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">Aguardando confirmação do pagamento...</p>
                  </div>
                </div>
             ) : (
                <div className="py-4 space-y-6">
                  <div className="flex items-start gap-4 p-4 bg-blue-600/10 rounded-2xl border border-blue-500/20">
                    <div className="h-8 w-8 bg-blue-600 rounded-lg flex items-center justify-center shrink-0">
                      <QrCode className="h-4 w-4 text-white" />
                    </div>
                    <p className="text-[11px] text-blue-100/80 leading-relaxed">
                      Geraremos um QR Code dinâmico para você. O saldo cai na hora após o pagamento.
                    </p>
                  </div>
                  <Button 
                    onClick={() => handleProcessPayment()}
                    disabled={loading}
                    className="w-full h-16 bg-blue-600 hover:bg-blue-500 text-white font-black uppercase tracking-[.2em] rounded-2xl shadow-xl shadow-blue-600/20 border-b-4 border-blue-800 active:border-b-0 active:translate-y-1 transition-all"
                  >
                    {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : 'Gerar QR Code Pix'}
                  </Button>
                </div>
             )}
          </motion.div>
        ) : (
          <motion.form 
            key="card" 
            initial={{ opacity: 0, x: 20 }} 
            animate={{ opacity: 1, x: 0 }} 
            exit={{ opacity: 0, x: -20 }} 
            onSubmit={handleProcessPayment} 
            className="space-y-4"
          >
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

            <Button 
              type="submit"
              disabled={loading}
              className="w-full h-16 bg-blue-600 hover:bg-blue-500 text-white font-black uppercase tracking-[.2em] rounded-2xl shadow-xl shadow-blue-600/20 border-b-4 border-blue-800 active:border-b-0 active:translate-y-1 transition-all text-xs"
            >
              {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : `Pagar com ${paymentMethod === 'debit' ? 'Débito' : 'Crédito'}`}
            </Button>
          </motion.form>
        )}
      </AnimatePresence>

      <div className="pt-2">
        <Button 
          variant="ghost" 
          onClick={onCancel}
          disabled={loading}
          className="w-full text-slate-500 hover:text-white uppercase font-black text-[9px] tracking-widest"
        >
          Cancelar e Voltar
        </Button>
        <div className="flex items-center justify-center gap-4 py-4 opacity-30 mt-2">
           <div className="flex items-center gap-1.5 ">
              <ShieldCheck size={12} className="text-blue-500" />
              <span className="text-[8px] font-bold text-slate-300 uppercase tracking-tighter">Ambiente Seguro</span>
           </div>
           <div className="h-1 w-1 bg-slate-800 rounded-full" />
           <div className="flex items-center gap-1.5 ">
              <Lock size={12} className="text-blue-500" />
              <span className="text-[8px] font-bold text-slate-300 uppercase tracking-tighter">Rede PCI</span>
           </div>
        </div>
      </div>
    </motion.div>
  );
}
