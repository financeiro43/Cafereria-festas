import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { initializeApp, getApps, App } from "firebase-admin/app";
import { getFirestore, Firestore, FieldValue } from "firebase-admin/firestore";
import fs from "fs";
import dotenv from "dotenv";

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

  app.use(express.json());

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", dbInitialized: !!db });
  });

  // --- Rede API Integration ---
  
  const REDE_PV = process.env.REDE_PV;
  const REDE_TOKEN = process.env.REDE_TOKEN;

  // Endpoint to create a payment link
  app.post("/api/rede/create-checkout", async (req, res) => {
    console.log("Create checkout request received:", req.body);
    try {
      const { amount, userId, studentName } = req.body;
      
      if (!amount || !userId) {
        return res.status(400).json({ error: "Missing required fields: amount or userId" });
      }

      const transactionId = `txn_${Date.now()}`;
      const isRealEnvironment = !!(REDE_PV && REDE_TOKEN);
      
      console.log(`Processing recharge: amount=${amount}, userId=${userId}, studentName=${studentName}`);

      // Attempt to save to Firestore if available
      if (db) {
        try {
          const docRef = db.collection("transactions").doc(transactionId);
          await docRef.set({
            userId,
            amount: parseFloat(amount),
            type: "credit",
            status: "pending",
            description: `Recarga de saldo para ${studentName || 'Estudante'}`,
            timestamp: FieldValue.serverTimestamp(),
          });
          console.log("Firestore write success:", transactionId);
        } catch (writeError: any) {
          console.error("Firestore WRITE FAILED:", writeError.message);
          // If Firestore fails here, the client-side MockPayment can manually recover it
        }
      } else {
        console.warn("Firestore 'db' is null. Checkout will rely on client-side recovery.");
      }

      // Simulation URL
      const checkoutUrl = `/mock-payment?tid=${transactionId}&amt=${amount}&uid=${userId}${isRealEnvironment ? '&real=true' : ''}`;
      
      res.json({
        checkoutUrl,
        transactionId,
        isReal: isRealEnvironment
      });
    } catch (error: any) {
      console.error("Unexpected error in create-checkout route:", error);
      res.status(500).json({ 
        error: "Internal Server Error", 
        message: error?.message || "Unknown error"
      });
    }
  });

  // Mock Payment Webhook (Simulation)
  app.post("/api/rede/webhook", async (req, res) => {
    try {
      const { transactionId, status } = req.body;
      if (!db) return res.status(500).json({ error: "Database not available" });

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
      
      res.json({ success: false, message: "Transaction not found or already processed" });
    } catch (error) {
      console.error("Webhook Error:", error);
      res.status(500).json({ error: "Webhook processing failed" });
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

