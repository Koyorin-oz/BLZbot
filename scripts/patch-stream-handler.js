const fs = require('fs');
const path = require('path');

const p = path.join(__dirname, '../ia/handlers.js');
let s = fs.readFileSync(p, 'utf8');

const start = s.indexOf('    const tickStreamEdit = async () => {');
const q = s.indexOf('        responseText = await queryFunction(async (progress) => {', start);
const end = s.indexOf('        });', q) + '        });'.length;

if (start < 0 || q < 0 || end < 20) {
    console.error('slice markers failed', { start, q, end });
    process.exit(1);
}

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

fs.writeFileSync(p, s.slice(0, start) + replacement + s.slice(end));
console.log('patched stream block', { start, end });
