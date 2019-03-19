const lib = require('./index');

const key = 'x';
const secret = 'y';

(async () => {

  lib.init(key, secret);
  const resp = await lib.request('private/get_position', {instrument_name: 'BTC-PERPETUAL'});

  console.log(resp);
})()