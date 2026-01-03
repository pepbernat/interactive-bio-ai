/**
 * Implementación basada en OpenAI Embeddings + cache en disco.
 * Requisitos: variable de entorno `OPENAI_API_KEY`.
 * Política: si no existe la API key o la generación de embeddings falla, el sistema
 * fallará en el inicio (no hay fallback silencioso), para garantizar comportamiento
 * determinista — tal como solicitaste.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY no encontrada. Configure la variable de entorno para usar embeddings de OpenAI.');
}

const EMB_CACHE_FILE = path.join(__dirname, '.embeddings_cache.json');
let knowledgeChunks = [];
let knowledgeEmbeddings = null;
// Activar depuración de embeddings con la variable de entorno DEBUG_EMBEDDINGS=1
const DEBUG = process.env.DEBUG_EMBEDDINGS === '1' || process.env.OPENAI_DEBUG_EMBEDDINGS === '1';

function sha256(obj) {
  const s = JSON.stringify(obj);
  return crypto.createHash('sha256').update(s).digest('hex');
}

async function openaiEmbed(text) {
  const url = 'https://api.openai.com/v1/embeddings';
  const body = {
    model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-large',
    input: text,
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`OpenAI Embeddings error: ${resp.status} ${t}`);
  }

  const data = await resp.json();
  if (!data.data || !data.data[0] || !data.data[0].embedding) {
    throw new Error('Respuesta inválida de embeddings');
  }
  return data.data[0].embedding;
}

/**
 * Procesa el contenido Markdown y lo divide en chunks semánticos basados en encabezados.
 */
function chunkKnowledge(markdownText) {
  const chunks = [];
  if (!markdownText || typeof markdownText !== 'string') return chunks;

  // Normalizar saltos de línea
  const text = markdownText.replace(/\r\n/g, '\n');

  // Dividir por encabezados de nivel 1 o 2 (ej: # Titulo o ## Subtitulo)
  // Usamos un regex que capture el encabezado para mantenerlo en el chunk si queremos, 
  // o simplemente usamos el split para separar bloques.
  // Estrategia: Split por `\n#{1,2} ` para detectar inicios de sección.

  const rawSections = text.split(/\n(?=#{1,2}\s)/g);

  rawSections.forEach(section => {
    const trimmed = section.trim();
    if (!trimmed) return;

    // Detectar título (primera línea)
    const firstLineMatch = trimmed.match(/^(#{1,6})\s+(.*)/);
    let title = 'General';
    let content = trimmed;

    if (firstLineMatch) {
      title = firstLineMatch[2].trim();
      // Eliminar los # del título para el 'type'
      // content = trimmed; // Mantenemos el título en el texto para dar contexto
    } else {
      // Si no empieza con # (ej: el preámbulo antes del primer título), es la intro
      if (trimmed.startsWith('Perfil:')) {
        title = 'Perfil';
      }
    }

    // Sub-dividir secciones muy largas si fuera necesario (por ahora confiamos en el tamaño razonable de los bloques)
    // Para "Experiencia Profesional", que tiene sub-headers (###), podemos subdividir más.

    if (trimmed.includes('\n### ')) {
      const subSections = trimmed.split(/\n(?=### )/g);
      subSections.forEach(sub => {
        const subTrimmed = sub.trim();
        if (!subTrimmed) return;
        // Verificar título sub
        const subMatch = subTrimmed.match(/^(#{3,6})\s+(.*)/);
        let subTitle = title;
        if (subMatch) {
          subTitle = `${title} - ${subMatch[2].trim()}`;
        }
        chunks.push({
          type: subTitle,
          text: subTrimmed
        });
      });
    } else {
      chunks.push({
        type: title,
        text: trimmed
      });
    }
  });

  return chunks;
}

const configPath = path.join(__dirname, '../config.json');
let config = {};
try {
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
} catch (err) {
  console.warn('Advertencia: No se pudo cargar config.json', err.message);
}

// Extractor simple para metadatos del perfil desde el Markdown (para el prompt del sistema)
function extractProfileInfo(markdownText) {
  const nameMatch = markdownText.match(/^# Perfil:\s*(.*)/m);
  const headlineMatch = markdownText.match(/- Headline:\s*(.*)/m);

  return {
    name: nameMatch ? nameMatch[1].trim() : (config.fallbackProfileName || 'Asistente'),
    headline: headlineMatch ? headlineMatch[1].trim() : ''
  };
}


async function generateKnowledgeEmbeddings(markdownText) {
  knowledgeChunks = chunkKnowledge(markdownText);
  const currentHash = sha256(knowledgeChunks);

  try {
    if (fs.existsSync(EMB_CACHE_FILE)) {
      const raw = fs.readFileSync(EMB_CACHE_FILE, 'utf8');
      const cache = JSON.parse(raw);
      if (
        cache &&
        cache.hash === currentHash &&
        Array.isArray(cache.embeddings) &&
        cache.embeddings.length === knowledgeChunks.length
      ) {
        knowledgeEmbeddings = cache.embeddings;
        console.log(`✓ Cargadas ${knowledgeEmbeddings.length} embeddings desde cache`);
        return;
      }
    }
  } catch (err) {
    console.warn('Advertencia leyendo cache de embeddings, se regenerará:', err.message);
  }

  console.log('Generando embeddings con OpenAI (esto puede costar y tardar unos segundos)...');
  knowledgeEmbeddings = [];
  for (let i = 0; i < knowledgeChunks.length; i++) {
    const text = knowledgeChunks[i].text;
    try {
      const emb = await openaiEmbed(text);
      knowledgeEmbeddings.push(emb);
    } catch (err) {
      throw new Error(`Error generando embeddings para chunk ${i}: ${err.message}`);
    }
  }

  try {
    fs.writeFileSync(EMB_CACHE_FILE, JSON.stringify({ hash: currentHash, embeddings: knowledgeEmbeddings }, null, 2), 'utf8');
    console.log(`✓ Embeddings generados y guardados (${knowledgeEmbeddings.length} chunks)`);
  } catch (err) {
    console.warn('No se pudo guardar cache de embeddings:', err.message);
  }
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function searchRelevantChunks(query, topK = 5) {
  if (!knowledgeChunks || knowledgeChunks.length === 0) {
    throw new Error('Embeddings no inicializados. Ejecute generateKnowledgeEmbeddings(knowledge) en el arranque.');
  }
  if (!knowledgeEmbeddings || knowledgeEmbeddings.length === 0) {
    throw new Error('Embeddings no disponibles. Ejecute generateKnowledgeEmbeddings(knowledge) en el arranque.');
  }
  const queryEmbedding = await openaiEmbed(query);

  if (DEBUG) {
    console.log('[embeddings-debug] query:', query);
    console.log('[embeddings-debug] topK:', topK, 'knowledgeChunks:', knowledgeChunks.length, 'embeddingLen:', queryEmbedding.length);
  }

  const similarities = knowledgeEmbeddings.map((emb, idx) => ({
    index: idx,
    similarity: cosineSimilarity(queryEmbedding, emb),
    chunk: knowledgeChunks[idx]
  }));

  // Ordenar por similitud (desc)
  const sorted = similarities.sort((a, b) => b.similarity - a.similarity);

  if (DEBUG) {
    console.log('[embeddings-debug] Top 10 candidatas (index, similarity, type, text-preview):');
    sorted.slice(0, 10).forEach(s => {
      const preview = (s.chunk && s.chunk.text) ? s.chunk.text.replace(/\s+/g, ' ').substring(0, 140) : '';
      console.log(`[embeddings-debug] #${s.index} ${s.similarity.toFixed(4)} ${s.chunk?.type || ''} - ${preview}${preview.length === 140 ? '...' : ''}`);
    });
  }

  const results = sorted
    .slice(0, topK)
    .filter(s => s.similarity > 0.2)
    .map(s => ({
      text: s.chunk.text,
      type: s.chunk.type,
      similarity: s.similarity
    }));

  if (DEBUG) {
    console.log('[embeddings-debug] Resultados finales (post-filter):', results.map(r => ({ type: r.type, sim: r.similarity.toFixed(4), textPreview: r.text.substring(0, 120) })));
  }

  return results;
}

async function buildContextualSystemPrompt(markdownText, userMessage) {
  // Recargar config si se desea caliente, o usar la ya cargada
  // Por simplicidad usamos la variable 'config' global de modulo cargada al inicio, 
  // pero para desarrollo real igual interesa reload.

  const profileInfo = extractProfileInfo(markdownText);
  const profileName = profileInfo.name;

  const relevantChunks = await searchRelevantChunks(userMessage, 5);

  if (DEBUG) {
    console.log('[embeddings-debug] Construyendo prompt. userMessage:', userMessage);
    console.log('[embeddings-debug] Chunks relevantes seleccionados:', relevantChunks.map((c, i) => ({ i, type: c.type, sim: c.similarity.toFixed(4), preview: c.text.substring(0, 80) })));
  }

  let contextInfo = '';
  if (relevantChunks.length > 0) {
    contextInfo = 'INFORMACIÓN RELEVANTE DEL PERFIL:\n';
    relevantChunks.forEach(chunk => {
      contextInfo += `--- BLOQUE: ${chunk.type} ---\n${chunk.text}\n\n`;
    });
  } else {
    contextInfo = `INFORMACIÓN DEL PERFIL:\n• Nombre: ${profileName}\n• ${profileInfo.headline}`;
  }

  let prompt = config.systemPromptTemplate || '';
  if (Array.isArray(prompt)) {
    prompt = prompt.join('\n');
  }

  // Reemplazo de variables en el template
  prompt = prompt.replace('{{PROFILE_NAME}}', profileName);
  prompt = prompt.replace('{{CONTEXT_INFO}}', contextInfo);

  return prompt;
}

module.exports = {
  generateKnowledgeEmbeddings,
  searchRelevantChunks,
  buildContextualSystemPrompt,
  chunkKnowledge // Export for testing
};
