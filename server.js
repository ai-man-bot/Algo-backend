/**
 * AlgoFinance Backend Server
 * * Responsibilities:
 * 1. Receive Webhooks from TradingView
 * 2. Execute Orders on Alpaca
 * 3. Serve Data to the React Frontend
 * * Dependencies: express, cors, body-parser, @alpacahq/alpaca-trade-api, dotenv
 */

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const Alpaca = require('@alpacahq/alpaca-trade-api');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// --- Middleware ---
app.use(cors()); // Allow React app to talk to this server
app.use(bodyParser.json());

// --- Configuration ---
// GET YOUR KEYS AT: https://alpaca.markets/
const alpaca = new Alpaca({
  keyId: process.env.ALPACA_KEY_ID || 'YOUR_ALPACA_KEY',
  secretKey: process.env.ALPACA_SECRET_KEY || 'YOUR_ALPACA_SECRET',
  paper: true, // Set to false for real money
});

// --- In-Memory Store (Use a Database like MongoDB/Postgres for production) ---
let logs = [];
const addLog = (type, source, message) => {
  const log = {
    id: Date.now(),
    time: new Date().toLocaleTimeString(),
    type,
    source,
    message
  };
  logs.unshift(log); // Add to beginning
  if (logs.length > 50) logs.pop(); // Keep last 50
};

// --- Endpoints ---

// 1. Health Check
app.get('/', (req, res) => {
  res.send('AlgoFinance Backend is Running');
});

// 2. The Webhook (TradingView hits this)
app.post('/webhook', async (req, res) => {
  const signal = req.body;
  
  // Log receipt
  console.log('Received Signal:', signal);
  addLog('WEBHOOK', 'TradingView', `${signal.action.toUpperCase()} ${signal.ticker} @ ${signal.price}`);

  // Validate Payload
  if (!signal.ticker || !signal.action) {
    return res.status(400).send('Invalid payload');
  }

  // Execute Trade on Alpaca
  try {
    const side = signal.action.toLowerCase(); // 'buy' or 'sell'
    const qty = signal.contracts || 1;

    // Place Order
    const order = await alpaca.createOrder({
      symbol: signal.ticker,
      qty: qty,
      side: side,
      type: 'market',
      time_in_force: 'day'
    });

    addLog('EXECUTION', 'Alpaca', `Order Placed: ${side.toUpperCase()} ${qty} ${signal.ticker}`);
    res.status(200).send('Order Executed');

  } catch (error) {
    console.error('Alpaca Error:', error.message);
    addLog('ERROR', 'Alpaca', `Execution Failed: ${error.message}`);
    res.status(500).send(error.message);
  }
});

// 3. Frontend Data (React hits this)
app.get('/api/logs', (req, res) => {
  res.json(logs);
});

app.get('/api/account', async (req, res) => {
  try {
    const account = await alpaca.getAccount();
    res.json(account);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Start Server ---
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});