// reflector.js — Krestianstvo SDK 4
// Pure WebSocket reflector — no HTTP, no express.
// Usage: import { attachReflector } from './reflector.js'; attachReflector(wss);
import { ProgramState } from 'renkon-core';

let lastTime = 0;
global.requestAnimationFrame = (callback) => {
    const currentTime = Number(process.hrtime.bigint() / 1000000n);
    const delay = Math.max(0, 16 - (currentTime - lastTime));
    return setTimeout(() => {
        lastTime = currentTime + delay;
        callback(lastTime);
    }, delay);
};


const clients = new Map();
const selos = new Map();
const pendingJoiners = new Map();

// Create a selo with its own Renkon program
function createSelo(seloId) {
    console.log(`Creating selo: ${seloId}`);
    
    const reflector = {
        clients: clients,
        selos: selos,
        seloId: seloId,
        // Message queue for this selo (fed by WebSocket handlers)
        startTime: Date.now(),
        messageQueue: [],
        messageResolvers: [],
        pendingJoiners,
        intervalMs: 50,
        pulseCount: 0,
        lastHbTick: -1,
    };

    // Selo-specific reactive program
    function seloProgram() {
        const app = Renkon.app;

        const hb          = Events.timer(50);
        const clientEvent = Events.receiver({ queued: true });

        // ── Network messages (connect / disconnect / snapshot_response) ───────
        const networkMessagesGen = (async function* () {
            while (true) {
                const message = await new Promise((resolve) => {
                    if (app.messageQueue.length > 0) resolve(app.messageQueue.shift());
                    else app.messageResolvers.push(resolve);
                });
                yield message;
            }
        })();
        const networkMessagesRaw = Events.next(networkMessagesGen);
        const networkMessages = Behaviors.collect(
            null, networkMessagesRaw,
            (_, r) => (r && !r.done) ? r.value : null
        );

        // ── Connect / disconnect broadcast ────────────────────────────────────
        const connectBroadcast = Behaviors.collect(null, networkMessages, (_, ev) => {
            if (!ev) return null;
            const selo = app.selos.get(app.seloId);
            if (!selo) return null;
            if (ev.type === 'connect') {
                const msg = JSON.stringify({ type: 'connect', from: ev.from });
                selo.clients.forEach((clientId) => {
                    if (clientId === ev.from) return;
                    if (app.pendingJoiners.has(clientId)) return;
                    const client = app.clients.get(clientId);
                    if (client && client.ws.readyState === 1) client.ws.send(msg);
                });
            } else if (ev.type === 'disconnect') {
                console.log(`[Selo ${app.seloId}] Broadcasting disconnect for ${ev.from}`);
                const msg = JSON.stringify({ type: 'disconnect', from: ev.from });
                selo.clients.forEach((clientId) => {
                    if (app.pendingJoiners.has(clientId)) { app.pendingJoiners.get(clientId).buffer.push({ type: 'disconnect', from: ev.from }); return; }
                    const client = app.clients.get(clientId);
                    if (client && client.ws.readyState === 1) client.ws.send(msg);
                });
            }
            return null;
        });

        // ── Snapshot forwarder ────────────────────────────────────────────────
        const snapshotForwarder = Behaviors.collect(null, networkMessages, (_, ev) => {
            if (ev?.data?.type === 'snapshot_response') {
                const targetId = ev.data.targetUser, targetClient = app.clients.get(targetId), pending = app.pendingJoiners.get(targetId);
                if (targetClient && targetClient.ws.readyState === 1 && pending) {
                    const snapTime = ev.data.payload?.time ?? 0;
                    targetClient.ws.send(JSON.stringify({ type: 'snapshot_apply', snapshot: ev.data.payload, history: [], seloId: app.seloId }));
                    const toFlush = pending.buffer.filter(m => m.type === 'pulse' ? m.logicalTime > snapTime : true);
                    console.log('[Selo ' + app.seloId + '] snapshot->' + targetId + ' snapTime=' + snapTime + ' flushing ' + toFlush.length + '/' + pending.buffer.length);
                    console.log('[flush]', toFlush.map(m => m.type === 'pulse' ? (m._isHeartbeat ? 'HB@' + m.logicalTime : 'EV@' + m.logicalTime) : m.type));
                    for (const m of toFlush) targetClient.ws.send(JSON.stringify(m));
                    app.pendingJoiners.delete(targetId);
                }
            }
            return null;
        });

        // ── Heartbeat pulse broadcast ─────────────────────────────────────────
        const syncBroadcaster = Events.collect(
            { lastTick: -1 },
            hb,
            (state, _) => {
                const tick = Math.floor((Date.now() - app.startTime) / app.intervalMs);
                if (tick <= state.lastTick) return state;
                app.pulseCount++;
                app.lastHbTick = tick;
                const pulse = {
                    type: 'pulse',
                    logicalTime: tick, wallTime: tick, wallMs: tick * app.intervalMs,
                    _pulseId: app.pulseCount,
                    _isHeartbeat: true, _isEvent: false,
                    _eventPayload: null, _targetWorld: null, _targetNode: null, _targetWorlds: null,
                };
                const selo = app.selos.get(app.seloId);
                if (selo) {
                    const msg = JSON.stringify(pulse);
                    selo.clients.forEach((clientId) => {
                        if (app.pendingJoiners.has(clientId)) { app.pendingJoiners.get(clientId).buffer.push(pulse); return; }
                        const client = app.clients.get(clientId);
                        if (client && client.ws.readyState === 1) client.ws.send(msg);
                    });
                }
                return { lastTick: tick };
            }
        );

        // ── Event pulse broadcast ─────────────────────────────────────────────
        const evDispatch = Behaviors.collect(null, clientEvent, (s, evs) => {
            const tick = Math.floor((Date.now() - app.startTime) / app.intervalMs);
            for (const ev of evs) {
                if (!ev) continue;
                app.pulseCount++;
                app.lastHbTick = tick;
                const pulse = {
                    type: 'pulse',
                    logicalTime: tick, wallTime: tick, wallMs: tick * app.intervalMs,
                    _pulseId: app.pulseCount,
                    _isHeartbeat: false, _isEvent: true,
                    _eventPayload: ev.payload ?? null,
                    _targetWorld: ev.targetWorldId ?? null,
                    _targetNode: ev.targetNodeId ?? null,
                    _targetWorlds: ev.targetWorldIds ?? null,
                };
                const selo = app.selos.get(app.seloId);
                if (selo) {
                    const msg = JSON.stringify(pulse);
                    console.log(`[reflector] ⚡EVENT lt=${tick} pulseId=#${app.pulseCount} payload=${JSON.stringify(pulse._eventPayload)}`);
                    selo.clients.forEach((clientId) => {
                        if (app.pendingJoiners.has(clientId)) { app.pendingJoiners.get(clientId).buffer.push(pulse); return; }
                        const client = app.clients.get(clientId);
                        if (client && client.ws.readyState === 1) client.ws.send(msg);
                    });
                }
            }
            return s;
        });

        return { networkMessages, connectBroadcast, snapshotForwarder, syncBroadcaster, clientEvent, evDispatch };
    }

    const programState = new ProgramState(Date.now(), reflector, true);
    programState.merge(seloProgram);
    programState.evaluator(Date.now(), { noAnimationFrame: true });
    
    selos.set(seloId, {
        programState,
        clients: new Set()
    });
    
    return selos.get(seloId);
}

function getOrCreateSelo(seloId) {
    if (!selos.has(seloId)) {
        return createSelo(seloId);
    }
    return selos.get(seloId);
}

function cleanupSelo(seloId) {
    const selo = selos.get(seloId);
    if (selo && selo.clients.size === 0) {
        console.log(`Cleaning up empty selo: ${seloId}`);
        try { selo.programState.stop(); } catch(e) { console.error('[cleanupSelo] stop() failed:', e); }
        selos.delete(seloId);
    }
}

function sendToSelo(seloId, eventData) {
    const selo = selos.get(seloId);
    if (selo && selo.programState) {
        const reflector = selo.programState.app;
        if (eventData.type === 'client_event') {
            selo.programState.registerEvent('clientEvent', eventData);
        } else {
            // connect / disconnect / snapshot_response go via generator queue
            if (reflector.messageResolvers.length > 0) reflector.messageResolvers.shift()(eventData);
            else reflector.messageQueue.push(eventData);
        }
    }
}

export function attachReflector(wss) {
wss.on('connection', (ws, req) => {
    const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    let currentSeloId = null;
    
    console.log(`Client ${clientId} connected (not yet in a selo)`);
    clients.set(clientId, { ws, seloId: null, clientId });

    ws.on('message', (data) => {
        console.log(`📦 RAW message received from ${clientId}:`, data.toString());
        
        try {
            const message = JSON.parse(data.toString());
            console.log(`📥 Parsed message from ${clientId}:`, message.type, message);
            
            if (message.type === 'join_selo') {
                const seloId = message.seloId || 'default';
                
                if (currentSeloId) {
                    const oldSelo = selos.get(currentSeloId);
                    if (oldSelo) {
                        oldSelo.clients.delete(clientId);
                        sendToSelo(currentSeloId, {
                            type: 'disconnect',
                            from: clientId,
                            timestamp: Date.now()
                        });
                        cleanupSelo(currentSeloId);
                    }
                }
                
                const selo = getOrCreateSelo(seloId);
                selo.clients.add(clientId);
                currentSeloId = seloId;
                
                clients.set(clientId, { ws, seloId, clientId });
                
                sendToSelo(seloId, {
                    type: 'connect',
                    from: clientId,
                    timestamp: Date.now()
                });
                
                ws.send(JSON.stringify({
                    type: 'selo_joined',
                    seloId: seloId,
                    clientId: clientId,
                    clientsInSelo: selo.clients.size
                }));

                // If others are present, buffer messages for the joiner immediately
                // (so no messages are lost), but delay request_snapshot by one heartbeat
                // interval (50ms). This gives all existing members time to send their
                // _join re-announcements, which will be buffered and flushed to the
                // joiner alongside the snapshot — guaranteeing all avatars appear.
                if (selo.clients.size > 1) {
                    pendingJoiners.set(clientId, { buffer: [] });
                    const memberIds = [...selo.clients].filter(id => id !== clientId);
                    const leaderId  = memberIds[0];
                    setTimeout(() => {
                        if (!pendingJoiners.has(clientId)) return;
                        const liveMember = memberIds.find(id => {
                            const c = clients.get(id);
                            return c && c.ws.readyState === 1;
                        });
                        if (!liveMember) { pendingJoiners.delete(clientId); return; }
                        clients.get(liveMember).ws.send(JSON.stringify({
                            type: 'request_snapshot', targetUser: clientId, seloId
                        }));
                        console.log(`Requested snapshot from leader ${liveMember} for ${clientId}`);
                    }, 50);
                }

                console.log(`Client ${clientId} joined selo ${seloId} (${selo.clients.size} clients total)`);
                return;
            }
            
            if (message.type === 'goodbye') {
                console.log(`[goodbye] client ${clientId} signing off from ${currentSeloId}`);
                if (currentSeloId) {
                    const selo = selos.get(currentSeloId);
                    if (selo) {
                        selo.clients.delete(clientId);
                        pendingJoiners.delete(clientId);
                        sendToSelo(currentSeloId, { type: 'disconnect', from: clientId, timestamp: Date.now() });
                        cleanupSelo(currentSeloId);
                    }
                }
                clients.delete(clientId);
                currentSeloId = null;
                ws.terminate();
                return;
            }

            if (currentSeloId) {
                if (message.type === 'client_event') {
                    sendToSelo(currentSeloId, {
                        type: 'client_event',
                        payload: message.payload ?? null,
                        targetWorldId: message.targetWorldId ?? null,
                        targetNodeId: message.targetNodeId ?? null,
                        targetWorldIds: message.targetWorldIds ?? null,
                        from: clientId,
                        timestamp: Date.now(),
                    });
                } else {
                    sendToSelo(currentSeloId, {
                        type: 'client_msg',
                        from: clientId,
                        data: message,
                        timestamp: Date.now(),
                        _arrivedAt: Date.now()
                    });
                }
            } else {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: 'Please join a selo first'
                }));
            }
        } catch (error) {
            console.error('Invalid message format:', error);
        }
    });

    ws.on('close', () => {
        console.log(`[ws.close] client=${clientId} selo=${currentSeloId}`);
        if (currentSeloId) {
            const selo = selos.get(currentSeloId);
            if (selo) {
                selo.clients.delete(clientId);
                pendingJoiners.delete(clientId);
                console.log(`Client ${clientId} disconnected from selo ${currentSeloId}, remaining clients: ${selo.clients.size}`);
                sendToSelo(currentSeloId, {
                    type: 'disconnect',
                    from: clientId,
                    timestamp: Date.now()
                });
                cleanupSelo(currentSeloId);
            } else {
                console.log(`Client ${clientId} disconnected but selo ${currentSeloId} not found`);
            }
        }
        clients.delete(clientId);
    });

    ws.on('error', (error) => {
        console.error(`WebSocket error for ${clientId}:`, error);
    });
});

} // end attachReflector