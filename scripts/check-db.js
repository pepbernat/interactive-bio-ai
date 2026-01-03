const db = require('../src/db');
(async () => {
    await db.initDB();
    const users = await db.listUsers();
    console.log('Users:', users);
    const admin = await db.getUser('admin');
    console.log('Admin user found:', !!admin);
})();
