const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const axios = require('axios');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 3002;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

const BANK_API = 'http://localhost:3001/api';
const LMS_API = 'http://localhost:3000/api';

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

// ============= INSTRUCTOR ENDPOINTS =============

// Login
app.post('/api/instructors/login', async (req, res) => {
  const { email, password } = req.body;
  
  try {
    const [instructors] = await db.execute(
      'SELECT * FROM instructors WHERE email = ? AND password = ?',
      [email, password]
    );
    
    if (instructors.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const instructor = instructors[0];
    
    res.json({
      message: 'Login successful',
      instructor: {
        id: instructor.id,
        name: instructor.name,
        email: instructor.email,
        accountNumber: instructor.account_number
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get instructor profile
app.get('/api/instructors/:instructorId', async (req, res) => {
  try {
    const [instructors] = await db.execute(
      'SELECT * FROM instructors WHERE id = ?',
      [req.params.instructorId]
    );
    
    if (instructors.length === 0) {
      return res.status(404).json({ error: 'Instructor not found' });
    }
    
    const instructor = instructors[0];
    
    // Get courses taught by this instructor
    const [courses] = await db.execute(
      'SELECT id FROM courses WHERE instructor_id = ?',
      [instructor.id]
    );
    
    res.json({
      id: instructor.id,
      name: instructor.name,
      email: instructor.email,
      accountNumber: instructor.account_number,
      courses: courses.map(c => c.id)
    });
  } catch (error) {
    console.error('Get instructor error:', error);
    res.status(500).json({ error: 'Failed to fetch instructor' });
  }
});

// Get instructor balance
app.post('/api/instructors/:instructorId/balance', async (req, res) => {
  const { instructorId } = req.params;
  
  try {
    const [instructors] = await db.execute(
      'SELECT * FROM instructors WHERE id = ?',
      [instructorId]
    );
    
    if (instructors.length === 0) {
      return res.status(404).json({ error: 'Instructor not found' });
    }
    
    const instructor = instructors[0];
    
    const response = await axios.post(`${BANK_API}/accounts/balance`, {
      accountNumber: instructor.account_number,
      secret: instructor.bank_secret
    });
    
    res.json(response.data);
  } catch (error) {
    console.error('Balance error:', error);
    res.status(500).json({ error: 'Failed to fetch balance' });
  }
});

// Validate and collect payment
app.post('/api/instructors/collect-payment', async (req, res) => {
  const { instructorId, transactionId } = req.body;
  
  try {
    const [instructors] = await db.execute(
      'SELECT * FROM instructors WHERE id = ?',
      [instructorId]
    );
    
    if (instructors.length === 0) {
      return res.status(404).json({ error: 'Instructor not found' });
    }
    
    const instructor = instructors[0];
    
    const response = await axios.post(`${BANK_API}/transactions/validate`, {
      transactionId,
      toAccount: instructor.account_number,
      secret: instructor.bank_secret
    });
    
    res.json({
      message: 'Payment collected successfully',
      ...response.data
    });
  } catch (error) {
    console.error('Collect payment error:', error);
    res.status(500).json({ 
      error: error.response?.data?.error || 'Payment collection failed' 
    });
  }
});

// Upload course
app.post('/api/instructors/:instructorId/upload-course', async (req, res) => {
  const { instructorId } = req.params;
  const { title, price, description } = req.body;
  
  try {
    const [instructors] = await db.execute(
      'SELECT * FROM instructors WHERE id = ?',
      [instructorId]
    );
    
    if (instructors.length === 0) {
      return res.status(404).json({ error: 'Instructor not found' });
    }
    
    const instructor = instructors[0];
    const courseId = uuidv4().substring(0, 8);
    const uploadPayment = 2000; // Lump sum for uploading course
    
    // Insert course into database
    await db.execute(
      'INSERT INTO courses (id, title, instructor_id, price, description) VALUES (?, ?, ?, ?, ?)',
      [courseId, title, instructorId, price, description]
    );
    
    // Credit instructor for uploading course
    const response = await axios.post(`${BANK_API}/transactions/credit-instructor`, {
      toAccount: instructor.account_number,
      amount: uploadPayment,
      secret: 'lms-secret-2024',
      description: `Course upload payment: ${title}`
    });
    
    res.json({
      message: 'Course uploaded successfully',
      courseId,
      payment: uploadPayment,
      transactionId: response.data.transactionId,
      instructorBalance: response.data.instructorBalance
    });
  } catch (error) {
    console.error('Upload course error:', error);
    res.status(500).json({ 
      error: error.response?.data?.error || 'Course upload failed' 
    });
  }
});

// Add material to course
app.post('/api/instructors/:instructorId/add-material', async (req, res) => {
  const { instructorId } = req.params;
  const { courseId, title, type, content } = req.body;
  
  try {
    // Verify instructor owns the course
    const [courses] = await db.execute(
      'SELECT * FROM courses WHERE id = ? AND instructor_id = ?',
      [courseId, instructorId]
    );
    
    if (courses.length === 0) {
      return res.status(403).json({ error: 'Not authorized for this course' });
    }
    
    const response = await axios.post(`${LMS_API}/courses/${courseId}/materials`, {
      title,
      type,
      content,
      instructorId
    });
    
    res.json(response.data);
  } catch (error) {
    console.error('Add material error:', error);
    res.status(500).json({ error: 'Failed to add material' });
  }
});

// Start server
app.listen(PORT, async () => {
  await initDB();
  console.log(`Instructor Service running on http://localhost:${PORT}`);
});