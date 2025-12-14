const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(bodyParser.json());

// MySQL Connection Configuration
const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: '513796', // CHANGE THIS to your MySQL password
  database: 'lms_system'
};

let db;

// Initialize Database Connection
async function initDB() {
  try {
    db = await mysql.createConnection(dbConfig);
    console.log('✅ Connected to MySQL Database');
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    process.exit(1);
  }
}

// ============= ACCOUNT ENDPOINTS =============

// Create/Register account
app.post('/api/accounts/register', async (req, res) => {
  const { accountNumber, initialBalance, secret } = req.body;
  
  if (!accountNumber || !secret) {
    return res.status(400).json({ error: 'Account number and secret required' });
  }
  
  try {
    // Check if account exists
    const [existing] = await db.execute(
      'SELECT * FROM bank_accounts WHERE account_number = ?',
      [accountNumber]
    );
    
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Account already exists' });
    }
    
    // Create account
    await db.execute(
      'INSERT INTO bank_accounts (account_number, balance, secret) VALUES (?, ?, ?)',
      [accountNumber, initialBalance || 0, secret]
    );
    
    res.json({ 
      message: 'Account created successfully',
      accountNumber,
      balance: initialBalance || 0
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Account creation failed' });
  }
});

// Get balance
app.post('/api/accounts/balance', async (req, res) => {
  const { accountNumber, secret } = req.body;
  
  try {
    const [accounts] = await db.execute(
      'SELECT * FROM bank_accounts WHERE account_number = ?',
      [accountNumber]
    );
    
    if (accounts.length === 0) {
      return res.status(404).json({ error: 'Account not found' });
    }
    
    const account = accounts[0];
    
    if (account.secret !== secret) {
      return res.status(401).json({ error: 'Invalid secret' });
    }
    
    res.json({ 
      accountNumber,
      balance: parseFloat(account.balance)
    });
  } catch (error) {
    console.error('Balance error:', error);
    res.status(500).json({ error: 'Failed to fetch balance' });
  }
});

// ============= TRANSACTION ENDPOINTS =============

// Debit from account (learner payment)
app.post('/api/transactions/debit', async (req, res) => {
  const { fromAccount, secret, amount, description } = req.body;
  
  try {
    // Get account
    const [accounts] = await db.execute(
      'SELECT * FROM bank_accounts WHERE account_number = ?',
      [fromAccount]
    );
    
    if (accounts.length === 0) {
      return res.status(404).json({ error: 'Account not found' });
    }
    
    const account = accounts[0];
    
    if (account.secret !== secret) {
      return res.status(401).json({ error: 'Invalid secret' });
    }
    
    if (parseFloat(account.balance) < amount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }
    
    // Deduct amount
    const newBalance = parseFloat(account.balance) - amount;
    await db.execute(
      'UPDATE bank_accounts SET balance = ? WHERE account_number = ?',
      [newBalance, fromAccount]
    );
    
    // Credit LMS account
    await db.execute(
      'UPDATE bank_accounts SET balance = balance + ? WHERE account_number = ?',
      [amount, 'LMS-ORG-001']
    );
    
    // Create transaction record
    const transactionId = uuidv4();
    await db.execute(
      'INSERT INTO transactions (id, from_account, amount, description, status) VALUES (?, ?, ?, ?, ?)',
      [transactionId, fromAccount, amount, description, 'completed']
    );
    
    res.json({
      message: 'Payment successful',
      transactionId,
      newBalance
    });
  } catch (error) {
    console.error('Debit error:', error);
    res.status(500).json({ error: 'Transaction failed' });
  }
});

// Create transaction record (LMS to Instructor)
app.post('/api/transactions/create-record', async (req, res) => {
  const { fromAccount, toAccount, amount, secret, description } = req.body;
  
  try {
    // Verify LMS account
    const [lmsAccounts] = await db.execute(
      'SELECT * FROM bank_accounts WHERE account_number = ?',
      [fromAccount]
    );
    
    if (lmsAccounts.length === 0) {
      return res.status(404).json({ error: 'LMS account not found' });
    }
    
    const lmsAccount = lmsAccounts[0];
    
    if (lmsAccount.secret !== secret) {
      return res.status(401).json({ error: 'Invalid secret' });
    }
    
    if (parseFloat(lmsAccount.balance) < amount) {
      return res.status(400).json({ error: 'Insufficient balance in LMS account' });
    }
    
    // Create pending transaction
    const transactionId = uuidv4();
    await db.execute(
      'INSERT INTO transactions (id, from_account, to_account, amount, description, status) VALUES (?, ?, ?, ?, ?, ?)',
      [transactionId, fromAccount, toAccount, amount, description, 'pending']
    );
    
    res.json({
      message: 'Transaction record created',
      transactionId
    });
  } catch (error) {
    console.error('Create record error:', error);
    res.status(500).json({ error: 'Failed to create transaction' });
  }
});

// Validate and execute transaction (Instructor validates)
app.post('/api/transactions/validate', async (req, res) => {
  const { transactionId, toAccount, secret } = req.body;
  
  try {
    // Get transaction
    const [transactions] = await db.execute(
      'SELECT * FROM transactions WHERE id = ?',
      [transactionId]
    );
    
    if (transactions.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    
    const transaction = transactions[0];
    
    if (transaction.status !== 'pending') {
      return res.status(400).json({ error: 'Transaction already processed' });
    }
    
    if (transaction.to_account !== toAccount) {
      return res.status(400).json({ error: 'Account mismatch' });
    }
    
    // Verify instructor account
    const [instructorAccounts] = await db.execute(
      'SELECT * FROM bank_accounts WHERE account_number = ?',
      [toAccount]
    );
    
    if (instructorAccounts.length === 0) {
      return res.status(404).json({ error: 'Instructor account not found' });
    }
    
    const instructorAccount = instructorAccounts[0];
    
    if (instructorAccount.secret !== secret) {
      return res.status(401).json({ error: 'Invalid secret' });
    }
    
    // Execute transfer
    await db.execute(
      'UPDATE bank_accounts SET balance = balance - ? WHERE account_number = ?',
      [transaction.amount, transaction.from_account]
    );
    
    await db.execute(
      'UPDATE bank_accounts SET balance = balance + ? WHERE account_number = ?',
      [transaction.amount, toAccount]
    );
    
    await db.execute(
      'UPDATE transactions SET status = ? WHERE id = ?',
      ['completed', transactionId]
    );
    
    // Get new balance
    const [updated] = await db.execute(
      'SELECT balance FROM bank_accounts WHERE account_number = ?',
      [toAccount]
    );
    
    res.json({
      message: 'Transaction validated and completed',
      transactionId,
      amount: parseFloat(transaction.amount),
      newBalance: parseFloat(updated[0].balance)
    });
  } catch (error) {
    console.error('Validate error:', error);
    res.status(500).json({ error: 'Validation failed' });
  }
});

// Credit instructor for course upload
app.post('/api/transactions/credit-instructor', async (req, res) => {
  const { toAccount, amount, secret, description } = req.body;
  
  try {
    // Verify LMS account
    const [lmsAccounts] = await db.execute(
      'SELECT * FROM bank_accounts WHERE account_number = ?',
      ['LMS-ORG-001']
    );
    
    const lmsAccount = lmsAccounts[0];
    
    if (lmsAccount.secret !== secret) {
      return res.status(401).json({ error: 'Invalid LMS secret' });
    }
    
    if (parseFloat(lmsAccount.balance) < amount) {
      return res.status(400).json({ error: 'Insufficient LMS balance' });
    }
    
    // Check if instructor account exists, if not create it
    const [instructorAccounts] = await db.execute(
      'SELECT * FROM bank_accounts WHERE account_number = ?',
      [toAccount]
    );
    
    if (instructorAccounts.length === 0) {
      return res.status(404).json({ error: 'Instructor account not found' });
    }
    
    // Transfer from LMS to instructor
    await db.execute(
      'UPDATE bank_accounts SET balance = balance - ? WHERE account_number = ?',
      [amount, 'LMS-ORG-001']
    );
    
    await db.execute(
      'UPDATE bank_accounts SET balance = balance + ? WHERE account_number = ?',
      [amount, toAccount]
    );
    
    // Create transaction record
    const transactionId = uuidv4();
    await db.execute(
      'INSERT INTO transactions (id, from_account, to_account, amount, description, status) VALUES (?, ?, ?, ?, ?, ?)',
      [transactionId, 'LMS-ORG-001', toAccount, amount, description, 'completed']
    );
    
    // Get new instructor balance
    const [updated] = await db.execute(
      'SELECT balance FROM bank_accounts WHERE account_number = ?',
      [toAccount]
    );
    
    res.json({
      message: 'Instructor credited successfully',
      transactionId,
      instructorBalance: parseFloat(updated[0].balance)
    });
  } catch (error) {
    console.error('Credit instructor error:', error);
    res.status(500).json({ error: 'Credit failed' });
  }
});

// Start server
app.listen(PORT, async () => {
  await initDB();
  console.log(`Bank Service running on http://localhost:${PORT}`);
});