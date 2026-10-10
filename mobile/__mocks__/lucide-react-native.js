// Every icon renders nothing; screens only need the import to resolve in tests.
const React = require('react');
module.exports = new Proxy({ __esModule: true }, {
  get: (target, name) => (name in target ? target[name] : () => React.createElement(React.Fragment)),
});
