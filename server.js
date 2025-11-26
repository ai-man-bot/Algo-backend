/**
 * AlgoFinance Backend (Strategic Analyst Edition)
 * 1. Webhooks execute trades IMMEDIATELY (Trusting the source).
 * 2. Gemini analyzes the trade context POST-EXECUTION.
 * 3. New endpoint to analyze entire portfolio balance.
 */

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const Alpaca = require('@alpacahq/alpaca-trade-api');
const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(bodyParser.json());

const alpaca = new Alpaca({
  keyId: process.env.ALPACA_KEY_ID,
  secretKey: process.env.ALPACA_SECRET_KEY,
  paper: true,
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Store logs
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
  if (logs.length > 200) logs.pop(); 
};

app.get('/', (req, res) => res.send('AlgoFinance Strategist is Running'));

// --- 1. The Reactive Webhook (Execute FIRST, Analyze SECOND) ---
app.post('/webhook', async (req, res) => {
  const signal = req.body;
  console.log('Received Signal:', signal);
  addLog('WEBHOOK', 'TradingView', `${signal.action.toUpperCase()} ${signal.ticker} @ ${signal.price}`);

  if (!signal.ticker || !signal.action) return res.status(400).send('Invalid payload');

  try {
    // 1. EXECUTE IMMEDIATELY (Trusting the signal source)
    const side = signal.action.toLowerCase();
    const qty = signal.contracts || 1;

    // Place the order first
    await alpaca.createOrder({
      symbol: signal.ticker,
      qty: qty,
      side: side,
      type: 'market',
      time_in_force: 'day'
    });
    
    addLog('EXECUTION', 'Alpaca', `Filled: ${side.toUpperCase()} ${qty} ${signal.ticker}`);
    res.status(200).send('Order Executed');

    // 2. POST-TRADE ANALYSIS (Async - doesn't block response)
    // We analyze the single trade in context of the account
    (async () => {
        try {
            const account = await alpaca.getAccount();
            const position = await alpaca.getPosition(signal.ticker).catch(() => ({ qty: 0 })); // Get updated position
            
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash"});
            
            const prompt = `
                I just executed a ${side.toUpperCase()} order for ${qty} shares of ${signal.ticker}.
                
                Context:
                - Total Portfolio Value: $${account.portfolio_value}
                - Buying Power: $${account.buying_power}
                - Current Position in ${signal.ticker}: ${position.qty || qty} shares
                
                Task: Provide a 1-sentence strategic recommendation. 
                Focus on: Position sizing, exposure risk, or if I should stop trading this specific asset.
                Do NOT say "consult a financial advisor". Be direct and algorithmic.
            `;

            const result = await model.generateContent(prompt);
            const advice = result.response.text();
            addLog('AI_STRATEGY', 'Gemini Flash', advice);
        } catch (err) {
            console.error("AI Analysis Failed:", err);
        }
    })();

  } catch (error) {
    console.error('Error:', error.message);
    addLog('ERROR', 'System', error.message);
    res.status(500).send(error.message);
  }
});

// --- 2. Portfolio Optimization Endpoint ---
app.get('/api/analyze-portfolio', async (req, res) => {
    try {
        // Fetch all open positions
        const positions = await alpaca.getPositions();
        const account = await alpaca.getAccount();

        if (positions.length === 0) {
            return res.json({ analysis: "No open positions to analyze. Start trading to get recommendations." });
        }

        // Summarize for AI
        const portfolioSummary = positions.map(p => 
            `- ${p.symbol}: ${p.qty} shares ($${p.market_value}), Profit/Loss: $${p.unrealized_pl}`
        ).join('\n');

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash"});
        const prompt = `
            Analyze this algorithmic trading portfolio:
            
            Total Equity: $${account.portfolio_value}
            Cash: $${account.cash}
            
            Positions:
            ${portfolioSummary}
            
            Task: Provide a strategic optimization report.
            1. Identify the best performing asset.
            2. Identify the worst performing asset (and suggest if I should cut losses).
            3. Evaluate diversity (am I too concentrated?).
            
            Format response as HTML (use <b> for bold, <br> for new lines). Keep it concise.
        `;

        const result = await model.generateContent(prompt);
        res.json({ analysis: result.response.text() });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// Data Endpoints
app.get('/api/logs', (req, res) => res.json(logs));
app.get('/api/account', async (req, res) => {
  try {
    const account = await alpaca.getAccount();
    res.json(account);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.get('/api/history', async (req, res) => {
    try {
        const history = await alpaca.getPortfolioHistory({ period: '1M', timeframe: '1D', extended_hours: true });
        const formatted = history.timestamp.map((t, i) => ({
            date: new Date(t * 1000).toLocaleDateString(),
            equity: history.equity[i],
            profit_loss: history.profit_loss[i]
        }));
        res.json(formatted);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));