# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (hot reload)
npm run dev

# Build frontend assets (minifies JS/CSS, adds MD5 hashes for cache-busting)
npm run build

# Start production server
npm start

# Utility scripts
node scripts/check-db.js      # Check database status
node scripts/test-db.js       # Test database connectivity
node scripts/reset-admin.js   # Reset admin user
```

No test runner or linter is configured.

## Architecture

**Interactive Bio AI** is a personal conversational assistant for Pep Bernat, powered by OpenAI gpt-5.4-nano with RAG over a [knowledge.md](knowledge.md) knowledge base.

### Stack
- **Backend:** Node.js + Express (`server.js`)
- **Frontend:** Vanilla HTML/CSS/JS (no framework) in [client/](client/)
- **Database:** SQLite via `better-sqlite3` (sessions, messages, users)
- **AI:** OpenAI API — `text-embedding-3-large` for semantic search, `gpt-5.4-nano` for chat
- **Container:** Multi-stage Docker build → GitHub Container Registry (ghcr.io)

### Request Flow

```
User message
  → POST /api/chat (sessionId + message)
  → Retrieve session history from SQLite
  → Semantic search over knowledge.md chunks (cosine similarity on embeddings)
  → Build system prompt from config.json template with injected context
  → OpenAI chat completion
  → Persist user + AI messages to SQLite
  → Return response
```

### Key Files

| File                  | Purpose                                                                          |
| --------------------- | -------------------------------------------------------------------------------- |
| `server.js`           | Express app, all API routes, startup initialization                              |
| `src/db.js`           | SQLite database: sessions, messages, users tables                                |
| `src/embeddings.js`   | RAG engine: chunk knowledge.md, embed, cosine search                             |
| `config.json`         | System prompt template with `{{PROFILE_NAME}}` / `{{CONTEXT_INFO}}` placeholders |
| `knowledge.md`        | Pep's professional profile — the RAG knowledge base                              |
| `client/main.js`      | Chat UI, avatar animations, API calls                                            |
| `client/ai-engine.js` | Local AI inference fallback (minimal)                                            |
| `scripts/build.js`    | Asset pipeline: minify, hash, copy to `public/`                                  |

### Frontend Build

`client/` is source; `public/` is the built output (gitignored). The build script:
1. Minifies `main.js` and `ai-engine.js` with Terser
2. Minifies `styles.css` with clean-css
3. Renames all assets with MD5 content hashes
4. Updates `index.html` references to hashed filenames

Always run `npm run build` after editing anything in `client/` before testing in production mode or building the Docker image.

### Authentication

Single-user admin model: first registered user becomes admin. JWT tokens are stored as HTTP-only cookies. Dashboard (`/dashboard`) requires authentication. The chat endpoint (`/api/chat`) is public and session-based (UUID sessionId from client).

### Embeddings Cache

`src/.embeddings_cache.json` stores pre-computed embeddings for `knowledge.md` chunks. It is auto-regenerated if `knowledge.md` changes (content hash check). Set `DEBUG_EMBEDDINGS=true` in `.env` to log embedding activity.

### Environment Variables

Required in `.env`:
- `OPENAI_API_KEY` — OpenAI API key
- `OPENAI_MODEL` — model name (default: `gpt-5.4-nano`)
- `MAX_TOKENS`, `TEMPERATURE` — generation config

Optional:
- `PORT` / `HOST` — server binding (default: `3000` / `0.0.0.0`)
- `DEBUG_EMBEDDINGS` — verbose embedding logs
- Google Sheets credentials for conversation logging

### CI/CD

GitHub Actions builds and pushes multi-arch Docker images (`linux/amd64` + `linux/arm64`) to `ghcr.io` on push to `main` or version tags.
