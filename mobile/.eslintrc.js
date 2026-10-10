module.exports = {
  root: true,
  extends: '@react-native',
  rules: { 'no-undef': 'error', 'react-native/no-inline-styles': 'off' },
  overrides: [{ files: ['**/__tests__/**', 'jest.setup.js'], env: { jest: true } }],
};
