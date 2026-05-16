/**
 * Rede API Integration - Environment Sync Ver: 1.0.7
 */
import express from "express";
import path from "path";
import cors from "cors";
import { initializeApp, getApps, FirebaseApp } from "firebase/app";
import { 
  getFirestore, 
  Firestore, 
  doc, 
  getDoc, 
  updateDoc, 
  increment, 
  serverTimestamp, 
  collection, 
  addDoc, 
  runTransaction 
} from "firebase/firestore";
import fs from "fs";
import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

async function startServer() {
  console.log("Starting server...");
  const app = express();
  const PORT = 3000;

  // Initialize Firebase (Client SDK)
  let db: Firestore | null = null;
  try {
    const configPath = path.resolve(process.cwd(), "firebase-applet-config.json");
    const apps = getApps();
    
    let firebaseApp: FirebaseApp;
    if (apps.length === 0) {
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        firebaseApp = initializeApp(config);
      } else {
        throw new Error("firebase-applet-config.json not found");
      }
    } else {
      firebaseApp = apps[0] as FirebaseApp;
    }
    
    db = getFirestore(firebaseApp);
  } catch (error: any) {
    console.error("Firebase initialization failed:", error?.message);
  }

  // IMPORTANT: Middleware and API Routes FIRST
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Global Logger - Filtered to reduce noise
  app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    const isStaticAsset = req.url.match(/\.(ts|tsx|js|css|json|svg|png|jpg|jpeg|gif|webp|woff|woff2)$/);
    const isViteInternal = req.url.includes('node_modules') || req.url.includes('@vite') || req.url.startsWith('/src/');

    if (!isStaticAsset && !isViteInternal) {
      res.on('finish', () => {
        console.log(`[REQ] ${timestamp} | ${res.statusCode} | ${req.method} | ${req.url}`);
      });
    }
    
    next();
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", dbInitialized: !!db });
  });

  // --- Rede API Integration ---
  const API_BASE = "/api/rede";

  // Token cache to avoid hitting rate limits (Rede Tokens last 24m)
  let redeTokenCache: { [key: string]: { token: string; expires: number } } = {};

      const getRedeAccessToken = async (pv: string, token: string, isSandbox: boolean) => {
    const keyPV = String(pv || "").trim();
    const keyToken = String(token || "").trim();
    const cacheKey = `${keyPV}-${isSandbox}`;
    
    if (redeTokenCache[cacheKey] && Date.now() < redeTokenCache[cacheKey].expires) {
      return redeTokenCache[cacheKey].token;
    }

    const tokenUrl = isSandbox 
      ? "https://rl7-sandbox-api.useredecloud.com.br/oauth2/token"
      : "https://api.userede.com.br/redelabs/oauth2/token"; // Note: Redelabs is required for this PV on Production
    
    console.log(`[REDE-API] Solicitando Novo Token OAuth (${isSandbox ? 'SANDBOX' : 'PRODUÇÃO'}) para PV ${keyPV.substring(0,4)}`);
    const authBase64 = Buffer.from(`${keyPV}:${keyToken}`).toString('base64');
    
    // Use URLSearchParams for correct encoding
    const params = new URLSearchParams();
    params.append("grant_type", "client_credentials");
    const body = params.toString();

    console.log(`[REDE-API] URL: ${tokenUrl}`);
    console.log(`[REDE-API] Body: ${body}`);
    console.log(`[REDE-API] AuthHeader: Basic ${authBase64.substring(0, 10)}...`);

    try {
      // Use native https for max control over headers and encoding
      const https = await import("https");
      const accessToken = await new Promise<string>((resolve, reject) => {
        const url = new URL(tokenUrl);
        const options = {
          hostname: url.hostname,
          path: url.pathname,
          method: 'POST',
          headers: {
            'Authorization': `Basic ${authBase64}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Content-Length': Buffer.byteLength(body)
          },
          timeout: 15000
        };

        const req = https.request(options, (res: any) => {
          let data = '';
          res.on('data', (chunk: any) => data += chunk);
          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                const parsed = JSON.parse(data);
                resolve(parsed.access_token);
              } catch (e) {
                reject(new Error(`Failed to parse OAuth response: ${data.substring(0, 100)}`));
              }
            } else {
              reject(new Error(`Rede OAuth Status ${res.statusCode}: ${data.substring(0, 200)}`));
            }
          });
        });

        req.on('error', (e: any) => reject(e));
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Rede OAuth Timeout'));
        });
        req.write(body);
        req.end();
      });

      // Expire in 20 minutes
      redeTokenCache[cacheKey] = { token: accessToken, expires: Date.now() + 20 * 60 * 1000 };
      return accessToken;
    } catch (tokenErr: any) {
      console.error(`[REDE-API] Erro OAuth PV=${pv}:`, tokenErr.message);
      throw new Error(`Falha Rede (OAuth): ${tokenErr.message}`);
    }
  };

  // Diagnostic GET route
  app.get(`${API_BASE}/ping`, async (req, res) => {
    let pv = (process.env.REDE_PV || process.env.RESGATE_PV || "").trim();
    let token = (process.env.REDE_TOKEN || process.env.RESGATE_TOKEN || "").trim();
    let isSandbox = String(process.env.REDE_SANDBOX || "").toLowerCase() === 'true';

    console.log(`[REDE-DEBUG] Ping V106 trigger. Code Ver: 1.0.6. PV Len: ${pv.length}`);

    try {
      if (!pv || !token) throw new Error("Credenciais ausentes no ambiente (.env)");
      const accessToken = await getRedeAccessToken(pv, token, isSandbox);
      res.json({ status: "connected", sandbox: isSandbox, pv: pv.substring(0, 4) + '****', tokenPrefix: accessToken.substring(0, 10) });
    } catch (e: any) {
      res.status(401).json({ status: "error", message: e.message });
    }
  });

  // Endpoint to create a checkout session
  app.post(`${API_BASE}/create-checkout`, async (req, res) => {
    console.log(`[REDE-API] POST /create-checkout`);
    try {
      const { amount, userId } = req.body;
      if (!amount || !userId) {
        return res.status(400).json({ error: "Missing amount or userId" });
      }

      const transactionId = `${Date.now()}`;
      
      const isReal = !!((process.env.REDE_PV || process.env.RESGATE_PV) && (process.env.REDE_TOKEN || process.env.RESGATE_TOKEN));
      const checkoutUrl = `/mock-payment?tid=${transactionId}&amt=${amount}&uid=${userId}${isReal ? '&real=true' : ''}`;
      
      res.json({ checkoutUrl, transactionId, isReal });
    } catch (error: any) {
      console.error(`[REDE-API] Error in create-checkout: ${error.message}`);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  // Real Rede Payment Processing
  app.post(`${API_BASE}/process-payment`, async (req, res) => {
    console.log(`[REDE-API] POST /process-payment`);

    try {
      const { cardData, amount, transactionId, userId, paymentMethod, customer } = req.body;
      console.log(`[REDE-API] Início: uid=${userId}, amt=${amount}, tid=${transactionId}, method=${paymentMethod}`);
      
      const parsedAmount = parseFloat(amount);
      if (!userId || isNaN(parsedAmount) || (!cardData && paymentMethod !== 'pix')) {
          console.error(`[REDE-API] Falha de Validação: uid=${userId}, amt=${parsedAmount}`);
          return res.status(400).json({ error: "Dados da transação inválidos ou incompletos" });
      }

      // 2. Fetch credentials - STRICTLY USE ENVIRONMENT VARIABLES FOR SECURITY
      const livePV = (process.env.REDE_PV || process.env.RESGATE_PV || "").trim();
      const liveToken = (process.env.REDE_TOKEN || process.env.RESGATE_TOKEN || "").trim();
      const isSandbox = String(process.env.REDE_SANDBOX || "").toLowerCase() === 'true';

      if (!livePV || !liveToken) {
        return res.status(500).json({ 
          error: "Configuração Ausente", 
          message: "PV ou Token da Rede não encontrados nas variáveis de ambiente." 
        });
      }

      const accessToken = await getRedeAccessToken(livePV, liveToken, isSandbox);
      
      const redeAmount = Math.round(parsedAmount * 100);
      const secureRef = `F${Date.now()}`.substring(0, 16);
      
      const axiosConfig = { 
        headers: { 
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Transaction-Response': 'brand-return-opened',
          'User-Agent': 'FestaPass/1.0 (Integration; e-Rede)'
        },
        timeout: 30000
      };

      const redeUrl = isSandbox 
        ? "https://sandbox-erede.useredecloud.com.br/erede/v2/transactions"
        : "https://api.userede.com.br/erede/v2/transactions";
      
      // Correctly structured payloads for V2
      let redePayload: any;

      if (paymentMethod === 'pix') {
        // PIX Standard Payload for e-Rede V2
        const expirationSeconds = 86400; // 24 hours
        const expDate = new Date(Date.now() + expirationSeconds * 1000);
        
        redePayload = {
          capture: false, // Pix is never captured automatically in the same sense as cards
          kind: "pix",
          reference: secureRef,
          amount: redeAmount,
          qrCodeResponse: true,
          expiration: expirationSeconds,
          qrCode: {
            dateTimeExpiration: expDate.toISOString().split('.')[0] + 'Z' // Ensure Z suffix for ISO 8601
          },
          customer: {
            name: customer?.name || "CLIENTE FESTAPASS",
            email: customer?.email || "atendimento@festapass.com.br"
          },
          urls: [
            {
              url: "https://festapass.com.br/payment-callback",
              kind: "callback"
            }
          ]
        };
      } else {
        // Credit/Debit Standard Payload
        redePayload = {
          capture: true,
          kind: paymentMethod === 'debit' ? 'debit' : 'credit',
          reference: secureRef,
          amount: redeAmount,
          softDescriptor: "FESTAPASS",
          customer: {
            name: customer?.name || "CLIENTE FESTAPASS",
            email: customer?.email || "atendimento@festapass.com.br"
          },
          urls: [
            {
              url: "https://festapass.com.br/payment-callback",
              kind: "callback"
            }
          ]
        };

        const [month, year] = String(cardData?.expiry || "/").split("/");
        if (!month || !year) throw new Error("Data de expiração inválida");

        const cleanName = String(cardData.holder || cardData.name || "CLIENTE")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-zA-Z ]/g, "")
          .toUpperCase()
          .trim()
          .substring(0, 30);

        const yearNum = parseInt(year, 10);
        const fullYear = (year.length === 2 && yearNum < 100) ? 2000 + yearNum : yearNum;

        redePayload = {
          ...redePayload,
          cardholderName: cleanName,
          cardNumber: String(cardData.number || "").replace(/\D/g, ""),
          expirationMonth: parseInt(month, 10),
          expirationYear: fullYear,
          securityCode: String(cardData.cvv || cardData.securityCode || "").trim().substring(0, 4)
        };

        if (paymentMethod === 'credit') {
          const instCount = parseInt(req.body.installments, 10);
          if (instCount > 1) {
            redePayload.installments = instCount;
          }
        }

        if (paymentMethod === 'debit') {
          // 3DS2 Requirements for risk analysis - Overwrite specific fields for Debit
          redePayload.threeDSecure = { 
            embedded: true, 
            onFailure: "decline",
            userAgent: req.headers['user-agent'] || "Mozilla/5.0",
            ipAddress: (req.ip || "127.0.0.1").replace('::ffff:', ''),
            returnUrl: "https://festapass.com.br/payment-callback"
          };

          // Redefine URLs for Debit ensuring all required kinds (code 160 fix)
          const baseUrl = "https://festapass.com.br/payment-callback";
          redePayload.urls = [
            { url: baseUrl, kind: "callback" },
            { url: baseUrl, kind: "return" },
            { url: baseUrl, kind: "threeDSecureSuccess" },
            { url: baseUrl, kind: "threeDSecureFailure" }
          ];
        }
      }

      // Safe Logging for verification
      const logPayload = { ...redePayload };
      if (logPayload.cardNumber) logPayload.cardNumber = logPayload.cardNumber.substring(0,6) + "******";
      if (logPayload.securityCode) logPayload.securityCode = "***";
      
      console.log(`[REDE-API] Chamando ${isSandbox ? 'Sandbox' : 'Produção'}: ${redeUrl}`);
      console.log(`[REDE-API] Payload:`, JSON.stringify(logPayload));
      
      let response;
      try {
        response = await axios.post(redeUrl, redePayload, axiosConfig);
      } catch (axiosError: any) {
        const status = axiosError.response?.status || 500;
        const respData = axiosError.response?.data;
        
        // CRITICAL: Robust logging of the exact error from Rede
        console.error(`[REDE-API] Erro Rede HTTP ${status}:`, JSON.stringify(respData || axiosError.message, null, 2));
        
        let msg = axiosError.message;
        if (respData) {
          if (respData.returnCode === "3095") {
            msg = "Chave PIX não configurada no Portal Rede. Por favor, acesse o Portal Userede e configure uma chave PIX padrão para este PV.";
          } else if (respData.errors && Array.isArray(respData.errors) && respData.errors.length > 0) {
            msg = respData.errors.map((e: any) => `${e.message} (${e.parameter})`).join('; ');
          } else {
            msg = respData.returnMessage || respData.message || (respData.error || null) || JSON.stringify(respData);
          }
        }

        return res.status(status).json({
          error: "Erro na Operadora/Configuração",
          message: msg,
          details: respData,
          debug: {
            url: redeUrl,
            pv: livePV.substring(0, 4) + '****',
            sandbox: isSandbox,
            payloadKeys: Object.keys(redePayload)
          }
        });
      }
      
      const redeData = response.data;
      console.log(`[REDE-API] Resposta Rede: ${redeData.returnCode} - ${redeData.returnMessage}`);

      const isSuccess = redeData.returnCode === "00" || redeData.returnCode === "0";

      if (isSuccess) {
        if (db) {
          try {
            const userRef = doc(db, "users", userId);
            const userDoc = await getDoc(userRef);
            
            if (userDoc.exists()) {
              const { setDoc } = await import("firebase/firestore");
              const txnId = redeData.tid;
              const txnRef = doc(db, "transactions", txnId);

              if (paymentMethod !== 'pix') {
                // For Credit/Debit, apply balance immediately and mark completed
                await updateDoc(userRef, {
                  balance: increment(parsedAmount),
                  lastRecharge: serverTimestamp(),
                  _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
                });

                await setDoc(txnRef, {
                  userId,
                  amount: parsedAmount,
                  type: "credit",
                  status: "completed",
                  description: `Recarga via ${paymentMethod === 'debit' ? 'Débito' : 'Crédito'} Rede`,
                  timestamp: serverTimestamp(),
                  redeTid: redeData.tid,
                  nsu: redeData.nsu,
                  _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
                });
                console.log(`[REDE-API] Saldo e transação (Cartão) atualizados: ${txnId}`);
              } else {
                // For Pix, create a PENDING transaction
                await setDoc(txnRef, {
                  userId,
                  amount: parsedAmount,
                  type: "credit",
                  status: "pending",
                  description: `Recarga via Pix Rede`,
                  timestamp: serverTimestamp(),
                  redeTid: redeData.tid,
                  _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
                });
                console.log(`[REDE-API] Transação Pix Pendente criada: ${txnId}`);
              }
            }
          } catch (dbErr: any) {
            console.error(`[REDE-API] Erro ao salvar dados no DB: ${dbErr.message}`);
          }
        }
        
        const responseData: any = { success: true, tid: redeData.tid };
        if (paymentMethod === 'pix') {
          // V2 PIX Response structure can vary slightly
          const qrCode = redeData.qrCodeResponse?.qrcode || 
                         redeData.qrCodeResponse?.qrCodeData || 
                         redeData.qrCode || 
                         redeData.pix?.qrCode || 
                         redeData.pix?.qrcode;
          
          responseData.pix = {
            qrCode: qrCode,
            expiration: redeData.qrCodeResponse?.dateTimeExpiration || redeData.qrCode?.dateTimeExpiration
          };
        }
        
        return res.json(responseData);
      } else {
        return res.status(400).json({ 
          error: "Pagamento Negado", 
          message: redeData.returnMessage || "Transação não autorizada pela operadora." 
        });
      }
    } catch (error: any) {
      console.error(`[REDE-API] Erro Crítico:`, error);
      res.status(500).json({ 
        error: "Erro Interno", 
        message: error.message || "A server error has occurred"
      });
    }
  });

  // Manual status check for Pix (Alternative to Webhook)
  app.get(`${API_BASE}/verify-pix/:tid`, async (req, res) => {
    const { tid } = req.params;
    console.log(`[REDE-API] GET /verify-pix/${tid}`);
    
    // Prevent caching for verification endpoint
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Vary", "*");

    if (!db) return res.status(500).json({ error: "Banco de dados não inicializado" });

    try {
      // 1. Fetch transaction from our DB
      const txnRef = doc(db, "transactions", tid);
      const txnDoc = await getDoc(txnRef);
      
      if (!txnDoc.exists()) {
        console.error(`[REDE-API] Transação ${tid} não encontrada no Firestore.`);
        return res.status(404).json({ error: "Transação não encontrada" });
      }

      const txnData = txnDoc.data()!;
      if (txnData.status === "completed") {
        return res.json({ success: true, status: "completed", message: "Pagamento já processado" });
      }

      // 2. Fetch credentials - STRICTLY USE ENVIRONMENT VARIABLES
      const livePV = (process.env.REDE_PV || process.env.RESGATE_PV || "").trim();
      const liveToken = (process.env.REDE_TOKEN || process.env.RESGATE_TOKEN || "").trim();
      const isSandbox = String(process.env.REDE_SANDBOX || "").toLowerCase() === 'true';

      // 3. Obtain OAuth Token for Query
      const accessToken = await getRedeAccessToken(livePV, liveToken, isSandbox);

      const axiosConfig = { 
        headers: { 
          'Authorization': `Bearer ${accessToken}`,
          'User-Agent': 'FestaPass/1.0 (Integration; e-Rede)'
        } 
      };

      // 4. Query Rede for transaction status (V2)
      const redeUrl = isSandbox 
        ? `https://sandbox-erede.useredecloud.com.br/erede/v2/transactions/${txnData.redeTid || tid}` 
        : `https://api.userede.com.br/erede/v2/transactions/${txnData.redeTid || tid}`;
        
      console.log(`[REDE-API] Verificando Rede V2 TID=${tid}: ${redeUrl}`);
      const response = await axios.get(redeUrl, axiosConfig);
      const redeData = response.data;
      
      console.log(`[REDE-API] Resposta Rede para ${tid}:`, JSON.stringify(redeData));

      // 5. Update balance if approved
      // Expanded possible success statuses for Pix/Cards
      const successStatuses = [
        "Approved", "Confirmed", "Captured", "Paid", "Success", "Authorized", 
        "captured", "approved", "paid", "confirmed", "success", "authorized",
        "CONFIRMADO", "APROVADO", "PAGO", "CAPTURADO", "SUCESSO", "AUTORIZADO",
        "Confirmed_Pix", "Paid_Pix"
      ];
      const isApproved = (redeData.returnCode === "00" || redeData.returnCode === "0") && 
                        (successStatuses.includes(redeData.status) || successStatuses.includes(String(redeData.status).toUpperCase()));

      if (isApproved) {
        const { userId, amount } = txnData;
        console.log(`[REDE-API] Transação Aprovada! Atualizando saldo para user ${userId}...`);
        
        try {
          await runTransaction(db, async (t) => {
            const userRef = doc(db, "users", userId);
            const userDoc = await t.get(userRef);
            if (userDoc.exists()) {
              const currentBalance = userDoc.data()?.balance || 0;
              t.update(userRef, { 
                balance: currentBalance + amount,
                lastRecharge: serverTimestamp(),
                updatedAt: serverTimestamp(),
                _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
              });
              t.update(txnRef, { 
                status: "completed", 
                updatedAt: serverTimestamp(),
                redeData: redeData,
                _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
              });
            }
          });
          console.log(`[REDE-API] Saldo e transação finalizados com sucesso.`);
          return res.json({ 
            success: true, 
            status: "completed", 
            pago: true,
            message: "Pagamento confirmado e saldo creditado!",
            redeStatus: redeData.status
          });
        } catch (transErr: any) {
          console.error(`[REDE-API] Falha na Transação Firestore: ${transErr.message}`);
          throw transErr;
        }
      }

      console.log(`[REDE-API] Transação ainda pendente ou negada. Código: ${redeData.returnCode}, Status: ${redeData.status}`);
      return res.json({ 
        success: false, 
        pago: false,
        status: txnData.status, 
        redeStatus: redeData.status,
        message: "O pagamento ainda não foi confirmado pela operadora."
      });
    } catch (error: any) {
      console.error(`[REDE-API] Erro na Verificação Pix:`, error.response?.data || error.message);
      res.status(500).json({ 
        error: "Erro ao verificar status", 
        details: error.response?.data?.returnMessage || error.message 
      });
    }
  });

  // Webhook
  app.post(`${API_BASE}/webhook`, async (req, res) => {
    try {
      const { transactionId, status } = req.body;
      if (!db) return res.status(500).json({ error: "DB error" });
      if (status === "approved") {
        const txnRef = doc(db, "transactions", transactionId);
        const txnDoc = await getDoc(txnRef);
        if (txnDoc.exists() && txnDoc.data()?.status === "pending") {
          const { userId, amount } = txnDoc.data()!;
          await runTransaction(db, async (t) => {
            const userRef = doc(db, "users", userId);
            const userDoc = await t.get(userRef);
            if (userDoc.exists()) {
              const currentBalance = userDoc.data()?.balance || 0;
              t.update(userRef, { 
                balance: currentBalance + amount,
                _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
              });
              t.update(txnRef, { 
                status: "completed", 
                updatedAt: serverTimestamp(),
                _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
              });
            }
          });
          return res.json({ success: true });
        }
      }
      res.json({ success: false });
    } catch (error) {
      res.status(500).json({ error: "Webhook error" });
    }
  });

  // --- Static Assets & Development Middleware ---

  if (process.env.NODE_ENV !== "production") {
    console.log("Loading Vite (Development Mode)...");
    try {
      // Use eval('import(...)') to strictly hide this from static analysis
      // This prevents Vercel/bundlers from attempting to resolve 'vite' in production
      const viteModule = await eval('import("vite")');
      const { createServer } = viteModule;
      const vite = await createServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
      console.log("Vite middleware loaded");
    } catch (vError: any) {
      console.error("Failed to load Vite middleware:", vError);
    }
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.setHeader("Surrogate-Control", "no-store");
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error("Failed to start server:", err);
});

