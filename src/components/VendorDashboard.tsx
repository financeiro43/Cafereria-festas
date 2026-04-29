import React, { useState, useEffect, useRef } from 'react';
import { db, auth } from '../lib/firebase';
import { collection, query, where, getDocs, addDoc, doc, updateDoc, increment, serverTimestamp } from 'firebase/firestore';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UserProfile } from '../types';
import { QrCode, ShoppingCart, Users, LogOut, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';

export default function VendorDashboard({ profile }: { profile: UserProfile }) {
  const [amount, setAmount] = useState<string>('');
  const [items, setItems] = useState<string>('');
  const [scannedUser, setScannedUser] = useState<UserProfile | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [processing, setProcessing] = useState(false);
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);

  useEffect(() => {
    if (isScanning && !scannerRef.current) {
      scannerRef.current = new Html5QrcodeScanner(
        "qr-reader",
        { fps: 10, qrbox: { width: 250, height: 250 } },
        /* verbose= */ false
      );
      scannerRef.current.render(onScanSuccess, onScanFailure);
    }

    return () => {
      if (scannerRef.current) {
        scannerRef.current.clear().catch(error => console.error("Failed to clear scanner", error));
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
        toast.error('Aluno não encontrado');
        return;
      }

      const userData = querySnapshot.docs[0].data() as UserProfile;
      setScannedUser(userData);
      toast.success(`Identificado: ${userData.name}`);
    } catch (error) {
      console.error('Scan error:', error);
      toast.error('Erro ao identificar aluno');
    }
  };

  const onScanFailure = (error: any) => {
    // Silently handle scan failures as they happen frequently during searching
  };

  const handleSale = async () => {
    if (!scannedUser || !amount) return;

    try {
      setProcessing(true);
      const sellAmount = parseFloat(amount);
      
      if (scannedUser.balance < sellAmount) {
        toast.error('Saldo insuficiente');
        return;
      }

      const batch = [];
      
      // Update student balance
      const studentRef = doc(db, 'users', scannedUser.uid);
      await updateDoc(studentRef, {
        balance: increment(-sellAmount)
      });

      // Record transaction
      await addDoc(collection(db, 'transactions'), {
        userId: scannedUser.uid,
        amount: -sellAmount,
        type: 'debit',
        description: `Compra na barraca: ${items || 'Itens diversos'}`,
        status: 'completed',
        timestamp: serverTimestamp()
      });

      // Record consumption
      await addDoc(collection(db, 'consumption'), {
        studentId: scannedUser.uid,
        vendorId: profile.uid,
        amount: sellAmount,
        items: items.split(',').map(i => i.trim()),
        timestamp: serverTimestamp()
      });

      toast.success('Venda concluída com sucesso!');
      setScannedUser(null);
      setAmount('');
      setItems('');
    } catch (error) {
      console.error('Sale error:', error);
      toast.error('Erro ao processar venda');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="flex justify-between items-center bg-slate-800 p-6 rounded-2xl shadow-lg border border-slate-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-slate-700 rounded-lg">
              <ShoppingCart className="h-6 w-6 text-blue-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Ponto de Venda</h1>
              <p className="text-slate-400 text-sm">{profile.name}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={() => auth.signOut()} className="hover:bg-slate-700">
            <LogOut className="h-5 w-5 text-slate-400" />
          </Button>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="bg-slate-800 border-slate-700 text-white">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <QrCode className="h-5 w-5" /> Identificar Aluno
              </CardTitle>
              <CardDescription className="text-slate-400">Escaneie o QR Code do aluno</CardDescription>
            </CardHeader>
            <CardContent>
              {!isScanning && !scannedUser ? (
                <Button onClick={() => setIsScanning(true)} className="w-full h-32 text-lg variant-outline border-dashed border-2 hover:bg-slate-700">
                  Abrir Scanner
                </Button>
              ) : isScanning ? (
                <div id="qr-reader" className="w-full rounded-xl overflow-hidden bg-black"></div>
              ) : scannedUser ? (
                <div className="bg-slate-700 p-6 rounded-xl flex items-center justify-between">
                  <div>
                    <p className="text-xs text-slate-400 uppercase tracking-widest font-bold">Aluno</p>
                    <p className="text-xl font-bold">{scannedUser.name}</p>
                    <p className="text-blue-400 font-mono text-sm mt-1">Saldo: R$ {scannedUser.balance.toFixed(2)}</p>
                  </div>
                  <Button variant="ghost" onClick={() => setScannedUser(null)} className="h-10 w-10 p-0 text-slate-400 hover:text-white">
                    <XCircle className="h-6 w-6" />
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="bg-slate-800 border-slate-700 text-white">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5" /> Detalhes da Venda
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs text-slate-400 font-bold uppercase">Valor total (R$)</label>
                <Input 
                  type="number" 
                  placeholder="0.00" 
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="bg-slate-700 border-slate-600 text-2xl h-14"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-slate-400 font-bold uppercase">Itens (separados por vírgula)</label>
                <Input 
                  placeholder="Coxinha, Suco de Laranja..." 
                  value={items}
                  onChange={(e) => setItems(e.target.value)}
                  className="bg-slate-700 border-slate-600"
                />
              </div>
              <Button 
                onClick={handleSale} 
                disabled={!scannedUser || !amount || processing}
                className="w-full h-14 bg-white text-slate-900 hover:bg-slate-200 font-bold text-lg mt-4"
              >
                {processing ? 'Processando...' : 'Confirmar Venda'}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
