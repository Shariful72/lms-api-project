const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const axios = require('axios');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));
app.set('view engine', 'ejs');

const BANK_API = 'http://localhost:3001/api';

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

// ============= USER ENDPOINTS =============

// Register user
app.post('/api/users/register', async (req, res) => {
  const { username, password, email, role } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  
  try {
    // Check if username exists
    const [existing] = await db.execute(
      'SELECT * FROM users WHERE username = ?',
      [username]
    );
    
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    
    const userId = uuidv4();
    
    await db.execute(
      'INSERT INTO users (id, username, password, email, role) VALUES (?, ?, ?, ?, ?)',
      [userId, username, password, email, role || 'learner']
    );
    
    res.json({ 
      message: 'User registered successfully',
      userId,
      username
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
app.post('/api/users/login', async (req, res) => {
  const { username, password } = req.body;
  
  try {
    const [users] = await db.execute(
      'SELECT * FROM users WHERE username = ? AND password = ?',
      [username, password]
    );
    
    if (users.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const user = users[0];
    
    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        hasBank: user.account_number !== null
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Setup bank info
app.post('/api/users/:userId/bank-setup', async (req, res) => {
  const { userId } = req.params;
  const { accountNumber, secret, initialBalance } = req.body;
  
  try {
    // Check if user exists
    const [users] = await db.execute(
      'SELECT * FROM users WHERE id = ?',
      [userId]
    );
    
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Register account with bank
    await axios.post(`${BANK_API}/accounts/register`, {
      accountNumber,
      secret,
      initialBalance: initialBalance || 5000
    });
    
    // Update user with bank info
    await db.execute(
      'UPDATE users SET account_number = ?, bank_secret = ? WHERE id = ?',
      [accountNumber, secret, userId]
    );
    
    res.json({ 
      message: 'Bank setup successful',
      accountNumber
    });
  } catch (error) {
    console.error('Bank setup error:', error);
    res.status(500).json({ error: error.response?.data?.error || 'Bank setup failed' });
  }
});

// Get user balance
app.post('/api/users/:userId/balance', async (req, res) => {
  const { userId } = req.params;
  
  try {
    const [users] = await db.execute(
      'SELECT * FROM users WHERE id = ?',
      [userId]
    );
    
    if (users.length === 0 || !users[0].account_number) {
      return res.status(404).json({ error: 'User or bank account not found' });
    }
    
    const user = users[0];
    
    const response = await axios.post(`${BANK_API}/accounts/balance`, {
      accountNumber: user.account_number,
      secret: user.bank_secret
    });
    
    res.json(response.data);
  } catch (error) {
    console.error('Balance error:', error);
    res.status(500).json({ error: 'Failed to fetch balance' });
  }
});

// ============= COURSE ENDPOINTS =============

// Get all courses
app.get('/api/courses', async (req, res) => {
  try {
    const [courses] = await db.execute('SELECT * FROM courses');
    
    // Get materials for each course
    for (let course of courses) {
      const [materials] = await db.execute(
        'SELECT * FROM course_materials WHERE course_id = ?',
        [course.id]
      );
      course.materials = materials;
      course.price = parseFloat(course.price);
    }
    
    res.json(courses);
  } catch (error) {
    console.error('Get courses error:', error);
    res.status(500).json({ error: 'Failed to fetch courses' });
  }
});

// Get course by ID
app.get('/api/courses/:courseId', async (req, res) => {
  try {
    const [courses] = await db.execute(
      'SELECT * FROM courses WHERE id = ?',
      [req.params.courseId]
    );
    
    if (courses.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    const course = courses[0];
    course.price = parseFloat(course.price);
    
    // Get materials
    const [materials] = await db.execute(
      'SELECT * FROM course_materials WHERE course_id = ?',
      [course.id]
    );
    course.materials = materials;
    
    res.json(course);
  } catch (error) {
    console.error('Get course error:', error);
    res.status(500).json({ error: 'Failed to fetch course' });
  }
});

// Add course material
app.post('/api/courses/:courseId/materials', async (req, res) => {
  const { courseId } = req.params;
  const { title, type, content, instructorId } = req.body;
  
  try {
    // Verify course exists and instructor owns it
    const [courses] = await db.execute(
      'SELECT * FROM courses WHERE id = ? AND instructor_id = ?',
      [courseId, instructorId]
    );
    
    if (courses.length === 0) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    const materialId = uuidv4();
    
    await db.execute(
      'INSERT INTO course_materials (id, course_id, title, type, content) VALUES (?, ?, ?, ?, ?)',
      [materialId, courseId, title, type, content]
    );
    
    const [materials] = await db.execute(
      'SELECT * FROM course_materials WHERE id = ?',
      [materialId]
    );
    
    res.json({ 
      message: 'Material added successfully',
      material: materials[0]
    });
  } catch (error) {
    console.error('Add material error:', error);
    res.status(500).json({ error: 'Failed to add material' });
  }
});

// ============= ENROLLMENT & PAYMENT =============

// Enroll in course
app.post('/api/enroll', async (req, res) => {
  const { userId, courseId } = req.body;
  
  console.log('📝 Enrollment request:', { userId, courseId });
  
  try {
    // Get user
    const [users] = await db.execute(
      'SELECT * FROM users WHERE id = ?',
      [userId]
    );
    
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = users[0];
    console.log('👤 User found:', user.username);
    
    // Get course
    const [courses] = await db.execute(
      'SELECT * FROM courses WHERE id = ?',
      [courseId]
    );
    
    if (courses.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    const course = courses[0];
    console.log('📚 Course found:', course.title);
    
    if (!user.account_number) {
      return res.status(400).json({ error: 'Bank account not set up' });
    }
    
    console.log('💳 User bank account:', user.account_number);
    console.log('💰 Course price:', course.price);
    
    // Check if already enrolled
    const [existingEnrollments] = await db.execute(
      'SELECT * FROM enrollments WHERE user_id = ? AND course_id = ?',
      [userId, courseId]
    );
    
    if (existingEnrollments.length > 0) {
      return res.status(400).json({ error: 'Already enrolled in this course' });
    }
    
    // Step 1: Debit learner account
    console.log('💸 Attempting to debit user account...');
    const debitResponse = await axios.post(`${BANK_API}/transactions/debit`, {
      fromAccount: user.account_number,
      secret: user.bank_secret,
      amount: parseFloat(course.price),
      description: `Course: ${course.title}`
    });
    console.log('✅ Debit successful:', debitResponse.data);
    
    // Step 2: Create transaction record for instructor
    console.log('📝 Creating instructor transaction...');
    const instructorShare = parseFloat(course.price) * 0.7; // 70% to instructor
    const transactionResponse = await axios.post(`${BANK_API}/transactions/create-record`, {
      fromAccount: 'LMS-ORG-001',
      toAccount: `INST-${course.instructor_id}`,
      amount: instructorShare,
      secret: 'lms-secret-2024',
      description: `Payment for course: ${course.title}`
    });
    console.log('✅ Instructor transaction created:', transactionResponse.data);
    
    // Enroll user
    const enrollmentId = uuidv4();
    await db.execute(
      'INSERT INTO enrollments (id, user_id, course_id, transaction_id, instructor_transaction_id) VALUES (?, ?, ?, ?, ?)',
      [enrollmentId, userId, courseId, debitResponse.data.transactionId, transactionResponse.data.transactionId]
    );
    
    console.log('🎉 Enrollment successful!');
    res.json({
      message: 'Enrollment successful',
      enrollmentId,
      transactionId: debitResponse.data.transactionId,
      instructorTransactionId: transactionResponse.data.transactionId
    });
    
  } catch (error) {
    console.error('❌ Enrollment error:', error.message);
    console.error('Full error:', error.response?.data || error);
    res.status(500).json({ 
      error: error.response?.data?.error || 'Enrollment failed' 
    });
  }
});

// Get user enrollments
app.get('/api/users/:userId/enrollments', async (req, res) => {
  const { userId } = req.params;
  
  try {
    const [enrollments] = await db.execute(
      'SELECT * FROM enrollments WHERE user_id = ?',
      [userId]
    );
    
    // Get course details for each enrollment
    for (let enrollment of enrollments) {
      const [courses] = await db.execute(
        'SELECT * FROM courses WHERE id = ?',
        [enrollment.course_id]
      );
      enrollment.course = courses[0];
      if (enrollment.course) {
        enrollment.course.price = parseFloat(enrollment.course.price);
      }
    }
    
    res.json(enrollments);
  } catch (error) {
    console.error('Get enrollments error:', error);
    res.status(500).json({ error: 'Failed to fetch enrollments' });
  }
});

// Complete course
app.post('/api/enrollments/:enrollmentId/complete', async (req, res) => {
  const { enrollmentId } = req.params;
  
  try {
    // Get enrollment
    const [enrollments] = await db.execute(
      'SELECT * FROM enrollments WHERE id = ?',
      [enrollmentId]
    );
    
    if (enrollments.length === 0) {
      return res.status(404).json({ error: 'Enrollment not found' });
    }
    
    const enrollment = enrollments[0];
    
    // Update enrollment
    await db.execute(
      'UPDATE enrollments SET completed = TRUE, completed_at = NOW() WHERE id = ?',
      [enrollmentId]
    );
    
    // Get user and course
    const [users] = await db.execute('SELECT * FROM users WHERE id = ?', [enrollment.user_id]);
    const [courses] = await db.execute('SELECT * FROM courses WHERE id = ?', [enrollment.course_id]);
    
    const user = users[0];
    const course = courses[0];
    
    // Generate certificate
    const certificateId = uuidv4();
    await db.execute(
      'INSERT INTO certificates (id, user_id, course_id, user_name, course_name) VALUES (?, ?, ?, ?, ?)',
      [certificateId, enrollment.user_id, enrollment.course_id, user.username, course.title]
    );
    
    res.json({
      message: 'Course completed',
      certificateId
    });
  } catch (error) {
    console.error('Complete course error:', error);
    res.status(500).json({ error: 'Failed to complete course' });
  }
});

// Get certificate
app.get('/api/certificates/:certificateId', async (req, res) => {
  try {
    const [certificates] = await db.execute(
      'SELECT * FROM certificates WHERE id = ?',
      [req.params.certificateId]
    );
    
    if (certificates.length === 0) {
      return res.status(404).json({ error: 'Certificate not found' });
    }
    
    res.json(certificates[0]);
  } catch (error) {
    console.error('Get certificate error:', error);
    res.status(500).json({ error: 'Failed to fetch certificate' });
  }
});

// Start server
app.listen(PORT, async () => {
  await initDB();
  console.log(`LMS Service running on http://localhost:${PORT}`);
});