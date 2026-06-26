/**
 * Rede API Integration - Environment Sync Ver: 1.0.7
 */
import express from "express";
import path from "path";
import cors from "cors";
import { initializeApp, getApps } from "firebase/app";
import { 
  getFirestore, 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  query as firestoreQuery, 
  where as firestoreWhere, 
  limit as firestoreLimit, 
  runTransaction as firestoreRunTransaction, 
  serverTimestamp, 
  increment 
} from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";

const FieldValue = {
  serverTimestamp() {
    return serverTimestamp();
  },
  increment(val: number) {
    return increment(val);
  }
};
import fs from "fs";
import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

async function startServer() {
  console.log("Starting server...");
  const app = express();
  const PORT = 3000;

  // Initialize Firebase (Client SDK with Admin/Server Compatibility Wrapper)
  let db: any = null;
  let auth: any = null;
  let rawDb: any = null;
  try {
    const configPath = path.resolve(process.cwd(), "firebase-applet-config.json");
    const existingApps = getApps();
    
    let firebaseApp;
    if (existingApps.length === 0) {
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        firebaseApp = initializeApp(config);
      } else {
        throw new Error("firebase-applet-config.json not found");
      }
    } else {
      firebaseApp = existingApps[0];
    }
    
    rawDb = getFirestore(firebaseApp);
    auth = getAuth(firebaseApp);
    
    // Sign in anonymously to authenticate server-side reads and writes
    signInAnonymously(auth)
      .then((userCred) => {
        console.log(`[FIREBASE-CLIENT] Server logged in anonymously (UID: ${userCred.user.uid})`);
      })
      .catch((authErr) => {
        console.error("[FIREBASE-CLIENT] Anonymous login error:", authErr.message);
      });

    // COMPATIBILITY LAYER
    db = {
      collection(colName: string) {
        let constraints: any[] = [];
        
        const queryBuilder = {
          where(field: string, op: string, val: any) {
            constraints.push(firestoreWhere(field, op as any, val));
            return queryBuilder;
          },
          limit(n: number) {
            constraints.push(firestoreLimit(n));
            return queryBuilder;
          },
          async get() {
            const colRef = collection(rawDb, colName);
            const q = firestoreQuery(colRef, ...constraints);
            const snap = await getDocs(q);
            
            // Wrap snapshot for compatibility
            const docs = snap.docs.map(d => ({
              id: d.id,
              ref: d.ref,
              data: () => d.data()
            }));
            
            return {
              empty: snap.empty,
              size: snap.size,
              docs
            };
          },
          doc(docId: string) {
            const docRef = doc(rawDb, colName, docId);
            return {
              id: docId,
              ref: docRef,
              async get() {
                const snap = await getDoc(docRef);
                return {
                  id: snap.id,
                  exists: snap.exists(),
                  data: () => snap.data()
                };
              },
              async set(data: any) {
                return setDoc(docRef, data);
              },
              async update(data: any) {
                return updateDoc(docRef, data);
              }
            };
          }
        };
        
        return queryBuilder;
      },
      
      async runTransaction(callback: (t: any) => Promise<any>) {
        return firestoreRunTransaction(rawDb, async (t) => {
          // Wrap transaction object 't'
          const wrappedT = {
            async get(refOrWrapper: any) {
              const actualRef = refOrWrapper.ref ? refOrWrapper.ref : refOrWrapper;
              const snap = await t.get(actualRef);
              return {
                id: snap.id,
                exists: snap.exists(),
                data: () => snap.data()
              };
            },
            set(refOrWrapper: any, data: any) {
              const actualRef = refOrWrapper.ref ? refOrWrapper.ref : refOrWrapper;
              t.set(actualRef, data);
              return wrappedT;
            },
            update(refOrWrapper: any, data: any) {
              const actualRef = refOrWrapper.ref ? refOrWrapper.ref : refOrWrapper;
              t.update(actualRef, data);
              return wrappedT;
            },
            delete(refOrWrapper: any) {
              const actualRef = refOrWrapper.ref ? refOrWrapper.ref : refOrWrapper;
              t.delete(actualRef);
              return wrappedT;
            }
          };
          return callback(wrappedT);
        });
      }
    };

    console.log("Firebase Client SDK initialized with compatibility wrapper");
  } catch (error: any) {
    console.error("Firebase Client initialization failed:", error?.message);
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
            const userRef = db.collection("users").doc(userId);
            const userDoc = await userRef.get();
            
            if (userDoc.exists) {
              const txnId = redeData.tid;
              const txnRef = db.collection("transactions").doc(txnId);

              const userData = userDoc.data();
              const isShared = userData && (!userData.balanceType || userData.balanceType === 'shared') && userData.parentUid;
              const targetUserRef = isShared ? db.collection("users").doc(userData.parentUid) : userRef;

              if (paymentMethod !== 'pix') {
                // For Credit/Debit, apply balance immediately and mark completed
                await targetUserRef.update({
                  balance: FieldValue.increment(parsedAmount),
                  lastRecharge: FieldValue.serverTimestamp(),
                  _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
                });

                await txnRef.set({
                  userId,
                  amount: parsedAmount,
                  type: "credit",
                  status: "completed",
                  description: `Recarga via ${paymentMethod === 'debit' ? 'Débito' : 'Crédito'} Rede`,
                  timestamp: FieldValue.serverTimestamp(),
                  redeTid: redeData.tid,
                  nsu: redeData.nsu,
                  _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
                });
                console.log(`[REDE-API] Saldo e transação (Cartão) atualizados: ${txnId}`);
              } else {
                // For Pix, create a PENDING transaction
                await txnRef.set({
                  userId,
                  amount: parsedAmount,
                  type: "credit",
                  status: "pending",
                  description: `Recarga via Pix Rede`,
                  timestamp: FieldValue.serverTimestamp(),
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
  // Production-grade verification with robust status detection
  app.get(`${API_BASE}/verify-pix/:tid`, async (req, res) => {
    const { tid } = req.params;
    console.log(`[REDE-API] Verificando TID/Referência: ${tid}`);
    
    // Prevent caching for verification endpoint
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Vary", "*");

    if (!db) return res.status(500).json({ error: "Banco de dados não disponível" });

    try {
      // 1. Fetch transaction metadata from Firestore
      const txnRef = db.collection("transactions").doc(tid);
      const txnDoc = await txnRef.get();
      
      if (!txnDoc.exists) {
        console.error(`[REDE-API] Transação ${tid} não encontrada no banco local.`);
        return res.status(404).json({ error: "Transação não encontrada", details: "ID inválido ou transação não iniciada." });
      }

      const txnData = txnDoc.data()!;
      
      // If already completed, return success immediately
      if (txnData.status === "completed") {
        return res.json({ 
          success: true, 
          status: "completed", 
          pago: true,
          message: "Pagamento já confirmado anteriormente." 
        });
      }

      // 2. Fetch credentials
      const livePV = (process.env.REDE_PV || process.env.RESGATE_PV || "").trim();
      const liveToken = (process.env.REDE_TOKEN || process.env.RESGATE_TOKEN || "").trim();
      const isSandbox = String(process.env.REDE_SANDBOX || "").toLowerCase() === 'true';

      // 3. Obtain OAuth Token
      const accessToken = await getRedeAccessToken(livePV, liveToken, isSandbox);

      const axiosConfig = { 
        headers: { 
          'Authorization': `Bearer ${accessToken}`,
          'User-Agent': 'FestaPass/1.0 (Integration; e-Rede; Production-Proxy)'
        },
        timeout: 10000 
      };

      // 4. Query Rede for transaction status (V2 API)
      // We look for both tid from route and internal redeTid stored in document
      const queryId = txnData.redeTid || tid;
      const redeUrl = isSandbox 
        ? `https://sandbox-erede.useredecloud.com.br/erede/v2/transactions/${queryId}` 
        : `https://api.userede.com.br/erede/v2/transactions/${queryId}`;
        
      console.log(`[REDE-API] Verificando no ambiente: ${isSandbox ? 'SANDBOX' : 'PRODUÇÃO'} | ID: ${queryId}`);
      const response = await axios.get(redeUrl, axiosConfig);
      const redeData = response.data;
      
      console.log(`[REDE-API] Resposta Recebida:`, JSON.stringify(redeData));

      // 5. Success Logic (Robust detection across multiple fields and cases)
      const successCodes = ["00", "0", "1", "000"]; // Added 1 and 000 as potential success codes
      const successStatuses = [
        "Approved", "Confirmed", "Captured", "Paid", "Success", "Authorized", 
        "captured", "approved", "paid", "confirmed", "success", "authorized",
        "CONFIRMADO", "APROVADO", "PAGO", "CAPTURADO", "SUCESSO", "AUTORIZADO",
        "Confirmed_Pix", "Paid_Pix", "Authenticated", "AUTHORIZED", "SUCCESS", "PAID",
        "CAPTURED", "CONFIRMED", "APPROVED_PIX", "PAID_PIX", "CONFIRMED_PIX",
        "CONCLUIDO", "TRANSACAO_CONCLUIDA", "LIQUIDADO"
      ];
      
      const authData = redeData.authorization || {};
      const rawStatus = String(redeData.status || authData.status || redeData.returnMessage || "").trim();
      const rawCode = String(redeData.returnCode || authData.returnCode || "").trim();
      
      console.log(`[REDE-API] Analisando Status: "${rawStatus}" | Code: "${rawCode}" | Nest: ${authData.status ? 'AuthObj' : 'Root'}`);

      // Detection Logic:
      // A) Code 00/0 and any success-related status
      const isStandardSuccess = successCodes.includes(rawCode) && 
                              (successStatuses.includes(rawStatus) || successStatuses.includes(rawStatus.toUpperCase()));
      
      // B) Known successful return code even if status is missing/generic (caution for Pix)
      const isCodeSuccess = successCodes.includes(rawCode) && (!rawStatus || rawStatus === "undefined" || rawStatus === "null" || rawStatus === "Processando");
      
      // C) Known successful status even if code is missing/generic
      const isStatusSuccess = rawStatus && (successStatuses.includes(rawStatus) || successStatuses.includes(rawStatus.toUpperCase()));

      const isApproved = isStandardSuccess || isCodeSuccess || isStatusSuccess;

      if (isApproved) {
        const { userId, amount } = txnData;
        console.log(`[REDE-API] PAGAMENTO APROVADO! User: ${userId} | Valor: ${amount} | Status: ${rawStatus} | Code: ${rawCode}`);
        
        try {
          // Verify if UID exists before proceeding (Safety Check)
          const userRef = db.collection("users").doc(userId);
          const userDoc = await userRef.get();
          
          if (!userDoc.exists) {
             console.error(`[REDE-API] ERRO CRÍTICO: Usuário ${userId} não existe no Firestore.`);
             return res.status(404).json({ success: false, error: "Usuário não encontrado no sistema local." });
          }

          await db.runTransaction(async (t) => {
            // Read transaction document inside transaction to avoid race conditions!
            const currentTxnDoc = await t.get(txnRef);
            if (!currentTxnDoc.exists) {
              throw new Error("Transação não encontrada no banco local dentro do bloco transacional.");
            }
            if (currentTxnDoc.data()?.status === "completed") {
              console.log("[REDE-API] Transação já concluída no banco de dados. Ignorando crédito duplicado.");
              return;
            }

            const uDoc = await t.get(userRef);
            if (uDoc.exists) {
              const userData = uDoc.data();
              const isShared = userData && (!userData.balanceType || userData.balanceType === 'shared') && userData.parentUid;
              const targetUserRef = isShared ? db.collection("users").doc(userData.parentUid) : userRef;
              
              const targetDoc = isShared ? await t.get(targetUserRef) : uDoc;
              const currentBalance = targetDoc.data()?.balance || 0;

              t.update(targetUserRef, { 
                balance: currentBalance + amount,
                lastRecharge: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
              });
              
              t.update(txnRef, { 
                status: "completed", 
                updatedAt: FieldValue.serverTimestamp(),
                redeData: redeData,
                _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
              });
            }
          });
          
          console.log(`[REDE-API] Sucesso: Saldo creditado e transação finalizada.`);
          return res.json({ 
            success: true, 
            status: "completed", 
            pago: true,
            message: "Pagamento confirmado and saldo creditado!",
            redeStatus: rawStatus,
            redeCode: rawCode
          });
        } catch (transErr: any) {
          console.error(`[REDE-API] ERRO NO FIRESTORE (runTransaction):`, transErr);
          return res.status(500).json({ 
            success: false, 
            error: "Erro ao processar transação no banco", 
            details: transErr.message,
            code: transErr.code
          });
        }
      }

      // 6. If not approved, return current pending state with Rede context
      console.log(`[REDE-API] Pagamento não confirmado na Rede ainda. Status Atual: ${rawStatus}`);
      return res.json({ 
        success: false, 
        pago: false,
        status: "pending", 
        redeStatus: rawStatus || "Pendente",
        redeCode: rawCode,
        sandbox: isSandbox,
        message: `O pagamento ainda consta como "${rawStatus || 'Processando'}" na Rede (Código: ${rawCode || '---'}). Verifique se o Pix foi realmente transferido.`
      });

    } catch (error: any) {
      const errorMsg = error.response?.data?.returnMessage || error.message;
      console.error(`[REDE-API] Falha crítica na verificação:`, error.response?.data || error.message);
      
      res.status(500).json({ 
        error: "Erro na verificação", 
        details: errorMsg,
        status: "error"
      });
    }
  });

  // Webhook
  app.post(`${API_BASE}/webhook`, async (req, res) => {
    try {
      const { transactionId, status } = req.body;
      if (!db) return res.status(500).json({ error: "DB error" });
      if (status === "approved") {
        const txnRef = db.collection("transactions").doc(transactionId);
        const txnDoc = await txnRef.get();
        if (txnDoc.exists) {
          const { userId, amount } = txnDoc.data()!;
          await db.runTransaction(async (t) => {
            const currentTxnDoc = await t.get(txnRef);
            if (!currentTxnDoc.exists || currentTxnDoc.data()?.status === "completed") {
              console.log("[REDE-API Webhook] Transação já concluída ou inexistente. Ignorando crédito.");
              return;
            }

            const userRef = db.collection("users").doc(userId);
            const userDoc = await t.get(userRef);
            if (userDoc.exists) {
              const userData = userDoc.data();
              const isShared = userData && (!userData.balanceType || userData.balanceType === 'shared') && userData.parentUid;
              const targetUserRef = isShared ? db.collection("users").doc(userData.parentUid) : userRef;
              
              const targetDoc = isShared ? await t.get(targetUserRef) : userDoc;
              const currentBalance = targetDoc.data()?.balance || 0;

              t.update(targetUserRef, { 
                balance: currentBalance + amount,
                _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
              });
              t.update(txnRef, { 
                status: "completed", 
                updatedAt: FieldValue.serverTimestamp(),
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

  // Admin Set User Balance Endpoint
  app.post(`${API_BASE}/admin/set-user-balance`, async (req, res) => {
    try {
      const { targetUserId, newBalance, requesterEmail } = req.body;
      
      // Safety/Security check: Only allow if the requester is the authorized admin email
      if (requesterEmail !== 'financeiro@modeloalpha.com.br' && requesterEmail !== 'admin@modeloalpha.com.br') {
        return res.status(403).json({ error: "Acesso Negado: Apenas o administrador financeiro pode realizar esta operação." });
      }

      if (!targetUserId || newBalance === undefined) {
        return res.status(400).json({ error: "targetUserId e newBalance são obrigatórios." });
      }

      if (!db) return res.status(500).json({ error: "Banco de dados não disponível" });

      const userRef = db.collection("users").doc(targetUserId);
      const userDoc = await userRef.get();

      if (!userDoc.exists) {
        return res.status(404).json({ error: "Usuário não encontrado." });
      }

      const userData = userDoc.data();

      console.log(`[ADMIN-SET] User ${userData.name} (UID: ${targetUserId}) current: R$ ${userData.balance}, setting to: R$ ${newBalance}`);

      await userRef.update({
        balance: parseFloat(newBalance),
        _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
      });

      return res.json({
        success: true,
        userName: userData.name,
        previousBalance: userData.balance,
        newBalance: parseFloat(newBalance)
      });

    } catch (error: any) {
      console.error("[ADMIN-SET] Erro:", error);
      return res.status(500).json({ error: "Erro interno", details: error.message });
    }
  });

  // Admin Manual Complete Transaction (Baixar) Endpoint
  app.post(`${API_BASE}/admin/complete-transaction`, async (req, res) => {
    try {
      const { txId, requesterEmail } = req.body;
      
      // Safety/Security check: Only allow if the requester is the authorized admin email
      if (requesterEmail !== 'financeiro@modeloalpha.com.br' && requesterEmail !== 'admin@modeloalpha.com.br') {
        return res.status(403).json({ error: "Acesso Negado: Apenas o administrador financeiro pode realizar esta operação." });
      }

      if (!txId) {
        return res.status(400).json({ error: "O campo txId é obrigatório." });
      }

      if (!db) return res.status(500).json({ error: "Banco de dados não disponível" });

      const txnRef = db.collection("transactions").doc(txId);
      const txnDoc = await txnRef.get();

      if (!txnDoc.exists) {
        return res.status(404).json({ error: "Transação não encontrada." });
      }

      const txnData = txnDoc.data()!;
      if (txnData.status === "completed") {
        return res.status(400).json({ error: "Esta transação já foi dada como concluída anteriormente." });
      }

      const { userId, amount } = txnData;
      const userRef = db.collection("users").doc(userId);
      const userDoc = await userRef.get();

      if (!userDoc.exists) {
        return res.status(404).json({ error: "Usuário/Cliente não encontrado." });
      }

      console.log(`[ADMIN-COMPLETE-TX] Baixando manualmente transação ${txId} para o usuário ${userId}. Valor: R$ ${amount}`);

      await db.runTransaction(async (t) => {
        const currentTxnDoc = await t.get(txnRef);
        if (!currentTxnDoc.exists) {
          throw new Error("Transação não encontrada no banco dentro do bloco transacional.");
        }
        if (currentTxnDoc.data()?.status === "completed") {
          return;
        }

        const uDoc = await t.get(userRef);
        if (uDoc.exists) {
          const userData = uDoc.data();
          const isShared = userData && (!userData.balanceType || userData.balanceType === 'shared') && userData.parentUid;
          const targetUserRef = isShared ? db.collection("users").doc(userData.parentUid) : userRef;
          
          const targetDoc = isShared ? await t.get(targetUserRef) : uDoc;
          const currentBalance = targetDoc.data()?.balance || 0;

          t.update(targetUserRef, { 
            balance: currentBalance + amount,
            lastRecharge: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
          });
          
          t.update(txnRef, { 
            status: "completed", 
            updatedAt: FieldValue.serverTimestamp(),
            _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
          });
        }
      });

      console.log(`[ADMIN-COMPLETE-TX] Sucesso ao baixar transação ${txId}.`);
      return res.json({ success: true, message: "Transação baixada e crédito adicionado com sucesso." });

    } catch (error: any) {
      console.error("[ADMIN-COMPLETE-TX] Erro:", error);
      return res.status(500).json({ error: "Erro interno ao processar transação", details: error.message });
    }
  });

  // Admin Trigger Reconciliation (Sincronizar com o Banco) Endpoint
  app.post(`${API_BASE}/admin/trigger-reconciliation`, async (req, res) => {
    try {
      const { requesterEmail } = req.body;
      
      // Safety/Security check: Only allow if the requester is the authorized admin email
      if (requesterEmail !== 'financeiro@modeloalpha.com.br' && requesterEmail !== 'admin@modeloalpha.com.br') {
        return res.status(403).json({ error: "Acesso Negado: Apenas o administrador financeiro pode realizar esta operação." });
      }

      if (!db) return res.status(500).json({ error: "Banco de dados não disponível" });

      console.log(`[ADMIN-TRIGGER-RECONCILE] Sincronização manual acionada por ${requesterEmail}`);
      const reconciledCount = await reconcilePendingTransactions();

      return res.json({ 
        success: true, 
        message: `Sincronização concluída! ${reconciledCount} transações pendentes foram conciliadas com o banco e processadas com sucesso.`,
        reconciledCount 
      });

    } catch (error: any) {
      console.error("[ADMIN-TRIGGER-RECONCILE] Erro:", error);
      return res.status(500).json({ error: "Erro interno na reconciliação", details: error.message });
    }
  });

  // Automatic Background Reconciliation Job for Pix
  async function reconcilePendingTransactions(): Promise<number> {
    if (!db) {
      console.log("[RECONCILIATION] DB não inicializado.");
      return 0;
    }
    let reconciledCount = 0;
    try {
      console.log("[RECONCILIATION] Executando varredura em segundo plano de Pix pendentes...");
      
      // Fetch up to 20 pending credit (recharge) transactions using Admin SDK query
      const snapshot = await db.collection("transactions")
        .where("status", "==", "pending")
        .where("type", "==", "credit")
        .limit(20)
        .get();
      
      if (snapshot.empty) {
        console.log("[RECONCILIATION] Nenhuma transação de recarga pendente encontrada.");
        return 0;
      }

      console.log(`[RECONCILIATION] Encontradas ${snapshot.size} transações pendentes para verificação.`);

      const livePV = (process.env.REDE_PV || process.env.RESGATE_PV || "").trim();
      const liveToken = (process.env.REDE_TOKEN || process.env.RESGATE_TOKEN || "").trim();
      const isSandbox = String(process.env.REDE_SANDBOX || "").toLowerCase() === 'true';

      if (!livePV || !liveToken) {
        console.log("[RECONCILIATION] Credenciais da Rede não estão totalmente configuradas. Pulando verificação.");
        return 0;
      }

      // Obtain OAuth Token
      const accessToken = await getRedeAccessToken(livePV, liveToken, isSandbox);
      const axiosConfig = { 
        headers: { 
          'Authorization': `Bearer ${accessToken}`,
          'User-Agent': 'FestaPass/1.0 (Integration; e-Rede; Production-Proxy)'
        },
        timeout: 10000 
      };

      const successCodes = ["00", "0", "1", "000"];
      const successStatuses = [
        "Approved", "Confirmed", "Captured", "Paid", "Success", "Authorized", 
        "captured", "approved", "paid", "confirmed", "success", "authorized",
        "CONFIRMADO", "APROVADO", "PAGO", "CAPTURADO", "SUCESSO", "AUTORIZADO",
        "Confirmed_Pix", "Paid_Pix", "Authenticated", "AUTHORIZED", "SUCCESS", "PAID",
        "CAPTURED", "CONFIRMED", "APPROVED_PIX", "PAID_PIX", "CONFIRMED_PIX",
        "CONCLUIDO", "TRANSACAO_CONCLUIDA", "LIQUIDADO"
      ];

      for (const txnDoc of snapshot.docs) {
        const tid = txnDoc.id;
        const txnData = txnDoc.data();
        
        // Skip check if the transaction is too old (e.g., more than 3 days old)
        const timestampVal = txnData.timestamp;
        let createdTime = Date.now();
        if (timestampVal) {
          if (typeof timestampVal.toDate === 'function') {
            createdTime = timestampVal.toDate().getTime();
          } else {
            createdTime = new Date(timestampVal).getTime();
          }
        }
        
        const ageInMs = Date.now() - createdTime;
        const maxAgeInMs = 3 * 24 * 60 * 60 * 1000; // 3 days
        if (ageInMs > maxAgeInMs) {
          console.log(`[RECONCILIATION] Transação ${tid} é antiga demais (${Math.round(ageInMs / 3600000)}h). Pulando reconciliação.`);
          continue;
        }

        const queryId = txnData.redeTid || tid;
        const isFirestoreId = typeof queryId === 'string' && queryId.length === 20 && /^[a-zA-Z0-9]+$/.test(queryId) && !/^\d+$/.test(queryId);
        
        if (!queryId || typeof queryId !== 'string' || queryId.trim() === '' || isFirestoreId) {
          console.log(`[RECONCILIATION] Transação ${tid} não possui um ID de transação Rede (redeTid) válido para consulta. Pulando.`);
          continue;
        }

        const redeUrl = isSandbox 
          ? `https://sandbox-erede.useredecloud.com.br/erede/v2/transactions/${queryId}` 
          : `https://api.userede.com.br/erede/v2/transactions/${queryId}`;

        console.log(`[RECONCILIATION] Consultando API Rede para transação ${tid} (queryId: ${queryId})...`);

        try {
          const response = await axios.get(redeUrl, axiosConfig);
          const redeData = response.data;
          
          const authData = redeData.authorization || {};
          const rawStatus = String(redeData.status || authData.status || redeData.returnMessage || "").trim();
          const rawCode = String(redeData.returnCode || authData.returnCode || "").trim();

          const isStandardSuccess = successCodes.includes(rawCode) && 
                                   (successStatuses.includes(rawStatus) || successStatuses.includes(rawStatus.toUpperCase()));
          const isCodeSuccess = successCodes.includes(rawCode) && (!rawStatus || rawStatus === "undefined" || rawStatus === "null" || rawStatus === "Processando");
          const isStatusSuccess = rawStatus && (successStatuses.includes(rawStatus) || successStatuses.includes(rawStatus.toUpperCase()));

          const isApproved = isStandardSuccess || isCodeSuccess || isStatusSuccess;

          if (isApproved) {
            const { userId, amount } = txnData;
            console.log(`[RECONCILIATION] PAGO DETECTADO! Creditando automaticamente txn ${tid} para o usuário ${userId} no valor de R$ ${amount}`);
            
            const userRef = db.collection("users").doc(userId);
            const userDocVal = await userRef.get();
            
            if (!userDocVal.exists) {
              console.log(`[RECONCILIATION] Usuário ${userId} não encontrado no Firestore.`);
              continue;
            }

            await db.runTransaction(async (t) => {
              const currentTxnDoc = await t.get(txnDoc.ref);
              if (!currentTxnDoc.exists || currentTxnDoc.data()?.status === "completed") {
                return;
              }

              const uDoc = await t.get(userRef);
              if (uDoc.exists) {
                const userData = uDoc.data();
                const isShared = userData && (!userData.balanceType || userData.balanceType === 'shared') && userData.parentUid;
                const targetUserRef = isShared ? db.collection("users").doc(userData.parentUid) : userRef;
                
                const targetDoc = isShared ? await t.get(targetUserRef) : uDoc;
                const currentBalance = targetDoc.data()?.balance || 0;

                t.update(targetUserRef, { 
                   balance: currentBalance + amount,
                   lastRecharge: FieldValue.serverTimestamp(),
                   updatedAt: FieldValue.serverTimestamp(),
                   _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
                });
                
                t.update(txnDoc.ref, { 
                  status: "completed", 
                  updatedAt: FieldValue.serverTimestamp(),
                  redeData: redeData,
                  _backendSecret: 'FESTA_PASS_SRV_2026_SECRET'
                });
              }
            });
            console.log(`[RECONCILIATION] Crédito automático realizado com sucesso para txn ${tid}.`);
            reconciledCount++;
          } else {
            console.log(`[RECONCILIATION] Transação ${tid} ainda consta como pendente na Rede (status: ${rawStatus}, código: ${rawCode}).`);
          }
        } catch (apiErr: any) {
          const status = apiErr.response?.status;
          if (status === 400 || status === 404) {
            console.log(`[RECONCILIATION] Transação ${tid} (queryId: ${queryId}) não foi encontrada na Rede ou está pendente (link de pagamento gerado, mas não pago). Status HTTP: ${status}`);
          } else {
            console.log(`[RECONCILIATION] Erro na API Rede ao verificar transação ${tid}: ${apiErr.message}`);
          }
        }
      }
    } catch (error: any) {
      console.error("[RECONCILIATION] Erro crítico no worker de segundo plano:", error);
    }
    return reconciledCount;
  }

  // Configura varredura automática a cada 2 minutos
  setInterval(reconcilePendingTransactions, 120000);
  
  // Executa uma varredura inicial 15 segundos após a inicialização do servidor
  setTimeout(reconcilePendingTransactions, 15000);

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

