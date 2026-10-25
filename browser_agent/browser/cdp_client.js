// Persistent CDP connection using the same Node runtime as chrome-devtools.
import {createInterface} from 'node:readline';

const socket = new WebSocket(process.argv[2]);
const pending = new Map();
let sequence = 0;
const connected = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Chrome CDP connection timed out')), 60000);
    socket.addEventListener('open', () => {clearTimeout(timeout); resolve();}, {once: true});
    socket.addEventListener('error', () => {clearTimeout(timeout); reject(new Error('Chrome CDP connection failed'));}, {once: true});
});
// A connection may fail before Python sends the first request.
connected.catch(() => {});
socket.addEventListener('message', event => {
    const reply = JSON.parse(event.data);
    const request = pending.get(reply.id);
    if (!request) return;
    pending.delete(reply.id);
    clearTimeout(request.timeout);
    if (reply.error) request.reject(new Error(reply.error.message));
    else request.resolve(reply.result);
});
socket.addEventListener('close', () => {
    for (const request of pending.values()) {
        clearTimeout(request.timeout);
        request.reject(new Error('Chrome CDP connection closed'));
    }
    pending.clear();
});
const call = async request => {
    await connected;
    if (socket.readyState !== WebSocket.OPEN) throw new Error('Chrome CDP connection is not open');
    const id = ++sequence;
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            pending.delete(id);
            reject(new Error('Chrome CDP request timed out'));
        }, 60000);
        pending.set(id, {resolve, reject, timeout});
        socket.send(JSON.stringify({id, ...request}));
    });
};
for await (const line of createInterface({input: process.stdin})) {
    let reply;
    try {reply = {result: await call(JSON.parse(line))};}
    catch (error) {reply = {error: error.message};}
    process.stdout.write(JSON.stringify(reply) + '\n');
}
socket.close();
