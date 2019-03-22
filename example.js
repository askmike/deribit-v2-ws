const deribit = require('./index');

const key = 'x';
const secret = 'y';

(async () => {

  await deribit.connect();
  console.log(new Date, 'connected');
  await deribit.authenticate(key, secret);
  console.log(new Date, 'authenticated');


  const resp = await deribit.request(
    'private/get_position',
    {instrument_name: 'BTC-PERPETUAL'}
  );
  console.log('position:', resp);

  const resp = await deribit.subscribe(
    'public',
    'deribit_price_index.btc_usd',
    e => console.log('update', e)
  );
})()