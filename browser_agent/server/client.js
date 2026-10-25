// Engine.IO 4 / Socket.IO default namespace, independent of Chrome scheduling.
import {createInterface} from 'node:readline';

const socket = new WebSocket(process.argv[2]);
const output = event => process.stdout.write(JSON.stringify(event) + '\n');
let heartbeat = null;
let heartbeatMs = 60000;
const armHeartbeat = () => {
    clearTimeout(heartbeat);
    heartbeat = setTimeout(() => socket.close(), heartbeatMs);
};
socket.addEventListener('message', ({data}) => {
    if (data.startsWith('0')) {
        const open = JSON.parse(data.slice(1));
        heartbeatMs = open.pingInterval + open.pingTimeout;
        armHeartbeat();
        socket.send('40');
    } else if (data === '2') {
        socket.send('3');
        armHeartbeat();
    } else if (data.startsWith('40')) {
        output(['__connected__']);
    } else if (data.startsWith('42')) {
        output(JSON.parse(data.slice(2)));
    } else if (data.startsWith('43')) {
        const [, id, payload] = data.match(/^43(\d+)(.*)$/);
        output(['__reply__', Number(id), JSON.parse(payload)]);
    } else if (data.startsWith('44')) {
        output(['__error__', 'Socket.IO connection rejected']);
        socket.close();
    }
});
socket.addEventListener('error', event => output(['__error__', event.message || 'WebSocket connection failed']));
socket.addEventListener('close', ({code}) => {
    clearTimeout(heartbeat);
    output(['__closed__', code]);
});
for await (const line of createInterface({input: process.stdin})) {
    const {id, event, args, ack} = JSON.parse(line);
    if (socket.readyState !== WebSocket.OPEN) {
        output(['__error__', 'WebSocket is not open']);
        continue;
    }
    socket.send('42' + (ack ? id : '') + JSON.stringify([event, ...args]));
    output(['__sent__', id]);
}
socket.close();
