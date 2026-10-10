'use strict';

const fs = require('fs');
const path = require('path');

const RUTA_ENV = path.join(__dirname, '..', '.env');
const URL_RESPONSES = 'https://api.openai.com/v1/responses';

function cargarEnvLocal() {
    try {
        if (!fs.existsSync(RUTA_ENV)) return;
        const lineas = fs.readFileSync(RUTA_ENV, 'utf8').split(/\r?\n/);
        for (const linea of lineas) {
            const limpia = linea.trim();
            if (!limpia || limpia.startsWith('#')) continue;
            const separador = limpia.indexOf('=');
            if (separador < 1) continue;
            const nombre = limpia.slice(0, separador).trim();
            let valor = limpia.slice(separador + 1).trim();
            if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
                valor = valor.slice(1, -1);
            }
            if (process.env[nombre] === undefined) process.env[nombre] = valor;
        }
    } catch (error) {
        console.error('🦖❌ No pude leer el archivo .env:', error.message);
    }
}

cargarEnvLocal();

async function responder(sock, chat, contenido, enviarConEncabezado) {
    if (typeof enviarConEncabezado === 'function') {
        return enviarConEncabezado(sock, chat, contenido);
    }
    return sock.sendMessage(chat, contenido);
}

function extraerTextoRespuesta(datos) {
    if (typeof datos?.output_text === 'string' && datos.output_text.trim()) {
        return datos.output_text.trim();
    }
    const bloques = (datos?.output || []).flatMap(elemento => Array.isArray(elemento.content) ? elemento.content : []);
    return bloques
        .filter(bloque => bloque.type === 'output_text' && typeof bloque.text === 'string')
        .map(bloque => bloque.text)
        .join('\n')
        .trim();
}

async function manejarIA({ sock, chat, mensaje, pregunta = '', enviarConEncabezado } = {}) {
    const enviar = contenido => responder(sock, chat, contenido, enviarConEncabezado);
    const consulta = String(pregunta || '').trim();

    if (!consulta) {
        await enviar({ text: '🦖 Escribe tu pregunta después del comando.\nEjemplo: .ia ¿Qué es un dinosaurio?' });
        return;
    }

    if (consulta.length > 4000) {
        await enviar({ text: '🦖 La pregunta está muy larga. Prueba con un mensaje de menos de 4,000 caracteres.' });
        return;
    }

    const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
    if (!apiKey || /tu\s*api\s*aqui|pega.*(?:api|clave)|placeholder/i.test(apiKey)) {
        await enviar({
            text: '🦖 Falta configurar la API. Abre el archivo .env en la carpeta principal y reemplaza el texto de OPENAI_API_KEY por tu clave secreta. No la compartas en el chat.'
        });
        return;
    }

    try {
        try { await sock.sendMessage(chat, { react: { text: '⏳', key: mensaje?.key } }); } catch (_) {}

        const modelo = String(process.env.OPENAI_MODEL || 'gpt-6-luna').trim();
        const respuesta = await fetch(URL_RESPONSES, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: modelo,
                instructions: 'Eres el asistente de DINO BOT. Responde en español, de forma clara, amable y útil. Mantén las respuestas concisas para WhatsApp. Si no sabes algo, dilo con honestidad.',
                input: consulta,
                max_output_tokens: 500,
                store: false
            }),
            signal: AbortSignal.timeout(45000)
        });

        const datos = await respuesta.json().catch(() => ({}));
        if (!respuesta.ok) {
            const detalle = datos?.error?.message || `La API respondió con HTTP ${respuesta.status}.`;
            throw new Error(detalle);
        }

        const textoRespuesta = extraerTextoRespuesta(datos);
        if (!textoRespuesta) throw new Error('La API no devolvió texto. Intenta de nuevo con otra pregunta.');

        await enviar({ text: `🦖🤖 *DINO IA*\n\n${textoRespuesta}` });
        try { await sock.sendMessage(chat, { react: { text: '✅', key: mensaje?.key } }); } catch (_) {}
    } catch (error) {
        console.error('🦖❌ Error en .ia:', error.message);
        try { await sock.sendMessage(chat, { react: { text: '❌', key: mensaje?.key } }); } catch (_) {}
        const detalle = String(error.message || 'Error desconocido').slice(0, 700);
        await enviar({ text: `🦖❌ No pude responder con IA.\n\n${detalle}` });
    }
}

module.exports = manejarIA;
