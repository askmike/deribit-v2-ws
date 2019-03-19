const lib = require('./index');

const key = 'x';
const secret = 'y';

lib.init(key, secret);
lib.request('private/get_position', {instrument_name: 'BTC-PERPETUAL'})
  .then(resp => console.log(resp))
  .catch(console.error);