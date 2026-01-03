const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const { minify } = require('terser');
const CleanCSS = require('clean-css');

const PUBLIC_DIR = path.join(__dirname, '../public');
const CLIENT_DIR = path.join(__dirname, '../client');

// Files to process
const JS_FILES = ['main.js', 'ai-engine.js'];
const CSS_FILES = ['styles.css'];
const STATIC_ASSETS = [
    'avatar.png', 'avatar.webp',
    'background.jpg', 'background.webp',
    'robots.txt', 'sitemap.xml'
];

// Map to store original -> hashed filenames
const fileMap = {};

async function hashFile(content) {
    return crypto.createHash('md5').update(content).digest('hex').slice(0, 8);
}

async function build() {
    console.log('🚀 Starting build process...');

    // 1. Clean/Create public directory
    await fs.emptyDir(PUBLIC_DIR);
    console.log('✓ Cleaned public directory');

    // 2. Process JS files
    for (const file of JS_FILES) {
        try {
            const content = await fs.readFile(path.join(CLIENT_DIR, file), 'utf8');
            const minified = await minify(content);
            if (minified.error) throw minified.error;

            const hash = await hashFile(minified.code);
            const ext = path.extname(file);
            const base = path.basename(file, ext);
            const hashedName = `${base}.${hash}${ext}`;

            await fs.writeFile(path.join(PUBLIC_DIR, hashedName), minified.code);
            fileMap[file] = hashedName;
            console.log(`✓ Minified & Hashed: ${file} -> ${hashedName}`);
        } catch (err) {
            console.error(`Error processing ${file}:`, err);
        }
    }

    // 3. Process CSS files
    for (const file of CSS_FILES) {
        try {
            const content = await fs.readFile(path.join(CLIENT_DIR, file), 'utf8');
            const output = new CleanCSS().minify(content);
            if (output.errors.length > 0) throw output.errors;

            const hash = await hashFile(output.styles);
            const ext = path.extname(file);
            const base = path.basename(file, ext);
            const hashedName = `${base}.${hash}${ext}`;

            await fs.writeFile(path.join(PUBLIC_DIR, hashedName), output.styles);
            fileMap[file] = hashedName;
            console.log(`✓ Minified & Hashed: ${file} -> ${hashedName}`);
        } catch (err) {
            console.error(`Error processing ${file}:`, err);
        }
    }

    // 4. Copy static assets
    for (const file of STATIC_ASSETS) {
        if (await fs.pathExists(path.join(CLIENT_DIR, file))) {
            await fs.copy(path.join(CLIENT_DIR, file), path.join(PUBLIC_DIR, file));
            console.log(`✓ Copied: ${file}`);
        } else {
            console.warn(`⚠ Warning: Asset not found: ${file}`);
        }
    }

    // 5. Process index.html
    try {
        let html = await fs.readFile(path.join(CLIENT_DIR, 'index.html'), 'utf8');

        // Replace references
        for (const [original, hashed] of Object.entries(fileMap)) {
            // Replace href="styles.css" or src="main.js"
            // Using a simple replace might be risky if names are common words, but these are specific files.
            // Better to use regex to match attributes.

            // Replace JS: src="main.js" -> src="main.123456.js"
            const jsRegex = new RegExp(`src=["']${original}["']`, 'g');
            html = html.replace(jsRegex, `src="${hashed}"`);

            // Replace CSS: href="styles.css" -> href="styles.123456.css"
            const cssRegex = new RegExp(`href=["']${original}["']`, 'g');
            html = html.replace(cssRegex, `href="${hashed}"`);
        }

        await fs.writeFile(path.join(PUBLIC_DIR, 'index.html'), html);
        console.log('✓ Processed and copied index.html');

    } catch (err) {
        console.error('Error processing index.html:', err);
    }

    // 6. Process dashboard.html
    try {
        if (await fs.pathExists(path.join(CLIENT_DIR, 'dashboard.html'))) {
            let html = await fs.readFile(path.join(CLIENT_DIR, 'dashboard.html'), 'utf8');

            // Replace references
            for (const [original, hashed] of Object.entries(fileMap)) {
                const jsRegex = new RegExp(`src=["']${original}["']`, 'g');
                html = html.replace(jsRegex, `src="${hashed}"`);

                const cssRegex = new RegExp(`href=["']${original}["']`, 'g');
                html = html.replace(cssRegex, `href="${hashed}"`);
            }

            await fs.writeFile(path.join(PUBLIC_DIR, 'dashboard.html'), html);
            console.log('✓ Processed and copied dashboard.html');
        }
    } catch (err) {
        console.error('Error processing dashboard.html:', err);
    }

    console.log('🎉 Build complete!');
}

build();
