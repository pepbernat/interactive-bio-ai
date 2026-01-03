const db = require('../src/db');
const bcrypt = require('bcrypt');

(async () => {
    try {
        await db.initDB();
        console.log('Deleting admin user...');
        await db.deleteUser('admin');

        console.log('Creating new admin user...');
        const hash = await bcrypt.hash('admin123', 10);
        await db.createUser('admin', hash, 'admin');
        console.log('✓ Admin user reset. User: admin, Pass: admin123');
    } catch (err) {
        console.error('Error:', err);
    }
})();
