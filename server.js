// server.js - UPDATED with Session-Based Tracking
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 5000;
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key';
const JWT_EXPIRES_IN = '7d';

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

// ===== SCHEMAS =====

// User Schema (unchanged)
const userSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  phoneNumber: { type: String, required: true },
  language: { type: String, default: 'english' },
name: { 
    type: String, 
    required: true,
    trim: true 
  },
  age: { type: Number, required: true },
  class: { type: String, default: 'Not Assigned' },
  tutorRefId: { type: String, default: null },
  isGuest: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  lastActive: { type: Date, default: Date.now }
});

// Tutor Schema (unchanged)
const tutorSchema = new mongoose.Schema({
  tutorId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  email: { type: String },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

// NEW: Game Session Schema
const gameSessionSchema = new mongoose.Schema({
  sessionId: { 
    type: String, 
    required: true, 
    unique: true,
    index: true 
  },
  userId: { 
    type: String, 
    required: true, 
    index: true 
  },
  tutorRefId: { 
    type: String, 
    default: null,
    index: true
  },
  gameId: { 
    type: String, 
    required: true 
  },
  gameName: { 
    type: String, 
    required: true,
    enum: ['choose-items', 'count-them', 'size-comparison', 'learn-numbers']
  },
  startedAt: { 
    type: Date, 
    required: true, 
    default: Date.now,
    index: true
  },
  completedAt: { 
    type: Date, 
    default: null 
  },
  totalLevels: { 
    type: Number, 
    required: true,
    default: 0 
  },
  perfectLevels: { 
    type: Number, 
    required: true,
    default: 0 
  },
  isPerfectSession: { 
    type: Boolean, 
    required: true,
    default: false 
  },
  language: { 
    type: String, 
    required: true,
    enum: ['english', 'hindi'],
    default: 'english'
  },
  totalQuestions: { type: Number, default: 0 },
  totalCorrect: { type: Number, default: 0 },
  totalWrong: { type: Number, default: 0 },
  accuracyPercent: { type: Number, default: 0 },
  durationSeconds: { type: Number, default: 0 }
}, {
  timestamps: true
});

// Compound indexes
gameSessionSchema.index({ tutorRefId: 1, startedAt: -1 });
gameSessionSchema.index({ userId: 1, startedAt: -1 });
gameSessionSchema.index({ userId: 1, gameId: 1, startedAt: -1 });

// Pre-save hook
gameSessionSchema.pre('save', function(next) {
  if (this.completedAt && this.totalLevels > 0) {
    this.isPerfectSession = (this.perfectLevels === this.totalLevels);
    const totalAttempts = this.totalCorrect + this.totalWrong;
    this.accuracyPercent = totalAttempts > 0 
      ? Math.round((this.totalCorrect / totalAttempts) * 100) 
      : 0;
    if (this.startedAt) {
      this.durationSeconds = Math.floor((this.completedAt - this.startedAt) / 1000);
    }
  }
  next();
});

// NEW: Level Attempt Schema
const levelAttemptSchema = new mongoose.Schema({
  sessionId: { 
    type: String, 
    required: true,
    index: true
  },
  userId: { 
    type: String, 
    required: true,
    index: true 
  },
  gameId: { 
    type: String, 
    required: true 
  },
  levelNumber: { 
    type: Number, 
    required: true,
    min: 1 
  },
  totalQuestions: { 
    type: Number, 
    required: true,
    default: 0 
  },
  correctAnswers: { 
    type: Number, 
    required: true,
    default: 0 
  },
  wrongAnswers: { 
    type: Number, 
    required: true,
    default: 0 
  },
  isPerfect: { 
    type: Boolean, 
    required: true,
    default: false 
  },
  timeTakenSeconds: { 
    type: Number, 
    default: 0 
  },
  attemptedAt: { 
    type: Date, 
    required: true,
    default: Date.now 
  }
}, {
  timestamps: true
});

levelAttemptSchema.index({ sessionId: 1, levelNumber: 1 });
levelAttemptSchema.index({ userId: 1, attemptedAt: -1 });

levelAttemptSchema.pre('save', function(next) {
  this.isPerfect = (this.wrongAnswers === 0 && this.correctAnswers > 0);
  next();
});

// DEPRECATED: Old Attempt Schema (kept for migration purposes only)
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

const User = mongoose.model('User', userSchema);
const Tutor = mongoose.model('Tutor', tutorSchema);
const GameSession = mongoose.model('GameSession', gameSessionSchema);
const LevelAttempt = mongoose.model('LevelAttempt', levelAttemptSchema);
// ===== JWT AUTH MIDDLEWARE =====
function authenticateTutor(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Authorization token missing'
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.tutor = decoded; // { tutorId, name }
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token'
    });
  }
}


// ===== API ROUTES =====

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// ===== USER ROUTES (unchanged) =====

app.post('/api/user/register', async (req, res) => {
  try {
    const { userId, name, phoneNumber, language, age, isGuest, class: userClass } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: 'Name is required' });
    }

    let user = await User.findOne({ userId });

    if (user) {
      user.name = name;
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
      name,
      phoneNumber,
      language,
      age,
      class: userClass || 'Not Assigned',
      isGuest: isGuest || false
    });

    await user.save();
    res.json({ success: true, message: 'User registered', user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


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

app.post('/api/settings', async (req, res) => {
  try {
    const { userId, name, tutorRefId, language, age, class: userClass } = req.body;

    const user = await User.findOne({ userId });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (name !== undefined) user.name = name;
    if (tutorRefId !== undefined) user.tutorRefId = tutorRefId;
    if (language !== undefined) user.language = language;
    if (age !== undefined) user.age = age;
    if (userClass !== undefined) user.class = userClass;

    user.updatedAt = new Date();
    await user.save();

    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ===== NEW GAME SESSION ROUTES =====

const { v4: uuidv4 } = require('uuid');

// Start game session
app.post('/api/game-session/start', async (req, res) => {
  try {
    const { userId, gameId, gameName, language } = req.body;

    if (!userId || !gameId || !gameName) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields' 
      });
    }

    const user = await User.findOne({ userId });
    const tutorRefId = user?.tutorRefId || null;

    const sessionId = uuidv4();
    const session = new GameSession({
      sessionId,
      userId,
      tutorRefId,
      gameId,
      gameName,
      language: language || 'english',
      startedAt: new Date()
    });

    await session.save();

    // Update user's last active
    await User.findOneAndUpdate({ userId }, { lastActive: new Date() });

    res.json({
      success: true,
      message: 'Game session started',
      data: { sessionId, startedAt: session.startedAt }
    });
  } catch (error) {
    console.error('Error starting game session:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to start session',
      error: error.message 
    });
  }
});

// Log level attempt
app.post('/api/game-session/level', async (req, res) => {
  try {
    const { 
      sessionId, userId, gameId, levelNumber,
      totalQuestions, correctAnswers, wrongAnswers, timeTakenSeconds
    } = req.body;

    if (!sessionId || !userId || !gameId || levelNumber === undefined) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields' 
      });
    }

    const session = await GameSession.findOne({ sessionId });
    if (!session) {
      return res.status(404).json({ 
        success: false, 
        message: 'Session not found' 
      });
    }

    const levelAttempt = new LevelAttempt({
      sessionId, userId, gameId, levelNumber,
      totalQuestions: totalQuestions || 0,
      correctAnswers: correctAnswers || 0,
      wrongAnswers: wrongAnswers || 0,
      timeTakenSeconds: timeTakenSeconds || 0,
      attemptedAt: new Date()
    });

    await levelAttempt.save();

    // Update session stats
    session.totalLevels += 1;
    session.totalQuestions += levelAttempt.totalQuestions;
    session.totalCorrect += levelAttempt.correctAnswers;
    session.totalWrong += levelAttempt.wrongAnswers;
    
    if (levelAttempt.isPerfect) {
      session.perfectLevels += 1;
    }

    await session.save();

    res.json({
      success: true,
      message: 'Level attempt logged',
      data: {
        levelNumber,
        isPerfect: levelAttempt.isPerfect,
        sessionStats: {
          totalLevels: session.totalLevels,
          perfectLevels: session.perfectLevels
        }
      }
    });
  } catch (error) {
    console.error('Error logging level attempt:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to log level attempt',
      error: error.message 
    });
  }
});

// Complete game session
app.post('/api/game-session/complete', async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Session ID required' 
      });
    }

    const session = await GameSession.findOne({ sessionId });
    if (!session) {
      return res.status(404).json({ 
        success: false, 
        message: 'Session not found' 
      });
    }

    session.completedAt = new Date();
    await session.save();

    res.json({
      success: true,
      message: 'Session completed',
      data: {
        sessionId,
        completedAt: session.completedAt,
        isPerfectSession: session.isPerfectSession,
        summary: {
          totalLevels: session.totalLevels,
          perfectLevels: session.perfectLevels,
          accuracyPercent: session.accuracyPercent,
          durationSeconds: session.durationSeconds
        }
      }
    });
  } catch (error) {
    console.error('Error completing session:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to complete session',
      error: error.message 
    });
  }
});

// Get session with levels
app.get('/api/game-session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await GameSession.findOne({ sessionId });
    if (!session) {
      return res.status(404).json({ 
        success: false, 
        message: 'Session not found' 
      });
    }

    const levels = await LevelAttempt
      .find({ sessionId })
      .sort({ levelNumber: 1 })
      .lean();

    res.json({
      success: true,
      data: { session, levels }
    });
  } catch (error) {
    console.error('Error fetching session:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch session',
      error: error.message 
    });
  }
});

// ===== TUTOR ROUTES =====

app.post('/api/tutor/login', async (req, res) => {
  try {
    const { tutorId, password } = req.body;

    const tutor = await Tutor.findOne({ tutorId });
    if (!tutor) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const isValid = await bcrypt.compare(password, tutor.password);
    if (!isValid) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const token = jwt.sign(
      {
        tutorId: tutor.tutorId,
        name: tutor.name
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({
      success: true,
      message: 'Login successful',
      token,
      tutor: {
        tutorId: tutor.tutorId,
        name: tutor.name,
        email: tutor.email
      }
    });
  } catch (error) {
    console.error('Tutor login error:', error);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
});

app.post('/api/tutor/register', async (req, res) => {
  try {
    const { tutorId, name, email, password } = req.body;

    let tutor = await Tutor.findOne({ tutorId });

    if (tutor) {
      return res.json({ success: true, message: 'Tutor already exists', tutor });
    }

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

// NEW: Tutor dashboard - Latest 5 + First session
app.get('/api/tutor/:tutorId/student/:userId/dashboard',authenticateTutor, async (req, res) => {
  try {

    const { tutorId, userId } = req.params;
    const { gameId } = req.query;

    const query = { 
      userId, 
      tutorRefId: tutorId,
      completedAt: { $ne: null }
    };
    
    if (gameId) query.gameId = gameId;

    // Latest 5 sessions
    const latestSessions = await GameSession
      .find(query)
      .sort({ startedAt: -1 })
      .limit(5)
      .lean();

    // First ever session
    const firstSession = await GameSession
      .findOne(query)
      .sort({ startedAt: 1 })
      .lean();

    // Combine and deduplicate
    const sessionIds = new Set();
    const allSessions = [];
    
    latestSessions.forEach(session => {
      sessionIds.add(session.sessionId);
      allSessions.push(session);
    });
    
    if (firstSession && !sessionIds.has(firstSession.sessionId)) {
      allSessions.push({ ...firstSession, isFirstEver: true });
    } else if (firstSession) {
      const idx = allSessions.findIndex(s => s.sessionId === firstSession.sessionId);
      if (idx !== -1) allSessions[idx].isFirstEver = true;
    }

    // Fetch levels
    const sessionIdsArray = Array.from(sessionIds);
    if (firstSession && !sessionIds.has(firstSession.sessionId)) {
      sessionIdsArray.push(firstSession.sessionId);
    }

    const allLevels = await LevelAttempt
      .find({ sessionId: { $in: sessionIdsArray } })
      .sort({ levelNumber: 1 })
      .lean();

    // Group levels by session
    const levelsBySession = {};
    allLevels.forEach(level => {
      if (!levelsBySession[level.sessionId]) {
        levelsBySession[level.sessionId] = [];
      }
      levelsBySession[level.sessionId].push(level);
    });

    const sessionsWithLevels = allSessions.map(session => ({
      ...session,
      levels: levelsBySession[session.sessionId] || []
    }));

    res.json({
      success: true,
      data: {
        sessions: sessionsWithLevels,
        totalSessions: sessionsWithLevels.length
      }
    });
  } catch (error) {
    console.error('Error fetching tutor dashboard:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch dashboard',
      error: error.message 
    });
  }
});

// Updated tutor students list (with new session-based stats)
app.get('/api/tutor/:tutorId/students', authenticateTutor, async (req, res) => {
  try {
    const tutorId = req.params.tutorId;
    const classFilter = req.query.class;

    let query = { tutorRefId: tutorId };
    if (classFilter && classFilter !== 'All Classes') {
      query.class = classFilter;
    }

    const students = await User.find(query);

    const studentStats = await GameSession.aggregate([
      {
        $match: {
          userId: { $in: students.map(s => s.userId) },
          completedAt: { $ne: null }
        }
      },
      {
        $group: {
          _id: '$userId',
          totalSessions: { $sum: 1 },
          perfectSessions: { $sum: { $cond: ['$isPerfectSession', 1, 0] } },
          totalLevels: { $sum: '$totalLevels' },
          perfectLevels: { $sum: '$perfectLevels' },
          avgAccuracy: { $avg: '$accuracyPercent' },
          lastPlayed: { $max: '$startedAt' }
        }
      }
    ]);

    const studentsWithStats = students.map(student => {
      const stats = studentStats.find(s => s._id === student.userId) || {
        totalSessions: 0,
        perfectSessions: 0,
        totalLevels: 0,
        perfectLevels: 0,
        avgAccuracy: 0,
        lastPlayed: null
      };

      return {
        userId: student.userId,
        phoneNumber: student.phoneNumber,
        language: student.language,
        age: student.age,
        class: student.class,
        isGuest: student.isGuest,
        createdAt: student.createdAt,
        lastActive: student.lastActive,
        stats: {
          totalSessions: stats.totalSessions,
          perfectSessions: stats.perfectSessions,
          totalLevels: stats.totalLevels,
          perfectLevels: stats.perfectLevels,
          avgAccuracy: Math.round(stats.avgAccuracy || 0),
          lastPlayed: stats.lastPlayed
        }
      };
    });

    res.json({ 
      success: true, 
      count: studentsWithStats.length,
      students: studentsWithStats 
    });
  } catch (error) {
    console.error('Error fetching students:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch students', error: error.message });
  }
});

// Tutor statistics
app.get('/api/tutor/:tutorId/stats',authenticateTutor, async (req, res) => {
  try {
    const tutorId = req.params.tutorId;

    const students = await User.find({ tutorRefId: tutorId });
    const studentIds = students.map(s => s.userId);

    const sessionStats = await GameSession.aggregate([
      {
        $match: {
          userId: { $in: studentIds },
          completedAt: { $ne: null }
        }
      },
      {
        $group: {
          _id: null,
          totalSessions: { $sum: 1 },
          perfectSessions: { $sum: { $cond: ['$isPerfectSession', 1, 0] } },
          avgAccuracy: { $avg: '$accuracyPercent' }
        }
      }
    ]);

    const activeThisWeek = students.filter(s => {
      if (!s.lastActive) return false;
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      return new Date(s.lastActive) > weekAgo;
    }).length;

    const classCounts = {};
    students.forEach(s => {
      classCounts[s.class] = (classCounts[s.class] || 0) + 1;
    });

    const stats = sessionStats[0] || { 
      totalSessions: 0, 
      perfectSessions: 0, 
      avgAccuracy: 0 
    };

    res.json({
      success: true,
      stats: {
        totalStudents: students.length,
        activeThisWeek,
        totalSessions: stats.totalSessions,
        perfectSessions: stats.perfectSessions,
        avgAccuracy: Math.round(stats.avgAccuracy || 0),
        classCounts
      }
    });
  } catch (error) {
    console.error('Error fetching tutor stats:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch statistics', error: error.message });
  }
});

// ===== DEPRECATED: Old log-attempt endpoint (kept for backward compatibility) =====
app.post('/api/log-attempt', async (req, res) => {
  console.warn('⚠️  DEPRECATED: /api/log-attempt is deprecated. Use /api/game-session endpoints instead.');
  
  try {
    const { userId, phoneNumber, game, level, correct, attempts, timeTaken, language } = req.body;

    const attempt = new Attempt({
      userId, phoneNumber, game, level, correct,
      attempts: attempts || 1,
      timeTaken: timeTaken || 0,
      language: language || 'english'
    });

    await attempt.save();
    await User.findOneAndUpdate({ userId }, { lastActive: new Date() });

    res.json({ success: true, message: 'Attempt logged (deprecated endpoint)', attempt });
  } catch (error) {
    console.error('Error logging attempt:', error);
    res.status(500).json({ success: false, message: 'Failed to log attempt', error: error.message });
  }
});

// ===== CREATE DEFAULT TUTOR =====
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
  createDefaultTutor();
});

module.exports = app;