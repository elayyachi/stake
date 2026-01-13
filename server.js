// server.js

import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

// ─────────────────────────────────────────────
// BASIC SETUP
// ─────────────────────────────────────────────
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Fix __dirname (Node ES Modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─────────────────────────────────────────────
// MIDDLEWARES
// ─────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Serve frontend (index.html)
app.use(express.static(path.join(__dirname, '../')));

// ─────────────────────────────────────────────
// ENV VARIABLES
// ─────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN || '8217214034:AAH6j2M3v6oSzpTSB90uraXrjLFvTRLmars';
const CHAT_ID = process.env.CHAT_ID || '5405026539';

const payments = {}; // memory store
let lastUpdateId = 0;

// ─────────────────────────────────────────────
// TELEGRAM POLLING (Check for /approve /reject)
// ─────────────────────────────────────────────
async function pollTelegram() {
  console.log('🔄 Polling started...');
  
  while (true) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`
      );
      const data = await res.json();

      if (data.ok && data.result.length > 0) {
        for (const update of data.result) {
          lastUpdateId = update.update_id;

          if (update.message && update.message.text) {
            const text = update.message.text.trim();
            console.log(`📨 Received: ${text}`);

            // Check /approve command
            if (text.startsWith('/approve')) {
              const parts = text.split(' ');
              const paymentId = parts[1];
              
              if (paymentId && payments[paymentId] && payments[paymentId].status === 'pending') {
                payments[paymentId].status = 'approved';
                console.log(`✅ Payment ${paymentId} APPROVED`);
                
                // Send confirmation
                fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    chat_id: CHAT_ID,
                    text: `✅ Payment ${paymentId} APPROVED! User can now download.`
                  })
                });
              }
            }

            // Check /reject command
            if (text.startsWith('/reject')) {
              const parts = text.split(' ');
              const paymentId = parts[1];
              
              if (paymentId && payments[paymentId] && payments[paymentId].status === 'pending') {
                payments[paymentId].status = 'rejected';
                console.log(`❌ Payment ${paymentId} REJECTED`);
                
                // Send confirmation
                fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    chat_id: CHAT_ID,
                    text: `❌ Payment ${paymentId} REJECTED!`
                  })
                });
              }
            }
          }
        }
      }
    } catch (err) {
      console.error('Polling error:', err.message);
      // Wait 1 second before retry
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

// ─────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────

// Home page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../index.html'));
});

// API: Send notification to Telegram
app.post('/api/notify', async (req, res) => {
  try {
    const { plan, price, crypto: coin, amount } = req.body;

    if (!plan || !price || !coin || !amount) {
      return res.status(400).json({ success: false, error: 'Missing fields' });
    }

    const paymentId = 'PAY-' + crypto.randomBytes(4).toString('hex').toUpperCase();

    payments[paymentId] = { 
      status: 'pending',
      plan,
      price,
      crypto: coin,
      amount,
      createdAt: new Date()
    };

    const message = `🔔 *NEW PAYMENT REQUEST*

📦 *Plan:* ${plan}
💰 *Price:* $${price}
🪙 *Crypto:* ${coin.toUpperCase()}
🔢 *Amount:* ${amount}
🆔 *ID:* \`${paymentId}\`
⏰ *Time:* ${new Date().toLocaleString()}

_Reply with:_
✅ \`/approve ${paymentId}\`
❌ \`/reject ${paymentId}\``;

    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: message,
        parse_mode: 'Markdown'
      })
    });

    console.log(`📩 New payment request: ${paymentId}`);
    res.json({ success: true, paymentId });

  } catch (err) {
    console.error('Notify error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// API: Check payment status
app.get('/api/status/:id', (req, res) => {
  const payment = payments[req.params.id];
  
  if (!payment) {
    return res.json({ status: 'unknown' });
  }
  
  res.json({ status: payment.status });
});

// API: List all payments (admin)
app.get('/api/payments', (req, res) => {
  res.json(payments);
});

// ─────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`🤖 Telegram polling started...`);
  
  // Start polling Telegram for /approve /reject commands
  pollTelegram();
});