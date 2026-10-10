// Native modules are replaced with in-memory fakes so pure logic can be tested without a device.
jest.mock('@react-native-async-storage/async-storage', () => {
  let store = {};
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async k => (k in store ? store[k] : null)),
      setItem: jest.fn(async (k, v) => { store[k] = v; }),
      removeItem: jest.fn(async k => { delete store[k]; }),
      clear: jest.fn(async () => { store = {}; }),
    },
  };
});
jest.mock('react-native-keychain', () => {
  let creds = null;
  return {
    setGenericPassword: jest.fn(async (u, p) => { creds = { username: u, password: p }; return true; }),
    getGenericPassword: jest.fn(async () => creds),
    resetGenericPassword: jest.fn(async () => { creds = null; return true; }),
  };
});
