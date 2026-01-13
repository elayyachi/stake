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
// ────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN
const CHAT_ID = process.env.CHAT_ID

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
// CRYPTO PRICE API - Real-time conversion
// ─────────────────────────────────────────────
async function getCryptoPrice(crypto) {
  const coinIds = {
    'btc': 'bitcoin',
    'eth': 'ethereum',
    'ltc': 'litecoin',
    'usdt-trc20': 'tether',
    'usdt-erc20': 'tether',
    'usdt-bep20': 'tether'
  };
  
  const coinId = coinIds[crypto.toLowerCase()];
  
  // USDT = 1:1 with USD
  if (coinId === 'tether') {
    return 1;
  }
  
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`);
    const data = await res.json();
    return data[coinId]?.usd || null;
  } catch (err) {
    console.error('Price API error:', err);
    return null;
  }
}

function formatCryptoAmount(amount, crypto) {
  const decimals = {
    'btc': 8,
    'eth': 6,
    'ltc': 6,
    'usdt-trc20': 2,
    'usdt-erc20': 2,
    'usdt-bep20': 2
  };
  return amount.toFixed(decimals[crypto.toLowerCase()] || 6);
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

    if (!plan || !price || !coin) {
      return res.status(400).json({ success: false, error: 'Missing fields' });
    }

    const priceUSD = parseFloat(price);
    
    // Get real-time crypto price
    const cryptoPrice = await getCryptoPrice(coin);
    
    let exactAmount;
    let cryptoSymbol = coin.toUpperCase().replace('-', ' ');
    
    if (cryptoPrice) {
      exactAmount = formatCryptoAmount(priceUSD / cryptoPrice, coin);
    } else {
      // Fallback prices if API fails
      const fallbackPrices = {
        'btc': 100000,
        'eth': 3300,
        'ltc': 100,
        'usdt-trc20': 1,
        'usdt-erc20': 1,
        'usdt-bep20': 1
      };
      exactAmount = formatCryptoAmount(priceUSD / fallbackPrices[coin.toLowerCase()], coin);
    }

    const paymentId = 'PAY-' + crypto.randomBytes(4).toString('hex').toUpperCase();

    payments[paymentId] = { 
      status: 'pending',
      plan,
      price: priceUSD,
      crypto: coin,
      exactAmount,
      createdAt: new Date()
    };

    const message = `🔔 *NEW PAYMENT REQUEST*

📦 *Plan:* ${plan}
💰 *Price:* $${priceUSD}
🪙 *Crypto:* ${cryptoSymbol}
🔢 *Amount:* ${exactAmount} ${cryptoSymbol}
💵 *Rate:* 1 ${cryptoSymbol} = $${cryptoPrice ? cryptoPrice.toLocaleString() : 'N/A'}
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

    console.log(`📩 New payment request: ${paymentId} - ${exactAmount} ${cryptoSymbol}`);
    res.json({ success: true, paymentId, exactAmount, cryptoSymbol });

  } catch (err) {
    console.error('Notify error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// API: Get real-time crypto price
app.get('/api/price/:crypto/:usd', async (req, res) => {
  try {
    const { crypto, usd } = req.params;
    const priceUSD = parseFloat(usd);
    
    const cryptoPrice = await getCryptoPrice(crypto);
    
    if (cryptoPrice) {
      const exactAmount = formatCryptoAmount(priceUSD / cryptoPrice, crypto);
      res.json({ 
        success: true, 
        exactAmount, 
        rate: cryptoPrice,
        crypto: crypto.toUpperCase()
      });
    } else {
      res.json({ success: false, error: 'Could not fetch price' });
    }
  } catch (err) {
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

// API: Manual approve (backup method)
app.get('/api/approve/:id', async (req, res) => {
  const paymentId = req.params.id;
  
  if (payments[paymentId]) {
    payments[paymentId].status = 'approved';
    console.log(`✅ Payment ${paymentId} APPROVED via API`);
    
    // Send confirmation to Telegram
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: `✅ Payment ${paymentId} APPROVED! User can now download.`
      })
    });
    
    res.json({ success: true, message: `Payment ${paymentId} approved` });
  } else {
    res.json({ success: false, error: 'Payment not found' });
  }
});

// API: Manual reject (backup method)
app.get('/api/reject/:id', async (req, res) => {
  const paymentId = req.params.id;
  
  if (payments[paymentId]) {
    payments[paymentId].status = 'rejected';
    console.log(`❌ Payment ${paymentId} REJECTED via API`);
    
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: `❌ Payment ${paymentId} REJECTED!`
      })
    });
    
    res.json({ success: true, message: `Payment ${paymentId} rejected` });
  } else {
    res.json({ success: false, error: 'Payment not found' });
  }
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
