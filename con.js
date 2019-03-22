const WebSocket = require('ws');

let isConnected = false;
let isAuthed = false;

let token;
let refreshToken;

let inflightQueue = [];
let ws;

let id = +new Date;
let nextId = () => ++id;

const connect = () => {

  let connected;
  const connectedHook = new Promise(r => connected = r);

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

const sendMessage = payload => {
  // console.log(new Date, 'send:', payload);

  let onDone;
  const p = new Promise(r => onDone = r);

  inflightQueue.push({
    requestedAt: +new Date,
    id: payload.id,
    onDone
  });

  ws.send(JSON.stringify(payload));

  return p;
}

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

process
  .on('unhandledRejection', (reason, p) => {
    console.error(reason, 'Unhandled Rejection at Promise', p);
  })

module.exports.connect = connect;
module.exports.authenticate = authenticate;
module.exports.request = request;