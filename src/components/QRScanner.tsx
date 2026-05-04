import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { Button } from '@/components/ui/button';
import { X, Camera, Loader2, Zap, ZapOff, Focus } from 'lucide-react';

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
    let scanner: Html5Qrcode | null = null;
    let isMounted = true;

    const startScanner = async () => {
      if (!isMounted) return;
      
      try {
        // Usar BarcodeDetector API se disponível para performance superior
        scanner = new Html5Qrcode(elementId, { 
          verbose: false,
          formatsToSupport: [ Html5QrcodeSupportedFormats.QR_CODE ],
          experimentalFeatures: { 
            useBarCodeDetectorIfSupported: true 
          } 
        });
        html5QrCodeRef.current = scanner;

        const config = {
          fps: 60, // Aumentado para 60 FPS para leitura ultrarrápida (se suportado pelo hardware)
          qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
            // QRBox otimizado: 70% da menor dimensão para garantir resolução e foco
            const qrboxSize = Math.floor(minEdge * 0.7);
            return { width: qrboxSize, height: qrboxSize };
          },
          aspectRatio: 1.0,
          disableFlip: false,
          // Video Constraints maximizadas para precisão
          videoConstraints: {
            facingMode: "environment",
            focusMode: "continuous",
            whiteBalanceMode: "continuous",
            exposureMode: "continuous",
            width: { min: 640, ideal: 1920, max: 3840 },
            height: { min: 480, ideal: 1080, max: 2160 },
            frameRate: { ideal: 60, min: 30 }
          }
        };

        // Função auxiliar para iniciar o scanner
        const tryStart = async (cameraIdOrConfig: any) => {
          return scanner?.start(
            cameraIdOrConfig,
            config,
            (decodedText) => {
              if (navigator.vibrate) try { navigator.vibrate(100); } catch(e){} 
              onScan(decodedText);
            },
            () => {}
          );
        };

        try {
          // Tentar primeiro com câmera traseira
          await tryStart({ facingMode: "environment" });
        } catch (e) {
          console.warn("Could not start with environment camera, trying any available camera...", e);
          
          // Tentar qualquer câmera disponível
          try {
            const allDevices = await Html5Qrcode.getCameras();
            const backCamera = allDevices.find(c => 
              c.label.toLowerCase().includes('back') || 
              c.label.toLowerCase().includes('traseira') ||
              c.label.toLowerCase().includes('rear')
            );
            
            if (backCamera) {
              await tryStart(backCamera.id);
            } else if (allDevices.length > 0) {
              await tryStart(allDevices[0].id);
            } else {
              await tryStart({ facingMode: "user" });
            }
          } catch (fallbackError) {
            console.error("All camera start attempts failed:", fallbackError);
            throw fallbackError;
          }
        }

        if (!isMounted) {
          if (scanner.isScanning) await scanner.stop();
          return;
        }

        // Capability check for torch
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
        if (isMounted) {
          console.error("Scanner init error:", e);
          setError("Não foi possível acessar a câmera. Verifique as permissões do navegador e se nenhuma outra aba está usando a sua webcam.");
          setIsInitializing(false);
        }
      }
    };

    const timer = setTimeout(startScanner, 500); 

    return () => {
      isMounted = false;
      clearTimeout(timer);
      if (html5QrCodeRef.current) {
        const currentScanner = html5QrCodeRef.current;
        if (currentScanner.isScanning) {
          currentScanner.stop()
            .then(() => {
              currentScanner.clear();
            })
            .catch(console.warn);
        } else {
          try { currentScanner.clear(); } catch(e) {}
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
