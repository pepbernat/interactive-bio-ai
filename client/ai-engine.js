class AIEngine {
    constructor() { }

    async processMessage(message, sessionId) {
        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message, sessionId })
            });

            if (!res.ok) {
                const text = await res.text();
                console.error('Error desde /api/chat:', res.status, text);
                throw new Error('Error desde el servidor de IA');
            }

            const data = await res.json();
            // Actualizar sessionId si el servidor devuelve uno nuevo
            if (data.sessionId) {
                chatState.sessionId = data.sessionId;
            }
            return data.reply || "Lo siento, no he podido generar una respuesta en este momento.";
        } catch (error) {
            console.error('Error al llamar al backend:', error);
            return "Lo siento, ocurrió un error al contactar al servicio de IA.";
        }
    }

    async getQuestionSuggestions() {
        try {
            const res = await fetch('/api/suggestions');
            if (!res.ok) return ["¿Qué quieres saber sobre mí?", "¿Puedes contarme tu experiencia?"];
            const data = await res.json();
            return Array.isArray(data.suggestions) ? data.suggestions : [];
        } catch (err) {
            console.warn('No se pudieron cargar sugerencias desde el servidor:', err);
            return ["¿Quién eres?", "¿Cuáles son tus habilidades técnicas?", "¿Cómo puedo contactarte?"];
        }
    }
}