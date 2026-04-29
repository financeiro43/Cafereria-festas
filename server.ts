import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import * as admin from "firebase-admin";
import fs from "fs";

async function startServer() {
  console.log("Starting server...");
  const app = express();
  const PORT = 3000;

  // Initialize Firebase Admin
  let db: admin.firestore.Firestore | null = null;
  try {
    const firebaseConfig = JSON.parse(fs.readFileSync("./firebase-applet-config.json", "utf-8"));
    if (!admin.apps.length) {
      admin.initializeApp({
        projectId: firebaseConfig.projectId,
      });
    }
    db = admin.firestore(firebaseConfig.firestoreDatabaseId);
    console.log("Firebase Admin initialized successfully");
  } catch (error) {
    console.error("Firebase Admin initialization failed:", error);
    // Continue without DB if needed, or handle accordingly
  }

  app.use(express.json());

  // --- Rede API Integration ---
  
  const REDE_PV = process.env.REDE_PV;
  const REDE_TOKEN = process.env.REDE_TOKEN;

  // Endpoint to create a payment link
  app.post("/api/rede/create-checkout", async (req, res) => {
    try {
      const { amount, userId, studentName } = req.body;

      if (!db) {
        return res.status(500).json({ error: "Database not available" });
      }

      if (!REDE_PV || !REDE_TOKEN) {
        // For simulation purposes, we allow it to proceed with a mock
        console.warn("Rede API not configured, using mock");
      }

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

