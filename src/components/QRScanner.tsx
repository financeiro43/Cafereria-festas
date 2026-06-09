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
  const hasScanned = useRef(false);
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

      // 1. Verificar suporte básico e HTTPS seguro (essencial em PWAs e navegadores mobile)
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        if (isMounted) {
          setError("Acesso à câmera bloqueado. Para utilizar o leitor de QR Code, você precisa obrigatoriamente acessar o aplicativo através de um endereço seguro iniciado por HTTPS (https://) e conceder permissão de câmera ao site nas configurações do dispositivo.");
          setIsInitializing(false);
        }
        return;
      }
      
      try {
        // @ts-ignore
        scanner = new Html5Qrcode(elementId, { 
          verbose: false,
          formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE]
        });
        html5QrCodeRef.current = scanner;

        const config = {
          fps: 30,
          qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
            const size = Math.floor(minEdge * 0.85);
            return { width: size, height: size };
          },
          aspectRatio: undefined,
          disableFlip: false,
          experimentalFeatures: {
            useBarCodeDetectorIfSupported: true
          }
        };

        // Função auxiliar para iniciar o leitor com determinado cameraId ou configurações de constraints
        const tryStart = async (cameraIdOrConfig: any) => {
          if (!scanner) return;
          return scanner.start(
            cameraIdOrConfig,
            config,
            (decodedText) => {
              if (!isMounted || hasScanned.current) return;
              hasScanned.current = true;
              if (navigator.vibrate) try { navigator.vibrate(100); } catch(e){} 
              onScan(decodedText);
            },
            () => {}
          );
        };

        // Pequeno delay para garantir que o DOM está pronto e animado
        await new Promise(resolve => setTimeout(resolve, 350));
        if (!isMounted) return;

        let success = false;

        // SEQUÊNCIA DE SELEÇÃO E CONEXÃO ÓPTICA INTELIGENTE ULTRA-ROBUSTA:
        // Evita a seleção automática de lentes ultra-wide (0.5x), teleobjetivas (3x/5x) ou macro que focam incorretamente ou geram imagens desfocadas
        const getBestCameraConfig = async () => {
          try {
            const devices = await Html5Qrcode.getCameras().catch(() => []);
            console.log("[SCANNER] Dispositivos de captura encontrados:", devices);
            
            if (devices && devices.length > 0) {
              // Filtrar apenas câmeras traseiras catalogadas na etiqueta
              const backDevices = devices.filter(d => 
                /back|traseira|rear|environment|direcional|outdoor|retaguarda|principal/i.test(d.label) || 
                /camera\s*0|câmera\s*0/i.test(d.label)
              );
              
              if (backDevices.length > 0) {
                // Filtrar lentes especiais de grande ângulo ou zoom teleobjetivo
                const mainBackDevices = backDevices.filter(d => 
                  !/ultra|wide|tele|zoom|macro|0\.5|3x|5x|virtual/i.test(d.label.toLowerCase())
                );
                
                console.log("[SCANNER] Câmeras traseiras identificadas:", backDevices);
                console.log("[SCANNER] Lente traseira principal (1x) sugerida:", mainBackDevices);
                
                const selectedCameraId = mainBackDevices.length > 0 
                  ? mainBackDevices[0].id 
                  : backDevices[0].id;
                  
                return {
                  deviceId: { exact: selectedCameraId },
                  width: { ideal: 1280 },
                  height: { ideal: 720 },
                  facingMode: "environment"
                };
              }
            }
          } catch (err) {
            console.warn("[SCANNER] Erro obtendo lista de hardware de imagem:", err);
          }
          
          // Fallback padrão se não puder enumerar ou labels estiverem ocultas por falta de permissão imediata
          return {
            facingMode: "environment",
            width: { ideal: 1280 },
            height: { ideal: 720 }
          };
        };

        const cameraConfig = await getBestCameraConfig();
        console.log("[SCANNER] Aplicando parâmetros de inicialização óptica:", cameraConfig);

        // Tentativa 1: Perfil de Resolução + Câmera Principal selecionada + Foco Contínuo Autônomo
        try {
          await tryStart({
            ...cameraConfig,
            // @ts-ignore
            focusMode: "continuous"
          });
          success = true;
          console.log("[SCANNER] Conectado via perfil completo de autofoco contínuo.");
        } catch (e1) {
          console.warn("[SCANNER] Perfil com foco falhou, tentando apenas com resolução ideal:", e1);
          
          // Tentativa 2: Perfil com resolução ideal sem restrição de foco explícita
          try {
            await tryStart(cameraConfig);
            success = true;
            console.log("[SCANNER] Conectado via perfil de resolução ideal.");
          } catch (e2) {
            console.warn("[SCANNER] Tentativa 2 falhou. Usando environment simples (legado):", e2);
            
            // Tentativa 3: Padrão environment genérico do browser
            try {
              await tryStart({ facingMode: "environment" });
              success = true;
              console.log("[SCANNER] Conectado via facingMode simples.");
            } catch (e3) {
              console.warn("[SCANNER] Tentativa 3 falhou. Usando exatidão de ambiente:", e3);
              
              // Tentativa 4: Padrão exact environment
              try {
                await tryStart({ facingMode: { exact: "environment" } });
                success = true;
                console.log("[SCANNER] Conectado via exact environment.");
              } catch (e4) {
                console.warn("[SCANNER] Todas as tentativas falharam. Usando ID bruto se disponível:", e4);
                
                // Tentativa 5: ID bruto ou câmera frontal
                try {
                  const allDevices = await Html5Qrcode.getCameras().catch(() => []);
                  if (allDevices && allDevices.length > 0) {
                    await tryStart(allDevices[0].id);
                    success = true;
                    console.log("[SCANNER] Conectado via ID físico direto:", allDevices[0].id);
                  } else {
                    await tryStart({ facingMode: "user" });
                    success = true;
                    console.log("[SCANNER] Conectado via câmera secundária frontal.");
                  }
                } catch (e5) {
                  console.error("[SCANNER] Falha irrecuperável de inicialização óptica:", e5);
                  throw e5;
                }
              }
            }
          }
        }

        if (!isMounted) {
          if (scanner && scanner.isScanning) await scanner.stop();
          return;
        }

        // Se iniciou, verificar se há lanterna (torch)
        try {
          const track = scanner.getRunningTrackCapabilities();
          //@ts-ignore
          if (track?.torch) {
            setHasTorch(true);
          }
        } catch (e) {
          console.log("Suporte a lanterna não detectado neste hardware:", e);
        }

        setIsInitializing(false);
      } catch (e: any) {
        if (isMounted) {
          console.error("Erro fatal de inicialização do leitor de QR:", e);
          
          const rawErrorString = e?.toString() || "";
          if (
            rawErrorString.includes("NotAllowedError") || 
            rawErrorString.includes("Permission denied") || 
            rawErrorString.includes("PermissionDeniedError")
          ) {
            setError("A permissão de acesso à câmera do celular foi recusada. Acesse as configurações de privacidade/permissões do seu aparelho ou do navegador e conceda acesso à câmera para este aplicativo.");
          } else {
            setError("Não foi possível acessar a câmera. Certifique-se de que de fato há uma câmera conectada, que concedeu permissões nas configurações e que nenhuma outra aba ou app está utilizando o hardware.");
          }
          setIsInitializing(false);
        }
      }
    };

    startScanner(); 

    return () => {
      isMounted = false;
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
          width: 100% !important;
          height: 100% !important;
          object-fit: cover !important;
        }
      `}</style>
    </div>
  );
}
