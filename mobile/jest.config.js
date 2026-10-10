module.exports = {
  preset: '@react-native/jest-preset',
  testPathIgnorePatterns: ['/node_modules/', '/android/', '/ios/'],
  setupFiles: ['./jest.setup.js'],
  moduleNameMapper: { '^lucide-react-native$': '<rootDir>/__mocks__/lucide-react-native.js' },
  transformIgnorePatterns: ['node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation)/)'],
};
