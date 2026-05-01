import React, { useState, useEffect } from 'react';
import { db, auth } from '@/lib/firebase';
import { doc, onSnapshot, collection, query, where, orderBy, limit, addDoc, serverTimestamp, getDocs, updateDoc, increment } from 'firebase/firestore';
import { QRCodeSVG } from 'qrcode.react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UserProfile, Transaction } from '../types';
import { handleFirestoreError, OperationType } from '@/lib/error-handler';
import { PlusCircle, History, QrCode, LogOut, Wallet, CreditCard, ChevronRight, Info, Zap, ShieldCheck } from 'lucide-react';
import axios from 'axios';
import { toast } from 'sonner';

import QRScanner from './QRScanner';

export default function ParentDashboard({ profile }: { profile: UserProfile }) {
  const [rechargeAmount, setRechargeAmount] = useState<string>('50');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

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
      const cardRef = doc(db, 'users', querySnapshot.docs[0].id);
      const userRef = doc(db, 'users', profile.uid);
      
      // Se for um cartão diferente e não for o próprio
      if (userData.uid !== profile.uid) {
        if (confirm(`Deseja vincular este cartão (${decodedText})? O saldo de R$ ${userData.balance.toFixed(2)} será transferido para sua conta digital.`)) {
          
          await updateDoc(userRef, {
            balance: increment(userData.balance),
            linkedCards: Array.from(new Set([...(profile.linkedCards || []), decodedText]))
          });

          // Reset do saldo do cartão vinculado para evitar duplicidade
          await updateDoc(cardRef, {
            balance: 0
          });

          // Registrar transação de transferência
          if (userData.balance > 0) {
            await addDoc(collection(db, 'transactions'), {
              userId: profile.uid,
              amount: userData.balance,
              type: 'credit',
              status: 'completed',
              description: `Vínculo de Cartão: ${decodedText} (+ Saldo)`,
              timestamp: serverTimestamp(),
            });
          }

          toast.success(`Cartão ${decodedText} vinculado com sucesso! Saldo transferido.`);
        }
      } else {
        toast.success('Este cartão já é o principal da sua conta.');
      }
    } catch (error) {
      console.error(error);
      toast.error('Erro ao processar leitura do cartão');
    }
  };

  useEffect(() => {
    if (!profile.uid) return;
    
    // Transactions listener
    const qTx = query(
      collection(db, 'transactions'),
      where('userId', '==', profile.uid),
      orderBy('timestamp', 'desc'),
      limit(20)
    );

    const unsubTx = onSnapshot(qTx, (snapshot) => {
      setTransactions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'transactions');
    });

    return () => unsubTx();
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

      console.log('Initiating recharge request...');
      const response = await axios.post('/api/rede/create-checkout', {
        amount,
        userId: profile.uid,
        studentName: profile.name
      });

      if (response.data && response.data.checkoutUrl) {
        toast.info('Redirecionando para o pagamento seguro...');
        setTimeout(() => {
          window.location.href = response.data.checkoutUrl;
        }, 1200);
      } else {
        throw new Error('Servidor não retornou URL de pagamento');
      }
    } catch (error: any) {
      console.error('Recharge error details:', error);
      const msg = error.response?.data?.message || error.message || 'Erro de conexão';
      toast.error(`Erro ao processar recarga: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white pb-24 overflow-x-hidden">
      {/* Background decorativo */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none -z-10">
        <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[40%] bg-blue-600/10 blur-[120px] rounded-full animate-pulse" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[40%] bg-purple-600/10 blur-[120px] rounded-full animate-pulse decoration-3000" />
      </div>

      <div className="max-w-md mx-auto px-6 pt-10 space-y-8">
        {/* Header */}
        <header className="flex justify-between items-center animate-in fade-in slide-in-from-top-4 duration-700">
          <div className="space-y-1">
            <h1 className="text-2xl font-black tracking-tight leading-none text-white uppercase">Sua Carteira</h1>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-[0.2em]">{profile.name} • Estudante</p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => auth.signOut()} className="bg-white/5 hover:bg-white/10 rounded-2xl h-12 w-12 text-slate-400">
            <LogOut className="h-5 w-5" />
          </Button>
        </header>

        {/* Cartão Digital */}
        <div className="relative group animate-in zoom-in fade-in duration-700 delay-150">
          <div className="absolute inset-0 bg-blue-600/20 blur-3xl rounded-[40px] opacity-50 group-hover:opacity-100 transition-opacity" />
          <Card className="relative bg-gradient-to-br from-blue-600 via-blue-500 to-indigo-600 border border-white/20 rounded-[40px] overflow-hidden min-h-[220px] shadow-2xl">
            <CardContent className="p-8 flex flex-col justify-between h-full min-h-[220px]">
              <div className="flex justify-between items-start">
                <div className="space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-[0.3em] text-blue-100/60">Saldo Digital Unificado</span>
                  <div className="text-5xl font-black tracking-tighter text-white">
                    R$ {profile.balance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </div>
                  {profile.linkedCards && profile.linkedCards.length > 0 && (
                    <p className="text-[9px] font-bold text-blue-200/40 uppercase mt-1">Inclui {profile.linkedCards.length} {profile.linkedCards.length === 1 ? 'cartão vinculado' : 'cartões vinculados'}</p>
                  )}
                </div>
                <Zap className="h-8 w-8 text-white fill-white/20 animate-bounce" />
              </div>

              <div className="flex justify-between items-end mt-12">
                <div className="space-y-1">
                   <p className="text-[9px] font-bold uppercase tracking-widest text-blue-100/60 leading-none">Matrícula Escolar</p>
                   <p className="text-sm font-black text-white/90 uppercase truncate max-w-[150px]">{profile.name}</p>
                </div>
                <div className="bg-white/10 p-2 rounded-xl backdrop-blur-md border border-white/20">
                  <CreditCard className="h-6 w-6 text-white" />
                </div>
              </div>
            </CardContent>
            <div className="absolute -top-1/2 -left-1/2 w-[200%] h-[200%] bg-gradient-to-br from-white/10 via-transparent to-transparent rotate-45 pointer-events-none" />
          </Card>
        </div>

        {/* QR Code para PDV */}
        <div className="space-y-4 animate-in slide-in-from-bottom-8 duration-700 delay-300">
          <div className="bg-slate-900/50 border border-white/5 rounded-[40px] p-8 text-center space-y-6 relative overflow-hidden group">
            <div className="relative z-10 space-y-6">
              <div className="space-y-1">
                <h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-400">Pague no Balcão</h3>
                <p className="text-[11px] text-slate-500 font-medium">Apresente este código para autorizar compras</p>
              </div>
              
              <div className="bg-white p-6 rounded-[32px] inline-block shadow-[0_0_50px_rgba(255,255,255,0.05)] transform transition-transform group-hover:scale-105 duration-500">
                <QRCodeSVG value={profile.qrCode} size={180} />
              </div>

              <div className="flex items-center justify-center gap-2">
                <div className="h-1.5 w-1.5 bg-blue-500 rounded-full animate-pulse" />
                <span className="text-[10px] font-black uppercase tracking-widest text-blue-500">Pronto para uso</span>
              </div>
            </div>
            <div className="absolute -bottom-10 -right-10 opacity-5">
              <QrCode size={200} />
            </div>
          </div>
        </div>

        {/* Recarga Rápida */}
        <div className="space-y-4 animate-in slide-in-from-bottom-8 duration-700 delay-500">
          <header className="flex justify-between items-center px-2">
            <h3 className="text-xs font-black uppercase tracking-[0.3em] text-slate-500">Adicionar Créditos</h3>
          </header>

          <div className="bg-slate-900/40 border border-white/5 rounded-[32px] p-6 space-y-6">
            <div className="grid grid-cols-3 gap-3">
              {[20, 50, 100].map(val => (
                <button 
                  key={val} 
                  onClick={() => setRechargeAmount(val.toString())}
                  className={`h-12 rounded-2xl border font-black text-xs transition-all ${rechargeAmount === val.toString() ? 'bg-blue-600 text-white border-blue-400 shadow-lg shadow-blue-900/20' : 'bg-slate-950 text-slate-400 border-white/5 hover:border-white/10'}`}
                >
                  R$ {val}
                </button>
              ))}
            </div>

            <div className="relative">
              <span className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-500 font-black text-lg">R$</span>
              <Input 
                type="number" 
                value={rechargeAmount}
                onChange={(e) => setRechargeAmount(e.target.value)}
                className="pl-14 pr-6 h-16 text-2xl font-black bg-slate-950 border-white/5 rounded-2xl focus:ring-blue-600 focus:border-blue-600 text-white text-right"
              />
            </div>

            <Button 
              onClick={handleRecharge} 
              disabled={loading} 
              className="w-full h-16 bg-blue-600 hover:bg-blue-500 text-white font-black text-sm uppercase tracking-widest rounded-2xl shadow-2xl transition-all active:scale-95 border-b-4 border-blue-800 active:border-b-0"
            >
              {loading ? 'Processando...' : 'Recarregar Agora'}
            </Button>

            <div className="space-y-3">
              <div className="flex items-center gap-3 p-4 bg-blue-500/5 rounded-2xl border border-blue-500/10 group cursor-pointer" onClick={() => setIsScanning(true)}>
                <div className="h-10 w-10 bg-blue-600/10 rounded-xl flex items-center justify-center">
                    <QrCode className="h-5 w-5 text-blue-500" />
                </div>
                <div className="flex-1">
                    <p className="text-[11px] font-black uppercase text-blue-100">Vincular Novo Cartão</p>
                    <p className="text-[9px] text-slate-500 font-bold">Adicione cartões físicos à sua conta</p>
                </div>
                <ChevronRight className="h-5 w-5 text-slate-700 group-hover:translate-x-1 transition-transform" />
              </div>

              {profile.linkedCards && profile.linkedCards.length > 0 && (
                <div className="pt-2 animate-in fade-in duration-500">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-600 mb-3 ml-2">Meus Cartões Vinculados</p>
                  <div className="space-y-2">
                    {profile.linkedCards.map(cardId => (
                      <div key={cardId} className="flex items-center justify-between p-3.5 bg-slate-950/50 rounded-2xl border border-white/5">
                        <div className="flex items-center gap-3">
                           <div className="h-8 w-8 bg-blue-600/10 rounded-lg flex items-center justify-center">
                              <CreditCard className="h-4 w-4 text-blue-500" />
                           </div>
                           <span className="text-xs font-black text-slate-300 font-mono">{cardId}</span>
                        </div>
                        <span className="text-[9px] font-black text-green-500/50 uppercase tracking-tighter bg-green-500/5 px-2 py-0.5 rounded-full border border-green-500/10">Ativo</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Extrato Recente */}
        <div className="space-y-4 animate-in slide-in-from-bottom-8 duration-700 delay-700 pb-10">
          <header className="flex justify-between items-center px-2">
            <h3 className="text-xs font-black uppercase tracking-[0.3em] text-slate-500">Atividade Recente</h3>
            <button onClick={() => setShowHistory(!showHistory)} className="text-[10px] font-black uppercase text-blue-500 hover:underline">
              {showHistory ? 'Fechar' : 'Ver Tudo'}
            </button>
          </header>

          <div className="bg-slate-900/40 border border-white/5 rounded-[32px] overflow-hidden">
            <div className={`divide-y divide-white/5 transition-all duration-500 ${showHistory ? 'max-h-[800px]' : 'max-h-[300px] overflow-hidden'}`}>
              {transactions.length === 0 ? (
                <div className="p-12 text-center text-slate-600 font-bold uppercase tracking-widest text-[10px]">
                  Sem movimentações recentes
                </div>
              ) : (
                transactions.map((tx) => (
                  <div key={tx.id} className="flex justify-between items-center p-6 hover:bg-white/[0.02] transition-colors">
                    <div className="flex items-center gap-4">
                      <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${tx.type === 'credit' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                        {tx.type === 'credit' ? <PlusCircle className="h-5 w-5" /> : <Wallet className="h-5 w-5" />}
                      </div>
                      <div>
                        <p className="text-xs font-black text-white/90 uppercase leading-none mb-1">{tx.description}</p>
                        <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">
                          {tx.timestamp ? new Date(tx.timestamp.toDate()).toLocaleDateString('pt-BR') : 'Agora'}
                        </p>
                      </div>
                    </div>
                    <div className={`text-sm font-black ${tx.type === 'credit' ? 'text-green-500' : 'text-slate-400'}`}>
                      {tx.type === 'credit' ? '+' : '-'} R$ {Math.abs(tx.amount).toFixed(2)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Info */}
        <div className="space-y-4 mb-8">
           <div className="bg-blue-600/5 rounded-3xl p-6 border border-blue-500/10">
              <div className="flex gap-4">
                 <Info className="h-5 w-5 text-blue-500 shrink-0" />
                 <div className="space-y-1">
                    <p className="text-[11px] font-black uppercase text-blue-100">Como funciona?</p>
                    <p className="text-[10px] text-slate-500 leading-relaxed font-medium">
                       Suas recargas digitais são creditadas instantaneamente. No balcão, apresente seu QR Code. O saldo será descontado automaticamente na hora da compra.
                    </p>
                 </div>
              </div>
           </div>

           {profile.role === 'admin' && (
             <div className="bg-amber-500/5 rounded-3xl p-6 border border-amber-500/10 animate-pulse">
                <div className="flex gap-4">
                   <ShieldCheck className="h-5 w-5 text-amber-500 shrink-0" />
                   <div className="space-y-2">
                      <p className="text-[11px] font-black uppercase text-amber-100">Painel de Configuração (Modo Admin)</p>
                      <p className="text-[10px] text-slate-500 leading-relaxed font-medium">
                         Para ativar o ambiente <strong>REAL</strong> de pagamentos Rede, você precisa adicionar as seguintes chaves nas Configurações (Secrets) do projeto:
                      </p>
                      <ul className="text-[9px] text-amber-500/70 font-mono space-y-1">
                        <li>• REDE_PV (Número do Estabelecimento)</li>
                        <li>• REDE_TOKEN (Token da API)</li>
                      </ul>
                      <p className="text-[9px] text-slate-600 italic">
                        Atualmente o sistema está operando em Modo de Simulação Seguro.
                      </p>
                   </div>
                </div>
             </div>
           )}
        </div>
      </div>

      {isScanning && (
        <QRScanner 
          onScan={onScanSuccess} 
          onClose={() => setIsScanning(false)} 
          title="Vincular Cartão Escolar"
        />
      )}
    </div>
  );
}
