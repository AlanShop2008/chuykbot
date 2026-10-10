'use strict';

const fs = require('fs');
const path = require('path');

const RUTA_DATOS = path.join(__dirname, '..', 'database', 'comandos-grupo.json');
const COMANDOS_RESERVADOS = new Set([
    'comandos', 'link', 'ia', 'hola', 'ping', 'menu', 'owner', 'nombre',
    'play', 'play2', 'antilink', 'n'
]);

function normalizarNumero(valor) {
    return String(valor || '')
        .split('@')[0]
        .split(':')[0]
        .replace(/\D/g, '');
}

function idsDeParticipante(participante) {
    return [
        participante?.id,
        participante?.jid,
        participante?.lid,
        participante?.phoneNumber,
        participante?.phoneJid,
        participante?.participantAlt
    ].filter(Boolean).map(String);
}

function obtenerRemitentes(mensaje) {
    const key = mensaje?.key || {};
    return [...new Set([
        key.participant,
        key.participantAlt,
        key.participantPn
    ].filter(Boolean).map(String))];
}

function esAdmin(metadata, remitentes) {
    const exactos = new Set(remitentes.map(id => id.toLowerCase()));
    const numeros = new Set(remitentes.map(normalizarNumero).filter(Boolean));

    return (metadata?.participants || []).some(participante => {
        const rol = String(participante.admin || '').toLowerCase();
        const admin = rol === 'admin' || rol === 'superadmin' ||
            participante.isAdmin === true || participante.isSuperAdmin === true;
        if (!admin) return false;

        return idsDeParticipante(participante).some(id =>
            exactos.has(id.toLowerCase()) ||
            (normalizarNumero(id) && numeros.has(normalizarNumero(id)))
        );
    });
}

function cargarDatos() {
    try {
        if (!fs.existsSync(RUTA_DATOS)) return {};
        const datos = JSON.parse(fs.readFileSync(RUTA_DATOS, 'utf8'));
        return datos && typeof datos === 'object' && !Array.isArray(datos) ? datos : {};
    } catch (error) {
        console.error('🦖❌ No pude leer database/comandos-grupo.json:', error.message);
        return {};
    }
}

function guardarDatos(datos) {
    fs.mkdirSync(path.dirname(RUTA_DATOS), { recursive: true });
    const temporal = `${RUTA_DATOS}.tmp`;
    fs.writeFileSync(temporal, JSON.stringify(datos, null, 2) + '\n', 'utf8');
    fs.renameSync(temporal, RUTA_DATOS);
}

async function responder(sock, chat, contenido, enviarConEncabezado) {
    if (typeof enviarConEncabezado === 'function') {
        return enviarConEncabezado(sock, chat, contenido);
    }
    return sock.sendMessage(chat, contenido);
}

async function manejarComandosPersonalizados({ sock, mensaje, chat, comando, argumentos = [], contenido = '', enviarConEncabezado } = {}) {
    if (!chat || !comando) return false;
    const esGrupo = String(chat).endsWith('@g.us');
    const enviar = contenido => responder(sock, chat, contenido, enviarConEncabezado);

    // Mensaje de migración para la sintaxis anterior.
    if (comando === 'setcomando') {
        await enviar({ text: '🦖 Ahora se configura así: .setstock Disney 20\nEso guarda la respuesta de .stock en este grupo.' });
        return true;
    }

    if (comando === 'set' || comando.startsWith('set')) {
        if (!esGrupo) {
            await enviar({ text: '🦖 Los comandos .set… solo se pueden configurar dentro del grupo donde se usarán.' });
            return true;
        }

        const nombre = comando === 'set' ? '' : comando.slice(3).toLowerCase();
        if (!/^[a-z0-9_]{2,24}$/i.test(nombre)) {
            await enviar({ text: '🦖 El nombre debe tener entre 2 y 24 letras, números o guiones bajos. Ejemplos: .setstock texto, .settramites texto.' });
            return true;
        }
        if (COMANDOS_RESERVADOS.has(nombre)) {
            await enviar({ text: `🦖 “.${nombre}” es un comando reservado del bot y no se puede reemplazar.` });
            return true;
        }

        let metadata;
        try {
            metadata = await sock.groupMetadata(chat);
        } catch (error) {
            console.error('🦖❌ No pude revisar los administradores del grupo:', error.message);
            await enviar({ text: '🦖❌ No pude verificar los permisos del grupo. Intenta de nuevo.' });
            return true;
        }

        const remitentes = obtenerRemitentes(mensaje);
        if (!esAdmin(metadata, remitentes)) {
            await enviar({ text: '🦖 Solo un administrador de este grupo puede crear o cambiar sus comandos.' });
            return true;
        }

        const textoOriginal = String(contenido || '');
        const separadorComando = new RegExp(`^set${nombre}(?:[\\t ]+|\\r?\\n)`, 'i');
        let respuesta = argumentos.join(' ').trim();
        if (separadorComando.test(textoOriginal)) {
            respuesta = textoOriginal
                .replace(separadorComando, '')
                .replace(/\r\n?/g, '\n')
                .trimEnd();
        }
        if (!respuesta) {
            await enviar({ text: `🦖 Escribe la respuesta después del comando.\nEjemplo: .set${nombre} Disney 20` });
            return true;
        }
        if (respuesta.length > 3500) {
            await enviar({ text: '🦖 La respuesta puede tener hasta 3,500 caracteres.' });
            return true;
        }

        try {
            const datos = cargarDatos();
            if (!datos[chat] || typeof datos[chat] !== 'object') datos[chat] = {};
            datos[chat][nombre] = respuesta;
            guardarDatos(datos);
            await enviar({
                text: `🦖✅ Guardé la respuesta de .${nombre} para este grupo.\nCualquier miembro puede escribir .${nombre} para verla.`
            });
            console.log(`🦖🧩 Comando .${nombre} actualizado en ${chat}`);
        } catch (error) {
            console.error('🦖❌ No pude guardar el comando personalizado:', error.message);
            await enviar({ text: '🦖❌ No pude guardar el comando. Revisa los permisos de la carpeta database.' });
        }
        return true;
    }

    if (comando === 'comandos') {
        if (!esGrupo) {
            await enviar({ text: '🦖 Los comandos personalizados se consultan dentro de cada grupo.' });
            return true;
        }
        const datos = cargarDatos();
        const nombres = Object.keys(datos[chat] || {}).sort();
        await enviar({
            text: nombres.length
                ? `🦖 Comandos disponibles en este grupo:\n${nombres.map(nombre => `• .${nombre}`).join('\n')}`
                : '🦖 Este grupo todavía no tiene comandos personalizados. Un admin puede crear .stock con .setstock Disney 20.'
        });
        return true;
    }

    if (!esGrupo || COMANDOS_RESERVADOS.has(comando)) return false;
    const datos = cargarDatos();
    const respuesta = datos[chat]?.[comando];
    if (typeof respuesta !== 'string' || !respuesta.trim()) return false;

    await enviar({ text: respuesta });
    return true;
}

module.exports = manejarComandosPersonalizados;

