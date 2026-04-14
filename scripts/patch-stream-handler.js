const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '../ia/handlers.js');
let s = fs.readFileSync(p, 'utf8');

const needle = `    const tickStreamEdit = async () => {
        // Si terminé, on arrête d'éditer via l'intervalle
        if (streamState.done) return;

        // Préparer le contenu à afficher
        let visibleContent = streamState.content.trim();
        let displayContent = '';

        // Gestion du statut "Thinking" (DeepSeek R1, etc.)
        if (streamState.isThinking || (streamState.content.includes('<redacted_thinking>') && !streamState.content.includes('</redacted_thinking>'))) {
            displayContent = '🧠 En réflexion...';
        } else if (visibleContent) {
            displayContent = visibleContent;
        } else {
            displayContent = '⏳ Génération en cours...';
        }

        // Ajouter le curseur clignotant
        displayContent += ' ▌';

        if (displayContent !== lastEditContent) {
            try {
                // On tente d'éditer
                await streamReplyMessage.edit({
                    content: displayContent,
                    components: streamState.isThinking ? [
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId('thinking_placeholder')
                                .setLabel('Réflexion en cours...')
                                .setStyle(ButtonStyle.Secondary)
                                .setDisabled(true)
                        )
                    ] : []
                });
                lastEditContent = displayContent;
            } catch (e) {
                // Ignore edit errors (message deleted, etc.)
            }
        }
    };

    void tickStreamEdit();
    const editInterval = setInterval(tickStreamEdit, config.IA_STREAM_EDIT_INTERVAL_MS || 550);

    try {
        responseText = await queryFunction(async (progress) => {
            streamState = progress;
        });`;

const replacement = `    const inThinkingBlock = () =>
        streamState.isThinking ||
        (streamState.content.includes('<redacted_thinking>') && !streamState.content.includes('</redacted_thinking>'));

    const tickStreamEdit = async () => {
        if (streamState.done) return;

        const visibleContent = streamState.content.trim();
        const thinking = inThinkingBlock();

        if (!thinking && !visibleContent) return;

        const displayContent = thinking ? '🧠' : visibleContent;

        if (displayContent !== lastEditContent) {
            try {
                await streamReplyMessage.edit({ content: displayContent, components: [] });
                lastEditContent = displayContent;
            } catch (e) {
                /* ignore */
            }
        }
    };

    const editMs = config.IA_STREAM_EDIT_INTERVAL_MS || 300;
    let primedFirstEdit = false;
    const editInterval = setInterval(tickStreamEdit, editMs);

    try {
        responseText = await queryFunction(async (progress) => {
            streamState = progress;
            if (progress.done) return;
            const v = (progress.content || '').trim();
            const th =
                progress.isThinking ||
                (progress.content &&
                    progress.content.includes('<redacted_thinking>') &&
                    !progress.content.includes('</redacted_thinking>'));
            if (!primedFirstEdit && (v.length > 0 || th)) {
                primedFirstEdit = true;
                void tickStreamEdit();
            }
        });`;

if (!s.includes(needle)) {
    console.error('Needle not found — file may already be patched or line endings differ.');
    process.exit(1);
}
s = s.replace(needle, replacement);
fs.writeFileSync(p, s);
console.log('OK patch-stream-handler');
