module.exports = {
  testEnvironment: "node",
  setupFilesAfterEnv: ["<rootDir>/tests/setup.js"],
  testTimeout: 15000,
  // otplib's plugins depend on @scure/base and @noble/hashes, which ship
  // ESM-only (`"type": "module"`, no CJS build). Node's native `require()`
  // handles this transparently at runtime, but Jest's own module system
  // doesn't — so these packages specifically need to be transformed instead
  // of skipped, wherever they appear (including nested under other
  // packages' own node_modules).
  transformIgnorePatterns: ["/node_modules/(?!.*(@scure|@noble))"],
};
