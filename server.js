const express = require('express');
const cors = require('cors');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const port = 3001;

// Middleware
app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));

app.use(express.json());
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// База данных
const db = new sqlite3.Database(path.join(__dirname, 'users.db'));

// Инициализация базы данных
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER UNIQUE,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      auth_token TEXT UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_login TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS game_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      score INTEGER DEFAULT 0,
      level INTEGER DEFAULT 1,
      games_played INTEGER DEFAULT 0,
      last_game_date TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
});

// Middleware для проверки авторизации
const checkAuth = (req, res, next) => {
  if (req.session.userId) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
};

// Роуты
app.post('/api/register', async (req, res) => {
  const { telegram_id, username, first_name, last_name, auth_token } = req.body;

  db.run(`
    INSERT OR REPLACE INTO users (telegram_id, username, first_name, last_name, auth_token, last_login)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `, [telegram_id, username, first_name, last_name, auth_token], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    const userId = this.lastID;

    // Создаем запись в game_stats, если её еще нет
    db.run(`
      INSERT OR IGNORE INTO game_stats (user_id)
      VALUES (?)
    `, [userId]);

    req.session.userId = userId;
    res.json({ success: true, userId });
  });
});

app.post('/api/verify-token', (req, res) => {
  const { token } = req.body;

  db.get(`
    SELECT users.*, game_stats.* 
    FROM users 
    LEFT JOIN game_stats ON users.id = game_stats.user_id 
    WHERE auth_token = ?
  `, [token], (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    req.session.userId = user.id;
    res.json({ 
      user: {
        id: user.id,
        telegramId: user.telegram_id,
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
        gameStats: {
          score: user.score,
          level: user.level,
          gamesPlayed: user.games_played
        }
      }
    });
  });
});

// Обновление игровой статистики
app.post('/api/update-stats', checkAuth, (req, res) => {
  const { score, level } = req.body;
  const userId = req.session.userId;

  db.run(`
    UPDATE game_stats 
    SET score = ?, level = ?, games_played = games_played + 1, last_game_date = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `, [score, level, userId], (err) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json({ success: true });
  });
});

// Получение статистики пользователя
app.get('/api/user-stats', checkAuth, (req, res) => {
  db.get(`
    SELECT users.*, game_stats.* 
    FROM users 
    LEFT JOIN game_stats ON users.id = game_stats.user_id 
    WHERE users.id = ?
  `, [req.session.userId], (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json({
      stats: {
        score: user.score,
        level: user.level,
        gamesPlayed: user.games_played,
        lastGameDate: user.last_game_date
      }
    });
  });
});

app.listen(port, () => {
  console.log(`Registration server running on port ${port}`);
});