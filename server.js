// server.js - ENHANCED VERSION with Class Support & Tutor Authentication
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/sheru-learning';

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ MongoDB connected successfully'))
.catch(err => console.error('❌ MongoDB connection error:', err));

// ===== ENHANCED SCHEMAS =====

// User Schema with Class
const userSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  phoneNumber: { type: String, required: true },
  language: { type: String, default: 'english' },
  age: { type: Number, required: true },
  class: { type: String, default: 'Not Assigned' }, // NEW: Nursery, LKG, UKG
  tutorRefId: { type: String, default: null },
  isGuest: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  lastActive: { type: Date, default: Date.now }
});

// Attempt Schema (unchanged)
const attemptSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  phoneNumber: { type: String, required: true },
  game: { type: String, required: true },
  level: { type: Number, required: true },
  correct: { type: Boolean, required: true },
  attempts: { type: Number, default: 1 },
  timeTaken: { type: Number },
  language: { type: String, default: 'english' },
  timestamp: { type: Date, default: Date.now }
});

// Enhanced Tutor Schema with Password
const tutorSchema = new mongoose.Schema({
  tutorId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  email: { type: String },
  password: { type: String, required: true }, // Hashed password
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Attempt = mongoose.model('Attempt', attemptSchema);
const Tutor = mongoose.model('Tutor', tutorSchema);

// ===== API ROUTES =====

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// ===== USER ROUTES =====

// Register new user (with class support)
app.post('/api/user/register', async (req, res) => {
  try {
    const { userId, phoneNumber, language, age, isGuest, class: userClass } = req.body;

    let user = await User.findOne({ userId });
    
    if (user) {
      user.language = language;
      user.age = age;
      if (userClass) user.class = userClass;
      user.updatedAt = new Date();
      user.lastActive = new Date();
      await user.save();
      
      return res.json({ success: true, message: 'User updated', user });
    }

    user = new User({
      userId,
      phoneNumber,
      language,
      age,
      class: userClass || 'Not Assigned',
      isGuest: isGuest || false
    });

    await user.save();
    res.json({ success: true, message: 'User registered successfully', user });
  } catch (error) {
    console.error('Error registering user:', error);
    res.status(500).json({ success: false, message: 'Failed to register user', error: error.message });
  }
});

// Get user by ID
app.get('/api/user/:userId', async (req, res) => {
  try {
    const user = await User.findOne({ userId: req.params.userId });
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    user.lastActive = new Date();
    await user.save();

    res.json({ success: true, user });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch user', error: error.message });
  }
});

// ===== SETTINGS ROUTES =====

// Update user settings (with class support)
app.post('/api/settings', async (req, res) => {
  try {
    const { userId, phoneNumber, tutorRefId, language, age, class: userClass } = req.body;

    let user = await User.findOne({ userId });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (tutorRefId !== undefined) user.tutorRefId = tutorRefId;
    if (language !== undefined) user.language = language;
    if (age !== undefined) user.age = age;
    if (userClass !== undefined) user.class = userClass;
    user.updatedAt = new Date();

    await user.save();

    res.json({ success: true, message: 'Settings updated successfully', user });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ success: false, message: 'Failed to update settings', error: error.message });
  }
});

// ===== GAME ATTEMPT ROUTES =====

// Log game attempt
app.post('/api/log-attempt', async (req, res) => {
  try {
    const { userId, phoneNumber, game, level, correct, attempts, timeTaken, language } = req.body;

    const attempt = new Attempt({
      userId,
      phoneNumber,
      game,
      level,
      correct,
      attempts: attempts || 1,
      timeTaken: timeTaken || 0,
      language: language || 'english'
    });

    await attempt.save();

    // Update user's last active
    await User.findOneAndUpdate(
      { userId },
      { lastActive: new Date() }
    );

    res.json({ success: true, message: 'Attempt logged successfully', attempt });
  } catch (error) {
    console.error('Error logging attempt:', error);
    res.status(500).json({ success: false, message: 'Failed to log attempt', error: error.message });
  }
});

// Get user's game history
app.get('/api/attempts/:userId', async (req, res) => {
  try {
    const { game, limit } = req.query;
    
    let query = { userId: req.params.userId };
    if (game) query.game = game;

    const attempts = await Attempt
      .find(query)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit) || 100);

    res.json({ success: true, count: attempts.length, attempts });
  } catch (error) {
    console.error('Error fetching attempts:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch attempts', error: error.message });
  }
});

// ===== TUTOR ROUTES =====

// Tutor Login with Password
app.post('/api/tutor/login', async (req, res) => {
  try {
    const { tutorId, password } = req.body;

    const tutor = await Tutor.findOne({ tutorId });

    if (!tutor) {
      return res.status(401).json({ success: false, message: 'Invalid tutor ID or password' });
    }

    const isPasswordValid = await bcrypt.compare(password, tutor.password);

    if (!isPasswordValid) {
      return res.status(401).json({ success: false, message: 'Invalid tutor ID or password' });
    }

    res.json({ 
      success: true, 
      message: 'Login successful',
      tutor: {
        tutorId: tutor.tutorId,
        name: tutor.name,
        email: tutor.email
      }
    });
  } catch (error) {
    console.error('Error during tutor login:', error);
    res.status(500).json({ success: false, message: 'Failed to login', error: error.message });
  }
});

// Register tutor (with password hashing)
app.post('/api/tutor/register', async (req, res) => {
  try {
    const { tutorId, name, email, password } = req.body;

    let tutor = await Tutor.findOne({ tutorId });

    if (tutor) {
      return res.json({ success: true, message: 'Tutor already exists', tutor });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    tutor = new Tutor({ tutorId, name, email, password: hashedPassword });
    await tutor.save();

    res.json({ 
      success: true, 
      message: 'Tutor registered successfully',
      tutor: {
        tutorId: tutor.tutorId,
        name: tutor.name,
        email: tutor.email
      }
    });
  } catch (error) {
    console.error('Error registering tutor:', error);
    res.status(500).json({ success: false, message: 'Failed to register tutor', error: error.message });
  }
});

// Get students for a tutor (with class filter and enhanced stats)
app.get('/api/tutor/:tutorId/students', async (req, res) => {
  try {
    const tutorId = req.params.tutorId;
    const classFilter = req.query.class;

    let query = { tutorRefId: tutorId };
    if (classFilter && classFilter !== 'All Classes') {
      query.class = classFilter;
    }

    const students = await User.find(query);

    const studentsWithAttempts = await Promise.all(
      students.map(async (student) => {
        // Get all SESSION attempts (not individual levels)
        const attempts = await Attempt
          .find({ userId: student.userId })
          .sort({ timestamp: -1 });

        // Calculate game-specific stats (session-based)
        const gameStats = {};
        const uniqueGames = [...new Set(attempts.map(a => a.game))];
        
        uniqueGames.forEach(game => {
          const gameAttempts = attempts.filter(a => a.game === game);
          const correctCount = gameAttempts.filter(a => a.correct).length;
          const totalSessions = gameAttempts.length;
          const avgLevel = totalSessions > 0 
            ? Math.round(gameAttempts.reduce((sum, a) => sum + a.level, 0) / totalSessions) 
            : 0;
          
          gameStats[game] = {
            totalSessions: totalSessions,
            successfulSessions: correctCount,
            successRate: totalSessions > 0 ? Math.round((correctCount / totalSessions) * 100) : 0,
            avgLevelsCompleted: avgLevel,
            lastPlayed: gameAttempts[0]?.timestamp
          };
        });

        // Calculate overall stats (session-based)
        const totalSessions = attempts.length;
        const successfulSessions = attempts.filter(a => a.correct).length;
        const successRate = totalSessions > 0 ? Math.round((successfulSessions / totalSessions) * 100) : 0;

        // Calculate activity score (sessions in last 7 days)
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        const recentSessions = attempts.filter(a => new Date(a.timestamp) > weekAgo).length;

        return {
          userId: student.userId,
          phoneNumber: student.phoneNumber,
          language: student.language,
          age: student.age,
          class: student.class,
          isGuest: student.isGuest,
          createdAt: student.createdAt,
          lastActive: student.lastActive,
          attempts: attempts.slice(0, 20), // Last 20 sessions
          stats: {
            totalSessions: totalSessions,
            successfulSessions: successfulSessions,
            successRate: successRate,
            recentActivity: recentSessions,
            gamesPlayed: uniqueGames.length,
            gameStats
          }
        };
      })
    );

    res.json({ 
      success: true, 
      count: studentsWithAttempts.length,
      students: studentsWithAttempts 
    });
  } catch (error) {
    console.error('Error fetching students:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch students', error: error.message });
  }
});

// Get tutor statistics
app.get('/api/tutor/:tutorId/stats', async (req, res) => {
  try {
    const tutorId = req.params.tutorId;

    const students = await User.find({ tutorRefId: tutorId });
    const studentIds = students.map(s => s.userId);

    const totalAttempts = await Attempt.countDocuments({ 
      userId: { $in: studentIds } 
    });

    const correctAttempts = await Attempt.countDocuments({ 
      userId: { $in: studentIds },
      correct: true
    });

    const activeThisWeek = students.filter(s => {
      if (!s.lastActive) return false;
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      return new Date(s.lastActive) > weekAgo;
    }).length;

    // Get class distribution
    const classCounts = {};
    students.forEach(s => {
      classCounts[s.class] = (classCounts[s.class] || 0) + 1;
    });

    res.json({
      success: true,
      stats: {
        totalStudents: students.length,
        activeThisWeek,
        totalAttempts,
        correctAttempts,
        successRate: totalAttempts > 0 ? Math.round((correctAttempts / totalAttempts) * 100) : 0,
        classCounts
      }
    });
  } catch (error) {
    console.error('Error fetching tutor stats:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch statistics', error: error.message });
  }
});

// ===== CREATE DEFAULT TUTOR =====
// This runs once to create a default tutor account
async function createDefaultTutor() {
  try {
    const existingTutor = await Tutor.findOne({ tutorId: 'TUTOR123' });
    if (!existingTutor) {
      const hashedPassword = await bcrypt.hash('teacher123', 10);
      const tutor = new Tutor({
        tutorId: 'TUTOR123',
        name: 'Demo Teacher',
        email: 'teacher@example.com',
        password: hashedPassword
      });
      await tutor.save();
      console.log('✅ Default tutor created: TUTOR123 / teacher123');
    }
  } catch (error) {
    console.error('Error creating default tutor:', error);
  }
}

// ===== ERROR HANDLING =====

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ 
    success: false, 
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 MongoDB URI: ${MONGODB_URI}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  
  // Create default tutor after server starts
  createDefaultTutor();
});

module.exports = app;