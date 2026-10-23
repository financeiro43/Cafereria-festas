import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle2, CreditCard, Loader2, ShieldCheck, Lock, XCircle, Smartphone, SmartphoneNfc, Wallet, Copy, Check, QrCode, ChevronLeft, Info, Clock } from 'lucide-react';
import { db } from '@/lib/firebase';
import { doc, updateDoc, increment, serverTimestamp, onSnapshot } from 'firebase/firestore';
import { toast } from 'sonner';
import axios from 'axios';
import { QRCodeSVG } from 'qrcode.react';

import { z } from 'zod';

const cardSchema = z.object({
  number: z.string()
    .min(13, 'Número do cartão muito curto')
    .max(19, 'Número do cartão muito longo'),
  name: z.string()
    .min(3, 'Digite o nome como impresso no cartão')
    .regex(/^[a-zA-ZáéíóúâêîôûãõçÁÉÍÓÚÂÊÎÔÛÃÕÇ\s]+$/, 'O nome deve conter apenas letras'),
  expiry: z.string()
    .regex(/^(0[1-9]|1[0-2])\/\d{2}$/, 'Validade deve ser MM/YY'),
  cvv: z.string()
    .min(3, 'CVV deve ter pelo menos 3 dígitos')
    .max(4, 'CVV muito longo')
    .regex(/^\d+$/, 'CVV deve conter apenas números')
});

interface RedePaymentFormProps {
  amount: number;
  uid: string;
  onSuccess: (tid: string) => void;
  onCancel: () => void;
}

type PaymentMethod = 'credit' | 'debit' | 'pix';

export default function RedePaymentForm({ amount, uid, onSuccess, onCancel }: RedePaymentFormProps) {
  const [status, setStatus] = useState<'idle' | 'processing' | 'success' | 'error' | 'awaiting_pix' | 'cancelled' | 'expired'>('idle');
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('credit');
  const [loading, setLoading] = useState(false);
  const [showForceCancel, setShowForceCancel] = useState(false);
  const [pixData, setPixData] = useState<{ qrcode: string, tid: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pendingStatusInfo, setPendingStatusInfo] = useState<string | null>(null);
  const [pixTimeRemaining, setPixTimeRemaining] = useState<number>(30 * 60); // 30 minutos (1800s)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [cardData, setCardData] = useState({
    number: '',
    name: '',
    expiry: '',
    cvv: ''
  });

  const handleCancelPayment = async (action: 'cancelled' | 'expirado' = 'cancelled') => {
    if (pixData?.tid) {
      try {
        await updateDoc(doc(db, 'transactions', pixData.tid), {
          status: action === 'expirado' ? 'expirado' : 'cancelled',
          failureReason: action === 'expirado' ? 'pix_expired' : 'user_cancelled',
          updatedAt: serverTimestamp(),
          ...(action === 'expirado' ? { expiredAt: serverTimestamp() } : {}),
          _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
        });
      } catch (e) {
        console.warn('Erro ao atualizar status para cancelado/expirado:', e);
      }
    }
    setStatus(action === 'expirado' ? 'expired' : 'cancelled');
    setLoading(false);
  };

  // Timer countdown for Pix expiration (30 minutes)
  React.useEffect(() => {
    if (status !== 'awaiting_pix') return;

    const timerInterval = setInterval(() => {
      setPixTimeRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timerInterval);
          handleCancelPayment('expirado');
          toast.error('Tempo limite de pagamento expirado!', {
            description: 'O QR Code do Pix expirou após 30 minutos sem pagamento. A cobrança foi cancelada com segurança.'
          });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timerInterval);
  }, [status, pixData?.tid]);

  // Listen for Pix payment confirmation
  React.useEffect(() => {
    if (status === 'awaiting_pix' && pixData?.tid) {
      // 1. Real-time listener (Primary)
      const unsub = onSnapshot(doc(db, 'transactions', pixData.tid), (snap: any) => {
        if (snap.exists()) {
          const data = snap.data();
          if (data.status === 'completed') {
            console.log('[REDE-FORM] Snapshot confirmou pagamento!');
            setStatus('success');
            toast.success('Pagamento Confirmado!');
            onSuccess(pixData.tid);
          } else if (data.status === 'expirado') {
            console.log('[REDE-FORM] Snapshot informou transação expirada (> 30 min).');
            setStatus('expired');
            toast.error('Pagamento Pix Expirado', { description: 'O tempo limite de 30 minutos para pagamento encerrou.' });
          } else if (data.status === 'cancelled' || data.status === 'failed') {
            console.log('[REDE-FORM] Snapshot informou transação cancelada.');
            setStatus('cancelled');
            toast.info('Transação Cancelada', { description: 'O pagamento não foi realizado a tempo.' });
          }
        }
      }, (err) => {
        console.error('[REDE-FORM] Erro no snapshot:', err);
      });

      // 2. Polling Fallback (Backup)
      const pollInterval = setInterval(async () => {
        try {
          const tid = pixData.tid;
          // Add timestamp as query param to bust all possible caches
          const response = await axios.get(`/api/rede/verify-pix/${tid}?t=${Date.now()}`);
          console.log('[REDE-FORM] Auto-Verificação Pix:', response.data);
          
          if (response.data.success) {
            console.log('[REDE-FORM] Auto-Verificação confirmou pagamento!');
            setStatus('success');
            toast.success('Pagamento Confirmado!', { 
              description: 'Seu saldo já foi creditado automaticamente.' 
            });
            onSuccess(tid);
            clearInterval(pollInterval);
          } else if (response.data.status === 'expirado' || response.data.expired) {
            setStatus('expired');
            toast.error('Pagamento Pix Expirado', {
              description: 'O tempo limite de 30 minutos para pagamento deste Pix expirou.'
            });
            clearInterval(pollInterval);
          } else if (response.data.status === 'cancelled') {
            setStatus('cancelled');
            toast.info('Pagamento Não Realizado', {
              description: 'Esta transação foi cancelada.'
            });
            clearInterval(pollInterval);
          } else {
            // Update UI with the current status from Rede if available
            if (response.data.redeStatus) {
              setPendingStatusInfo(response.data.redeStatus);
            }
          }
        } catch (e) {
          console.error('[REDE-FORM] Erro no polling:', e);
        }
      }, 8000); // Poll every 8 seconds

      return () => {
        unsub();
        clearInterval(pollInterval);
      };
    }
  }, [status, pixData?.tid, onSuccess]);

  const handleProcessPayment = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setFormErrors({});
    
    if (paymentMethod !== 'pix') {
      const validation = cardSchema.safeParse({
        ...cardData,
        number: cardData.number.replace(/\s/g, '')
      });

      if (!validation.success) {
        const errors: Record<string, string> = {};
        validation.error.issues.forEach(issue => {
          if (issue.path[0]) errors[issue.path[0] as string] = issue.message;
        });
        setFormErrors(errors);
        toast.error('Verifique os dados informados', { 
          description: 'Alguns campos do cartão estão incorretos ou incompletos.' 
        });
        return;
      }
    }

    setLoading(true);
    setStatus('processing');
    setShowForceCancel(false);
    setPaymentError(null);
    
    // Safety timeout to prevent infinite spinning
    const processTimeout = setTimeout(() => {
      setStatus(prev => {
        if (prev === 'processing') {
          setPaymentError('O tempo de processamento excedeu o limite. A transação não foi finalizada.');
          return 'error';
        }
        return prev;
      });
      setLoading(false);
    }, 45000);

    const timer = setTimeout(() => setShowForceCancel(true), 5000); 
    const tid = `txn_${Date.now()}`;
    
    console.log(`[REDE-FORM] Iniciando processamento: ${paymentMethod}, Valor: ${amount}`);

    try {
      const response = await axios.post('/api/rede/process-payment', {
        cardData: paymentMethod === 'pix' ? null : {
          ...cardData,
          number: cardData.number.replace(/\s/g, '')
        },
        amount: amount.toString(),
        transactionId: tid,
        userId: uid,
        paymentMethod,
        customer: {
          name: "Luis Carlos Tosto",
          cpf: "04082089888",
          email: "admin@modeloalpha.com.br",
          businessName: "Escola Cristã Modelo Alpha Ltda",
          cnpj: "04214446000170"
        }
      }, { 
        timeout: 40000, 
        headers: { 'Content-Type': 'application/json' }
      });

      console.log(`[REDE-FORM] Resposta recebida:`, response.data);

      if (response.data && (response.data.success || response.data.pix)) {
        clearTimeout(processTimeout);
        if (paymentMethod === 'pix' && response.data.pix) {
          const qrCode = response.data.pix.qrCode;
          if (!qrCode) {
            setPaymentError('Erro ao gerar código Pix. A operadora financeira não retornou os dados.');
            setStatus('error');
            return;
          }
          setPixData({ qrcode: qrCode, tid: response.data.tid || tid });
          setStatus('awaiting_pix');
        } else {
          setStatus('success');
          toast.success('Pagamento Aprovado!', { description: 'Seu saldo foi creditado com sucesso.' });
          setTimeout(() => onSuccess(response.data.tid || tid), 2000);
        }
      } else {
        throw new Error(response.data?.message || 'Transação não autorizada pela operadora');
      }
    } catch (error: any) {
      clearTimeout(processTimeout);
      console.error('Erro detalhado do pagamento:', error);
      
      let errorMsg = 'Pagamento Não Realizado';
      let description = 'Não foi possível concluir a transação.';
      
      if (error.code === 'ECONNABORTED') {
        errorMsg = 'Tempo Limite Excedido';
        description = 'A operadora demorou para responder. Verifique sua conexão e tente novamente.';
      } else if (error.response?.data) {
        const errorData = error.response.data;
        const rawMsg = errorData.message || errorData.error || errorData.returnMessage || 
                       (Array.isArray(errorData.message) ? errorData.message[0]?.message : null) ||
                       (errorData.details?.[0]?.message) ||
                       (typeof errorData === 'string' ? errorData : JSON.stringify(errorData));
        
        description = rawMsg;

        if (errorData.returnCode === "203") {
          errorMsg = "Autenticação 3DS Necessária";
          description = "Transações de débito exigem autenticação 3DS no banco. Recomendamos usar Cartão de Crédito ou Pix.";
        } else if (error.response?.status === 500) {
           errorMsg = 'Instabilidade no Gateway';
           description = 'O gateway de pagamento retornou erro temporário. Tente via Pix ou tente novamente em alguns instantes.';
        } else if (error.response?.status === 401) {
           errorMsg = 'Erro de Autenticação';
           description = 'As credenciais do gateway estão expiradas ou inválidas.';
        } else {
           errorMsg = 'Pagamento Não Autorizado';
           const lowerMsg = String(rawMsg).toLowerCase();
           if (lowerMsg.includes('insufficient funds')) description = 'Saldo insuficiente no cartão.';
           else if (lowerMsg.includes('expired card')) description = 'Cartão informado está vencido.';
           else if (lowerMsg.includes('invalid card')) description = 'Número do cartão inválido.';
           else if (lowerMsg.includes('security code')) description = 'Código CVV incorreto.';
           else if (lowerMsg.includes('contact issuer') || lowerMsg.includes('unauthorized')) description = 'O banco emissor negou a autorização da transação.';
        }
      } else if (error.request) {
        errorMsg = 'Falha de Conexão';
        description = 'Sem resposta do servidor. Verifique sua conexão com a internet.';
      } else if (error.message) {
        description = error.message;
      }
      
      setPaymentError(description);
      setStatus('error');
      toast.error(errorMsg, { 
        description: description,
        duration: 8000
      });
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  };

  const copyPix = () => {
    if (pixData) {
      navigator.clipboard.writeText(pixData.qrcode);
      setCopied(true);
      toast.success('Código Pix copiado com sucesso!');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const checkStatus = async () => {
    if (!pixData?.tid) return;
    setLoading(true);
    try {
      const response = await axios.get(`/api/rede/verify-pix/${pixData.tid}?t=${Date.now()}`);
      console.log('[REDE-FORM] Verificação manual:', response.data);
      
      if (response.data.success) {
        setStatus('success');
        toast.success('Pagamento Confirmado!', {
          description: 'O saldo já foi adicionado à sua conta.'
        });
        onSuccess(pixData.tid);
      } else {
        const redeStatus = response.data.redeStatus || 'Aguardando';
        setPendingStatusInfo(redeStatus);
        
        toast.info(`Aguardando Pagamento`, {
          description: `O banco ainda não identificou a liquidação do Pix. Se já pagou, aguarde 15 a 30 segundos.`,
          duration: 5000
        });
      }
    } catch (e: any) {
      console.error('[REDE-FORM] Erro checkStatus:', e);
      const msg = e.response?.data?.details || e.response?.data?.message || 'Falha na verificação bancária.';
      toast.error('Erro na Verificação', { description: msg });
    } finally {
      setLoading(false);
    }
  };

  const formatCardNumber = (value: string) => {
    return value.replace(/\W/gi, '').replace(/(.{4})/g, '$1 ').trim();
  };

  if (status === 'processing') {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="relative">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }}
            className="h-24 w-24 border-4 border-blue-500/20 border-t-blue-500 rounded-full"
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <CreditCard className="h-8 w-8 text-blue-500 animate-pulse" />
          </div>
        </div>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-8 space-y-3"
        >
          <span className="text-[10px] font-black uppercase tracking-[0.25em] text-blue-400">Processamento em Andamento</span>
          <h3 className="text-2xl font-black text-white tracking-tight">Aguardando Pagamento</h3>
          <p className="text-slate-400 text-xs font-medium max-w-[280px] mx-auto leading-relaxed">
            Estamos comunicando com a operadora Rede para confirmar a transação de <strong className="text-white">R$ {amount.toFixed(2)}</strong>.
          </p>
          
          <div className="pt-6 flex flex-col gap-3 min-w-[240px]">
            {showForceCancel ? (
              <Button 
                variant="destructive" 
                onClick={handleCancelPayment}
                className="h-12 bg-red-600 hover:bg-red-700 text-white font-black uppercase tracking-wider text-xs rounded-xl shadow-lg cursor-pointer"
              >
                Parar e Cancelar
              </Button>
            ) : (
              <div className="flex items-center justify-center gap-2 h-12">
                 {[0,1,2].map(i => (
                   <motion.div 
                     key={i}
                     animate={{ scale: [1, 1.4, 1], opacity: [0.3, 1, 0.3] }}
                     transition={{ repeat: Infinity, duration: 1, delay: i * 0.2 }}
                     className="h-2 w-2 bg-blue-500 rounded-full"
                   />
                 ))}
              </div>
            )}
            
            <Button 
              variant="ghost" 
              onClick={handleCancelPayment}
              className="text-xs text-slate-400 hover:text-white uppercase font-bold tracking-wider h-10 cursor-pointer"
            >
              Cancelar Transação
            </Button>
          </div>
        </motion.div>
      </div>
    );
  }

  // SCREEN: PAGAMENTO CANCELADO
  if (status === 'cancelled') {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="h-20 w-20 bg-amber-500/15 border border-amber-500/30 rounded-3xl flex items-center justify-center text-amber-400 mb-6 shadow-[0_0_30px_rgba(245,158,11,0.2)]"
        >
          <XCircle className="h-10 w-10" strokeWidth={2.5} />
        </motion.div>

        <div className="space-y-2 mb-6">
          <span className="text-[10px] font-black uppercase tracking-[0.25em] text-amber-400">Transação Interrompida</span>
          <h3 className="text-2xl font-black text-white tracking-tight">Pagamento Não Finalizado</h3>
          <p className="text-slate-400 text-xs font-medium max-w-[280px] leading-relaxed mx-auto">
            Você cancelou esta operação. <strong>Nenhum valor foi debitado</strong> da sua conta ou cartão.
          </p>
        </div>

        <div className="w-full bg-white/5 border border-white/5 rounded-2xl p-4 mb-6 text-left space-y-1.5">
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-400">Valor pretendido:</span>
            <span className="text-white font-mono font-bold tabular-nums">R$ {amount.toFixed(2)}</span>
          </div>
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-400">Status atual:</span>
            <span className="text-amber-400 font-bold uppercase text-[10px]">Cancelado pelo usuário</span>
          </div>
        </div>

        <div className="w-full flex flex-col gap-2.5">
          <Button 
            onClick={() => setStatus('idle')}
            className="w-full h-13 bg-white text-slate-950 hover:bg-slate-200 font-black uppercase tracking-wider text-xs rounded-xl shadow-lg cursor-pointer"
          >
            Tentar Novamente
          </Button>
          <Button 
            variant="ghost" 
            onClick={onCancel}
            className="w-full h-11 text-slate-400 hover:text-white uppercase font-bold text-xs tracking-wider cursor-pointer"
          >
            Voltar para Carteira
          </Button>
        </div>
      </div>
    );
  }

  // SCREEN: PIX EXPIRADO (30 MINUTOS)
  if (status === 'expired') {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 280, damping: 20 }}
          className="relative h-20 w-20 bg-amber-500/15 border border-amber-500/30 rounded-3xl flex items-center justify-center text-amber-400 shadow-[0_0_40px_rgba(245,158,11,0.25)] mb-6"
        >
          <Clock className="h-10 w-10" strokeWidth={2.5} />
        </motion.div>

        <div className="space-y-2 mb-6">
          <span className="text-[10px] font-black uppercase tracking-[0.25em] text-amber-400">Tempo Limite Excedido</span>
          <h3 className="text-2xl font-black text-white tracking-tight">Pix Expirado</h3>
          <p className="text-slate-400 text-xs font-medium max-w-[300px] leading-relaxed mx-auto">
            O tempo de 30 minutos para o pagamento deste Pix encerrou. O QR Code não é mais válido e <strong>nenhum valor foi debitado</strong>.
          </p>
        </div>

        <div className="w-full bg-white/5 border border-white/5 rounded-2xl p-4 mb-6 text-left space-y-1.5">
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-400">Valor pretendido:</span>
            <span className="text-white font-mono font-bold tabular-nums">R$ {amount.toFixed(2)}</span>
          </div>
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-400">Status atual:</span>
            <span className="text-amber-400 font-bold uppercase text-[10px]">Expirado (&gt; 30 min)</span>
          </div>
        </div>

        <div className="w-full flex flex-col gap-2.5">
          <Button 
            onClick={() => {
              setPixTimeRemaining(30 * 60);
              setStatus('idle');
            }}
            className="w-full h-13 bg-white text-slate-950 hover:bg-slate-200 font-black uppercase tracking-wider text-xs rounded-xl shadow-lg cursor-pointer"
          >
            Gerar Novo Pix
          </Button>
          <Button 
            variant="ghost" 
            onClick={onCancel}
            className="w-full h-11 text-slate-400 hover:text-white uppercase font-bold text-xs tracking-wider cursor-pointer"
          >
            Voltar para Carteira
          </Button>
        </div>
      </div>
    );
  }

  // SCREEN: PAGAMENTO NÃO REALIZADO (ERRO)
  if (status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 280, damping: 20 }}
          className="relative h-20 w-20 bg-red-500/15 border border-red-500/30 rounded-3xl flex items-center justify-center text-red-400 shadow-[0_0_40px_rgba(239,68,68,0.25)] mb-6"
        >
          <XCircle className="h-10 w-10" strokeWidth={2.5} />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-2 mb-6"
        >
           <span className="text-[10px] font-black uppercase tracking-[0.25em] text-red-400">Operação Não Autorizada</span>
           <h3 className="text-2xl font-black text-white tracking-tight">Pagamento Não Realizado</h3>
           <p className="text-slate-300 text-xs font-semibold max-w-[320px] leading-relaxed mx-auto px-2">
             {paymentError || 'Não foi possível autorizar o pagamento com as informações fornecidas.'}
           </p>
        </motion.div>

        <div className="w-full bg-red-950/30 border border-red-500/20 rounded-2xl p-4 text-left space-y-2.5 mb-6">
          <div className="flex items-center gap-2 text-red-300 text-xs font-bold">
            <Info className="h-4 w-4 shrink-0 text-red-400" />
            <span>Nenhuma cobrança foi realizada</span>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Seu saldo e limites continuam protegidos. Você pode tentar outro cartão, conferir o limite bancário ou utilizar o pagamento via Pix.
          </p>
          <div className="pt-2 border-t border-red-500/15 flex justify-between items-center text-xs">
            <span className="text-slate-400">Tentativa de recarga:</span>
            <span className="text-white font-mono font-bold tabular-nums">R$ {amount.toFixed(2)}</span>
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="w-full flex flex-col gap-2.5"
        >
          <Button 
            onClick={() => {
              setPaymentMethod('pix');
              setStatus('idle');
            }}
            className="w-full h-13 bg-emerald-600 hover:bg-emerald-500 text-white font-black uppercase tracking-wider rounded-xl text-xs shadow-lg cursor-pointer flex items-center justify-center gap-2"
          >
            <QrCode className="h-4 w-4" /> Pagar via Pix (Mais Rápido)
          </Button>

          <Button 
            onClick={() => setStatus('idle')}
            className="w-full h-12 bg-white text-slate-950 hover:bg-slate-200 font-black uppercase tracking-wider rounded-xl text-xs cursor-pointer"
          >
            Tentar Outro Cartão
          </Button>

          <Button 
            variant="ghost"
            onClick={onCancel}
            className="w-full h-10 text-slate-400 hover:text-white font-bold uppercase tracking-wider text-[11px] cursor-pointer"
          >
            Voltar para Carteira
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
          className="relative h-24 w-24 bg-emerald-500 rounded-full flex items-center justify-center text-white shadow-[0_20px_50px_rgba(16,185,129,0.3)] mb-8"
        >
          <motion.div
            animate={{ 
              scale: [1, 1.15, 1],
              opacity: [1, 0.8, 1]
            }}
            transition={{ 
              repeat: Infinity, 
              duration: 2,
              ease: "easeInOut"
            }}
            className="relative z-10"
          >
            <CheckCircle2 className="h-12 w-12" strokeWidth={3} />
          </motion.div>
          
          {/* Pulsing ripples */}
          {[1, 2].map((i) => (
            <motion.div 
              key={i}
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: [0, 0.4, 0], scale: [1, 1.8 + (i * 0.4)] }}
              transition={{ 
                duration: 2, 
                repeat: Infinity, 
                ease: "easeOut",
                delay: i * 0.6
              }}
              className="absolute inset-0 bg-emerald-500 rounded-full"
            />
          ))}
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
              className="h-1.5 w-1.5 bg-emerald-500 rounded-full shadow-[0_0_10px_rgba(16,185,129,0.4)]"
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
         <div className="flex items-center gap-3">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={onCancel}
              disabled={loading}
              className="h-10 w-10 bg-white/5 hover:bg-white/10 rounded-xl -ml-2"
            >
               <ChevronLeft className="h-5 w-5 text-slate-400" />
            </Button>
            <div className="space-y-1">
               <span className="text-[10px] font-black uppercase tracking-[0.3em] text-blue-500">Checkout Seguro</span>
               <h2 className="text-xl font-black text-white uppercase tracking-tighter">Escolha o Pagamento</h2>
            </div>
         </div>
         <div className="bg-white/5 p-2 rounded-xl border border-white/5">
            <ShieldCheck className="text-blue-500 h-5 w-5" />
         </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
         {[
           { id: 'pix', label: 'Pix', icon: QrCode, color: 'text-emerald-400' },
           { id: 'credit', label: 'Crédito', icon: CreditCard, color: 'text-blue-400' },
           { id: 'debit', label: 'Débito', icon: SmartphoneNfc, color: 'text-orange-400' }
         ].map((method) => (
           <button
             key={method.id}
             onClick={() => {
               setPaymentMethod(method.id as PaymentMethod);
               if (status === 'awaiting_pix') setStatus('idle');
             }}
             className={`flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all gap-2 relative overflow-hidden group ${
               paymentMethod === method.id 
                ? 'bg-blue-600 border-blue-400 shadow-lg shadow-blue-600/20 text-white' 
                : 'bg-white/5 border-white/5 text-slate-400 hover:bg-white/10'
             }`}
           >
             <method.icon className={`h-5 w-5 ${paymentMethod === method.id ? 'text-white' : method.color}`} />
             <span className="text-[9px] font-black uppercase tracking-widest">{method.label}</span>
             {paymentMethod === method.id && (
               <motion.div 
                 layoutId="active-method-dot"
                 className="absolute top-1 right-1 h-1 w-1 bg-white rounded-full"
               />
             )}
           </button>
         ))}
      </div>

      <div className="bg-slate-950 p-4 rounded-2xl border border-white/5 flex justify-between items-center relative overflow-hidden">
         <div className="flex items-center gap-2 relative z-10">
            <Wallet className="h-4 w-4 text-slate-500" />
            <span className="text-[9px] font-black uppercase text-slate-500 tracking-widest">Valor Final</span>
         </div>
         <span className="text-xl font-black text-white relative z-10">R$ {amount.toFixed(2)}</span>
         <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 blur-3xl -mr-16 -mt-16" />
      </div>

      <AnimatePresence mode="wait">
        {paymentMethod === 'pix' ? (
          <motion.div key="pix" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="space-y-4">
             {status === 'awaiting_pix' ? (
                <div className="flex flex-col items-center justify-center py-2 text-center space-y-5">
                  {/* Status Banner: AGUARDANDO PAGAMENTO COM TEMPO LIMITE */}
                  <div className="w-full bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3.5 text-left flex items-start gap-3">
                    <div className="h-8 w-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                    <div className="space-y-1 flex-1">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-black uppercase text-amber-400 tracking-wider">Aguardando Pagamento</span>
                          <span className="text-[9px] font-bold bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded-full uppercase">Pix</span>
                        </div>
                        <div className={`flex items-center gap-1 px-2 py-0.5 rounded-lg border font-mono text-[10px] font-black tracking-tight ${
                          pixTimeRemaining < 120 
                            ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse' 
                            : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                        }`}>
                          <Clock className="h-3 w-3" />
                          <span>Expira em {Math.floor(pixTimeRemaining / 60)}:{(pixTimeRemaining % 60).toString().padStart(2, '0')}</span>
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-300 leading-snug">
                        Abra o app do seu banco, escaneie o QR Code ou copie o código Pix abaixo para creditar <strong>R$ {amount.toFixed(2)}</strong>.
                      </p>
                    </div>
                  </div>

                  {/* QR Code Container */}
                  <div className="p-4 bg-white rounded-[28px] shadow-2xl relative">
                    {pixData && <QRCodeSVG value={pixData.qrcode} size={180} level="H" includeMargin />}
                    <div className="absolute -top-2.5 -right-2.5 h-9 w-9 bg-emerald-500 rounded-xl flex items-center justify-center text-white shadow-lg">
                      <QrCode className="h-4 w-4" />
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="w-full space-y-2.5">
                    <Button 
                      type="button"
                      onClick={copyPix} 
                      className="w-full h-13 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-400 font-black uppercase text-[11px] tracking-wider rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-all"
                    >
                      {copied ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}
                      {copied ? 'Código Pix Copiado!' : 'Copiar Código Pix (Copia e Cola)'}
                    </Button>
                    
                    <Button 
                      type="button"
                      onClick={checkStatus} 
                      disabled={loading}
                      className="w-full h-13 bg-white text-slate-950 hover:bg-slate-200 font-black uppercase tracking-wider text-xs rounded-xl shadow-xl flex items-center justify-center gap-2 cursor-pointer"
                    >
                      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                      {loading ? 'Verificando com o Banco...' : 'Já Fiz o Pagamento • Verificar'}
                    </Button>

                    <Button 
                      type="button"
                      variant="ghost"
                      onClick={handleCancelPayment}
                      disabled={loading}
                      className="w-full h-10 text-slate-400 hover:text-red-400 text-xs font-bold uppercase tracking-wider cursor-pointer"
                    >
                      Cancelar Transação
                    </Button>

                    <div className="flex flex-col items-center justify-center gap-1 pt-1">
                       <div className="flex items-center gap-1.5">
                         <div className="h-2 w-2 rounded-full bg-amber-400 animate-ping" />
                         <p className="text-[10px] text-slate-400 font-semibold">
                           {pendingStatusInfo ? `Status bancário: ${pendingStatusInfo}` : 'Monitorando confirmação instantânea...'}
                         </p>
                       </div>
                       {pixData?.tid && (
                         <p className="text-[8px] text-slate-600 font-mono">
                           ID: {pixData.tid.substring(0, 18)}...
                         </p>
                       )}
                    </div>
                  </div>
                </div>
             ) : (
                <div className="py-2 space-y-6">
                  <div className="flex items-start gap-4 p-4 bg-emerald-500/5 rounded-2xl border border-emerald-500/10">
                    <div className="h-10 w-10 bg-emerald-500/10 text-emerald-500 rounded-xl flex items-center justify-center shrink-0">
                      <Smartphone className="h-5 w-5" />
                    </div>
                    <div className="space-y-1">
                      <h4 className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">Pagamento Instantâneo</h4>
                      <p className="text-[11px] text-slate-400 leading-tight">
                        O saldo é liberado imediatamente após o pagamento do QR Code.
                      </p>
                    </div>
                  </div>
                  <Button 
                    onClick={() => handleProcessPayment()}
                    disabled={loading}
                    className="w-full h-16 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black uppercase tracking-[.2em] rounded-2xl shadow-xl shadow-emerald-500/20 active:translate-y-1 transition-all text-sm"
                  >
                    {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : 'Gerar Pagamento Pix'}
                  </Button>
                </div>
             )}
          </motion.div>
        ) : (
          <motion.form 
            key="card" 
            initial={{ opacity: 0, scale: 0.95 }} 
            animate={{ opacity: 1, scale: 1 }} 
            exit={{ opacity: 0, scale: 0.95 }} 
            onSubmit={handleProcessPayment} 
            className="space-y-4"
          >
            {paymentMethod === 'debit' && (
              <div className="p-3 bg-orange-500/5 border border-orange-500/10 rounded-xl mb-2">
                <p className="text-[10px] text-orange-400/80 leading-snug">
                  <span className="font-black text-orange-400">AVISO:</span> Cartões de débito geralmente exigem que você confirme a compra no aplicativo do seu banco.
                </p>
              </div>
            )}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-[9px] font-black uppercase tracking-widest text-slate-500 ml-1">Número do Cartão</Label>
                <div className="relative">
                  <Input 
                    placeholder="0000 0000 0000 0000"
                    maxLength={19}
                    value={formatCardNumber(cardData.number)}
                    onChange={(e) => {
                      setCardData({...cardData, number: e.target.value});
                      if (formErrors.number) setFormErrors(prev => {
                        const next = {...prev};
                        delete next.number;
                        return next;
                      });
                    }}
                    className={`bg-slate-950 border-white/5 h-12 rounded-xl text-white font-mono tracking-widest pl-10 text-sm ${formErrors.number ? 'border-red-500/50 ring-1 ring-red-500/20' : ''}`}
                    required
                  />
                  <CreditCard className={`absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 ${formErrors.number ? 'text-red-500' : 'text-slate-700'}`} />
                </div>
                {formErrors.number && <p className="text-[9px] text-red-500 font-bold uppercase ml-1">{formErrors.number}</p>}
              </div>

              <div className="space-y-2">
                <Label className="text-[9px] font-black uppercase tracking-widest text-slate-500 ml-1">Nome no Cartão</Label>
                <Input 
                  placeholder="COMO ESTÁ NO CARTÃO"
                  value={cardData.name}
                  onChange={(e) => {
                    setCardData({...cardData, name: e.target.value.toUpperCase()});
                    if (formErrors.name) setFormErrors(prev => {
                      const next = {...prev};
                      delete next.name;
                      return next;
                    });
                  }}
                  className={`bg-slate-950 border-white/5 h-12 rounded-xl text-white font-black tracking-widest uppercase text-sm ${formErrors.name ? 'border-red-500/50 ring-1 ring-red-500/20' : ''}`}
                  required
                />
                {formErrors.name && <p className="text-[9px] text-red-500 font-bold uppercase ml-1">{formErrors.name}</p>}
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
                      setCardData({...cardData, expiry: val});
                      if (formErrors.expiry) setFormErrors(prev => {
                        const next = {...prev};
                        delete next.expiry;
                        return next;
                      });
                    }}
                    className={`bg-slate-950 border-white/5 h-12 rounded-xl text-white font-black text-center text-sm ${formErrors.expiry ? 'border-red-500/50 ring-1 ring-red-500/20' : ''}`}
                    required
                  />
                  {formErrors.expiry && <p className="text-[9px] text-red-500 font-bold uppercase ml-1">{formErrors.expiry}</p>}
                </div>
                <div className="space-y-2">
                  <Label className="text-[9px] font-black uppercase tracking-widest text-slate-500 ml-1">CVV</Label>
                  <Input 
                    placeholder="000"
                    maxLength={4}
                    value={cardData.cvv}
                    onChange={(e) => {
                      setCardData({...cardData, cvv: e.target.value});
                      if (formErrors.cvv) setFormErrors(prev => {
                        const next = {...prev};
                        delete next.cvv;
                        return next;
                      });
                    }}
                    className={`bg-slate-950 border-white/5 h-12 rounded-xl text-white font-black text-center text-sm ${formErrors.cvv ? 'border-red-500/50 ring-1 ring-red-500/20' : ''}`}
                    required
                  />
                  {formErrors.cvv && <p className="text-[9px] text-red-500 font-bold uppercase ml-1">{formErrors.cvv}</p>}
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
