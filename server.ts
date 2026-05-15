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

  // Startup Diagnostics for Secrets
  console.log(`[DIAGNOSTICS] REDE_PV: ${process.env.REDE_PV ? 'PRESENT' : 'MISSING'}`);
  console.log(`[DIAGNOSTICS] REDE_TOKEN: ${process.env.REDE_TOKEN ? 'PRESENT' : 'MISSING'}`);
  console.log(`[DIAGNOSTICS] RESGATE_PV: ${process.env.RESGATE_PV ? 'PRESENT' : 'MISSING'}`);
  console.log(`[DIAGNOSTICS] REDE_SANDBOX: ${process.env.REDE_SANDBOX}`);

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
        const settingsSnap = await db.collection("settings").doc("config").get();
        if (settingsSnap.exists) {
          const config = settingsSnap.data();
          if (config?.redePV && config?.redeToken) isReal = true;
        }
      }

      const checkoutUrl = `/mock-payment?tid=${transactionId}&amt=${amount}&uid=${userId}${isReal ? '&real=true' : ''}`;
      
      res.json({ checkoutUrl, transactionId, isReal });
    } catch (error: any) {
      console.error(`[REDE-API] Error: ${error.message}`);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  // Real Rede Payment Processing
  app.post(`${API_BASE}/process-payment`, async (req, res) => {
    console.log(`[REDE-API] POST /process-payment`);

    try {
      const { cardData, amount, transactionId, userId, paymentMethod, customer } = req.body;
      console.log(`[REDE-API] Data: uid=${userId}, amt=${amount}, tid=${transactionId}, method=${paymentMethod}`);
      
      const parsedAmount = parseFloat(amount);
      if (!userId || isNaN(parsedAmount) || (!cardData && paymentMethod !== 'pix')) {
          console.error(`[REDE-API] Validation failed: uid=${userId}, parsedAmt=${parsedAmount}, hasCardData=${!!cardData}`);
          return res.status(400).json({ error: "Dados da transação inválidos ou incompletos" });
      }

      // Fetch dynamic settings from DB
      let livePV = (process.env.REDE_PV || process.env.RESGATE_PV || "").trim();
      let liveToken = (process.env.REDE_TOKEN || process.env.RESGATE_TOKEN || "").trim();
      let forceSandbox = process.env.REDE_SANDBOX !== 'false';

      const pvSource = process.env.REDE_PV ? 'REDE_PV' : (process.env.RESGATE_PV ? 'RESGATE_PV' : 'NONE');

      if (db) {
        try {
          const settingsSnap = await db.collection("settings").doc("config").get();
          if (settingsSnap.exists) {
            const config = settingsSnap.data();
            if (config?.redePV) livePV = String(config.redePV).trim();
            if (config?.redeToken) liveToken = String(config.redeToken).trim();
            if (config?.isProduction !== undefined) forceSandbox = !config.isProduction;
          }
        } catch (dbErr) {
          console.warn("[REDE-API] Failed to fetch settings from Firestore:", dbErr);
        }
      }

      console.log(`[REDE-API] Config: PV=${livePV ? livePV.substring(0, 4) + '****' : 'MISSING'} (Source: ${pvSource}), Token=${liveToken ? 'EXISTS' : 'MISSING'}, Sandbox=${forceSandbox}`);

      if (!pv || !token) {
        console.error(`[REDE-API] Configuration missing: REDE_PV or REDE_TOKEN is not set.`);
        return res.status(401).json({ 
          success: false,
          error: "Credenciais ausentes", 
          message: "Credenciais REDE_PV ou REDE_TOKEN não configuradas." 
        });
      }

      const redeAmount = Math.round(parsedAmount * 100);
      const secureRef = String(transactionId || `R${Date.now()}`).replace(/[^a-zA-Z0-9]/g, "").substring(0, 16);
      
      const authBase64 = Buffer.from(`${pv}:${token}`).toString('base64');
      const axiosConfig = { 
        headers: { 
          'Authorization': `Basic ${authBase64}`,
          'Content-Type': 'application/json' 
        } 
      };

      const redeUrl = forceSandbox ? "https://sandbox-erede.useredecloud.com.br/v1/transactions" : "https://api.userede.com.br/v1/transactions";
      
      let redePayload: any = {
        amount: redeAmount,
        reference: secureRef,
        softDescriptor: "RECESCOLA"
      };

      if (customer) {
        redePayload.customer = {
          name: String(customer.name || "Luis Carlos Tosto").substring(0, 50),
          documentNumber: String(customer.cnpj || customer.cpf || "04214446000170").replace(/\D/g, ""),
          documentType: customer.cnpj ? 'CNPJ' : 'CPF',
          email: customer.email || "admin@modeloalpha.com.br"
        };
      }

      if (paymentMethod === 'pix') {
        redePayload.kind = "pix";
      } else {
        const expiryStr = String(cardData?.expiry || "/");
        const [month, year] = expiryStr.split("/");
        
        if (!month || !year) {
          throw new Error("Data de validade do cartão inválida");
        }

        const sanitizedName = String(cardData.name || "")
          .toUpperCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^A-Z0-9 ]/g, "")
          .substring(0, 30);

        redePayload = {
          ...redePayload,
          capture: true,
          kind: paymentMethod === 'debit' ? "debit" : "credit",
          cardholderName: sanitizedName,
          cardNumber: String(cardData.number || "").replace(/\s/g, ""),
          expirationMonth: month.padStart(2, '0'),
          expirationYear: "20" + year.trim(),
          securityCode: String(cardData.securityCode || cardData.cvv || "").trim(),
        };

        if (paymentMethod === 'debit') {
          redePayload.threeDSecure = {
            embedded: true,
            onFailure: "continue"
          };
        }
      }

      // Log payload keys (safe debugging)
      console.log(`[REDE-API] Payload for ${paymentMethod}:`, Object.keys(redePayload));
      
      let response;
      try {
        response = await axios.post(redeUrl, redePayload, {
          ...axiosConfig,
          timeout: 20000 
        });
      } catch (axiosError: any) {
        const status = axiosError.response?.status;
        const data = axiosError.response?.data;
        console.error(`[REDE-API] Rede Call Failed (${status}):`, JSON.stringify(data || axiosError.message));
        
        // Rethrow with better context
        const customError: any = new Error(axiosError.message);
        customError.response = axiosError.response;
        customError.code = axiosError.code;
        throw customError;
      }
      
      const redeData = response?.data || {};
      console.log(`[REDE-API] Success Response: ${redeData.returnCode} - ${redeData.returnMessage}`);
      
      if (redeData.returnCode === "00") {
        if (paymentMethod !== 'pix' && db) {
          const userRef = db.collection("users").doc(userId);
          const txnRef = db.collection("transactions").doc(transactionId);
          
          console.log(`[REDE-API] Starting balance update transaction for ${userId} (Amount: ${amount})`);
          
          // Use a Promise.race to ensure transaction doesn't hang indefinitely in the backend
          const transactionPromise = db.runTransaction(async (t) => {
            console.log(`[REDE-API] Inside runTransaction for ${userId}`);
            const userDoc = await t.get(userRef);
            if (!userDoc.exists) throw new Error("Usuário não encontrado no banco de dados");
            
            const currentBalance = userDoc.data()?.balance || 0;
            const newBalance = currentBalance + parseFloat(amount);
            
            console.log(`[REDE-API] Updating balance from ${currentBalance} to ${newBalance}`);
            
            t.update(userRef, { 
              balance: newBalance,
              updatedAt: FieldValue.serverTimestamp()
            });
            
            t.set(txnRef, {
              userId,
              amount: parseFloat(amount),
              type: "credit",
              status: "completed",
              description: `Recarga ${paymentMethod === 'debit' ? 'Débito' : 'Crédito'} via Rede`,
              timestamp: FieldValue.serverTimestamp(),
              redeTid: redeData.tid,
              nsu: redeData.nsu
            });
            return { newBalance };
          });

          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Firestore Transaction Timeout")), 15000)
          );

          try {
            await Promise.race([transactionPromise, timeoutPromise]);
            console.log(`[REDE-API] Balance update successful for ${userId}`);
          } catch (txError: any) {
            console.error(`[REDE-API] Transaction error for ${userId}: ${txError.message}`);
            // We return 500 but note that payment was approved
            return res.status(500).json({
              success: false,
              error: "Erro ao creditar saldo",
              message: "Pagamento APROVADO, mas houve um erro ao atualizar seu saldo. Guarde seu comprovante (TID: " + redeData.tid + ") e contate o suporte.",
              tid: redeData.tid
            });
          }
        } else if (paymentMethod === 'pix' && db) {
          // For Pix, we save it as pending
          await db.collection("transactions").doc(transactionId).set({
            userId,
            amount: parseFloat(amount),
            type: "credit",
            status: "pending",
            description: "Recarga Pix via Rede",
            timestamp: FieldValue.serverTimestamp(),
            redeTid: redeData.tid
          });
        }
        
        return res.json({ 
          success: true, 
          tid: redeData.tid,
          pix: redeData.pix
        });
      } else {
        return res.status(400).json({ 
          success: false,
          error: "Pagamento negado", 
          message: redeData.returnMessage || "A operadora não autorizou esta transação." 
        });
      }
    } catch (error: any) {
      const respData = error.response?.data;
      let errorMsg = error.message;
      
      if (respData) {
        if (Array.isArray(respData)) {
          errorMsg = respData[0]?.message || respData[0]?.returnMessage || JSON.stringify(respData[0]);
        } else if (typeof respData === 'object') {
          errorMsg = respData.message || respData.returnMessage || respData.error || JSON.stringify(respData);
        } else {
          errorMsg = String(respData);
        }
      }
      
      if (typeof errorMsg !== 'string') errorMsg = JSON.stringify(errorMsg);
      
      console.error(`[REDE-API] Error Detail:`, JSON.stringify(respData || error.message));
      res.status(error.response?.status || 500).json({ 
        error: "Erro no Gateway Rede", 
        message: errorMsg,
        details: respData
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
      let livePV = process.env.REDE_PV || process.env.RESGATE_PV;
      let liveToken = process.env.REDE_TOKEN || process.env.RESGATE_TOKEN;
      let forceSandbox = process.env.REDE_SANDBOX !== 'false';

      const settingsSnap = await db.collection("settings").doc("config").get();
      if (settingsSnap.exists) {
        const config = settingsSnap.data();
        if (config?.redePV) livePV = config.redePV;
        if (config?.redeToken) liveToken = config.redeToken;
        if (config?.isProduction !== undefined) forceSandbox = !config.isProduction;
      }

      const authBase64 = Buffer.from(`${livePV}:${liveToken}`).toString('base64');
      const axiosConfig = { 
        headers: { 'Authorization': `Basic ${authBase64}` } 
      };

      // 3. Query Rede for transaction status
      const redeUrl = forceSandbox 
        ? `https://sandbox-erede.useredecloud.com.br/v1/transactions/${txnData.redeTid || tid}` 
        : `https://api.userede.com.br/v1/transactions/${txnData.redeTid || tid}`;
        
      console.log(`[REDE-API] Querying Rede status: ${redeUrl}`);
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

  // Diagnostic GET route
  app.get(`${API_BASE}/ping`, (req, res) => {
    res.send("PONG - Rede API is up");
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

