// Mock localStorage for MSW in Node.js environment
const localStorageMock = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
};

// @ts-ignore
global.localStorage = localStorageMock;

