require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const db = require('./src/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { generateKnowledgeEmbeddings, buildContextualSystemPrompt } = require('./src/embeddings');

const app = express();
app.use(compression()); // Enable Gzip/Brotli compression
app.use(helmet({
    contentSecurityPolicy: false, // Disable CSP for now to avoid breaking inline scripts/styles if any remain, or configure it properly later
    crossOriginEmbedderPolicy: false
}));
app.use(cors());
app.use(express.json());
app.use(cookieParser());

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_key_change_in_prod';

const knowledgePath = path.join(__dirname, 'knowledge.md');
let knowledgeText = '';
try {
    if (fs.existsSync(knowledgePath)) {
        knowledgeText = fs.readFileSync(knowledgePath, 'utf8');
    } else {
        console.warn('knowledge.md no encontrado. El sistema funcionará con capacidad reducida.');
    }
} catch (err) {
    console.warn('No se pudo cargar knowledge.md en el servidor:', err.message);
}

// Helper para extraer info básica del perfil desde Markdown (para fallback)
function extractProfileBasic(markdownText) {
    if (!markdownText) return { name: 'Asistente', title: '' };
    const nameMatch = markdownText.match(/^# Perfil:\s*(.*)/m);
    const headlineMatch = markdownText.match(/- Headline:\s*(.*)/m);
    return {
        name: nameMatch ? nameMatch[1].trim() : 'Asistente',
        title: headlineMatch ? headlineMatch[1].trim() : ''
    };
}

// Helper para extraer info básica del perfil desde Markdown (para fallback)

function serializeMessagesForModel(messages = []) {
    return messages.map(msg => ({ role: msg.role, content: msg.content }));
}

function hasUserProvidedContact(messages = [], latestUserMessage = null) {
    const userMessages = [...messages, latestUserMessage]
        .filter(msg => msg && msg.role === 'user' && typeof msg.content === 'string')
        .map(msg => msg.content);

    const emailRegex = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
    const phoneRegex = /\b(?:\+\d{1,3}\s*)?(?:\d[\s.-]?){8,}\d\b/;
    const linkedinRegex = /linkedin\.com\/[a-z]{2,3}\/[\w-]+|linkedin\.com\/in\/[\w-]+/i;
    const nameRegex = /\b(mi nombre es|me llamo)\s+[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ.-]+/i;
    const contactKeyword = /(puedes escribirme|contáctame|te dejo mi|mi correo|mi email|mi whatsapp|mi teléfono|mi movil|mi móvil)/i;

    return userMessages.some(text =>
        emailRegex.test(text) ||
        phoneRegex.test(text) ||
        linkedinRegex.test(text) ||
        nameRegex.test(text) ||
        contactKeyword.test(text)
    );
}

function ensureCallToAction(reply, hasContactInfo = false) {
    const contactFallback = '¿Me dejas tu nombre y cómo contactarte (email o LinkedIn)? Si lo prefieres, cuéntame otra duda ahora y te respondo al momento.';
    const questionFallback = 'Dime qué duda o detalle concreto quieres que cubra ahora y seguimos.';
    const fallback = hasContactInfo ? questionFallback : contactFallback;
    if (!reply || typeof reply !== 'string') return fallback;

    const normalized = reply.toLowerCase();
    const hasContactCue = /(nombre|contacto|contactar|correo|email|linkedin|whatsapp)/.test(normalized);
    const hasQuestionCue = /(pregunta|duda|querías saber algo más|que mas necesitas|que más necesitas|en qué más)/.test(normalized);

    if (hasContactInfo && hasContactCue) {
        // Evitar insistir si ya dio sus datos; prioriza abrir siguiente duda
        return `${reply.trim()}\n\n${questionFallback}`;
    }

    if (hasContactCue || hasQuestionCue) return reply;
    return `${reply.trim()}\n\n${fallback}`;
}

// Funciones de persistencia eliminadas a favor de SQLite


// Determinar ruta de estáticos (public o client)
const publicPath = path.join(__dirname, 'public');
const clientPath = path.join(__dirname, 'client');
const usePublic = fs.existsSync(publicPath);
const staticPath = usePublic ? publicPath : clientPath;
console.log(`✓ Sirviendo estáticos desde: ${usePublic ? 'public (Build)' : 'client (Dev)'}`);

app.get('/', (req, res) => {
    res.sendFile(path.join(staticPath, 'index.html'));
});

app.post('/api/chat', async (req, res) => {
    const { message, sessionId } = req.body || {};
    if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: 'Se requiere campo `message` en el body.' });
    }

    if (!OPENAI_API_KEY) {
        return res.status(503).json({ error: 'OPENAI_API_KEY no configurada en el servidor.' });
    }

    // Generar o usar sessionId existente
    const sid = sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
        // Recuperar historial desde SQLite
        const history = await db.getMessages(sid);
        const userHasSharedContact = hasUserProvidedContact(history, { role: 'user', content: message });

        // Usar búsqueda semántica para construir el system prompt
        let systemPrompt;
        try {
            if (!knowledgeText) throw new Error('Knowledge base vacía');
            systemPrompt = await buildContextualSystemPrompt(knowledgeText, message);
        } catch (err) {
            console.warn('Error en búsqueda semántica (o knowledge vacío), usando prompt estándar:', err.message);
            // Fallback al prompt estándar
            const profile = extractProfileBasic(knowledgeText);
            const profileName = profile.name;
            const profileTitle = profile.title;
            systemPrompt = `Eres un asistente conversacional en español.
INSTRUCCIONES:
- Informa que hay un problema temporal para acceder al perfil de ${profileName}${profileTitle ? `, ${profileTitle}` : ''}.
- Responde con cortesía y concisión.
- Usa Markdown simple: negritas para ideas clave, listas breves y enlaces cuando aplique.
- Si no puedes responder, ofrece este enlace para contacto directo: https://www.linkedin.com/in/pepbernat4/ y sugiere que deje su forma de contactar para que le escribas.
- Cierra cada respuesta pidiendo su nombre y un medio de contacto (email o LinkedIn) o, si no quiere aún, invitando a que lance otra pregunta concreta.
- Si ya compartió sus datos de contacto, no los vuelvas a pedir; céntrate en resolver su duda o en la siguiente pregunta que deba responderte.
- No inventes datos.`;
        }

        // Construir messages incluyendo historial (history son {role, content, timestamp})
        const messages = [
            { role: 'system', content: systemPrompt },
            ...serializeMessagesForModel(history),
            { role: 'user', content: message }
        ];

        const payload = {
            model: OPENAI_MODEL,
            messages: messages,
            max_tokens: parseInt(process.env.MAX_TOKENS || '2000', 10),
            temperature: parseFloat(process.env.TEMPERATURE || '0')
        };

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const t = await response.text();
            console.error('OpenAI API error:', response.status, t);
            return res.status(502).json({ error: 'Error desde la API de OpenAI', details: t });
        }

        const data = await response.json();
        const modelReply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
            ? data.choices[0].message.content.trim()
            : null;

        // ensureCallToAction logic (can be uncommented if needed)
        const reply = modelReply; // ensureCallToAction(modelReply, userHasSharedContact);

        // Guardar mensajes en SQLite
        await db.addMessage(sid, 'user', message);
        await db.addMessage(sid, 'assistant', reply);

        return res.json({ reply, sessionId: sid });
    } catch (error) {
        console.error('Error al procesar chat:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
});


// --- AUTENTICACIÓN Y SEGURIDAD ---

const requireAuth = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'No autorizado' });

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(401).json({ error: 'Token inválido' });
        req.user = decoded;
        next();
    });
};

const requireAdmin = (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Acceso denegado: Requiere Admin' });
    }
    next();
};

app.get('/api/auth/status', async (req, res) => {
    const hasUsers = await db.hasUsers();
    let isLoggedIn = false;
    let user = null;

    if (req.cookies.token) {
        try {
            user = jwt.verify(req.cookies.token, JWT_SECRET);
            isLoggedIn = true;
        } catch (e) { /* Token inválido, ignorar */ }
    }

    res.json({
        setupNeeded: !hasUsers,
        isLoggedIn,
        user: user ? { username: user.username, role: user.role } : null
    });
});

app.post('/api/auth/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Faltan datos' });

    const hasUsers = await db.hasUsers();
    if (hasUsers && (!req.cookies.token || !jwt.verify(req.cookies.token, JWT_SECRET).role === 'admin')) {
        // Si ya hay usuarios, solo un admin autenticado debería poder crear más (pero para el setup inicial permitimos solo si 0 users)
        // La lógica aquí debe ser: Permitir público SOLO si count=0.
        // Si count>0, rechazar (el admin usará /api/users para crear).
        return res.status(403).json({ error: 'El registro público está cerrado.' });
    }

    try {
        const hash = await bcrypt.hash(password, 10);
        // db.createUser maneja que el primero sea admin
        const newUser = await db.createUser(username, hash);

        // Auto login si es el primer usuario (setup)
        if (!hasUsers) {
            const token = jwt.sign({ username: newUser.username, role: newUser.role }, JWT_SECRET, { expiresIn: '12h' });
            res.cookie('token', token, { httpOnly: true, secure: false }); // secure false para dev/http
        }

        res.json({ success: true, user: newUser });
    } catch (err) {
        if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Usuario ya existe' });
        res.status(500).json({ error: 'Error al registrar' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await db.getUser(username);

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
        return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const token = jwt.sign({ username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '12h' });
    res.cookie('token', token, { httpOnly: true, secure: false });
    res.json({ success: true, user: { username: user.username, role: user.role } });
});

app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ success: true });
});

// --- API USER MANAGEMENT (ADMIN) ---

app.get('/api/users', requireAuth, requireAdmin, async (req, res) => {
    const users = await db.listUsers();
    res.json({ users });
});

app.post('/api/users', requireAuth, requireAdmin, async (req, res) => {
    const { username, password, role } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Faltan datos' });

    try {
        const hash = await bcrypt.hash(password, 10);
        await db.createUser(username, hash, role || 'readonly');
        res.json({ success: true });
    } catch (err) {
        if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Usuario ya existe' });
        res.status(500).json({ error: 'Error al crear usuario' });
    }
});

app.delete('/api/users/:username', requireAuth, requireAdmin, async (req, res) => {
    if (req.params.username === req.user.username) return res.status(400).json({ error: 'No puedes borrarte a ti mismo' });
    await db.deleteUser(req.params.username);
    res.json({ success: true });
});


// Endpoint para sugerencias de preguntas (usado por el frontend)
//  - Devuelve las preguntas más importantes fijas al inicio
//  - Añade hasta 3 sugerencias adicionales seleccionadas aleatoriamente según el contenido de `knowledge`
app.get('/api/suggestions', (req, res) => {
    try {
        // Preguntas fijas (las más importantes)
        const fixed = [
            'Hazme un resumen de tu experiencia profesional en travel tech y touroperación.',
            '¿Cómo contacto contigo?'
        ];

        // Lista de candidatos siempre disponibles (se añadirán aleatoriamente)
        const candidates = [
            '¿Cuáles son tus logros más relevantes liderando producto, tecnología y negocio?',
            'Explícame qué te aportó el PDD de IESE y cómo aplicas esa formación en tu día a día.',
            '¿En qué empresas has trabajado?',
            '¿Cuáles son tus habilidades clave para liderar proyectos de travel tech?',
            '¿Cómo ha evolucionado tu carrera hasta llegar a tu puesto actual?',
            '¿Qué tipo de consultoría y servicios ofreces a touroperadores, OTAs y otras empresas?',
            'Háblame de tus carreras de trail running y qué dicen de ti como líder y profesional.',
            '¿Qué valores guían tu trabajo y tus decisiones profesionales?'
        ];

        // Elegir hasta 3 aleatorios de los candidatos
        const shuffled = candidates.sort(() => Math.random() - 0.5);
        const randomPick = shuffled.slice(0, 3);

        const suggestions = [...fixed, ...randomPick].slice(0, 6);
        return res.json({ suggestions });
    } catch (err) {
        return res.json({ suggestions: ['¿A qué te dedicas actualmente?', '¿Cuáles son tus habilidades?'] });
    }
});

// --- DASHBOARD API (PROTECTED) ---

app.get('/api/dashboard/sessions', requireAuth, async (req, res) => {
    try {
        const sessions = await db.getAllSessionsWithMessages();
        const summary = sessions.map(s => ({
            sessionId: s.sessionId,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
            messageCount: s.messages.length,
            preview: s.messages.length > 0 ? s.messages[0].content.substring(0, 100) : '(Empty)'
        }));
        res.json({ sessions: summary });
    } catch (err) {
        res.status(500).json({ error: 'Error inteno' });
    }
});

app.get('/api/dashboard/sessions/:id', requireAuth, async (req, res) => {
    try {
        const messages = await db.getMessages(req.params.id);
        const session = await db.getSession(req.params.id);
        res.json({ session: { ...session, messages } });
    } catch (err) {
        res.status(500).json({ error: 'Error inteno' });
    }
});

// Serve Dashboard HTML
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(staticPath, 'dashboard.html'));
});

app.use(express.static(staticPath, {
    etag: true,
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
            // No cachear HTML para asegurar que siempre se carguen las últimas referencias
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        } else if (filePath.match(/\.[0-9a-f]{8}\.(js|css)$/)) {
            // Archivos con hash: cachear por 1 año (immutable)
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
            // Otros estáticos: cachear por 1 día
            res.setHeader('Cache-Control', 'public, max-age=86400');
        }
    }
}));

// Inicializar embeddings y servidor
async function initServer() {
    try {
        // Inicializar DB
        await db.initDB();

        if (knowledgeText && knowledgeText.length > 0) {
            console.log('Inicializando búsqueda semántica...');
            await generateKnowledgeEmbeddings(knowledgeText);
            console.log('✓ Servidor listo con búsqueda semántica activada');
        } else {
            console.warn('⚠ knowledge.md vacío o no encontrado - la búsqueda semántica no disponible');
        }
    } catch (err) {
        console.error('Error al inicializar servidor:', err.message);
        // Continuar de todas formas
    }

    app.listen(PORT, () => console.log(`✓ Servidor iniciado en http://localhost:${PORT}`));
}

initServer();
