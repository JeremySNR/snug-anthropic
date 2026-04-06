/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\.tsx?$': ['ts-jest', { tsconfig: './tsconfig.json' }],
  },
  moduleNameMapper: {
    '^(\.{1,2}/.+)\.js$': '$1',
    '^tiktoken$': '<rootDir>/tests/__mocks__/tiktoken.cjs',
  },
};
