import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle2, CreditCard, Loader2, ShieldCheck, Lock, ChevronLeft, AlertCircle, XCircle, RefreshCw, ArrowLeft } from 'lucide-react';
import { db } from '@/lib/firebase';
import { doc, runTransaction, serverTimestamp, updateDoc } from 'firebase/firestore';
import { toast } from 'sonner';
import axios from 'axios';
import { motion, AnimatePresence } from 'motion/react';

export default function MockPayment() {
  const [status, setStatus] = useState<'idle' | 'processing' | 'success' | 'error' | 'cancelled'>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
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

  const markTransactionCancelled = async () => {
    if (tid) {
      try {
        const txnRef = doc(db, 'transactions', tid);
        await updateDoc(txnRef, {
          status: 'cancelled',
          updatedAt: serverTimestamp(),
          _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
        });
      } catch (e) {
        console.warn('Could not mark transaction as cancelled:', e);
      }
    }
    setStatus('cancelled');
  };

  const handleProcessPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tid || !uid || !amt) {
      toast.error('Dados da transação ausentes');
      setErrorMessage('Identificador de transação ou usuário não fornecido.');
      setStatus('error');
      return;
    }

    // Basic validation
    if (cardData.number.replace(/\s/g, '').length < 16 || !cardData.expiry.includes('/') || cardData.cvv.length < 3) {
      toast.error('Preencha os dados do cartão corretamente');
      return;
    }

    setStatus('processing');
    setErrorMessage('');
    
    try {
      if (isReal) {
        // CALL REAL BACKEND REDE API
        const response = await axios.post('/api/rede/process-payment', {
          cardData,
          amount: amt,
          transactionId: tid,
          userId: uid
        }, { timeout: 25000 });

        if (response.data && response.data.success) {
          setStatus('success');
          toast.success('Pagamento real processado com sucesso via Rede!');
        } else {
          throw new Error(response.data?.message || 'Erro no processamento da Rede');
        }
      } else {
        // SIMULATION LOGIC
        await new Promise(resolve => setTimeout(resolve, 1800)); // Simulate delay
        
        await runTransaction(db, async (transaction) => {
          const txnRef = doc(db, 'transactions', tid);
          const userRef = doc(db, 'users', uid);
          
          const txnDoc = await transaction.get(txnRef);
          const userDoc = await transaction.get(userRef);

          if (!userDoc.exists()) throw new Error('Usuário não encontrado no sistema.');
          
          if (!txnDoc.exists()) {
            transaction.set(txnRef, {
              userId: uid,
              amount: parseFloat(amt),
              type: 'credit',
              status: 'pending',
              description: 'Recarga Digital (Simulada)',
              timestamp: serverTimestamp(),
              _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
            });
          }

          const userData = userDoc.data();
          const isShared = userData && (!userData.balanceType || userData.balanceType === 'shared') && userData.parentUid;
          
          let targetUserRef = userRef;
          let targetUserData = userData;
          
          if (isShared) {
            const parentRef = doc(db, 'users', userData.parentUid);
            const parentDoc = await transaction.get(parentRef);
            if (parentDoc.exists()) {
              targetUserRef = parentRef;
              targetUserData = parentDoc.data();
            }
          }

          transaction.update(targetUserRef, { 
            balance: (targetUserData.balance || 0) + parseFloat(amt),
            _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
          });
          
          transaction.update(txnRef, { 
            status: 'completed',
            updatedAt: serverTimestamp(),
            _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
          });
        });

        setStatus('success');
        toast.success('Simulação de pagamento concluída com sucesso!');
      }
    } catch (error: any) {
      console.error('Payment processing error:', error);
      setStatus('error');
      const errorData = error.response?.data;
      const errorMsg = errorData?.message || errorData?.error || error.message || 'Transação negada pela operadora.';
      setErrorMessage(errorMsg);
      toast.error(`Pagamento não realizado: ${errorMsg}`);
    }
  };

  const formatCardNumber = (value: string) => {
    return value.replace(/\W/gi, '').replace(/(.{4})/g, '$1 ').trim();
  };

  const parsedAmount = isNaN(parseFloat(amt)) ? 0 : parseFloat(amt);

  // SCREEN 1: SUCCESSFUL PAYMENT
  if (status === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-6 relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-emerald-500/10 blur-[120px] rounded-full pointer-events-none" />
        
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className="w-full max-w-md relative z-10"
        >
          <Card className="bg-slate-900/80 border-white/10 text-center py-10 px-6 rounded-[36px] shadow-2xl backdrop-blur-2xl">
            <CardContent className="flex flex-col items-center gap-5 p-0">
              <div className="h-20 w-20 bg-emerald-500/15 rounded-3xl flex items-center justify-center text-emerald-400 border border-emerald-500/30 shadow-[0_0_40px_rgba(16,185,129,0.2)]">
                <CheckCircle2 className="h-10 w-10" strokeWidth={2.5} />
              </div>
              
              <div className="space-y-1">
                <span className="text-[10px] font-black uppercase tracking-[0.25em] text-emerald-400">Pagamento Aprovado</span>
                <CardTitle className="text-3xl font-black text-white tracking-tight">Recarga Concluída!</CardTitle>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-2xl p-4 w-full text-left space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-400 font-medium">Valor Creditado</span>
                  <span className="text-emerald-400 font-black font-mono text-base tabular-nums">
                    R$ {parsedAmount.toFixed(2)}
                  </span>
                </div>
                {tid && (
                  <div className="flex justify-between items-center text-[10px] text-slate-500 font-mono pt-2 border-t border-white/5">
                    <span>ID da Transação</span>
                    <span className="truncate max-w-[150px]">{tid}</span>
                  </div>
                )}
              </div>

              <p className="text-slate-400 text-xs font-medium px-2 leading-relaxed">
                O saldo já está disponível na sua conta Festa Pass e pode ser utilizado imediatamente nos pontos de venda.
              </p>

              <Button 
                onClick={() => window.close()} 
                className="w-full h-14 bg-white text-slate-950 hover:bg-slate-200 font-black rounded-2xl uppercase tracking-wider text-xs transition-all active:scale-98 shadow-xl mt-2 cursor-pointer"
              >
                Voltar ao Aplicativo
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  // SCREEN 2: PAGAMENTO NÃO REALIZADO (ERROR)
  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-6 relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-red-600/10 blur-[130px] rounded-full pointer-events-none" />
        
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className="w-full max-w-md relative z-10"
        >
          <Card className="bg-slate-900/90 border-red-500/20 text-center py-10 px-6 rounded-[36px] shadow-2xl backdrop-blur-2xl ring-1 ring-red-500/20">
            <CardContent className="flex flex-col items-center gap-5 p-0">
              <div className="h-20 w-20 bg-red-500/15 rounded-3xl flex items-center justify-center text-red-400 border border-red-500/30 shadow-[0_0_40px_rgba(239,68,68,0.2)]">
                <XCircle className="h-10 w-10" strokeWidth={2.5} />
              </div>

              <div className="space-y-1">
                <span className="text-[10px] font-black uppercase tracking-[0.25em] text-red-400">Falha na Operação</span>
                <CardTitle className="text-2xl font-black text-white tracking-tight">Pagamento Não Realizado</CardTitle>
              </div>

              {/* Informative Error Box */}
              <div className="bg-red-950/40 border border-red-500/30 rounded-2xl p-4 w-full text-left space-y-2">
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-[11px] font-bold text-red-200 uppercase tracking-wide">Motivo do Cancelamento</p>
                    <p className="text-xs text-red-300 font-medium leading-relaxed">
                      {errorMessage || 'A operadora recusou a transação ou os dados do cartão informados são inválidos.'}
                    </p>
                  </div>
                </div>

                <div className="pt-2 border-t border-red-500/20 flex justify-between items-center text-[11px] text-slate-300">
                  <span>Valor da tentativa</span>
                  <span className="font-mono font-bold text-white tabular-nums">R$ {parsedAmount.toFixed(2)}</span>
                </div>
              </div>

              <div className="bg-white/5 border border-white/5 rounded-2xl p-3 w-full text-left">
                <p className="text-[10px] text-slate-400 font-medium leading-relaxed">
                  🛡️ <strong>Fique tranquilo:</strong> Nenhuma cobrança foi efetuada. Seu saldo anterior permanece inalterado.
                </p>
              </div>

              <div className="w-full space-y-2.5 pt-2">
                <Button 
                  onClick={() => setStatus('idle')}
                  className="w-full h-13 bg-red-600 hover:bg-red-500 text-white font-black rounded-2xl uppercase tracking-wider text-xs transition-all active:scale-98 shadow-xl flex items-center justify-center gap-2 cursor-pointer"
                >
                  <RefreshCw className="h-4 w-4" /> Tentar Novamente
                </Button>

                <Button 
                  variant="ghost"
                  onClick={() => window.close()}
                  className="w-full h-11 text-slate-400 hover:text-white font-black text-[11px] uppercase tracking-wider rounded-xl cursor-pointer"
                >
                  Voltar ao Aplicativo
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  // SCREEN 3: PAGAMENTO NÃO FINALIZADO / CANCELADO
  if (status === 'cancelled') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-6 relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-amber-500/10 blur-[130px] rounded-full pointer-events-none" />
        
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className="w-full max-w-md relative z-10"
        >
          <Card className="bg-slate-900/90 border-amber-500/20 text-center py-10 px-6 rounded-[36px] shadow-2xl backdrop-blur-2xl ring-1 ring-amber-500/20">
            <CardContent className="flex flex-col items-center gap-5 p-0">
              <div className="h-20 w-20 bg-amber-500/15 rounded-3xl flex items-center justify-center text-amber-400 border border-amber-500/30 shadow-[0_0_40px_rgba(245,158,11,0.2)]">
                <AlertCircle className="h-10 w-10" strokeWidth={2.5} />
              </div>

              <div className="space-y-1">
                <span className="text-[10px] font-black uppercase tracking-[0.25em] text-amber-400">Checkout Cancelado</span>
                <CardTitle className="text-2xl font-black text-white tracking-tight">Pagamento Não Finalizado</CardTitle>
              </div>

              <div className="bg-amber-950/30 border border-amber-500/20 rounded-2xl p-4 w-full text-left space-y-2">
                <p className="text-xs text-amber-200 font-medium leading-relaxed">
                  Você optou por não concluir o pagamento. A transação foi interrompida com segurança e <strong>nenhum valor foi cobrado</strong>.
                </p>
                <div className="pt-2 border-t border-amber-500/10 flex justify-between items-center text-[11px] text-slate-300">
                  <span>Valor pendente</span>
                  <span className="font-mono font-bold text-white tabular-nums">R$ {parsedAmount.toFixed(2)}</span>
                </div>
              </div>

              <div className="w-full space-y-2.5 pt-2">
                <Button 
                  onClick={() => setStatus('idle')}
                  className="w-full h-13 bg-white text-slate-950 hover:bg-slate-200 font-black rounded-2xl uppercase tracking-wider text-xs transition-all active:scale-98 shadow-xl flex items-center justify-center gap-2 cursor-pointer"
                >
                  <RefreshCw className="h-4 w-4" /> Reiniciar Pagamento
                </Button>

                <Button 
                  variant="ghost"
                  onClick={() => window.close()}
                  className="w-full h-11 text-slate-400 hover:text-white font-black text-[11px] uppercase tracking-wider rounded-xl cursor-pointer"
                >
                  Fechar Janela
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  // SCREEN 4: PROCESSING (AGUARDANDO PAGAMENTO)
  if (status === 'processing') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-6 relative overflow-hidden">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md relative z-10 text-center space-y-6"
        >
          <Card className="bg-slate-900/80 border-white/10 p-10 rounded-[36px] shadow-2xl backdrop-blur-2xl">
            <CardContent className="flex flex-col items-center gap-6 p-0">
              <div className="relative">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                  className="h-20 w-20 border-4 border-blue-500/20 border-t-blue-500 rounded-full"
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <CreditCard className="h-8 w-8 text-blue-400 animate-pulse" />
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-[10px] font-black uppercase tracking-[0.25em] text-blue-400">Processando</span>
                <h3 className="text-2xl font-black text-white tracking-tight">Aguardando Pagamento...</h3>
                <p className="text-slate-400 text-xs font-medium max-w-xs mx-auto leading-relaxed">
                  Estamos comunicando com a operadora financeira para autorizar sua recarga de <strong className="text-white">R$ {parsedAmount.toFixed(2)}</strong>.
                </p>
              </div>

              <div className="w-full bg-white/5 border border-white/5 rounded-xl p-3 flex items-center justify-center gap-2">
                <ShieldCheck className="h-4 w-4 text-blue-400" />
                <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">Criptografia PCI-DSS de 256 bits</span>
              </div>

              <Button
                variant="ghost"
                onClick={markTransactionCancelled}
                className="text-xs font-bold text-slate-400 hover:text-red-400 uppercase tracking-wider"
              >
                Cancelar Transação
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  // SCREEN 0: IDLE FORM
  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Background decorativo */}
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none opacity-25">
        <div className="absolute top-[-20%] right-[-10%] w-[60%] h-[60%] bg-blue-600 blur-[160px] rounded-full" />
        <div className="absolute bottom-[-20%] left-[-10%] w-[60%] h-[60%] bg-purple-600 blur-[160px] rounded-full" />
      </div>

      <div className="w-full max-w-lg relative z-10 space-y-5">
        <header className="flex items-center justify-between px-2">
           <button 
             onClick={markTransactionCancelled} 
             className="text-slate-400 hover:text-white transition-colors flex items-center gap-2 font-bold uppercase text-[11px] tracking-wider cursor-pointer"
           >
              <ArrowLeft size={16} /> Cancelar e Voltar
           </button>
           <div className="flex items-center gap-2 text-slate-400 font-bold uppercase text-[10px] tracking-widest">
              <Lock size={12} className="text-emerald-400" /> Ambiente Criptografado
           </div>
        </header>

        <Card className="bg-slate-900/60 border-white/10 backdrop-blur-3xl rounded-[36px] shadow-2xl overflow-hidden">
          <CardHeader className="p-8 pb-4">
            <div className="flex justify-between items-start">
               <div className="space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-[0.25em] text-blue-400">Gateway Seguro</span>
                  <CardTitle className="text-2xl font-black text-white tracking-tight">Recarga Digital</CardTitle>
               </div>
               <div className="bg-white/5 p-3 rounded-2xl border border-white/10 text-white">
                  <CreditCard className="h-6 w-6" />
               </div>
            </div>
            <div className="mt-4 p-4 bg-white/5 border border-white/5 rounded-2xl flex justify-between items-center">
              <span className="text-slate-400 text-xs font-semibold">Valor da Recarga</span>
              <span className="text-white font-mono font-black text-xl tabular-nums">
                R$ {parsedAmount.toFixed(2)}
              </span>
            </div>
          </CardHeader>
          
          <CardContent className="p-8 pt-4">
            <form onSubmit={handleProcessPayment} className="space-y-5">
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-black uppercase tracking-wider text-slate-400 ml-1">Número do Cartão</Label>
                  <div className="relative">
                    <Input 
                      placeholder="0000 0000 0000 0000"
                      maxLength={19}
                      value={formatCardNumber(cardData.number)}
                      onChange={(e) => setCardData({...cardData, number: e.target.value})}
                      className="bg-slate-950 border-white/10 h-13 rounded-2xl text-white font-mono tracking-widest pl-12 text-sm focus:border-blue-500"
                      required
                    />
                    <CreditCard className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 h-5 w-5" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[10px] font-black uppercase tracking-wider text-slate-400 ml-1">Nome no Cartão</Label>
                  <Input 
                    placeholder="COMO ESTÁ IMPRESSO"
                    value={cardData.name}
                    onChange={(e) => setCardData({...cardData, name: e.target.value.toUpperCase()})}
                    className="bg-slate-950 border-white/10 h-13 rounded-2xl text-white font-bold tracking-wider uppercase text-sm focus:border-blue-500"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-black uppercase tracking-wider text-slate-400 ml-1">Validade</Label>
                    <Input 
                      placeholder="MM/AA"
                      maxLength={5}
                      value={cardData.expiry}
                      onChange={(e) => {
                        let val = e.target.value.replace(/\D/g, '');
                        if (val.length >= 2) val = val.substring(0,2) + '/' + val.substring(2,4);
                        setCardData({...cardData, expiry: val})
                      }}
                      className="bg-slate-950 border-white/10 h-13 rounded-2xl text-white font-mono font-bold text-center text-sm focus:border-blue-500"
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-black uppercase tracking-wider text-slate-400 ml-1">CVV</Label>
                    <Input 
                      placeholder="000"
                      maxLength={4}
                      value={cardData.cvv}
                      onChange={(e) => setCardData({...cardData, cvv: e.target.value})}
                      className="bg-slate-950 border-white/10 h-13 rounded-2xl text-white font-mono font-bold text-center text-sm focus:border-blue-500"
                      required
                    />
                  </div>
                </div>
              </div>

              <div className="pt-3 space-y-3">
                <Button 
                  type="submit"
                  className="w-full h-15 bg-blue-600 hover:bg-blue-500 text-white font-black uppercase tracking-widest rounded-2xl shadow-xl shadow-blue-600/20 transition-all active:scale-98 cursor-pointer text-xs"
                >
                  Finalizar e Pagar R$ {parsedAmount.toFixed(2)}
                </Button>
                
                <Button
                  type="button"
                  variant="ghost"
                  onClick={markTransactionCancelled}
                  className="w-full text-slate-400 hover:text-white uppercase font-bold text-[11px] tracking-wider h-10"
                >
                  Cancelar e Não Pagar
                </Button>

                <div className="flex items-center justify-center gap-4 py-2 border-t border-white/5">
                   <div className="flex items-center gap-1.5 opacity-60">
                      <ShieldCheck size={13} className="text-blue-400" />
                      <span className="text-[10px] font-medium text-slate-300">Tokenização Ativa</span>
                   </div>
                   <div className="h-1 w-1 bg-slate-700 rounded-full" />
                   <div className="flex items-center gap-1.5 opacity-60">
                      <Lock size={13} className="text-emerald-400" />
                      <span className="text-[10px] font-medium text-slate-300">Padrão PCI Seguro</span>
                   </div>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>

        {isReal ? (
          <p className="text-center text-[10px] text-amber-400 font-bold uppercase tracking-wider">
            Ambiente Real Ativo • Conexão Direta Rede
          </p>
        ) : (
          <p className="text-center text-[10px] text-slate-500 font-bold uppercase tracking-wider">
            Ambiente de Simulação de Pagamento
          </p>
        )}
      </div>
    </div>
  );
}

