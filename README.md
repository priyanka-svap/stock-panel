# 📈 Stock Panel - Complete Trading API

Complete Node.js + MongoDB backend for Stock Panel trading application with **LIVE Nifty/Sensex/Bank Nifty data** and real-time stock prices from NSE/BSE.

## ✨ Features

- ✅ **Live Market Data** - Real-time Nifty 50, Sensex, Bank Nifty, Nifty IT prices
- ✅ **Live Stock Prices** - 20+ NSE stocks with auto-updates
- ✅ **User Authentication** - JWT-based username/password login
- ✅ **Order Management** - Place BUY/SELL orders (Market, Limit, SL, SL-M)
- ✅ **Positions Tracking** - Intraday positions with P&L
- ✅ **Watchlist** - Add/remove favorite stocks
- ✅ **Funds Management** - Deposit/withdraw funds
- ✅ **WebSocket** - Real-time price updates
- ✅ **Auto-Update** - Cron jobs for market hours updates

## 🚀 Quick Start

### 1. Install Dependencies
```bash
cd stock-panel-api
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env with your MongoDB URI
```

### 3. Seed Database with Live Data
```bash
npm run seed
```

This will:
- Fetch live Nifty 50, Sensex, Bank Nifty, Nifty IT data
- Fetch live prices for 20 NSE stocks (TCS, Reliance, Infosys, etc.)
- Create a demo user (username: `demo`, password: `demo123`)

### 4. Start Server
```bash
npm start
# Or for development:
npm run dev
```

Server runs on `http://localhost:5000`

## 📡 API Endpoints

### 🔐 Authentication

#### Register
```http
POST /api/auth/register
Content-Type: application/json

{
  "username": "johndoe",
  "password": "password123",
  "email": "john@example.com",
  "fullName": "John Doe"
}
```

#### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "username": "demo",
  "password": "demo123"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "...",
      "username": "demo",
      "clientId": "CL1705123456",
      "availableBalance": 100000
    }
  }
}
```

### 📊 Indices (Nifty, Sensex, Bank Nifty)

#### Get All Indices
```http
GET /api/indices
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "name": "NIFTY50",
      "displayName": "NIFTY 50",
      "value": 21894.75,
      "change": 152.35,
      "percentageChange": 0.70,
      "dayHigh": 21920.50,
      "dayLow": 21750.00,
      "lastUpdated": "2026-02-03T09:30:00.000Z"
    }
  ]
}
```

#### Get Single Index
```http
GET /api/indices/NIFTY50
GET /api/indices/SENSEX
GET /api/indices/BANKNIFTY
GET /api/indices/NIFTYIT
```

#### Refresh Index (Live Data)
```http
POST /api/indices/refresh/NIFTY50
```

#### Refresh All Indices
```http
POST /api/indices/refresh-all
```

### 📈 Stocks

#### Get All Stocks
```http
GET /api/stocks?page=1&limit=20&sortBy=percentageChange&order=desc
```

**Query Parameters:**
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 20)
- `sortBy` - Sort field (percentageChange, symbol, currentPrice)
- `order` - asc/desc
- `search` - Search by symbol or name
- `sector` - Filter by sector

#### Get Single Stock
```http
GET /api/stocks/TCS
```

#### Top Gainers
```http
GET /api/stocks/market/gainers?limit=5
```

#### Top Losers
```http
GET /api/stocks/market/losers?limit=5
```

#### Search Stocks
```http
GET /api/stocks/search/reliance
```

#### Refresh Stock (Live Data)
```http
POST /api/stocks/refresh/TCS
```

#### Refresh All Stocks
```http
POST /api/stocks/refresh-all
```

### 📋 Orders

**Authentication Required:** Add `Authorization: Bearer <token>` header

#### Get User Orders
```http
GET /api/orders?status=PENDING
Authorization: Bearer <token>
```

**Status values:** `PENDING`, `COMPLETED`, `CANCELLED`

#### Place Order
```http
POST /api/orders
Authorization: Bearer <token>
Content-Type: application/json

{
  "symbol": "RELIANCE",
  "companyName": "Reliance Industries Ltd.",
  "orderType": "BUY",
  "quantity": 10,
  "price": 2456.50,
  "orderMode": "Market",
  "stopLoss": 2400.00,
  "takeProfit": 2500.00
}
```

**Order Modes:** `Market`, `Limit`, `SL`, `SL-M`

**Response:**
```json
{
  "success": true,
  "message": "Order placed successfully",
  "data": {
    "symbol": "RELIANCE",
    "orderType": "BUY",
    "quantity": 10,
    "price": 2456.50,
    "totalAmount": 24565.00,
    "brokerage": 20.00,
    "taxesAndCharges": 15.50,
    "netAmount": 24600.50,
    "status": "COMPLETED"
  }
}
```

#### Cancel Order
```http
PATCH /api/orders/:orderId/cancel
Authorization: Bearer <token>
Content-Type: application/json

{
  "reason": "Changed my mind"
}
```

### 📊 Positions

#### Get Open Positions
```http
GET /api/positions
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": [...],
  "summary": {
    "totalPnL": 2450,
    "count": 3
  }
}
```

### ⭐ Watchlist

#### Get Watchlist
```http
GET /api/watchlist
Authorization: Bearer <token>
```

#### Add to Watchlist
```http
POST /api/watchlist/add/TCS
Authorization: Bearer <token>
```

#### Remove from Watchlist
```http
DELETE /api/watchlist/remove/TCS
Authorization: Bearer <token>
```

### 💰 Funds

#### Get Fund Details
```http
GET /api/funds
Authorization: Bearer <token>
```

#### Deposit Funds
```http
POST /api/funds/deposit
Authorization: Bearer <token>
Content-Type: application/json

{
  "amount": 10000,
  "method": "UPI"
}
```

**Methods:** `UPI`, `BANK_TRANSFER`, `CARD`, `NET_BANKING`

#### Withdraw Funds
```http
POST /api/funds/withdraw
Authorization: Bearer <token>
Content-Type: application/json

{
  "amount": 5000,
  "method": "BANK_TRANSFER"
}
```

### 👤 User Profile

#### Get Profile
```http
GET /api/users/profile
Authorization: Bearer <token>
```

#### Update Profile
```http
PUT /api/users/profile
Authorization: Bearer <token>
Content-Type: application/json

{
  "fullName": "John Updated Doe",
  "email": "newemail@example.com"
}
```

## 🔌 WebSocket Integration

### Connect to WebSocket
```javascript
const socket = io('http://localhost:5000');

// Subscribe to stocks
socket.emit('subscribe', ['TCS', 'INFY', 'RELIANCE']);

// Listen for stock updates
socket.on('stockUpdate', (data) => {
  console.log('Stock updated:', data);
  // data = { symbol: 'TCS', data: {...}, timestamp: '...' }
});

// Listen for index updates
socket.on('indexUpdate', (data) => {
  console.log('Index updated:', data);
});

// Unsubscribe
socket.emit('unsubscribe', ['TCS']);
```

## ⏰ Auto-Update Schedule

### Indices
- Updates every **2 minutes** during market hours
- NIFTY 50, SENSEX, BANK NIFTY, NIFTY IT

### Stocks
- Updates every **5 minutes** during market hours
- All active stocks in database

### Market Hours
- **Monday to Friday**
- **9:15 AM to 3:30 PM IST**

## 📁 Project Structure

```
stock-panel-api/
├── models/
│   ├── User.js          # User authentication
│   ├── Stock.js         # Stock data
│   ├── Index.js         # Market indices
│   ├── Order.js         # Buy/Sell orders
│   ├── Position.js      # Intraday positions
│   ├── Watchlist.js     # User watchlists
│   └── Transaction.js   # Fund transactions
├── routes/
│   ├── auth.js          # Authentication routes
│   ├── stocks.js        # Stock routes
│   ├── indices.js       # Index routes
│   ├── orders.js        # Order routes
│   ├── positions.js     # Position routes
│   ├── watchlist.js     # Watchlist routes
│   ├── funds.js         # Fund routes
│   └── users.js         # User routes
├── services/
│   └── liveDataService.js  # Yahoo Finance integration
├── jobs/
│   └── marketUpdateJob.js  # Cron jobs
├── middleware/
│   └── auth.js          # JWT authentication
├── server.js            # Main server file
├── seed.js              # Database seeder
├── package.json
└── README.md
```

## 🗄️ Database Models

### User
- username, password, email, fullName
- clientId, availableBalance, usedMargin
- portfolioValue, totalPnL

### Stock
- symbol, companyName, exchange
- currentPrice, priceChange, percentageChange
- dayHigh, dayLow, openPrice, volume
- marketCap, sector

### Index
- name, displayName, value
- change, percentageChange
- dayHigh, dayLow, openValue

### Order
- userId, symbol, companyName
- orderType (BUY/SELL)
- orderMode (Market/Limit/SL/SL-M)
- quantity, price, stopLoss, takeProfit
- totalAmount, brokerage, taxesAndCharges
- status (PENDING/COMPLETED/CANCELLED)

### Position
- userId, symbol, companyName
- type (BUY/SELL), quantity, avgPrice
- currentPrice, totalValue, pnl
- pnlPercentage, dayChange

### Watchlist
- userId, stocks[]

### Transaction
- userId, type (DEPOSIT/WITHDRAWAL)
- amount, method, status

## 🧪 Testing

### Test Demo Account
```
Username: demo
Password: demo123
```

### Test Endpoints
```bash
# Health check
curl http://localhost:5000/api/health

# Get all indices
curl http://localhost:5000/api/indices

# Get stocks
curl http://localhost:5000/api/stocks?limit=10

# Login
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"demo","password":"demo123"}'
```

## 🔧 Configuration

### Environment Variables
```env
MONGODB_URI=mongodb://localhost:27017/stockPanelDB
PORT=5000
JWT_SECRET=your-super-secret-key
NODE_ENV=development
```

### MongoDB Connection
**Local:**
```
mongodb://localhost:27017/stockPanelDB
```

**Atlas (Cloud):**
```
mongodb+srv://username:password@cluster.mongodb.net/stockPanelDB
```

## 🚨 Common Issues

### MongoDB Connection Failed
```bash
# Start MongoDB
mongod

# Or use MongoDB Atlas cloud database
```

### Yahoo Finance API Errors
- Free tier with no rate limits
- Stock symbols must be valid NSE symbols
- Indices use special symbols (^NSEI, ^BSESN, etc.)

### Cron Jobs Not Running
- Check if current time is during market hours
- Verify IST timezone calculation
- Check console logs for job status

## 📦 Deployment

### Heroku
```bash
heroku create stock-panel-api
heroku addons:create mongolab
git push heroku main
```

### Railway
```bash
railway init
railway add mongodb
railway up
```

### DigitalOcean/VPS
```bash
# Install Node.js and MongoDB
npm install
npm run seed
pm2 start server.js
```

## 🤝 Support

- Frontend UI: Already provided (stock-panel-complete-all-screens.html)
- Backend API: This repository
- Live Data: Yahoo Finance (FREE)

## 📝 License

MIT

---

**Built with ❤️ for Stock Panel Trading App**
