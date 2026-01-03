const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');

const dbPath = path.join(__dirname, '../data', 'chat_database.sqlite');

let db = null;

async function initDB() {
    if (db) return db;

    db = await open({
        filename: dbPath,
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
            sessionId TEXT PRIMARY KEY,
            createdAt TEXT,
            updatedAt TEXT
        );

        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sessionId TEXT,
            role TEXT,
            content TEXT,
            timestamp TEXT,
            FOREIGN KEY(sessionId) REFERENCES sessions(sessionId)
        );

        CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY,
            passwordHash TEXT,
            role TEXT
        );
    `);

    console.log(`✓ Base de datos SQLite inicializada en: ${dbPath}`);
    return db;
}

async function getSession(sessionId) {
    if (!db) await initDB();
    return db.get('SELECT * FROM sessions WHERE sessionId = ?', sessionId);
}

async function createSession(sessionId) {
    if (!db) await initDB();
    const now = new Date().toISOString();
    await db.run(
        'INSERT OR IGNORE INTO sessions (sessionId, createdAt, updatedAt) VALUES (?, ?, ?)',
        sessionId, now, now
    );
    return getSession(sessionId);
}

async function updateSessionTimestamp(sessionId) {
    if (!db) await initDB();
    const now = new Date().toISOString();
    await db.run('UPDATE sessions SET updatedAt = ? WHERE sessionId = ?', now, sessionId);
}

async function addMessage(sessionId, role, content) {
    if (!db) await initDB();
    const timestamp = new Date().toISOString();

    // Ensure session exists
    await createSession(sessionId);

    await db.run(
        'INSERT INTO messages (sessionId, role, content, timestamp) VALUES (?, ?, ?, ?)',
        sessionId, role, content, timestamp
    );

    await updateSessionTimestamp(sessionId);
    return { sessionId, role, content, timestamp };
}

async function getMessages(sessionId) {
    if (!db) await initDB();
    return db.all('SELECT role, content, timestamp FROM messages WHERE sessionId = ? ORDER BY id ASC', sessionId);
}

async function getAllSessionsWithMessages() {
    if (!db) await initDB();

    const sessions = await db.all('SELECT * FROM sessions ORDER BY updatedAt DESC');
    const result = [];

    for (const session of sessions) {
        const messages = await getMessages(session.sessionId);
        result.push({
            sessionId: session.sessionId,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            messages
        });
    }

    return result;
}


// User Management
async function hasUsers() {
    if (!db) await initDB();
    const result = await db.get('SELECT COUNT(*) as count FROM users');
    return result.count > 0;
}

async function getUser(username) {
    if (!db) await initDB();
    return db.get('SELECT * FROM users WHERE username = ?', username);
}

async function createUser(username, passwordHash, role = 'readonly') {
    if (!db) await initDB();

    // First user is always admin
    const userCount = await hasUsers();
    const finalRole = !userCount ? 'admin' : role;

    await db.run(
        'INSERT INTO users (username, passwordHash, role) VALUES (?, ?, ?)',
        username, passwordHash, finalRole
    );
    return { username, role: finalRole };
}

async function listUsers() {
    if (!db) await initDB();
    return db.all('SELECT username, role FROM users'); // Never return password hash
}

async function deleteUser(username) {
    if (!db) await initDB();
    await db.run('DELETE FROM users WHERE username = ?', username);
}

module.exports = {
    initDB,
    getSession,
    createSession,
    addMessage,
    getMessages,
    getAllSessionsWithMessages,
    hasUsers,
    getUser,
    createUser,
    listUsers,
    deleteUser
};
