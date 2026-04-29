import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import * as admin from "firebase-admin";

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    // In this environment, Admin SDK uses the same project as the app
  });
}

const db = admin.firestore();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // --- Rede API Integration ---
  
  const REDE_PV = process.env.REDE_PV;
  const REDE_TOKEN = process.env.REDE_TOKEN;
  const REDE_BASE_URL = process.env.REDE_SANDBOX === "true" 
    ? "https://api.userede.com.br/redelabs/v1" 
    : "https://api.userede.com.br/ecommerce/v1";

  // Endpoint to create a payment link
  app.post("/api/rede/create-checkout", async (req, res) => {
    try {
      const { amount, userId, studentName } = req.body;

      if (!REDE_PV || !REDE_TOKEN) {
        return res.status(500).json({ error: "Rede API not configured" });
      }

      // Mocking Rede Link Creation for demo purposes if keys are missing
      // In a real scenario, we would call fetch(`${REDE_BASE_URL}/transactions`, ...)
      
      const transactionId = `txn_${Date.now()}`;
      
      // Store pending transaction
      await db.collection("transactions").doc(transactionId).set({
        userId,
        amount,
        type: "credit",
        status: "pending",
        description: `Recarga de saldo para ${studentName}`,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Returning a mock URL if real integration isn't possible without real creds
      // The user can replace this with actual Rede API calls
      res.json({
        checkoutUrl: `${process.env.APP_URL}/mock-payment?tid=${transactionId}&amt=${amount}&uid=${userId}`,
        transactionId
      });
    } catch (error) {
      console.error("Rede Payment Error:", error);
      res.status(500).json({ error: "Failed to create payment" });
    }
  });

  // Mock Payment Webhook (Simulation)
  app.post("/api/rede/webhook", async (req, res) => {
    try {
      const { transactionId, status } = req.body;

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
              t.update(txnRef, { status: "completed", updatedAt: admin.firestore.FieldValue.serverTimestamp() });
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
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
