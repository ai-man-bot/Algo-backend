/**
 * AlgoFinance Backend Server (Gemini AI Edition)
 * * Responsibilities:
 * 1. Receive Webhooks from TradingView
 * 2. Analyze Signals with Google Gemini AI
 * 3. Execute Orders on Alpaca
 * * Dependencies: express, cors, body-parser, @alpacahq/alpaca-trade-api, dotenv, @google/generative-ai
 */

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const Alpaca = require('@alpacahq/alpaca-trade-api');
const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// --- Middleware ---
app.use(cors());
app.use(bodyParser.json());

// --- Configuration ---
const alpaca = new Alpaca({
  keyId: process.env.ALPACA_KEY_ID,
  secretKey: process.env.ALPACA_SECRET_KEY,
  paper: true,
});

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- In-Memory Store ---
let logs = [];
const addLog = (type, source, message) => {
  const log = {
    id: Date.now(),
    time: new Date().toLocaleTimeString(),
    type,
    source,
    message
  };
  logs.unshift(log);
  if (logs.length > 50) logs.pop();
};

// --- Endpoints ---

app.get('/', (req, res) => res.send('AlgoFinance Backend (Gemini) is Running'));

// The Smart Webhook
app.post('/webhook', async (req, res) => {
  const signal = req.body;
  console.log('Received Signal:', signal);
  addLog('WEBHOOK', 'TradingView', `${signal.action.toUpperCase()} ${signal.ticker} @ ${signal.price}`);

  if (!signal.ticker || !signal.action) return res.status(400).send('Invalid payload');

  try {
    // --- STEP 1: AI ANALYSIS ---
    // We ask Gemini to act as a Risk Manager
    addLog('AI_ANALYSIS', 'Gemini Pro', 'Analyzing market conditions...');
    
    const model = genAI.getGenerativeModel({ model: "gemini-pro"});
    const prompt = `
      Act as a strict financial risk manager. I have a signal to ${signal.action} ${signal.ticker} at price ${signal.price}.
      The timestamp is ${signal.timestamp || 'now'}.
      
      Respond with strictly ONE word: "APPROVE" or "DENY".
      (For this simulation, approve if the ticker is a major tech stock or crypto, deny if obscure).
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const decision = response.text().trim().toUpperCase();

    addLog('AI_ANALYSIS', 'Gemini Pro', `Decision: ${decision}`);

    if (decision.includes("DENY")) {
        return res.status(200).send('Trade Denied by AI Risk Manager');
    }

    // --- STEP 2: EXECUTION ---
    const side = signal.action.toLowerCase();
    const qty = signal.contracts || 1;

    const order = await alpaca.createOrder({
      symbol: signal.ticker,
      qty: qty,
      side: side,
      type: 'market',
      time_in_force: 'day'
    });

    addLog('EXECUTION', 'Alpaca', `Order Filled: ${side.toUpperCase()} ${qty} ${signal.ticker}`);
    res.status(200).send('Order Executed');

  } catch (error) {
    console.error('Error:', error.message);
    addLog('ERROR', 'System', error.message);
    res.status(500).send(error.message);
  }
});

// Frontend Data
app.get('/api/logs', (req, res) => res.json(logs));
app.get('/api/account', async (req, res) => {
  try {
    const account = await alpaca.getAccount();
    res.json(account);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));