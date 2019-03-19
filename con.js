const WebSocket = require('ws');

const _MESSAGE_MAP = {
  'public/auth': 9929,
  'private/buy': 5275,
  'private/get_position': 404
};
const MESSAGE_MAP = message => {
  if(!_MESSAGE_MAP[message]) {
    throw new Error('unknown message ' + message);
  }

  return _MESSAGE_MAP[message];
}

let token;
let refreshToken;

let connected;
let connectedHook = new Promise(r => connected = r);

let inflightQueue = [];

let ws;
const init = (key, secret) => {
  ws = new WebSocket('wss://www.deribit.com/ws/api/v2');
  ws.onmessage = e => {
    let payload;

    try {
      payload = JSON.parse(e.data);
    } catch(e) {
      console.error('deribit send bad json', e);
    }

    // console.log(new Date, 'received:', payload);

    if(payload.id === MESSAGE_MAP('public/auth')) {
      token = payload.result.access_token;
      refreshToken = payload.result.refresh_token;
      connected();
      return;
    }

    const request = find(payload.id);

    if(request) {
      payload.requestedAt = request.requestedAt;
      payload.receiveddAt = +new Date;
      request.onDone(payload);
    }
  };
  ws.onopen = () => {
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
  };
  ws.onerror = e => console.error(e);
}

// traverse inflight queue FIFO
const find = code => {
  for(let i = 0; i < inflightQueue.length; i++) {
    if(code === inflightQueue[i].id) {
      return inflightQueue[i];
    }
  }
}

const send = payload => {
  // console.log(new Date, 'send:', payload);
  ws.send(JSON.stringify(payload));
}

const request = (path, params) => {
  return connectedHook.then(() => {
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


module.exports.init = init;
module.exports.request = request;