const deribit = require('./index');

const key = 'x';
const secret = 'y';

(async () => {

  await deribit.connect();
  console.log('connected');
  await deribit.authenticate(key, secret);
  console.log('authenticated');
  const resp = await deribit.request('private/get_position', {instrument_name: 'BTC-PERPETUAL'});
  console.log('requested position:', resp);
})()