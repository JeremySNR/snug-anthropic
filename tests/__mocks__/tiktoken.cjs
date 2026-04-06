const makeEnc = () => ({ encode: (t) => Array.from(t), free: () => {} });
module.exports = {
  encoding_for_model: () => makeEnc(),
  get_encoding: () => makeEnc(),
};
