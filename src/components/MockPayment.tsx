import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { CheckCircle2, ChevronRight, Loader2 } from 'lucide-react';
import { db, auth } from '@/lib/firebase';
import { doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { toast } from 'sonner';

export default function MockPayment() {
  const [status, setStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle');
  const params = new URLSearchParams(window.location.search);
  const tid = params.get('tid');
  const amt = params.get('amt');
  const uid = params.get('uid');

  const handlePay = async () => {
    if (!tid || !uid || !amt) {
      toast.error('Dados da transação ausentes');
      return;
    }

    setStatus('processing');
    try {
      // Create or update the transaction and user balance
      await runTransaction(db, async (transaction) => {
        const txnRef = doc(db, 'transactions', tid);
        const userRef = doc(db, 'users', uid);
        
        const txnDoc = await transaction.get(txnRef);
        const userDoc = await transaction.get(userRef);

        if (!userDoc.exists()) throw new Error('Usuário não encontrado');
        
        // If the server failed to create the txn doc, we create it here
        if (!txnDoc.exists()) {
          transaction.set(txnRef, {
            userId: uid,
            amount: parseFloat(amt),
            type: 'credit',
            status: 'pending',
            description: 'Recarga Digital (Auto-recuperada)',
            timestamp: serverTimestamp()
          });
        } else if (txnDoc.data().status !== 'pending') {
          throw new Error('Transação já processada');
        }

        const currentBalance = userDoc.data().balance || 0;
        const amount = parseFloat(amt);

        transaction.update(userRef, { 
          balance: currentBalance + amount 
        });
        
        transaction.update(txnRef, { 
          status: 'completed',
          updatedAt: serverTimestamp()
        });
      });

      setStatus('success');
      toast.success('Pagamento processado com sucesso!');
    } catch (error: any) {
      console.error('Payment simulation error:', error);
      setStatus('error');
      toast.error(`Erro ao processar: ${error.message}`);
    }
  };

  if (status === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <Card className="w-full max-w-md text-center py-8">
          <CardContent className="flex flex-col items-center gap-4">
            <div className="h-20 w-20 bg-green-100 rounded-full flex items-center justify-center text-green-600 mb-2">
              <CheckCircle2 className="h-10 w-10" />
            </div>
            <CardTitle className="text-2xl">Pagamento Aprovado!</CardTitle>
            <CardDescription>
              Seu saldo foi atualizado com sucesso. Você já pode fechar esta janela.
            </CardDescription>
            <Button onClick={() => window.close()} className="mt-4">
              Fechar Janela
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>Simulador de Pagamento Rede</CardTitle>
          <CardDescription>Esta é uma tela de simulação para o ambiente de testes.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-slate-100 p-4 rounded-xl space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Transação:</span>
              <span className="font-mono font-medium">{tid}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Valor:</span>
              <span className="font-bold text-slate-900">R$ {amt}</span>
            </div>
          </div>

          <Button 
            onClick={handlePay} 
            disabled={status === 'processing'}
            className="w-full h-12 text-lg bg-green-600 hover:bg-green-700 text-white"
          >
            {status === 'processing' ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              'Confirmar Pagamento Simulado'
            )}
          </Button>
          
          <p className="text-center text-xs text-slate-400">
            Ao clicar, simularemos o webhook da Rede informando a aprovação do pagamento.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
