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

  // Global Debug Logger - Capture EVERYTHING and log to stdout
  app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[REQ] ${timestamp} | ${req.method} | ${req.url}`);
    next();
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", dbInitialized: !!db });
  });

  // --- Rede API Integration ---
  const API_BASE = "/api/rede";

  // Endpoint to create a checkout session
  app.post(`${API_BASE}/create-checkout`, async (req, res) => {
    console.log(`[REDE-API] POST /create-checkout`);
    try {
      const { amount, userId } = req.body;
      if (!amount || !userId) {
        return res.status(400).json({ error: "Missing amount or userId" });
      }

      const transactionId = `txn_${Date.now()}`;
      const isReal = !!(process.env.REDE_PV && process.env.REDE_TOKEN);
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
    const REDE_PV = process.env.REDE_PV;
    const REDE_TOKEN = process.env.REDE_TOKEN;

    try {
      const { cardData, amount, transactionId, userId } = req.body;
      if (!userId || !amount || !cardData) {
          return res.status(400).json({ error: "Missing transaction data" });
      }

      if (!REDE_PV || !REDE_TOKEN) {
        return res.status(400).json({ error: "Rede credentials not configured" });
      }

      const redeAmount = Math.round(parseFloat(amount) * 100);
      const redePayload = {
        capture: true,
        kind: "credit",
        reference: transactionId,
        amount: redeAmount,
        cardholderName: cardData.name,
        cardNumber: cardData.number.replace(/\s/g, ""),
        expirationMonth: cardData.expiry.split("/")[0],
        expirationYear: "20" + cardData.expiry.split("/")[1],
        securityCode: cardData.cvv,
        softDescriptor: "REC ESCOLA"
      };

      const axiosConfig = { auth: { username: REDE_PV, password: REDE_TOKEN } };
      const isSandbox = process.env.REDE_SANDBOX !== 'false';
      const redeUrl = isSandbox ? "https://sandbox-erede.useredecloud.com.br/v1/transactions" : "https://api.userede.com.br/v1/transactions";

      const response = await axios.post(redeUrl, redePayload, axiosConfig);

      if (response.data.returnCode === "00") {
        if (db) {
          const userRef = db.collection("users").doc(userId);
          const txnRef = db.collection("transactions").doc(transactionId);
          await db.runTransaction(async (t) => {
            const userDoc = await t.get(userRef);
            const currentBalance = userDoc.data()?.balance || 0;
            t.update(userRef, { balance: currentBalance + parseFloat(amount) });
            t.set(txnRef, {
              userId,
              amount: parseFloat(amount),
              type: "credit",
              status: "completed",
              description: "Recarga Real via Rede",
              timestamp: FieldValue.serverTimestamp(),
              redeTid: response.data.tid
            });
          });
        }
        return res.json({ success: true, tid: response.data.tid });
      } else {
        return res.status(400).json({ error: "Pagamento negado", message: response.data.returnMessage });
      }
    } catch (error: any) {
      console.error(`[REDE-API] Error: ${error.response?.data || error.message}`);
      res.status(500).json({ error: "Erro no Gateway Rede", message: error.response?.data?.returnMessage || error.message });
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

