'use strict';

async function manejarBotReglas({ sock, chat, enviarConEncabezado } = {}) {
    if (!sock || !chat) return;

    const text = [
        '🦖📜 REGLAS DE USO DE DINO BOT',
        '',
        '1. Respeta a los demás miembros y las reglas de este grupo.',
        '2. No uses el bot para spam, flood o mensajes repetidos.',
        '3. Los comandos personalizados se configuran por grupo y solo los administradores pueden cambiarlos.',
        '4. Comparte el enlace del grupo solo con personas a quienes el grupo permita invitar.',
        '5. Los comandos de owner, como .grupos y .autoadmin, son exclusivos del owner configurado.',
        '6. No publiques contraseñas, claves API ni información privada.',
        '7. Usa las respuestas de IA con criterio y verifica la información importante.'
    ].join('\n');

    const payload = { text };
    if (typeof enviarConEncabezado === 'function') {
        await enviarConEncabezado(sock, chat, payload);
    } else {
        await sock.sendMessage(chat, payload);
    }
}

module.exports = manejarBotReglas;
