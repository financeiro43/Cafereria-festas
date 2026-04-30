import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Button } from '@/components/ui/button';
import { X, Camera, Loader2, Zap, ZapOff } from 'lucide-react';

interface QRScannerProps {
  onScan: (decodedText: string) => void;
  onClose: () => void;
  title?: string;
}

export default function QRScanner({ onScan, onClose, title = "Escanear QR Code" }: QRScannerProps) {
  const [error, setError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isTorchOn, setIsTorchOn] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const elementId = "universal-qr-reader";

  const toggleTorch = async () => {
    if (!html5QrCodeRef.current) return;
    try {
      const newState = !isTorchOn;
      await html5QrCodeRef.current.applyVideoConstraints({
        //@ts-ignore - torch is not in standard types but supported by html5-qrcode
        advanced: [{ torch: newState }]
      });
      setIsTorchOn(newState);
    } catch (e) {
      console.warn("Failed to toggle torch:", e);
    }
  };

  useEffect(() => {
    const startScanner = async () => {
      try {
        const scanner = new Html5Qrcode(elementId);
        html5QrCodeRef.current = scanner;

        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 30,
            qrbox: (viewfinderWidth, viewfinderHeight) => {
              const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
              return { width: Math.floor(minEdge * 0.8), height: Math.floor(minEdge * 0.8) };
            },
            aspectRatio: 1.0,
            showZoomSliderIfSupported: true,
            videoConstraints: {
              facingMode: "environment",
              focusMode: "continuous", // Tenta forçar o foco contínuo
              whiteBalanceMode: "continuous"
            }
          },
          (decodedText) => {
            if (navigator.vibrate) try { navigator.vibrate(100); } catch(e){} 
            onScan(decodedText);
          },
          () => {}
        );

        // Verificar se a câmera suporta lanterna (torch)
        try {
          const track = scanner.getRunningTrackCapabilities();
          //@ts-ignore
          if (track?.torch) {
            setHasTorch(true);
          }
        } catch (e) {
          console.log("Torch capability check failed:", e);
        }

        setIsInitializing(false);
      } catch (e: any) {
        console.error("Scanner init error:", e);
        if (e.toString().includes("NotAllowedError") || e.toString().includes("Permission denied")) {
          setError("Acesso à câmera negado. Por favor, libere a permissão nas configurações do seu navegador.");
        } else {
          setError("Erro ao acessar a câmera principal. Tente recarregar a página.");
        }
        setIsInitializing(false);
      }
    };

    const timer = setTimeout(startScanner, 400);

    return () => {
      clearTimeout(timer);
      if (html5QrCodeRef.current) {
        if (html5QrCodeRef.current.isScanning) {
          html5QrCodeRef.current.stop().then(() => {
            html5QrCodeRef.current?.clear();
          }).catch(console.warn);
        }
      }
    };
  }, [onScan]);

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center">
      {/* Header Minimalista */}
      <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-center z-10 bg-gradient-to-b from-black/80 to-transparent">
        <h3 className="text-white font-black uppercase text-[10px] tracking-[0.2em]">{title}</h3>
        <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full text-white hover:bg-white/10 h-12 w-12">
          <X className="h-8 w-8" />
        </Button>
      </div>
      
      {/* Container do Vídeo */}
      <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
        <div id={elementId} className="w-full h-full object-cover"></div>
        
        {/* Overlay de UI Customizado */}
        {!error && !isInitializing && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            {/* Máscara de Escurecimento */}
            <div className="absolute inset-0 bg-black/50"></div>
            
            {/* Área de Foco */}
            <div className="relative w-[80vw] h-[80vw] max-w-[320px] max-h-[320px] border-2 border-white/20 rounded-[48px] overflow-hidden shadow-[0_0_0_1000px_rgba(0,0,0,0.6)] animate-in zoom-in duration-500">
              {/* Cantos de Foco Brilhantes */}
              <div className="absolute top-0 left-0 w-10 h-10 border-t-4 border-l-4 border-blue-500 rounded-tl-2xl"></div>
              <div className="absolute top-0 right-0 w-10 h-10 border-t-4 border-r-4 border-blue-500 rounded-tr-2xl"></div>
              <div className="absolute bottom-0 left-0 w-10 h-10 border-b-4 border-l-4 border-blue-500 rounded-bl-2xl"></div>
              <div className="absolute bottom-0 right-0 w-10 h-10 border-b-4 border-r-4 border-blue-500 rounded-br-2xl"></div>
              
              {/* Linha de Varredura Animada (Mais suave) */}
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent animate-[scan_1.5s_linear_infinite] shadow-[0_0_20px_blue]"></div>
              
              {/* Feedback de Mira Central */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 border border-white/10 rounded-full opacity-30"></div>
            </div>
            
            <div className="absolute bottom-[15%] flex flex-col items-center gap-4 px-10 text-center">
               <p className="text-white/80 font-black text-xs uppercase tracking-[0.2em] animate-pulse">
                Aproxime o código do centro
               </p>
               <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest max-w-[200px]">
                Mantenha o celular firme para uma leitura instantânea
               </p>
            </div>
          </div>
        )}

        {/* Botão de Lanterna Flutuante */}
        {hasTorch && !isInitializing && !error && (
          <div className="absolute bottom-[25%] right-8 z-20">
             <Button 
                onClick={toggleTorch} 
                className={`h-16 w-16 rounded-full shadow-2xl transition-all duration-300 ${
                  isTorchOn ? 'bg-yellow-400 text-black scale-110' : 'bg-white/10 text-white backdrop-blur-md'
                }`}
             >
                {isTorchOn ? <ZapOff className="h-8 w-8" /> : <Zap className="h-8 w-8 fill-current" />}
             </Button>
          </div>
        )}

        {isInitializing && (
          <div className="flex flex-col items-center gap-6">
            <div className="relative">
               <div className="absolute inset-0 bg-blue-500 blur-2xl opacity-20 animate-pulse"></div>
               <Loader2 className="h-12 w-12 text-blue-500 animate-spin relative" />
            </div>
            <p className="text-white/50 font-black text-[10px] tracking-[0.3em] uppercase">Sincronizando Óptica...</p>
          </div>
        )}

        {error && (
          <div className="p-8 text-center space-y-6 max-w-xs z-20">
            <div className="bg-red-500/20 p-6 rounded-full w-fit mx-auto">
              <Camera className="h-12 w-12 text-red-500" />
            </div>
            <div className="space-y-2">
              <p className="text-lg font-black text-white">Erro Óptico</p>
              <p className="text-sm text-slate-400 leading-relaxed font-medium">{error}</p>
            </div>
            <Button onClick={() => window.location.reload()} className="w-full bg-blue-600 text-white font-black rounded-2xl h-14 shadow-xl shadow-blue-900/40">
              REINICIAR CÂMERA
            </Button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes scan {
          0% { top: 0%; opacity: 0; }
          15% { opacity: 1; }
          85% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
        #universal-qr-reader video {
          object-fit: cover !important;
          width: 100% !important;
          height: 100% !important;
        }
      `}</style>
    </div>
  );
}
