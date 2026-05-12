const WebSocket = require('ws');
const ws = new WebSocket('wss://v5.oddspapi.io/ws');
ws.on('open', () => ws.send(JSON.stringify({ type: 'login', apiKey: 'YOUR_API_KEY' })));
ws.on('message', (data) => console.log(JSON.parse(data.toString())));
