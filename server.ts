/**
 * Rede API Integration - Environment Sync Ver: 1.0.4
 */
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import { initializeApp, getApps, App } from "firebase-admin/app";
import { getFirestore, Firestore, FieldValue } from "firebase-admin/firestore";
import fs from "fs";
import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

async function startServer() {
  console.log("Starting server...");
  const app = express();
  const PORT = 3000;

  // Initialize Firebase Admin
  let db: Firestore | null = null;
  try {
    const configPath = path.resolve(process.cwd(), "firebase-applet-config.json");
    const apps = getApps();
    
    let firebaseApp: App;
    if (apps.length === 0) {
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        firebaseApp = initializeApp({ projectId: config.projectId });
      } else {
        firebaseApp = initializeApp();
      }
    } else {
      firebaseApp = apps[0];
    }

    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      if (config.firestoreDatabaseId) {
        try {
          db = getFirestore(firebaseApp, config.firestoreDatabaseId);
        } catch (fError: any) {
          db = getFirestore(firebaseApp);
        }
      } else {
        db = getFirestore(firebaseApp);
      }
    } else {
      db = getFirestore(firebaseApp);
    }
  } catch (error: any) {
    console.error("Firebase Admin initialization failed:", error?.message);
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
    const cacheKey = `${pv}-${isSandbox}`;
    if (redeTokenCache[cacheKey] && Date.now() < redeTokenCache[cacheKey].expires) {
      return redeTokenCache[cacheKey].token;
    }

    const tokenUrl = isSandbox 
      ? "https://rl7-sandbox-api.useredecloud.com.br/oauth2/token"
      : "https://api.userede.com.br/redelabs/oauth2/token";
    
    console.log(`[REDE-API] Solicitando Novo Token OAuth: ${isSandbox ? 'SANDBOX' : 'PRODUÇÃO'} para PV ${pv.substring(0,4)}`);
    const authBase64 = Buffer.from(`${pv.trim()}:${token.trim()}`).toString('base64');
    
    try {
      const tokenResp = await axios.post(tokenUrl, "grant_type=client_credentials", {
        headers: {
          'Authorization': `Basic ${authBase64}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 15000
      });
      
      const accessToken = tokenResp.data.access_token;
      // Expire in 20 minutes (manual says 24m)
      redeTokenCache[cacheKey] = { token: accessToken, expires: Date.now() + 20 * 60 * 1000 };
      return accessToken;
    } catch (tokenErr: any) {
      console.error(`[REDE-API] Erro OAuth PV=${pv}:`, tokenErr.response?.data || tokenErr.message);
      throw new Error(`Falha Rede (OAuth): ${tokenErr.response?.data?.message || tokenErr.message}`);
    }
  };

  // Diagnostic GET route
  app.get(`${API_BASE}/ping`, async (req, res) => {
    let pv = (process.env.REDE_PV || process.env.RESGATE_PV || "").trim();
    let token = (process.env.REDE_TOKEN || process.env.RESGATE_TOKEN || "").trim();
    let isSandbox = process.env.REDE_SANDBOX !== 'false';

    if (db) {
       const settings = await db.collection("settings").doc("config").get();
       if (settings.exists) {
         const d = settings.data();
         if (d?.redePV) pv = String(d.redePV).trim();
         if (d?.redeToken) token = String(d.redeToken).trim();
         if (d?.isProduction !== undefined) isSandbox = !d.isProduction;
       }
    }

    try {
      if (!pv || !token) throw new Error("Credenciais ausentes");
      await getRedeAccessToken(pv, token, isSandbox);
      res.json({ status: "connected", sandbox: isSandbox, pv: pv.substring(0, 4) + '****' });
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
      
      let isReal = !!((process.env.REDE_PV || process.env.RESGATE_PV) && (process.env.REDE_TOKEN || process.env.RESGATE_TOKEN));
      if (db && !isReal) {
        try {
          const settingsSnap = await db.collection("settings").doc("config").get();
          if (settingsSnap.exists) {
            const config = settingsSnap.data();
            if ((config?.redePV || config?.REDE_PV) && (config?.redeToken || config?.REDE_TOKEN)) isReal = true;
          }
        } catch (e) {
          console.warn("[REDE-API] Checkout diagnostic settings fetch failed:", e);
        }
      }

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

      let livePV = (process.env.REDE_PV || process.env.RESGATE_PV || "").trim();
      let liveToken = (process.env.REDE_TOKEN || process.env.RESGATE_TOKEN || "").trim();
      let forceSandbox = process.env.REDE_SANDBOX !== 'false';

      if (db) {
        try {
          const settingsSnap = await db.collection("settings").doc("config").get();
          if (settingsSnap.exists) {
            const config = settingsSnap.data();
            if (config?.redePV || config?.REDE_PV) livePV = String(config.redePV || config.REDE_PV).trim();
            if (config?.redeToken || config?.REDE_TOKEN) liveToken = String(config.redeToken || config.REDE_TOKEN).trim();
            if (config?.isProduction !== undefined) forceSandbox = !config.isProduction;
            if (config?.REDE_SANDBOX !== undefined) forceSandbox = config.REDE_SANDBOX !== 'false' && config.REDE_SANDBOX !== false;
          }
        } catch (dbErr: any) {
          console.warn(`[REDE-API] Falha ao ler config do DB: ${dbErr.message}`);
        }
      }

      let accessToken;
      try {
        accessToken = await getRedeAccessToken(livePV, liveToken, forceSandbox);
      } catch (e: any) {
        return res.status(401).json({ error: "Erro de Autenticação", message: e.message });
      }

      const redeAmount = Math.round(parsedAmount * 100);
      const secureRef = String(transactionId || `R${Date.now()}`).replace(/[^a-zA-Z0-9]/g, "").substring(0, 16);
      
      const axiosConfig = { 
        headers: { 
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json' 
        },
        timeout: 25000
      };

      const redeUrl = forceSandbox 
        ? "https://sandbox-erede.useredecloud.com.br/v2/transactions" 
        : "https://api.userede.com.br/erede/v2/transactions";
      
      let redePayload: any = {
        amount: redeAmount,
        reference: secureRef,
        softDescriptor: "FESTAPASS"
      };

      if (customer) {
        redePayload.customer = {
          name: String(customer.name || "CLIENTE").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z ]/g, "").substring(0, 50),
          documentNumber: String(customer.cnpj || customer.cpf || "04214446000170").replace(/\D/g, ""),
          documentType: (customer.cnpj || (customer.documentType === 'CNPJ')) ? 'CNPJ' : 'CPF',
          email: customer.email || "admin@modeloalpha.com.br"
        };
      }

      if (paymentMethod === 'pix') {
        redePayload.kind = "pix";
      } else {
        const [month, year] = String(cardData?.expiry || "/").split("/");
        if (!month || !year) throw new Error("Data de expiração inválida");

        redePayload = {
          ...redePayload,
          capture: true,
          kind: paymentMethod === 'debit' ? "debit" : "credit",
          cardholderName: String(cardData.holder || cardData.name || "CLIENTE").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z ]/g, "").toUpperCase().substring(0, 30),
          cardNumber: String(cardData.number || "").replace(/\s/g, ""),
          expirationMonth: month.padStart(2, '0'),
          expirationYear: year.length === 2 ? `20${year}` : year,
          securityCode: String(cardData.cvv || cardData.securityCode || "").trim(),
          installments: 1
        };

        if (paymentMethod === 'debit') {
          redePayload.threeDSecure = { 
            embedded: true, 
            onFailure: "decline", // Manual 1.32 pg 41: Auto-decline for debit if auth fails
            userAgent: req.headers['user-agent'] || "Mozilla/5.0",
            ipAddress: req.ip || "127.0.0.1"
          };
        }
      }

      // Safe Logging
      const maskedPayload = { 
        ...redePayload, 
        cardNumber: redePayload.cardNumber ? redePayload.cardNumber.substring(0, 6) + '******' + redePayload.cardNumber.slice(-4) : undefined,
        securityCode: redePayload.securityCode ? '***' : undefined
      };
      console.log(`[REDE-API] Chamando: ${redeUrl}`);
      console.log(`[REDE-API] Payload:`, JSON.stringify(maskedPayload));
      
      let response;
      try {
        response = await axios.post(redeUrl, redePayload, axiosConfig);
      } catch (axiosError: any) {
        const status = axiosError.response?.status || 500;
        const respData = axiosError.response?.data;
        console.error(`[REDE-API] Erro Rede HTTP ${status}:`, JSON.stringify(respData || axiosError.message));
        
        let msg = axiosError.message;
        if (respData) {
          msg = respData.returnMessage || respData.message || (Array.isArray(respData.errors) ? respData.errors[0]?.message : (respData.error || null)) || JSON.stringify(respData);
        }

        return res.status(status).json({
          error: "Erro na Operadora",
          message: msg,
          details: respData,
          debug: {
            url: redeUrl,
            pv: livePV.substring(0, 4) + '****',
            sandbox: forceSandbox
          }
        });
      }
      
      const redeData = response.data;
      console.log(`[REDE-API] Resposta Rede: ${redeData.returnCode} - ${redeData.returnMessage}`);

      if (redeData.returnCode === "00") {
        if (paymentMethod !== 'pix' && db) {
          try {
            const userRef = db.collection("users").doc(userId);
            const userDoc = await userRef.get();
            if (userDoc.exists) {
              await userRef.update({
                balance: FieldValue.increment(parsedAmount),
                lastRecharge: FieldValue.serverTimestamp()
              });

              await db.collection("transactions").add({
                userId,
                amount: parsedAmount,
                type: "credit",
                status: "completed",
                description: `Recarga via ${paymentMethod === 'debit' ? 'Débito' : 'Crédito'} Rede`,
                timestamp: FieldValue.serverTimestamp(),
                redeTid: redeData.tid,
                nsu: redeData.nsu
              });
              console.log(`[REDE-API] Saldo e transação atualizados para ${userId}`);
            }
          } catch (dbErr: any) {
            console.error(`[REDE-API] Erro ao salvar saldo pós-aprovado: ${dbErr.message}`);
          }
        }
        
        const responseData: any = { success: true, tid: redeData.tid };
        if (paymentMethod === 'pix') {
          responseData.pix = {
            qrCode: redeData.qrCodeResponse?.qrCodeData || redeData.pix?.qrCode || redeData.pix?.qrcode,
            expiration: redeData.qrCodeResponse?.dateTimeExpiration
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
    
    if (!db) return res.status(500).json({ error: "Banco de dados não inicializado" });

    try {
      // 1. Fetch transaction from our DB
      const txnRef = db.collection("transactions").doc(tid);
      const txnDoc = await txnRef.get();
      
      if (!txnDoc.exists) {
        return res.status(404).json({ error: "Transação não encontrada" });
      }

      const txnData = txnDoc.data()!;
      if (txnData.status === "completed") {
        return res.json({ success: true, status: "completed", message: "Pagamento já processado" });
      }

      // 2. Fetch credentials
      let livePV = (process.env.REDE_PV || process.env.RESGATE_PV || "").trim();
      let liveToken = (process.env.REDE_TOKEN || process.env.RESGATE_TOKEN || "").trim();
      let forceSandbox = process.env.REDE_SANDBOX !== 'false';

      const settingsSnap = await db.collection("settings").doc("config").get();
      if (settingsSnap.exists) {
        const config = settingsSnap.data();
        if (config?.redePV || config?.REDE_PV) livePV = String(config.redePV || config.REDE_PV).trim();
        if (config?.redeToken || config?.REDE_TOKEN) liveToken = String(config.redeToken || config.REDE_TOKEN).trim();
        if (config?.isProduction !== undefined) forceSandbox = !config.isProduction;
      }

      // 3. Obtain OAuth Token for Query
      const tokenUrl = forceSandbox 
        ? "https://rl7-sandbox-api.useredecloud.com.br/oauth2/token"
        : "https://api.userede.com.br/redelabs/oauth2/token";
      
      const authBase64 = Buffer.from(`${livePV}:${liveToken}`).toString('base64');
      const tokenResp = await axios.post(tokenUrl, "grant_type=client_credentials", {
        headers: {
          'Authorization': `Basic ${authBase64}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 10000
      });
      const accessToken = tokenResp.data.access_token;

      const axiosConfig = { 
        headers: { 'Authorization': `Bearer ${accessToken}` } 
      };

      // 4. Query Rede for transaction status (V2)
      const redeUrl = forceSandbox 
        ? `https://sandbox-erede.useredecloud.com.br/v2/transactions/${txnData.redeTid || tid}` 
        : `https://api.userede.com.br/erede/v2/transactions/${txnData.redeTid || tid}`;
        
      console.log(`[REDE-API] Querying Rede status V2: ${redeUrl}`);
      const response = await axios.get(redeUrl, axiosConfig);
      const redeData = response.data;
      
      console.log(`[REDE-API] Rede Status for ${tid}: ${redeData.returnCode} - ${redeData.returnMessage}`);

      // 4. Update balance if approved
      if (redeData.returnCode === "00" && (redeData.status === "Approved" || redeData.status === "Confirmed" || redeData.status === "Captured")) {
        const { userId, amount } = txnData;
        
        await db.runTransaction(async (t) => {
          const userRef = db.collection("users").doc(userId);
          const userDoc = await t.get(userRef);
          if (userDoc.exists) {
            const currentBalance = userDoc.data()?.balance || 0;
            t.update(userRef, { 
              balance: currentBalance + amount,
              updatedAt: FieldValue.serverTimestamp()
            });
            t.update(txnRef, { 
              status: "completed", 
              updatedAt: FieldValue.serverTimestamp(),
              redeData: redeData 
            });
          }
        });
        
        return res.json({ success: true, status: "completed", message: "Pagamento confirmado e saldo creditado!" });
      }

      return res.json({ 
        success: false, 
        status: txnData.status, 
        redeStatus: redeData.status,
        message: "O pagamento ainda não foi confirmado pela operadora."
      });
    } catch (error: any) {
      console.error(`[REDE-API] Verify error: ${error.message}`);
      res.status(500).json({ error: "Erro ao verificar status", details: error.message });
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
        if (txnDoc.exists && txnDoc.data()?.status === "pending") {
          const { userId, amount } = txnDoc.data()!;
          await db.runTransaction(async (t) => {
            const userRef = db.collection("users").doc(userId);
            const userDoc = await t.get(userRef);
            if (userDoc.exists) {
              const currentBalance = userDoc.data()?.balance || 0;
              t.update(userRef, { balance: currentBalance + amount });
              t.update(txnRef, { status: "completed", updatedAt: FieldValue.serverTimestamp() });
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

  // --- Vite / Static Assets ---

  if (process.env.NODE_ENV !== "production") {
    console.log("Loading Vite middleware...");
    try {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
      console.log("Vite middleware loaded");
    } catch (vError) {
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

