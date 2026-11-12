require("dotenv").config({ quiet: true });
const http = require("http");
const app = require("./src/app");

const PORT = process.env.PORT || 5000;

const server = http.createServer(app);

// Add '0.0.0.0' here to listen to the whole network
server.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ┌───────────────────────────────────────────┐
  │                                           │
  │   🚀 Server is live on the Network!       │
  │   📦 Port: ${PORT}                         │
  │   🔗 Access via your IP Address           │
  │                                           │
  └───────────────────────────────────────────┘
  `);
});