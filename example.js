const Deribit = require('./');

const key = 'x';
const secret = 'y';

(async () => {

  const db = new Deribit({key, secret});

  console.log(new Date, 'connecting...');

  await db.connect();
  console.log(new Date, 'connected');
  

  const resp = await db.request(
    'private/get_position',
    {instrument_name: 'BTC-PERPETUAL'}
  );

  console.log('position:', resp);

  await db.subscribe(
    'public',
    'deribit_price_index.btc_usd'
  );

  db.on('deribit_price_index.btc_usd', console.log);
})()