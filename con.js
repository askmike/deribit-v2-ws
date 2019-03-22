const WebSocket = require('ws');

const _MESSAGE_MAP = require('./messageMap.json');
const MESSAGE_MAP = message => {
  if(!_MESSAGE_MAP[message]) {
    throw new Error('Unknown path ' + message);
  }

  return _MESSAGE_MAP[message];
}

let isConnected = false;
let connected;
let connectedHook = new Promise(r => connected = r);

let token;
let refreshToken;

let isAuthed = false;
let authed;
let authedHook = new Promise(r => authed = r);

let inflightQueue = [];
let ws;

const connect = () => {
  ws = new WebSocket('wss://www.deribit.com/ws/api/v2');
  ws.onopen = () => {
    isConnected = true;
    connected();
  }

  ws.onerror = e => console.error(e);

  ws.onmessage = e => {
    let payload;

    try {
      payload = JSON.parse(e.data);
    } catch(e) {
      console.error('deribit send bad json', e);
    }

    if(payload.id === MESSAGE_MAP('public/auth')) {
      token = payload.result.access_token;
      refreshToken = payload.result.refresh_token;

      isAuthed = true;
      authed();
      return;
    }

    const request = find(payload.id);

    if(request) {
      payload.requestedAt = request.requestedAt;
      payload.receivedAt = +new Date;
      request.onDone(payload);
    }
  };

  return connectedHook;
}

const authenticate = (key, secret) => {

  if(!isConnected) {
    throw new Error('Not connected.');
  }

  send({
    jsonrpc: "2.0",
    id: MESSAGE_MAP('public/auth'),
    method: "public/auth",
    params: {
      grant_type: "client_credentials",
      client_id: key,
      client_secret: secret
    }
  });

  return authedHook;
}

// traverse inflight queue FIFO
const find = code => {
  for(let i = 0; i < inflightQueue.length; i++) {
    const req = inflightQueue[i];
    if(code === req.id) {
      inflightQueue.splice(i, 1);
      return req;
    }
  }
}

const send = payload => {
  // console.log(new Date, 'send:', payload);
  ws.send(JSON.stringify(payload));
}

const request = (path, params) => {

  if(!isAuthed) {
    throw new Error('Not authenticated.');
  }

  return authedHook.then(() => {
    let onDone;
    const p = new Promise(r => onDone = r);

    const id = MESSAGE_MAP(path);

    const message = {
      jsonrpc: '2.0',
      id,
      method: path,
      params
    }

    inflightQueue.push({
      // message,
      requestedAt: +new Date,
      id,
      onDone
    });
    send(message);

    return p;
  });
}


module.exports.connect = connect;
module.exports.authenticate = authenticate;
module.exports.request = request;