// Mensajes base para mantener una bienvenida consistente
const WELCOME_MESSAGE = '¡Hola! Soy Pep en modo asistente. ¿Me compartes tu nombre y qué te trae por aquí (selección, reto o curiosidad)? Cuéntamelo y lanza las preguntas que tengas para responderte a medida.';
const SECONDARY_PROMPT = 'Preséntate con tu nombre y el motivo de tu visita; así afino mis respuestas. De paso, dispara cualquier duda o curiosidad sobre mi perfil, cómo trabajo o cómo puedo ayudarte y te contesto directo y con respeto.';

// Utilidades de formato seguro para mensajes con saltos de línea, negritas y enlaces
function escapeHTML(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatMessageContent(content = '') {
    const escaped = escapeHTML(content);
    // Markdown simple: **negrita**
    const bolded = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Markdown links: [texto](url)
    const linked = bolded.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    // Saltos de línea
    return linked.replace(/\n/g, '<br>');
}

// Configuración y estado del chat
const chatState = {
    messages: [],
    isProcessing: false,
    currentMessage: '',
    aiEngine: null,
    sessionId: null
};

// Elementos del DOM
const elements = {
    chatMessages: document.getElementById('chatMessages'),
    chatInput: document.getElementById('chatInput'),
    sendButton: document.getElementById('sendButton'),
    typingIndicator: document.getElementById('typingIndicator'),
    avatarThinking: document.getElementById('avatarThinking'),
    quickQuestions: document.querySelectorAll('.quick-question'),
    avatarImage: document.getElementById('avatarImage'),
    particlesContainer: document.getElementById('particles'),
    charCount: document.getElementById('charCount'),
    clearHistory: document.getElementById('clearHistory'),
    scrollHelper: document.getElementById('scrollHelper'),
    seoPanel: document.querySelector('.seo-panel'),
    seoToggle: document.getElementById('seoToggle')
};

// Sistema de partículas
class ParticleSystem {
    constructor(container) {
        this.container = container;
        this.particles = [];
        this.init();
    }

    init() {
        this.createParticles();
        this.animate();
    }

    createParticles() {
        const particleCount = 50;

        for (let i = 0; i < particleCount; i++) {
            const particle = document.createElement('div');
            particle.style.position = 'absolute';
            particle.style.width = Math.random() * 4 + 1 + 'px';
            particle.style.height = particle.style.width;
            particle.style.background = `rgba(${Math.random() * 100 + 155}, ${Math.random() * 100 + 155}, 255, ${Math.random() * 0.5 + 0.2})`;
            particle.style.borderRadius = '50%';
            particle.style.pointerEvents = 'none';

            const particleData = {
                element: particle,
                x: Math.random() * window.innerWidth,
                y: Math.random() * window.innerHeight,
                vx: (Math.random() - 0.5) * 0.5,
                vy: (Math.random() - 0.5) * 0.5,
                life: Math.random() * 100 + 50
            };

            particle.style.left = particleData.x + 'px';
            particle.style.top = particleData.y + 'px';

            this.container.appendChild(particle);
            this.particles.push(particleData);
        }
    }

    animate() {
        this.particles.forEach(particle => {
            particle.x += particle.vx;
            particle.y += particle.vy;
            particle.life--;

            if (particle.x < 0 || particle.x > window.innerWidth) particle.vx *= -1;
            if (particle.y < 0 || particle.y > window.innerHeight) particle.vy *= -1;

            if (particle.life <= 0) {
                particle.life = Math.random() * 100 + 50;
                particle.element.style.opacity = Math.random() * 0.5 + 0.2;
            }

            particle.element.style.left = particle.x + 'px';
            particle.element.style.top = particle.y + 'px';
            particle.element.style.opacity = particle.life / 100;
        });

        requestAnimationFrame(() => this.animate());
    }
}

// Sistema de chat
class ChatSystem {
    constructor() {
        this.initializeEventListeners();
        this.particleSystem = new ParticleSystem(elements.particlesContainer);
        this.resetConversation();
        this.updateCharCount();
        this.autoResizeInput();
        this.initializeAI();
        this.handleResponsiveSections();
    }

    async initializeAI() {
        chatState.aiEngine = new AIEngine();
        // Actualizar sugerencias de preguntas desde el backend
        //await this.updateQuestionSuggestions();
    }

    async updateQuestionSuggestions() {
        if (chatState.aiEngine) {
            const suggestions = await chatState.aiEngine.getQuestionSuggestions();
            const quickQuestionsContainer = document.querySelector('.quick-questions');
            if (!quickQuestionsContainer) return;

            // Limpiar sugerencias existentes
            quickQuestionsContainer.innerHTML = '';

            // Agregar nuevas sugerencias
            (Array.isArray(suggestions) ? suggestions : []).slice(0, 6).forEach(question => {
                const button = document.createElement('button');
                button.className = 'quick-question';
                button.textContent = question.replace('¿', '').replace('?', '');
                button.dataset.question = question;
                button.addEventListener('click', (e) => {
                    this.sendQuickQuestion(question);
                    VisualEffects.addGlowEffect(button);
                    VisualEffects.createRippleEffect(button, e);
                });
                quickQuestionsContainer.appendChild(button);
            });
        }
    }

    initializeEventListeners() {
        // Enviar mensaje con botón
        elements.sendButton.addEventListener('click', () => this.sendMessage());

        // Enviar mensaje con Enter
        elements.chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        elements.chatInput.addEventListener('input', () => {
            this.updateCharCount();
            this.autoResizeInput();
        });

        // Preguntas rápidas
        elements.quickQuestions.forEach(button => {
            button.addEventListener('click', (e) => {
                const question = e.target.dataset.question;
                this.sendQuickQuestion(question);
            });
        });

        // Animación del avatar al hacer clic
        elements.avatarImage.addEventListener('click', () => {
            this.animateAvatar();
        });

        if (elements.clearHistory) {
            elements.clearHistory.addEventListener('click', () => this.resetConversation(true));
        }

        if (elements.chatMessages) {
            elements.chatMessages.addEventListener('scroll', () => this.toggleScrollHelper());
        }

        if (elements.scrollHelper) {
            elements.scrollHelper.addEventListener('click', () => {
                this.scrollToBottom(true);
            });
        }

        if (elements.seoToggle && elements.seoPanel) {
            elements.seoToggle.addEventListener('click', () => this.toggleSeoPanel());
        }
    }

    async sendMessage() {
        const message = elements.chatInput.value.trim();
        if (!message || chatState.isProcessing) return;

        // Limpiar input
        elements.chatInput.value = '';
        this.updateCharCount();
        this.autoResizeInput();

        // Agregar mensaje del usuario
        this.addMessage(message, 'user');

        // Mostrar indicador de escritura
        this.showTypingIndicator();

        // Procesar respuesta
        await this.processResponse(message);

        // Ocultar indicador de escritura
        this.hideTypingIndicator();
    }

    async sendQuickQuestion(question) {
        if (chatState.isProcessing) return;

        this.scrollChatSectionIntoView();

        // Agregar pregunta como mensaje del usuario
        this.addMessage(question, 'user');

        // Mostrar indicador de escritura
        this.showTypingIndicator();

        // Procesar respuesta
        await this.processResponse(question);

        // Ocultar indicador de escritura
        this.hideTypingIndicator();
    }

    addMessage(content, sender) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}`;

        const bubbleDiv = document.createElement('div');
        bubbleDiv.className = 'message-bubble';
        bubbleDiv.innerHTML = formatMessageContent(content);

        messageDiv.appendChild(bubbleDiv);
        elements.chatMessages.appendChild(messageDiv);

        // Scroll al final
        this.scrollToBottom();

        // Guardar en el estado
        chatState.messages.push({ content, sender, timestamp: new Date() });
    }

    resetConversation(announce = false) {
        if (!elements.chatMessages) return;
        elements.chatMessages.innerHTML = '';
        chatState.messages = [];
        this.addMessage(WELCOME_MESSAGE, 'assistant');

        if (announce) {
            this.addMessage('Listo, he limpiado la conversación. ¿Por dónde continuamos?', 'assistant');
        }

        if (elements.chatInput) {
            elements.chatInput.value = '';
            this.updateCharCount();
            this.autoResizeInput();
        }

        this.hideTypingIndicator();
        this.toggleScrollHelper();
    }

    async processResponse(userMessage) {
        chatState.isProcessing = true;
        elements.sendButton.disabled = true;

        // Mostrar avatar pensando
        this.showAvatarThinking();

        let response;
        try {
            // Procesar con IA, pasando sessionId
            if (chatState.aiEngine) {
                response = await chatState.aiEngine.processMessage(userMessage, chatState.sessionId);
            } else {
                response = "Lo siento, mi sistema de IA no está disponible en este momento. Por favor, intenta de nuevo más tarde.";
            }
        } catch (error) {
            console.error('Error processing message:', error);
            response = "Hubo un error procesando tu mensaje. Por favor, intenta de nuevo.";
        }

        // Simular tiempo de procesamiento adicional para efecto visual
        const processingTime = Math.max(500, 1000 + Math.random() * 1000);
        await this.delay(processingTime);

        // Agregar respuesta con efecto de escritura
        await this.addMessageWithTypingEffect(response, 'assistant');

        // Ocultar avatar pensando
        this.hideAvatarThinking();

        chatState.isProcessing = false;
        elements.sendButton.disabled = false;
    }

    async addMessageWithTypingEffect(content, sender) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}`;

        const bubbleDiv = document.createElement('div');
        bubbleDiv.className = 'message-bubble';
        bubbleDiv.innerHTML = '';

        messageDiv.appendChild(bubbleDiv);
        elements.chatMessages.appendChild(messageDiv);

        const formatted = formatMessageContent(content);
        const hasMarkup = /<[^>]+>/.test(formatted);

        if (hasMarkup && sender === 'assistant') {
            // Para mantener HTML intacto, pintamos de golpe con ligera pausa
            await this.delay(80);
            bubbleDiv.innerHTML = formatted;
            this.scrollToBottom();
        } else {
            // Efecto de escritura seguro sin romper marcado
            for (let i = 0; i < formatted.length; i++) {
                bubbleDiv.innerHTML = formatted.slice(0, i + 1);
                this.scrollToBottom();
                await this.delay(15);
            }
        }

        // Guardar en el estado
        chatState.messages.push({ content, sender, timestamp: new Date() });
    }

    showTypingIndicator() {
        elements.typingIndicator.classList.add('active');
        this.scrollToBottom();
    }

    hideTypingIndicator() {
        elements.typingIndicator.classList.remove('active');
    }

    showAvatarThinking() {
        elements.avatarThinking.classList.add('active');
        elements.avatarImage.style.filter = 'brightness(1.2)';
    }

    hideAvatarThinking() {
        elements.avatarThinking.classList.remove('active');
        elements.avatarImage.style.filter = 'brightness(1)';
    }

    animateAvatar() {
        elements.avatarImage.style.transform = 'scale(1.1)';
        elements.avatarImage.style.transition = 'transform 0.3s ease';

        setTimeout(() => {
            elements.avatarImage.style.transform = 'scale(1)';
        }, 300);
    }

    scrollToBottom(focusComposer = false) {
        if (!elements.chatMessages) return;
        elements.chatMessages.scrollTo({
            top: elements.chatMessages.scrollHeight,
            behavior: 'smooth'
        });
        this.toggleScrollHelper();
        if (focusComposer && elements.chatInput) {
            elements.chatInput.focus();
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    updateCharCount() {
        if (!elements.charCount) return;
        const length = elements.chatInput.value.length;
        elements.charCount.textContent = `${length}/200`;
    }

    autoResizeInput() {
        if (!elements.chatInput) return;
        elements.chatInput.style.height = 'auto';
        elements.chatInput.style.height = `${Math.min(elements.chatInput.scrollHeight, 140)}px`;
    }

    toggleScrollHelper() {
        if (!elements.chatMessages || !elements.scrollHelper) return;
        const { scrollTop, scrollHeight, clientHeight } = elements.chatMessages;
        const offset = scrollHeight - (scrollTop + clientHeight);
        const nearBottom = offset < 80;
        elements.scrollHelper.classList.toggle('visible', !nearBottom);
    }

    toggleSeoPanel() {
        if (!elements.seoPanel || !elements.seoToggle) return;
        const isCollapsed = elements.seoPanel.classList.toggle('collapsed');
        const expanded = !isCollapsed;
        elements.seoToggle.setAttribute('aria-expanded', expanded.toString());
        const label = expanded ? 'Ocultar detalles' : 'Mostrar detalles';
        const labelSpan = elements.seoToggle.querySelector('span');
        if (labelSpan) labelSpan.textContent = label;
    }

    handleResponsiveSections() {
        if (!elements.seoPanel || !elements.seoToggle) return;
        const isMobile = window.innerWidth <= 768;
        if (isMobile) {
            elements.seoPanel.classList.add('collapsed');
            elements.seoToggle.setAttribute('aria-expanded', 'false');
            const labelSpan = elements.seoToggle.querySelector('span');
            if (labelSpan) labelSpan.textContent = 'Mostrar detalles';
        } else {
            elements.seoPanel.classList.remove('collapsed');
            elements.seoToggle.setAttribute('aria-expanded', 'true');
            const labelSpan = elements.seoToggle.querySelector('span');
            if (labelSpan) labelSpan.textContent = 'Ocultar detalles';
        }
    }

    scrollChatSectionIntoView() {
        const chatSection = document.querySelector('.chat-section');
        if (!chatSection) return;
        chatSection.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
    }
}

// Efectos visuales adicionales
class VisualEffects {
    static addGlowEffect(element) {
        element.style.boxShadow = '0 0 20px rgba(34, 211, 238, 0.65)';
        setTimeout(() => {
            element.style.boxShadow = 'none';
        }, 1000);
    }

    static createRippleEffect(element, event) {
        const ripple = document.createElement('span');
        const rect = element.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        const x = event.clientX - rect.left - size / 2;
        const y = event.clientY - rect.top - size / 2;

        ripple.style.width = ripple.style.height = size + 'px';
        ripple.style.left = x + 'px';
        ripple.style.top = y + 'px';
        ripple.style.position = 'absolute';
        ripple.style.borderRadius = '50%';
        ripple.style.background = 'rgba(249, 115, 22, 0.28)';
        ripple.style.transform = 'scale(0)';
        ripple.style.animation = 'ripple 0.6s linear';
        ripple.style.pointerEvents = 'none';

        element.style.position = 'relative';
        element.style.overflow = 'hidden';
        element.appendChild(ripple);

        setTimeout(() => {
            ripple.remove();
        }, 600);
    }
}

let chatSystemInstance = null;

// Inicialización de la aplicación
document.addEventListener('DOMContentLoaded', () => {
    chatSystemInstance = new ChatSystem();

    // Agregar efectos visuales a los botones
    elements.sendButton.addEventListener('click', (e) => {
        VisualEffects.addGlowEffect(elements.sendButton);
        VisualEffects.createRippleEffect(elements.sendButton, e);
    });

    // Efecto de brillo en preguntas rápidas
    elements.quickQuestions.forEach(button => {
        button.addEventListener('click', (e) => {
            VisualEffects.addGlowEffect(button);
            VisualEffects.createRippleEffect(button, e);
        });
    });

    // Animación inicial del avatar
    setTimeout(() => {
        chatSystemInstance.animateAvatar();
    }, 2000);

    // Mensaje de bienvenida adicional después de un tiempo
    setTimeout(async () => {
        const hasUserMessages = chatState.messages.some(message => message.sender === 'user');
        if (!hasUserMessages) {
            chatSystemInstance.showTypingIndicator();
            await chatSystemInstance.delay(1500);
            chatSystemInstance.hideTypingIndicator();
            await chatSystemInstance.addMessageWithTypingEffect(SECONDARY_PROMPT, 'assistant');
        }
    }, 5000);
});

// Manejo de redimensionamiento de ventana
window.addEventListener('resize', () => {
    if (chatSystemInstance) {
        chatSystemInstance.handleResponsiveSections();
    }
    // Recalcular partículas si es necesario
    const particles = document.querySelectorAll('#particles div');
    particles.forEach(particle => {
        if (parseFloat(particle.style.left) > window.innerWidth) {
            particle.style.left = window.innerWidth + 'px';
        }
        if (parseFloat(particle.style.top) > window.innerHeight) {
            particle.style.top = window.innerHeight + 'px';
        }
    });
});

// Prevenir el menú contextual en el avatar para mejor experiencia
elements.avatarImage.addEventListener('contextmenu', (e) => {
    e.preventDefault();
});

// Agregar animación de ripple al CSS dinámicamente
const style = document.createElement('style');
style.textContent = `
    @keyframes ripple {
        to {
            transform: scale(4);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);
