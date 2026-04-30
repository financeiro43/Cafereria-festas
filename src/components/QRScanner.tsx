import React, { useEffect, useRef, useState } from 'react';
import { Html5QrcodeScanner, Html5QrcodeScannerState } from 'html5-qrcode';
import { Button } from '@/components/ui/button';
import { Camera, X } from 'lucide-react';

interface QRScannerProps {
  onScan: (decodedText: string) => void;
  onClose: () => void;
  title?: string;
}

export default function QRScanner({ onScan, onClose, title = "Escanear QR Code" }: QRScannerProps) {
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const elementId = "universal-qr-reader";

  useEffect(() => {
    const initScanner = () => {
      try {
        if (scannerRef.current) {
          scannerRef.current.clear().catch(() => {});
          scannerRef.current = null;
        }

        const scanner = new Html5QrcodeScanner(
          elementId,
          { 
            fps: 10, 
            qrbox: { width: 250, height: 250 },
            showTorchButtonIfSupported: true,
            aspectRatio: 1.0
          },
          /* verbose= */ false
        );

        scannerRef.current = scanner;
        
        scanner.render(
          (text) => {
            onScan(text);
          },
          (err) => {
            // Ignore minor framing errors
          }
        );
      } catch (e: any) {
        console.error("Scanner init error:", e);
        setError("Erro ao acessar a câmera. Verifique as permissões do navegador.");
      }
    };

    // Small timeout to ensure DOM element is ready
    const timer = setTimeout(initScanner, 300);

    return () => {
      clearTimeout(timer);
      if (scannerRef.current) {
        scannerRef.current.clear().catch(err => {
          console.warn("Failed to clear scanner on unmount:", err);
        });
        scannerRef.current = null;
      }
    };
  }, [onScan]);

  return (
    <div className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 md:p-8">
      <div className="w-full max-w-md bg-slate-900 rounded-[32px] overflow-hidden shadow-2xl border border-white/10">
        <div className="p-6 flex justify-between items-center bg-white/5">
          <h3 className="text-white font-black uppercase text-xs tracking-widest">{title}</h3>
          <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full text-slate-400 hover:text-white hover:bg-white/10">
            <X className="h-5 w-5" />
          </Button>
        </div>
        
        <div className="p-6 space-y-6">
          <div 
            id={elementId} 
            className="rounded-2xl overflow-hidden bg-black border border-white/5 aspect-square flex items-center justify-center relative shadow-inner"
          >
            {!error && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-slate-900/40 backdrop-blur-sm pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                <Camera className="h-10 w-10 text-white/50" />
                <p className="text-white/50 text-[10px] uppercase font-black">Aguardando Câmera...</p>
              </div>
            )}
            {error && (
              <div className="p-8 text-center space-y-4">
                <Camera className="h-12 w-12 text-red-500 mx-auto" />
                <p className="text-sm text-slate-300 font-medium">{error}</p>
                <Button onClick={() => window.location.reload()} variant="outline" className="text-xs border-white/10 text-white">
                  Recarregar App
                </Button>
              </div>
            )}
          </div>
          
          {!error && (
            <Button 
               id="manual-camera-auth" 
               variant="outline" 
               className="w-full h-11 border-white/10 text-white bg-white/5 hover:bg-white/10 rounded-xl text-xs font-black uppercase tracking-widest"
               onClick={() => {
                 // Try to trigger interaction-based permission
                 const video = document.createElement('video');
                 navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
                   stream.getTracks().forEach(t => t.stop());
                   window.location.reload(); // Hard reset to catch the new permission
                 }).catch(e => setError("Permissão negada. Ative nas configurações do navegador."));
               }}
            >
              Liberar Câmera Manualmente
            </Button>
          )}
          
          <div className="bg-blue-500/10 p-4 rounded-2xl border border-blue-500/20">
            <p className="text-[10px] text-blue-400 font-black uppercase tracking-widest text-center">Dica</p>
            <p className="text-[11px] text-slate-400 text-center mt-1">Aponte a câmera para o QR Code e aguarde o reconhecimento automático.</p>
          </div>
          
          <Button variant="ghost" onClick={onClose} className="w-full text-slate-500 font-bold hover:text-slate-300 transition-colors">
            Cancelar Operação
          </Button>
        </div>
      </div>
    </div>
  );
}
