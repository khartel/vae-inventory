jest.mock("pg", () => ({ ...jest.requireActual("pg"), Client: jest.fn() }));

const { Client } = require("pg");
const { liveness, readiness } = require("../src/utils/health");
let client;

const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });

beforeEach(() => {
  jest.clearAllMocks();
  client = {
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }),
    end: jest.fn().mockResolvedValue(undefined),
  };
  Client.mockImplementation(() => client);
});

afterEach(() => { jest.useRealTimers(); });

test("liveness preserves its payload without constructing a database client", () => {
  const res = response();
  liveness({}, res);
  expect(res.json).toHaveBeenCalledWith({ success: true, message: "Server is running" });
  expect(Client).not.toHaveBeenCalled();
});

test("readiness executes SELECT 1, returns 200 and closes its connection", async () => {
  const res = response();
  await readiness({}, res);
  expect(client.query).toHaveBeenCalledWith("SELECT 1");
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith({ success: true, message: "Database is ready", data: null });
  expect(client.end).toHaveBeenCalledTimes(1);
});

test.each(["connect", "query"])("a database %s error returns a generic 503 and closes the connection", async (stage) => {
  client[stage].mockRejectedValue(new Error("private connection credentials"));
  const res = response();
  await readiness({}, res);
  expect(res.status).toHaveBeenCalledWith(503);
  expect(res.json).toHaveBeenCalledWith({ success: false, message: "Database is unavailable", errors: null });
  expect(client.end).toHaveBeenCalledTimes(1);
});

test("invalid connection configuration returns 503", async () => {
  Client.mockImplementationOnce(() => { throw new Error("Invalid database URL"); });
  const res = response();
  await readiness({}, res);
  expect(res.status).toHaveBeenCalledWith(503);
});

test.each(["connect", "query"])("a hung %s hits the 3-second deadline and closes the client", async (stage) => {
  jest.useFakeTimers();
  try {
    client[stage].mockImplementation(() => new Promise(() => {}));
    const res = response();
    const pending = readiness({}, res);
    await jest.advanceTimersByTimeAsync(2999);
    expect(res.json).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await pending;
    expect(res.status).toBeDefined();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(client.end).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

test("connect and query share one total deadline rather than separate 3-second budgets", async () => {
  jest.useFakeTimers();
  try {
    client.connect.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 2000)));
    client.query.mockImplementation(() => new Promise(() => {}));
    const res = response();
    const pending = readiness({}, res);
    await jest.advanceTimersByTimeAsync(2999);
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(res.json).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await pending;
    expect(res.status).toHaveBeenCalledWith(503);
    expect(client.end).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

test("a late connection failure after timeout does not send a second response", async () => {
  jest.useFakeTimers();
  try {
    let rejectConnect;
    client.connect.mockImplementation(() => new Promise((resolve, reject) => { rejectConnect = reject; }));
    const res = response();
    const pending = readiness({}, res);
    await jest.advanceTimersByTimeAsync(3000);
    await pending;
    rejectConnect(new Error("Connection terminated"));
    await jest.advanceTimersByTimeAsync(0);
    expect(res.json).toHaveBeenCalledTimes(1);
    expect(client.query).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

test("connection-level errors during a probe are handled as 503", async () => {
  client.query.mockImplementation(() => new Promise(() => {}));
  const res = response();
  const pending = readiness({}, res);
  const [, onError] = client.on.mock.calls.find(([event]) => event === "error");
  onError(new Error("Connection terminated"));
  await pending;
  expect(res.status).toHaveBeenCalledWith(503);
  expect(client.end).toHaveBeenCalledTimes(1);
});
