const WebSocket = require('ws');
const EventEmitter = require('events');

const wait = n => new Promise(r => setTimeout(r, n));

class Connection extends EventEmitter {
  constructor({key, secret, domain}) {
    super();

    if(!domain){
      domain = 'www.deribit.com'
    }

    this.key = key;
    this.secret = secret;
    this.WSdomain = domain;

    this.connected = false;
    this.isReadyHook = false;
    this.isReady = new Promise((r => this.isReadyHook = r));
    this.authenticated = false;
    this.reconnecting = false;
    this.afterReconnect;

    this.inflightQueue = [];
    this.subscriptions = [];

    this.id = +new Date;
  }

  nextId() {
    return ++this.id;
  }

  handleError = (e) => {
    console.log(new Date, '[DERIBIT] DERI ERROR', e);
  }

  _connect() {
    if(this.connected) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`wss://${this.WSdomain}/ws/api/v2`);
      this.ws.onmessage = this.handleWSMessage;

      this.ws.onopen = () => {
        this.connected = true;

        this.pingInterval = setInterval(this.ping, 20 * 1000);

        this.emit('statusChange', 'connected');
        resolve();
      }
      this.ws.onerror = this.handleError;
      this.ws.on('error', this.handleError)

      this.ws.onclose = async e => {
        this.isReady = new Promise((r => this.isReadyHook = r));
        this.emit('statusChange', 'closed');
        console.log(new Date, '[DERIBIT] CLOSED CON');
        this.inflightQueue.forEach((queueElement) => {
          queueElement.connectionAborted(new Error('Deribit connection closed.'));
        });
        this.inflightQueue = [];
        this.authenticated = false;
        this.connected = false;
        clearInterval(this.pingInterval);
        this.reconnect();
        this.isReadyHook();
      }
    });
  }

  ping = async() => {
    let start = new Date;
    const timeout = setTimeout(() => {
      console.log(new Date, '[DERIBIT] NO PING RESPONSE');
      this.terminate();
    }, 10000)
    await this.request('public/test');
    clearInterval(timeout);
  }

  // terminate a connection and immediatly try to reconnect
  terminate = async() => {
    console.log(new Date, '[DERIBIT] TERMINATED WS CON');
    this.ws.terminate();
    this.authenticated = false;
    this.connected = false;
  }

  // end a connection
  end = () => {
    console.log(new Date, '[DERIBIT] ENDED WS CON');
    clearInterval(this.pingInterval);
    this.ws.onclose = undefined;
    this.authenticated = false;
    this.connected = false;
    this.ws.terminate();
  }

  reconnect = async () => {
    this.reconnecting = true;

    let hook;
    this.afterReconnect = new Promise(r => hook = r);
    await wait(500);
    console.log(new Date, '[DERIBIT] RECONNECTING...');
    await this.connect();
    hook();
    this.isReadyHook();

    this.subscriptions.forEach(sub => {
      this.subscribe(sub.type, sub.channel);
    });
    this.reconnecting = false;
  }

  connect = async () => {
    await this._connect();
    if(this.key) {
      await this.authenticate();
    }
  }

  authenticate = async () => {
    if(!this.connected) {
      await this.connect();
    }

    const resp = await this.sendMessage({
      jsonrpc: '2.0',
      method: 'public/auth',
      id: this.nextId(),
      params: {
        grant_type: 'client_credentials',
        client_id: this.key,
        client_secret: this.secret
      }
    });

    if(resp.error) {
      throw new Error(resp.error.message);
    }

    this.token = resp.result.access_token;
    this.refreshToken = resp.result.refresh_token;
    this.authenticated = true;

    if(!resp.result.expires_in) {
      throw new Error('Deribit did not provide expiry details');
    }

    setTimeout(this.refreshTokenFn, resp.result.expires_in - 10 * 60 * 1000);
  }

  refreshTokenFn = async () => {
    const resp = await this.sendMessage({
      jsonrpc: '2.0',
      method: 'public/auth',
      id: this.nextId(),
      params: {
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken
      }
    });

    this.token = resp.result.access_token;
    this.refreshToken = resp.result.refresh_token;

    if(!resp.result.expires_in) {
      throw new Error('Deribit did not provide expiry details');
    }

    setTimeout(this.refreshTokenFn, resp.result.expires_in - 10 * 60 * 1000);
  }

  findRequest(id) {
    for(let i = 0; i < this.inflightQueue.length; i++) {
      const req = this.inflightQueue[i];
      if(id === req.id) {
        this.inflightQueue.splice(i, 1);
        return req;
      }
    }
  }

  handleWSMessage = e => {
    let payload;

    try {
      payload = JSON.parse(e.data);
    } catch(e) {
      console.error('deribit send bad json', e);
    }

    if(payload.method === 'subscription') {
      return this.emit(payload.params.channel, payload.params.data);
    }

    if(payload.method === 'heartbeat') {
      return this.sendMessage({
        jsonrpc: '2.0',
        method: 'public/test',
        id: this.nextId(),
        params: {}
      })
    }

    const request = this.findRequest(payload.id);

    if(!request) {
      return console.error('received response to request not send:', payload);
    }

    payload.requestedAt = request.requestedAt;
    payload.receivedAt = +new Date;
    request.onDone(payload);
  }

  sendMessage = async (payload, fireAndForget) => {
    if(!this.connected) {
      if(!this.reconnecting) {
        throw new Error('Not connected.')
      }

      await this.afterReconnect;
    }

    let p;
    if(!fireAndForget) {
      let onDone;
      let connectionAborted;
      p = new Promise((r, rj) => {onDone = r; connectionAborted = rj;});

      this.inflightQueue.push({
        requestedAt: +new Date,
        id: payload.id,
        onDone,
        connectionAborted
      });
    }


    this.ws.send(JSON.stringify(payload));

    return p;
  }


  request = async (path, params) => {

    if(!this.connected) {
      if(!this.reconnecting) {
        throw new Error('Not connected.');
      }

      await this.afterReconnect;
    }

    if (path.startsWith('private')) {
      if(!this.authenticated) {
        throw new Error('Not authenticated.');
      }
    }

    const message = {
      jsonrpc: '2.0',
      method: path,
      params,
      id: this.nextId()
    }

    return this.sendMessage(message);
  }

  subscribe = (type, channel) => {

    if(!this.subscriptions.find(s => s.type == type && s.channel == channel))
      this.subscriptions.push({type, channel});

    if(!this.connected) {
      throw new Error('Not connected.');
    } else if(type === 'private' && !this.authenticated) {
      throw new Error('Not authenticated.');
    }

    const message = {
      jsonrpc: '2.0',
      method: `${type}/subscribe`,
      params: {
        channels: [ channel ]
      },
      id: this.nextId()
    }

    return this.sendMessage(message);
  }
}


module.exports = Connection;
