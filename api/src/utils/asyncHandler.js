export const ah = (fn) => (req, res, next) => {
  fn(req, res, next).catch(next);
};
