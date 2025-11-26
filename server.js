/**
 * AlgoFinance Backend Server (Gemini AI Edition + History)
 * Responsibilities:
 * 1. Receive Webhooks from TradingView
 * 2. Analyze Signals with Google Gemini AI
 * 3. Execute Orders on Alpaca
 * 4. Serve Portfolio History
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

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- In-Memory Store ---
// Storing more logs for better history on frontend
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
  if (logs.length > 200) logs.pop(); // Keep last 200
};

// --- Endpoints ---

app.get('/', (req, res) => res.send('AlgoFinance Backend is Running'));

// 1. Webhook Endpoint
app.post('/webhook', async (req, res) => {
  const signal = req.body;
  console.log('Received Signal:', signal);
  addLog('WEBHOOK', 'TradingView', `${signal.action.toUpperCase()} ${signal.ticker} @ ${signal.price}`);

  if (!signal.ticker || !signal.action) return res.status(400).send('Invalid payload');

  try {
    // AI Analysis
    addLog('AI_ANALYSIS', 'Gemini Pro', `Analyzing risk for ${signal.ticker}...`);
    
    const model = genAI.getGenerativeModel({ model: "gemini-pro"});
    const prompt = `
      Act as a financial risk manager. 
      Signal: ${signal.action} ${signal.ticker} at ${signal.price}.
      Context: Current Market.
      Task: Respond with strictly ONE word: "APPROVE" or "DENY".
      Criteria: Deny if it sounds like a scam token or extremely low volume penny stock. Approve major stocks/crypto.
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const decision = response.text().trim().toUpperCase();

    addLog('AI_ANALYSIS', 'Gemini Pro', `Decision: ${decision}`);

    if (decision.includes("DENY")) {
        return res.status(200).send('Trade Denied by AI');
    }

    // Execution
    const side = signal.action.toLowerCase();
    const qty = signal.contracts || 1;

    await alpaca.createOrder({
      symbol: signal.ticker,
      qty: qty,
      side: side,
      type: 'market',
      time_in_force: 'day'
    });

    addLog('EXECUTION', 'Alpaca', `Filled: ${side.toUpperCase()} ${qty} ${signal.ticker}`);
    res.status(200).send('Order Executed');

  } catch (error) {
    console.error('Error:', error.message);
    addLog('ERROR', 'System', error.message);
    res.status(500).send(error.message);
  }
});

// 2. Data Endpoints
app.get('/api/logs', (req, res) => res.json(logs));

app.get('/api/account', async (req, res) => {
  try {
    const account = await alpaca.getAccount();
    res.json(account);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// NEW: Fetch Historical Portfolio Data for Chart
app.get('/api/history', async (req, res) => {
    try {
        // Fetch 1 month of history
        const history = await alpaca.getPortfolioHistory({
            period: '1M',
            timeframe: '1D',
            extended_hours: true
        });
        
        // Format for Recharts
        const formatted = history.timestamp.map((t, i) => ({
            date: new Date(t * 1000).toLocaleDateString(),
            equity: history.equity[i],
            profit_loss: history.profit_loss[i]
        }));
        
        res.json(formatted);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));