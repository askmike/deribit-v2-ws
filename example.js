const deribit = require('./index');

const key = 'x';
const secret = 'y';

(async () => {

  await deribit.connect();
  console.log(new Date, 'connected');
  await deribit.authenticate(key, secret);
  console.log(new Date, 'authenticated');
  const resp = await deribit.request('private/get_position', {instrument_name: 'BTC-PERPETUAL'});
  console.log(new Date, 'position:', resp);
})()