const db = require('../src/db');
const fs = require('fs');
const path = require('path');

async function test() {
    console.log('Testing DB operations...');
    try {
        await db.initDB();

        const sessionId = 'test-session-' + Date.now();
        console.log(`Creating session: ${sessionId}`);

        await db.createSession(sessionId);

        console.log('Adding user message...');
        await db.addMessage(sessionId, 'user', 'Hello DB');

        console.log('Adding assistant message...');
        await db.addMessage(sessionId, 'assistant', 'Hello User');

        const messages = await db.getMessages(sessionId);
        console.log('Messages retrieved:', messages);

        if (messages.length === 2 && messages[0].content === 'Hello DB' && messages[1].content === 'Hello User') {
            console.log('✓ DB Verification Passed');
            if (fs.existsSync(path.join(__dirname, '../data', 'chat_database.sqlite'))) {
                console.log('✓ DB file created in data/ folder');
            } else {
                console.error('✗ DB file NOT found in data/ folder');
                process.exit(1);
            }
        } else {
            console.error('✗ DB Verification Failed');
            process.exit(1);
        }

        const sessions = await db.getAllSessionsWithMessages();
        console.log(`Total sessions: ${sessions.length}`);

    } catch (err) {
        console.error('Test failed:', err);
        process.exit(1);
    }
}

test();
