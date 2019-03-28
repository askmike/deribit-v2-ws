const WebSocket = require('ws');

let isConnected = false;
let isAuthed = false;

let token;
let refreshToken;

let _key;
let _secret;

let inflightQueue = [];
let ws;

let id = +new Date;
let nextId = () => ++id;

let channelHandlers = {};

let connected;
const connectedHook = new Promise(r => connected = r);
module.exports.connectedHook = connectedHook;

let reconnecting = false;
let reconnectHook;
let reconnect;

const connect = () => {

  ws = new WebSocket('wss://www.deribit.com/ws/api/v2');
  ws.onopen = () => {
    if(reconnecting) {

      if(_key) {
        authenticate(_key, _secret)
          .then(() => {
            reconnect();
            reconnecting = false;
          });
      }


    } else {
      // initial connection
      connected();
      isConnected = true;
    }

    return sendMessage({
      jsonrpc: '2.0',
      method: 'public/set_heartbeat',
      id: nextId(),
      params: {
        interval: 30
      }
    });
  }

  ws.onerror = e => {
    console.log(new Date, 'DERI ERROR1', e);
  }

  ws.onclose = e => {
    console.log(new Date, 'DERIBIT CLOSED CON');
    reconnecting = true;
    reconnectHook = new Promise(r => reconnect = r);
    connect();
  }

  ws.onmessage = e => {
    let payload;

    try {
      payload = JSON.parse(e.data);
    } catch(e) {
      console.error('deribit send bad json', e);
    }

    if(payload.method === 'subscription') {
      const fn = channelHandlers[payload.params.channel];

      if(fn) {
        fn(payload.params.data);
      } else {
        console.log(new Date, 'received subscription update for non subscribed event');
      }

      return;
    }

    if(payload.method === 'heartbeat') {
      return sendMessage({
        jsonrpc: '2.0',
        method: 'public/test',
        id: nextId(),
        params: {}
      }).then(() => {});
    }

    const request = findRequest(payload.id);

    if(!request) {
      console.error('received response to request not send:', payload);
    }

    if(request) {
      payload.requestedAt = request.requestedAt;
      payload.receivedAt = +new Date;
      request.onDone(payload);
    }
  };

  return connectedHook;
}

const authenticate = (key, secret) => {

  _key = key;
  _secret = secret;

  if(!isConnected) {
    throw new Error('Not connected.');
  }

  return sendMessage({
    jsonrpc: '2.0',
    method: 'public/auth',
    id: nextId(),
    params: {
      grant_type: 'client_credentials',
      client_id: key,
      client_secret: secret
    }
  }).then(resp => {
    token = resp.result.access_token;
    refreshToken = resp.result.refresh_token;
    isAuthed = true;

    if(!resp.result.expires_in) {
      return new Error('Deribit did not provide expiry details');
    }

    setTimeout(refresh, resp.result.expires_in - 10 * 60 * 1000);
  });
}

const refresh = () => {
  return sendMessage({
    jsonrpc: '2.0',
    method: 'public/auth',
    id: nextId(),
    params: {
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    }
  }).then(resp => {
    token = resp.result.access_token;
    refreshToken = resp.result.refresh_token;

    if(!resp.result.expires_in) {
      return new Error('Deribit did not provide expiry details');
    }

    setTimeout(refresh, resp.result.expires_in - 10 * 60 * 1000);

  });
}

const findRequest = id => {
  for(let i = 0; i < inflightQueue.length; i++) {
    const req = inflightQueue[i];
    if(id === req.id) {
      inflightQueue.splice(i, 1);
      return req;
    }
  }
}

const sendMessage = (payload, fireAndForget) => {
  // console.log(new Date, 'send:', payload);

  let p;
  if(!fireAndForget) {
    let onDone;
    p = new Promise(r => onDone = r);

    inflightQueue.push({
      requestedAt: +new Date,
      id: payload.id,
      onDone
    });
  }

  if(reconnecting) {
    reconnectHook.then(() => {
      ws.send(JSON.stringify(payload));
    })
  } else {
    ws.send(JSON.stringify(payload));
  }

  return p;
}

module.exports.connect = connect;
module.exports.authenticate = authenticate;

process
  .on('unhandledRejection', (reason, p) => {
    console.error(reason, 'Unhandled Rejection at Promise', p);
  })

// API:

const request = (path, params) => {

  if(!isAuthed) {
    throw new Error('Not authenticated.');
  }

  const message = {
    jsonrpc: '2.0',
    method: path,
    params,
    id: nextId()
  }

  return sendMessage(message);
}
module.exports.request = request;

const subscribe = (type, channel, handler) => {

  if(!isConnected) {
    throw new Error('Not connected.');
  } else if(type === 'private' && !isAuthed) {
    throw new Error('Not authenticated.');
  }

  if(channelHandlers[channel]) {
    throw new Error('Already subscribed.');
  }

  const message = {
    jsonrpc: '2.0',
    method: `${type}/subscribe`,
    params: {
      channels: [ channel ]
    },
    id: nextId()
  }

  channelHandlers[channel] = handler;

  return sendMessage(message);
}
module.exports.subscribe = subscribe;